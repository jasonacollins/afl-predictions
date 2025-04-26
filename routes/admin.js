const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const { getQuery, getOne, runQuery } = require('../models/db');
const { isAuthenticated, isAdmin } = require('./auth');
const sqlite3 = require('sqlite3').verbose();
const scoringService = require('../services/scoring-service');
const roundService = require('../services/round-service');
const matchService = require('../services/match-service');
const predictionService = require('../services/prediction-service');
const predictorService = require('../services/predictor-service');

// Require authentication and admin for all admin routes
router.use(isAuthenticated);
router.use(isAdmin);

// Password strength validation
function isStrongPassword(password) {
  // At least 12 characters
  return password && password.length >= 12;
}

// Admin dashboard
router.get('/', async (req, res) => {
  try {
    // Get selected year or default to current year
    const currentYear = new Date().getFullYear();
    const selectedYear = req.query.year ? parseInt(req.query.year) : currentYear;
    
    // Get all available years
    const years = await getQuery(
      'SELECT DISTINCT year FROM matches ORDER BY year DESC'
    );
    
    // Get all predictors
    const predictors = await predictorService.getAllPredictors();
    
    // Get all rounds for the selected year
    const rounds = await roundService.getRoundsForYear(selectedYear);
    
    res.render('admin', {
      predictors,
      rounds,
      years,
      selectedYear,
      selectedUser: null,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Error loading admin dashboard:', error);
    res.render('error', { error: 'Failed to load admin dashboard' });
  }
});

// Add new predictor
router.post('/predictors', async (req, res) => {
  try {
    const { username, password, isAdmin, yearJoined } = req.body;
    
    // Validate input
    if (!username || !password) {
      return res.redirect('/admin?error=Username and password are required');
    }
    
    // Check password length
    if (password.length < predictorService.PASSWORD_MIN_LENGTH) {
      return res.redirect(`/admin?error=Password must be at least ${predictorService.PASSWORD_MIN_LENGTH} characters`);
    }
    
    // Check if user already exists
    const existingUser = await predictorService.getPredictorByName(username);
    
    if (existingUser) {
      return res.redirect('/admin?error=User already exists');
    }
    
    // Create new predictor
    const isAdminValue = isAdmin === 'on';
    await predictorService.createPredictor(username, password, isAdminValue, yearJoined);
    
    res.redirect('/admin?success=Predictor added successfully');
  } catch (error) {
    console.error('Error adding predictor:', error);
    res.redirect('/admin?error=Failed to add predictor');
  }
});

// Get predictions for a specific user
router.get('/predictions/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    
    // Check if user exists
    const user = await getOne(
      'SELECT * FROM predictors WHERE predictor_id = ?',
      [userId]
    );
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get predictions for this user
    const predictions = await predictionService.getPredictionsForUser(userId);
    
    // Convert to a map format for the frontend
    const predictionsMap = {};
    predictions.forEach(pred => {
      predictionsMap[pred.match_id] = pred.home_win_probability;
    });
    
    res.json({
      success: true,
      predictions: predictionsMap
    });
  } catch (error) {
    console.error('Error fetching user predictions:', error);
    res.status(500).json({ error: 'Failed to fetch predictions' });
  }
});

