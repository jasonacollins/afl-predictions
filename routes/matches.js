const express = require('express');
const router = express.Router();
const { getQuery, getOne } = require('../models/db');
const { isAuthenticated } = require('./auth');

// Require authentication for all matches routes
router.use(isAuthenticated);

// Get all matches
router.get('/', async (req, res) => {
  try {
    const round = req.query.round;
    
    let matches;
    if (round) {
      // Get matches for specific round
      matches = await getQuery(
        `SELECT m.*, 
         t1.name as home_team, 
         t2.name as away_team 
         FROM matches m
         JOIN teams t1 ON m.home_team_id = t1.team_id
         JOIN teams t2 ON m.away_team_id = t2.team_id
         WHERE m.round_number = ?
         ORDER BY m.match_number`,
        [round]
      );
    } else {
      // Get all matches
      matches = await getQuery(
        `SELECT m.*, 
         t1.name as home_team, 
         t2.name as away_team 
         FROM matches m
         JOIN teams t1 ON m.home_team_id = t1.team_id
         JOIN teams t2 ON m.away_team_id = t2.team_id
         ORDER BY m.match_number`
      );
    }
    
    res.json(matches);
  } catch (error) {
    console.error('Error fetching matches:', error);
    res.status(500).json({ error: 'Failed to fetch matches' });
  }
});

// Get all rounds
router.get('/rounds', async (req, res) => {
  try {
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
      LIMIT 10
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
        
        if (predictorStats[predictorId]) {
          if (correctPrediction) {
            predictorStats[predictorId].correct++;
          } else {
            predictorStats[predictorId].incorrect++;
          }
        }
      }
    });
    
    // Calculate final accuracy
    Object.values(predictorStats).forEach(stats => {
      const total = stats.correct + stats.incorrect;
      stats.accuracy = total > 0 ? ((stats.correct / total) * 100).toFixed(1) : 0;
    });
    
    res.render('stats', {
      predictorStats: Object.values(predictorStats).sort((a, b) => b.accuracy - a.accuracy),
      completedMatches,
      currentUser: req.session.user
    });
  } catch (error) {
    console.error('Error generating statistics:', error);
    res.render('error', { error: 'Failed to generate statistics' });
  }
});

module.exports = router;
