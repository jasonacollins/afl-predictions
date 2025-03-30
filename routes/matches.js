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
    
    res.render('stats', {
      predictorStats: predictorStats.sort((a, b) => b.accuracy - a.accuracy),
      completedMatches,
      currentUser: req.session.user,
      userPredictions: currentUserPredictions
    });
  } catch (error) {
    console.error('Error generating statistics:', error);
    res.render('error', { error: 'Failed to generate statistics' });
  }
});

module.exports = router;