// Make predictions on behalf of a user
router.post('/predictions/:userId/save', async (req, res) => {
  try {
    const userId = req.params.userId;
    const { matchId, probability } = req.body;
    
    // Validate input
    if (!matchId || probability === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Check if user exists
    const user = await getOne(
      'SELECT * FROM predictors WHERE predictor_id = ?',
      [userId]
    );
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if this is a deletion request (empty string or null)
    if (probability === "" || probability === null) {
      await predictionService.deletePrediction(matchId, userId);
      return res.json({ success: true, action: 'deleted' });
    }
    
    // Sanitize probability value for actual predictions
    let prob = parseInt(probability);
    if (isNaN(prob)) prob = 50;
    if (prob < 0) prob = 0;
    if (prob > 100) prob = 100;
    
    await predictionService.savePrediction(matchId, userId, prob);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving prediction:', error);
    res.status(500).json({ error: 'Failed to save prediction' });
  }
});

// Generate statistics page
router.get('/stats', async (req, res) => {
  try {
    // Get all predictors
    const predictors = await getQuery(
      'SELECT predictor_id, name FROM predictors ORDER BY name'
    );
    
    // Get total predictions per user
    const predictionCounts = await getQuery(`
      SELECT predictor_id, COUNT(*) as count 
      FROM predictions 
      GROUP BY predictor_id
    `);
    
    // Create a map of predictor_id to prediction count
    const countsMap = {};
    predictionCounts.forEach(row => {
      countsMap[row.predictor_id] = row.count;
    });
    
    // Get matches with results
    const completedMatches = await getQuery(`
      SELECT m.*, 
             t1.name as home_team, 
             t2.name as away_team 
      FROM matches m
      JOIN teams t1 ON m.home_team_id = t1.team_id
      JOIN teams t2 ON m.away_team_id = t2.team_id
      WHERE m.hscore IS NOT NULL AND m.ascore IS NOT NULL
      ORDER BY m.match_date DESC
    `);
    
    // Get all predictions for completed matches
    const predictions = await getQuery(`
      SELECT p.*, pr.name as predictor_name 
      FROM predictions p
      JOIN predictors pr ON p.predictor_id = pr.predictor_id
      JOIN matches m ON p.match_id = m.match_id
      WHERE m.hscore IS NOT NULL AND m.ascore IS NOT NULL
    `);
    
    // Calculate accuracy for each predictor
    const predictorStats = {};
    
    predictors.forEach(predictor => {
      predictorStats[predictor.predictor_id] = {
        id: predictor.predictor_id,
        name: predictor.name,
        totalPredictions: countsMap[predictor.predictor_id] || 0,
        correct: 0,
        incorrect: 0,
        accuracy: 0
      };
    });
    
    // Process predictions
    predictions.forEach(prediction => {
      const match = completedMatches.find(m => m.match_id === prediction.match_id);
      
      if (match) {
        const homeWon = match.hscore > match.ascore;
        const awayWon = match.hscore < match.ascore;
        const tie = match.hscore === match.ascore;
        
        const correctPrediction = 
          (homeWon && prediction.home_win_probability > 50) || 
          (awayWon && prediction.home_win_probability < 50) || 
          (tie && prediction.home_win_probability === 50);
        
        const predictorId = prediction.predictor_id;
        
        if (correctPrediction) {
          predictorStats[predictorId].correct++;
        } else {
          predictorStats[predictorId].incorrect++;
        }
      }
    });
    
    // Calculate final accuracy
    Object.values(predictorStats).forEach(stats => {
      const total = stats.correct + stats.incorrect;
      stats.accuracy = total > 0 ? ((stats.correct / total) * 100).toFixed(1) : 0;
    });
    
    res.render('admin-stats', {
      predictorStats: Object.values(predictorStats).sort((a, b) => b.accuracy - a.accuracy),
      completedMatches,
    });
  } catch (error) {
    console.error('Error generating statistics:', error);
    res.render('error', { error: 'Failed to generate statistics' });
  }
});

// Modified export route from admin.js
router.get('/export/predictions', async (req, res) => {
  try {
    // Get all predictions with related data
    const predictions = await predictionService.getAllPredictionsWithDetails();
    
    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=afl-predictions-export.csv');
    
    // Create CSV header with new metrics columns
    let csvData = 'Predictor,Round,Match Number,Match Date,Home Team,Away Team,Home Win %,Away Win %,Tipped Team,Home Score,Away Score,Correct,Tip Points,Brier Score,Bits Score\n';
    
    // Add prediction rows
    predictions.forEach(prediction => {
      const homeWon = prediction.hscore !== null && prediction.ascore !== null && 
                    prediction.hscore > prediction.ascore;
      const awayWon = prediction.hscore !== null && prediction.ascore !== null && 
                    prediction.hscore < prediction.ascore;
      const tie = prediction.hscore !== null && prediction.ascore !== null && 
                prediction.hscore === prediction.ascore;
      
      // Default tipped team for 50% predictions if not stored
      let tippedTeam = prediction.tipped_team || 'home';
      
      let correct = '';
      let tipPoints = 0;
      let brierScore = '';
      let bitsScore = '';
      
      if (prediction.hscore !== null && prediction.ascore !== null) {
        const homeWon = prediction.hscore > prediction.ascore;
        const awayWon = prediction.hscore < prediction.ascore;
        const tie = prediction.hscore === prediction.ascore;
        
        // Default tipped team for 50% predictions if not stored
        let tippedTeam = prediction.tipped_team || 'home';
        
        // Calculate tip points using scoring service
        tipPoints = scoringService.calculateTipPoints(
          prediction.home_win_probability, 
          prediction.hscore, 
          prediction.ascore, 
          tippedTeam
        );
        
        // Determine actual outcome for scoring
        const actualOutcome = homeWon ? 1 : (tie ? 0.5 : 0);
        
        // Calculate Brier score
        brierScore = scoringService.calculateBrierScore(
          prediction.home_win_probability, 
          actualOutcome
        ).toFixed(4);
        
        // Calculate Bits score
        bitsScore = scoringService.calculateBitsScore(
          prediction.home_win_probability, 
          actualOutcome
        ).toFixed(4);
        
        // Set correct class
        correct = tipPoints === 1 ? 'Yes' : 'No';
      }
      
      // Format date for CSV
      let matchDate = prediction.match_date;
      try {
        if (matchDate && matchDate.includes('T')) {
          const date = new Date(matchDate);
          matchDate = date.toLocaleDateString('en-AU');
        }
      } catch (error) {
        console.error('Error formatting date:', matchDate);
      }
      
      // Show "Home" or "Away" instead of 'home' or 'away'
      const displayTippedTeam = prediction.home_win_probability === 50 
        ? (tippedTeam === 'home' ? prediction.home_team : prediction.away_team)
        : '';
      
      csvData += `"${prediction.predictor_name}",`;
      csvData += `"${prediction.round_number}",`;
      csvData += `${prediction.match_number},`;
      csvData += `"${matchDate}",`;
      csvData += `"${prediction.home_team}",`;
      csvData += `"${prediction.away_team}",`;
      csvData += `${prediction.home_win_probability},`;
      csvData += `${100 - prediction.home_win_probability},`;
      csvData += `"${displayTippedTeam}",`;
      csvData += `${prediction.hscore || ''},`;
      csvData += `${prediction.ascore || ''},`;
      csvData += `"${correct}",`;
      csvData += `${tipPoints.toFixed(1)},`;
      csvData += `${brierScore},`;
      csvData += `${bitsScore}\n`;
    });
    
    // Send CSV data
    res.send(csvData);
  } catch (error) {
    console.error('Error exporting predictions:', error);
    res.status(500).render('error', { error: 'Failed to export predictions' });
  }
});

// Add password reset route
router.post('/reset-password/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const { newPassword } = req.body;
    
    // Validate input
    if (!newPassword) {
      return res.redirect('/admin?error=New password is required');
    }
    
    // Check password length
    if (newPassword.length < predictorService.PASSWORD_MIN_LENGTH) {
      return res.redirect(`/admin?error=Password must be at least ${predictorService.PASSWORD_MIN_LENGTH} characters`);
    }
    
    // Check if user exists
    const user = await predictorService.getPredictorById(userId);
    
    if (!user) {
      return res.redirect('/admin?error=User not found');
    }
    
    // Reset password
    await predictorService.resetPassword(userId, newPassword);
    
    res.redirect('/admin?success=Password reset successfully');
  } catch (error) {
    console.error('Error resetting password:', error);
    res.redirect('/admin?error=Failed to reset password');
  }
});

