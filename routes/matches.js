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
    // Get the selected year or default to current year
    const currentYear = new Date().getFullYear();
    const selectedYear = req.query.year ? parseInt(req.query.year) : currentYear;
    
    // Get all available years
    const years = await getQuery(
      'SELECT DISTINCT year FROM matches ORDER BY year DESC'
    );
    
    // Get all predictors
    const predictors = await getQuery(
      'SELECT predictor_id, name FROM predictors ORDER BY name'
    );
    
    // Get matches with results for the selected year
    const completedMatches = await getQuery(`
      SELECT m.*, 
             t1.name as home_team, 
             t2.name as away_team 
      FROM matches m
      JOIN teams t1 ON m.home_team_id = t1.team_id
      JOIN teams t2 ON m.away_team_id = t2.team_id
      WHERE m.home_score IS NOT NULL AND m.away_score IS NOT NULL
      AND m.year = ?
      ORDER BY m.match_date DESC
      LIMIT 10
    `, [selectedYear]);
    
    // Get current user's predictions for completed matches in the selected year
    const userPredictions = await getQuery(`
      SELECT p.*
      FROM predictions p
      JOIN matches m ON p.match_id = m.match_id
      WHERE p.predictor_id = ?
      AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
      AND m.year = ?
    `, [req.session.user.id, selectedYear]);
    
    // Calculate accuracy for each predictor with additional metrics
    const predictorStats = [];
    
    for (const predictor of predictors) {
      // Get all predictions for this predictor with results for the selected year
      const predictionResults = await getQuery(`
        SELECT p.*, m.home_score, m.away_score
        FROM predictions p
        JOIN matches m ON p.match_id = m.match_id
        WHERE p.predictor_id = ?
        AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
        AND m.year = ?
      `, [predictor.predictor_id, selectedYear]);
      
      let tipPoints = 0;
      let totalBrierScore = 0;
      let totalBitsScore = 0;
      let totalPredictions = predictionResults.length;
      
      // Calculate metrics for each prediction
      predictionResults.forEach(pred => {
        const homeWon = pred.home_score > pred.away_score;
        const awayWon = pred.home_score < pred.away_score;
        const tie = pred.home_score === pred.away_score;
        
        // Determine outcome (1 if home team won, 0.5 if tie, 0 if away team won)
        const actualOutcome = homeWon ? 1 : (tie ? 0.5 : 0);
        
        // Calculate Brier score: (forecast - outcome)^2
        const probability = pred.home_win_probability / 100;
        const brierScore = Math.pow(probability - actualOutcome, 2);
        totalBrierScore += brierScore;
        
        // Calculate Bits score
        let bitsScore;
        const safeProb = Math.max(0.001, Math.min(0.999, probability));
        
        if (homeWon) {
          bitsScore = 1 + Math.log2(safeProb);
        } else if (awayWon) {
          bitsScore = 1 + Math.log2(1 - safeProb);
        } else { // tie
          bitsScore = 1 + Math.log2(1 - Math.abs(0.5 - safeProb));
        }
        totalBitsScore += bitsScore;
        
        // Calculate tip points with half-point system
        if (pred.home_win_probability === 50) {
          // Half point for 50% prediction (full point if it was a tie)
          tipPoints += tie ? 1 : 0.5;
        } else if (homeWon && pred.home_win_probability > 50) {
          // Correctly predicted home team win
          tipPoints += 1;
        } else if (awayWon && pred.home_win_probability < 50) {
          // Correctly predicted away team win
          tipPoints += 1;
        } else if (tie) {
          // Half point for any prediction in case of a tie (unless exactly 50%)
          tipPoints += 0.5;
        }
      });
      
      // Calculate averages and percentages
      const avgBrierScore = totalPredictions > 0 ? (totalBrierScore / totalPredictions).toFixed(4) : 0;
      const avgBitsScore = totalPredictions > 0 ? (totalBitsScore / totalPredictions).toFixed(4) : 0;
      const tipAccuracy = totalPredictions > 0 ? ((tipPoints / totalPredictions) * 100).toFixed(1) : 0;
      
      predictorStats.push({
        id: predictor.predictor_id,
        name: predictor.name,
        tipPoints,
        totalPredictions,
        tipAccuracy,
        brierScore: avgBrierScore,
        bitsScore: avgBitsScore
      });
    }
    
    // Sort predictors by tip accuracy (highest first)
    predictorStats.sort((a, b) => parseFloat(b.tipAccuracy) - parseFloat(a.tipAccuracy));
    
    // Format dates for completed matches
    completedMatches.forEach(match => {
      if (match.match_date && match.match_date.includes('T')) {
        try {
          const date = new Date(match.match_date);
          match.match_date = date.toLocaleDateString('en-AU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
          });
        } catch (error) {
          console.error('Error formatting date:', match.match_date);
        }
      }
    });
    
    res.render('stats', {
      years,
      selectedYear,
      predictorStats,
      completedMatches,
      userPredictions,
      currentUser: req.session.user
    });
  } catch (error) {
    console.error('Error generating statistics:', error);
    res.render('error', { error: 'Failed to generate statistics' });
  }
});

module.exports = router;