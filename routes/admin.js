const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const { getQuery, getOne, runQuery } = require('../models/db');
const { isAuthenticated, isAdmin } = require('./auth');

// Require authentication and admin for all admin routes
router.use(isAuthenticated);
router.use(isAdmin);

// Admin dashboard
router.get('/', async (req, res) => {
  try {
    // Get all predictors
    const predictors = await getQuery(
      'SELECT predictor_id, name, is_admin FROM predictors ORDER BY name'
    );
    
    // Get all rounds for match selection
    const rounds = await getQuery(
      `SELECT DISTINCT round_number 
       FROM matches 
       ORDER BY 
         CASE 
           WHEN round_number = 'OR' THEN 0 
           WHEN round_number LIKE 'Finals%' THEN 100
           WHEN round_number = 'Semi Finals' THEN 101
           WHEN round_number = 'Prelim Finals' THEN 102
           WHEN round_number = 'Grand Final' THEN 103
           ELSE CAST(round_number AS INTEGER) 
         END`
    );
    
    res.render('admin', {
      predictors,
      rounds,
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
    const salt = await bcrypt.genSalt(10);
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
    
    // Sanitize probability value
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

module.exports = router;