// API refresh route
router.post('/api-refresh', async (req, res) => {
  try {
    const year = req.body.year || new Date().getFullYear();
    // Get the forceScoreUpdate flag from the request body (default to false)
    const forceScoreUpdate = req.body.forceScoreUpdate === 'true' || req.body.forceScoreUpdate === true;
    
    console.log(`API refresh requested for year ${year} ${forceScoreUpdate ? 'with force update enabled' : ''}`);
    
    // Import the refreshAPIData function
    const { refreshAPIData } = require('../scripts/api-refresh');
    
    // Call the function with the year and options object
    const result = await refreshAPIData(parseInt(year), { forceScoreUpdate });
    
    // Return the result
    return res.json(result);
  } catch (error) {
    console.error('API refresh route error:', error);
    return res.status(500).json({
      success: false,
      message: `Error in API refresh route: ${error.message}`,
      error: error.message
    });
  }
});

// Delete user route
router.post('/delete-user/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    
    // Don't allow deleting the current logged-in user
    if (parseInt(userId) === req.session.user.id) {
      return res.redirect('/admin?error=You cannot delete your own account');
    }
    
    // Check if user exists
    const user = await predictorService.getPredictorById(userId);
    
    if (!user) {
      return res.redirect('/admin?error=User not found');
    }
    
    // Delete the user and their predictions
    await predictorService.deletePredictor(userId);
    
    res.redirect('/admin?success=User deleted successfully');
      } catch (error) {
        console.error('Error deleting user:', error);
        res.redirect('/admin?error=Failed to delete user');
      }
    });

// Database export route
router.get('/export/database', async (req, res) => {
  try {
    const path = require('path');
    const fs = require('fs');
    const { exec } = require('child_process');
    
    // Get database path from models/db.js
    const dbPath = require('../models/db').dbPath || path.join(__dirname, '../data/afl_predictions.db');
    
    // Get current timestamp for filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `afl_predictions_${timestamp}.db`;
    const backupPath = path.join(__dirname, '..', 'data', filename);
    
    // Copy the database file (this is safer than running the backup API)
    fs.copyFile(dbPath, backupPath, (err) => {
      if (err) {
        console.error('Error creating database copy:', err);
        return res.status(500).render('error', { error: 'Failed to create database backup' });
      }
      
      // Send the file for download
      res.download(backupPath, filename, (downloadErr) => {
        if (downloadErr) {
          console.error('Error sending file:', downloadErr);
        }
        
        // Clean up - delete the temporary file after download
        fs.unlink(backupPath, (unlinkErr) => {
          if (unlinkErr) console.error('Error deleting temp file:', unlinkErr);
        });
      });
    });
  } catch (error) {
    console.error('Error exporting database:', error);
    res.status(500).render('error', { error: 'Failed to export database' });
  }
});

module.exports = router;