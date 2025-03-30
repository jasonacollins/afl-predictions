const express = require('express');
const router = express.Router();
const { getQuery, getOne } = require('../models/db');
const { isAuthenticated } = require('./auth');

// Require authentication for all matches routes
router.use(isAuthenticated);

// Get all matches
router.get('/round/:round', async (req, res) => {
  try {
    const round = req.params.round;
    const year = req.query.year || new Date().getFullYear();
    
    let matches;
    
    // Get matches for the specific round and year
    matches = await getQuery(
      `SELECT m.*, 
       t1.name as home_team, 
       t2.name as away_team 
       FROM matches m
       JOIN teams t1 ON m.home_team_id = t1.team_id
       JOIN teams t2 ON m.away_team_id = t2.team_id
       WHERE m.round_number = ? AND m.year = ?
       ORDER BY m.match_number`,
      [round, year]
    );
    
    res.json(matches);
  } catch (error) {
    console.error('Error fetching matches:', error);
    res.status(500).json({ error: 'Failed to fetch matches' });
  }
});

// Get all rounds
router.get('/', async (req, res) => {
  try {
    // Get the selected year or default to current year
    const currentYear = new Date().getFullYear();
    const selectedYear = req.query.year ? parseInt(req.query.year) : currentYear;
    
    // Get all available years
    const years = await getQuery(
      'SELECT DISTINCT year FROM matches ORDER BY year DESC'
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
    
    res.json(rounds);
  } catch (error) {
    console.error('Error fetching rounds:', error);
    res.status(500).json({ error: 'Failed to fetch rounds' });
  }
});

// Get stats page
router.get('/stats', async (req, res) => {
  try {
    // Get all predictors
    const predictors = await getQuery(
      'SELECT predictor_id, name FROM predictors ORDER BY name'
    );
    
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
      LIMIT 10
    `);
    
    // Get current user's predictions for completed matches
    const currentUserPredictions = await getQuery(`
      SELECT p.*
      FROM predictions p
      JOIN matches m ON p.match_id = m.match_id
      WHERE p.predictor_id = ?
      AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
    `, [req.session.user.id]);
    
    // Calculate accuracy for each predictor
    const predictorStats = [];
    
    for (const predictor of predictors) {
      // Get all predictions for this predictor with results
      const predictionResults = await getQuery(`
        SELECT p.*, m.home_score, m.away_score
        FROM predictions p
        JOIN matches m ON p.match_id = m.match_id
        WHERE p.predictor_id = ?
        AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
      `, [predictor.predictor_id]);
      
      let correct = 0;
      let incorrect = 0;
      
      // Calculate correct/incorrect
      predictionResults.forEach(pred => {
        const homeWon = pred.home_score > pred.away_score;
        const awayWon = pred.home_score < pred.away_score;
        const tie = pred.home_score === pred.away_score;
        
        const correctPrediction = 
          (homeWon && pred.home_win_probability > 50) || 
          (awayWon && pred.home_win_probability < 50) || 
          (tie && pred.home_win_probability === 50);
        
        if (correctPrediction) {
          correct++;
        } else {
          incorrect++;
        }
      });
      
      const total = correct + incorrect;
      const accuracy = total > 0 ? ((correct / total) * 100).toFixed(1) : 0;
      
      predictorStats.push({
        id: predictor.predictor_id,
        name: predictor.name,
        correct,
        incorrect,
        accuracy
      });
    }
    
    res.render('predictions', {
      years,
      selectedYear,
      rounds,
      selectedRound,
      matches,
      predictions: predictionsMap
    });
  } catch (error) {
    console.error('Error generating statistics:', error);
    res.render('error', { error: 'Failed to generate statistics' });
  }
});

module.exports = router;
