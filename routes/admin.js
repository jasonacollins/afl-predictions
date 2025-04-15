const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const { getQuery, getOne, runQuery } = require('../models/db');
const { isAuthenticated, isAdmin } = require('./auth');

// Require authentication and admin for all admin routes
router.use(isAuthenticated);
router.use(isAdmin);

// Password strength validation
function isStrongPassword(password) {
  // At least 8 chars, including uppercase, lowercase, number, and special char
  const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  return regex.test(password);
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
    const predictors = await getQuery(
      'SELECT predictor_id, name, is_admin FROM predictors ORDER BY name'
    );
    
    // Get all rounds for the selected year
    const rounds = await getQuery(
      `SELECT DISTINCT round_number 
       FROM matches 
       WHERE year = ?
       ORDER BY 
         CASE 
           WHEN round_number = 'OR' THEN 0 
           WHEN round_number LIKE '%' AND CAST(round_number AS INTEGER) BETWEEN 1 AND 99 THEN CAST(round_number AS INTEGER)
           WHEN round_number = 'Elimination Final' THEN 100
           WHEN round_number = 'Qualifying Final' THEN 101
           WHEN round_number = 'Semi Final' THEN 102
           WHEN round_number = 'Preliminary Final' THEN 103
           WHEN round_number = 'Grand Final' THEN 104
           ELSE 999
         END`,
      [selectedYear]
    );
    
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
    const { username, password, isAdmin } = req.body;
    
    // Validate input
    if (!username || !password) {
      return res.redirect('/admin?error=Username and password are required');
    }
    
    // Check if user already exists
    const existingUser = await getOne(
      'SELECT * FROM predictors WHERE name = ?',
      [username]
    );
    
    if (existingUser) {
      return res.redirect('/admin?error=User already exists');
    }
    
    // Hash password
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Convert isAdmin to integer (checkbox value)
    const isAdminValue = isAdmin === 'on' ? 1 : 0;
    
    // Insert new predictor
    await runQuery(
      'INSERT INTO predictors (name, password, is_admin) VALUES (?, ?, ?)',
      [username, hashedPassword, isAdminValue]
    );
    
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
    const predictions = await getQuery(
      'SELECT * FROM predictions WHERE predictor_id = ?',
      [userId]
    );
    
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
      // Delete the prediction
      await runQuery(
        'DELETE FROM predictions WHERE match_id = ? AND predictor_id = ?',
        [matchId, userId]
      );
      return res.json({ success: true, action: 'deleted' });
    }
    
    // Sanitize probability value for actual predictions
    let prob = parseInt(probability);
    if (isNaN(prob)) prob = 50;
    if (prob < 0) prob = 0;
    if (prob > 100) prob = 100;
    
    // Check if prediction exists
    const existing = await getOne(
      'SELECT * FROM predictions WHERE match_id = ? AND predictor_id = ?',
      [matchId, userId]
    );
    
    if (existing) {
      await runQuery(
        'UPDATE predictions SET home_win_probability = ? WHERE match_id = ? AND predictor_id = ?',
        [prob, matchId, userId]
      );
    } else {
      await runQuery(
        'INSERT INTO predictions (match_id, predictor_id, home_win_probability) VALUES (?, ?, ?)',
        [matchId, userId, prob]
      );
    }
    
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
      WHERE m.home_score IS NOT NULL AND m.away_score IS NOT NULL
      ORDER BY m.match_date DESC
    `);
    
    // Get all predictions for completed matches
    const predictions = await getQuery(`
      SELECT p.*, pr.name as predictor_name 
      FROM predictions p
      JOIN predictors pr ON p.predictor_id = pr.predictor_id
      JOIN matches m ON p.match_id = m.match_id
      WHERE m.home_score IS NOT NULL AND m.away_score IS NOT NULL
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
        const homeWon = match.home_score > match.away_score;
        const awayWon = match.home_score < match.away_score;
        const tie = match.home_score === match.away_score;
        
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
    const predictions = await getQuery(`
      SELECT 
        p.prediction_id,
        p.match_id,
        p.predictor_id,
        p.home_win_probability,
        p.prediction_time,
        p.tipped_team,
        pr.name as predictor_name,
        m.match_number,
        m.round_number,
        m.match_date,
        t1.name as home_team,
        t2.name as away_team,
        m.home_score,
        m.away_score
      FROM predictions p
      JOIN predictors pr ON p.predictor_id = pr.predictor_id
      JOIN matches m ON p.match_id = m.match_id
      JOIN teams t1 ON m.home_team_id = t1.team_id
      JOIN teams t2 ON m.away_team_id = t2.team_id
      ORDER BY pr.name, m.match_date
    `);
    
    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=afl-predictions-export.csv');
    
    // Create CSV header with new metrics columns
    let csvData = 'Predictor,Round,Match Number,Match Date,Home Team,Away Team,Home Win %,Away Win %,Tipped Team,Home Score,Away Score,Correct,Tip Points,Brier Score,Bits Score\n';
    
    // Add prediction rows
    predictions.forEach(prediction => {
      const homeWon = prediction.home_score !== null && prediction.away_score !== null && 
                    prediction.home_score > prediction.away_score;
      const awayWon = prediction.home_score !== null && prediction.away_score !== null && 
                    prediction.home_score < prediction.away_score;
      const tie = prediction.home_score !== null && prediction.away_score !== null && 
                prediction.home_score === prediction.away_score;
      
      // Default tipped team for 50% predictions if not stored
      let tippedTeam = prediction.tipped_team || 'home';
      
      let correct = '';
      let tipPoints = 0;
      let brierScore = '';
      let bitsScore = '';
      
      if (prediction.home_score !== null && prediction.away_score !== null) {
        // For 50% predictions, use the tipped team to determine correctness
        if (prediction.home_win_probability === 50) {
          if (tie) {
            correct = 'No';
            tipPoints = 0;
          } else {
            const correctPrediction = (homeWon && tippedTeam === 'home') || (awayWon && tippedTeam === 'away');
            correct = correctPrediction ? 'Yes' : 'No';
            tipPoints = correctPrediction ? 1.0 : 0.0;
          }
        } else {
          // For other predictions, use standard logic
          const correctPrediction = 
            (homeWon && prediction.home_win_probability > 50) || 
            (awayWon && prediction.home_win_probability < 50);
            
          correct = correctPrediction ? 'Yes' : 'No';
          
          if (tie) {
            tipPoints = 0;
          } else {
            tipPoints = correctPrediction ? 1.0 : 0.0;
          }
        }
        
        // Calculate Brier score
        const prob = prediction.home_win_probability / 100;
        const actualOutcome = homeWon ? 1 : (tie ? 0.5 : 0);
        brierScore = Math.pow(prob - actualOutcome, 2).toFixed(4);
        
        // Calculate Bits score
        try {
          const safeProb = Math.max(0.001, Math.min(0.999, prob));
          if (homeWon) {
            bitsScore = (1 + Math.log2(safeProb)).toFixed(4);
          } else if (awayWon) {
            bitsScore = (1 + Math.log2(1 - safeProb)).toFixed(4);
          } else { // tie
            bitsScore = (1 + Math.log2(1 - Math.abs(0.5 - safeProb))).toFixed(4);
          }
        } catch (error) {
          console.error('Error calculating bits score:', error);
          bitsScore = 'Error';
        }
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
      csvData += `${prediction.home_score || ''},`;
      csvData += `${prediction.away_score || ''},`;
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
    
    // Check password strength
    if (!isStrongPassword(newPassword)) {
      return res.redirect('/admin?error=Password must be at least 8 characters and include uppercase, lowercase, number, and special character');
    }
    
    // Check if user exists
    const user = await getOne(
      'SELECT * FROM predictors WHERE predictor_id = ?',
      [userId]
    );
    
    if (!user) {
      return res.redirect('/admin?error=User not found');
    }
    
    // Hash new password
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    
    // Update password
    await runQuery(
      'UPDATE predictors SET password = ? WHERE predictor_id = ?',
      [hashedPassword, userId]
    );
    
    res.redirect('/admin?success=Password reset successfully');
  } catch (error) {
    console.error('Error resetting password:', error);
    res.redirect('/admin?error=Failed to reset password');
  }
});

// Manual API refresh route
router.post('/refresh-data', async (req, res) => {
  try {
    const year = req.body.year || new Date().getFullYear();
    console.log(`Manual refresh initiated for year ${year}`);
    
    // Import the sync functions with error handling
    let syncModule;
    try {
      syncModule = require('../scripts/sync-games');
      console.log('Available exports:', Object.keys(syncModule));
    } catch (importError) {
      console.error('Error importing sync-games module:', importError);
      return res.status(500).json({
        success: false,
        message: 'Failed to import data sync module',
        error: importError.message
      });
    }
    
    // Verify the function exists
    if (!syncModule.syncGamesFromAPI) {
      console.error('syncGamesFromAPI function not found in module');
      return res.status(500).json({
        success: false,
        message: 'Data sync function not found'
      });
    }
    
    // Call the function with timeout to prevent hanging
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('API sync timed out after 30 seconds')), 30000);
    });
    
    const results = await Promise.race([
      syncModule.syncGamesFromAPI({ year: parseInt(year) }),
      timeoutPromise
    ]);
    
    console.log('API sync results:', results);
    
    // Return the results
    return res.json({
      success: true,
      message: `API refresh complete. Inserted: ${results.insertCount}, Updated: ${results.updateCount}, Skipped: ${results.skipCount}`,
      results
    });
  } catch (error) {
    console.error('API refresh error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to refresh data from API',
      error: error.message
    });
  }
});

// Safe refresh route with simplified functionality
router.post('/safe-refresh', async (req, res) => {
  try {
    const year = req.body.year || new Date().getFullYear();
    console.log(`Safe refresh initiated for year ${year}`);
    
    // Just log the success without actually calling the sync function
    return res.json({
      success: true,
      message: `Safe refresh simulated for year ${year}`,
      note: "This doesn't actually sync data - it just tests the route"
    });
  } catch (error) {
    console.error('Safe refresh error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error in safe refresh route',
      error: error.message
    });
  }
});

// Test import route
router.post('/test-import', async (req, res) => {
  try {
    const year = req.body.year || new Date().getFullYear();
    console.log(`Test import for year ${year}`);
    
    // Just import the module and verify functions exist
    const syncModule = require('../scripts/sync-games');
    
    return res.json({
      success: true,
      message: `Module imported successfully`,
      functions: Object.keys(syncModule),
      syncFunctionExists: !!syncModule.syncGamesFromAPI
    });
  } catch (error) {
    console.error('Import test error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error importing module',
      error: error.message
    });
  }
});

// New API refresh route
router.post('/api-refresh', async (req, res) => {
  try {
    const year = req.body.year || new Date().getFullYear();
    console.log(`API refresh requested for year ${year}`);
    
    // Import the new module
    const { refreshAPIData } = require('../scripts/api-refresh');
    
    // Call the function
    const result = await refreshAPIData(parseInt(year));
    
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

module.exports = router;