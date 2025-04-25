const express = require('express');
const router = express.Router();
const { getQuery, getOne, runQuery } = require('../models/db');
const { isAuthenticated } = require('./auth');
const scoringService = require('../services/scoring-service');

// Require authentication for all matches routes
router.use(isAuthenticated);

// This function ensures all predictors have predictions for all completed matches
async function ensureDefaultPredictions(selectedYear) {
  try {
    // Get all predictors with their year_joined
    const predictors = await getQuery('SELECT predictor_id, year_joined FROM predictors');
    
    // Get all completed matches for the selected year with match dates
    const completedMatches = await getQuery(`
      SELECT match_id, match_date 
      FROM matches 
      WHERE hscore IS NOT NULL 
      AND ascore IS NOT NULL
      AND year = ?
    `, [selectedYear]);
    
    // Current date for comparison
    const currentDate = new Date();
    
    // For each predictor, check if they have predictions for all completed matches
    for (const predictor of predictors) {
      // Skip if predictor joined after the selected year
      if (predictor.year_joined && predictor.year_joined > selectedYear) {
        console.log(`Skipping predictor ${predictor.predictor_id}: joined in ${predictor.year_joined}, selected year is ${selectedYear}`);
        continue;
      }
      
      for (const match of completedMatches) {
        // Only create default predictions for matches that have already occurred
        let matchInPast = true;
        
        if (match.match_date) {
          try {
            const matchDate = new Date(match.match_date);
            // Check if matchDate is valid and in the past
            if (!isNaN(matchDate.getTime()) && matchDate > currentDate) {
              matchInPast = false;
            }
          } catch (err) {
            console.error(`Error parsing match date: ${match.match_date}`);
          }
        }
        
        // Skip if the match is in the future
        if (!matchInPast) {
          continue;
        }
        
        // Check if the predictor has a prediction for this match
        const existingPrediction = await getOne(`
          SELECT * FROM predictions 
          WHERE predictor_id = ? AND match_id = ?
        `, [predictor.predictor_id, match.match_id]);
        
        // If no prediction exists, create a default one (50% with home team tip)
        if (!existingPrediction) {
          await runQuery(`
            INSERT INTO predictions 
            (match_id, predictor_id, home_win_probability, tipped_team) 
            VALUES (?, ?, 50, 'home')
          `, [match.match_id, predictor.predictor_id]);
          
          console.log(`Created default prediction for predictor ${predictor.predictor_id}, match ${match.match_id}`);
        }
      }
    }
    
    console.log('Default predictions created successfully');
  } catch (error) {
    console.error('Error creating default predictions:', error);
  }
}

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
       t1.abbrev as home_team_abbrev,
       t2.name as away_team,
       t2.abbrev as away_team_abbrev 
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
    let yearQuery = 'SELECT DISTINCT year FROM matches ORDER BY year DESC';
    if (!req.session.isAdmin) {
      yearQuery = 'SELECT DISTINCT year FROM matches WHERE year >= 2022 ORDER BY year DESC';
    }
    const years = await getQuery(yearQuery);
    
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
    let yearQuery = 'SELECT DISTINCT year FROM matches ORDER BY year DESC';
    if (!req.session.isAdmin) {
      yearQuery = 'SELECT DISTINCT year FROM matches WHERE year >= 2022 ORDER BY year DESC';
    }
    const years = await getQuery(yearQuery);    
    
    // Ensure all predictors have predictions for completed matches
    await ensureDefaultPredictions(selectedYear);
    
    // Get all predictors, but include admin status
    const predictors = await getQuery(
      'SELECT predictor_id, name, is_admin FROM predictors ORDER BY name'
    );
    
    // Get matches with results for the selected year
    const completedMatches = await getQuery(`
      SELECT m.*, 
             t1.name as home_team, 
             t1.abbrev as home_team_abbrev,
             t2.name as away_team,
             t2.abbrev as away_team_abbrev 
      FROM matches m
      JOIN teams t1 ON m.home_team_id = t1.team_id
      JOIN teams t2 ON m.away_team_id = t2.team_id
      WHERE m.hscore IS NOT NULL AND m.ascore IS NOT NULL
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
      AND m.hscore IS NOT NULL AND m.ascore IS NOT NULL
      AND m.year = ?
    `, [req.session.user.id, selectedYear]);
    
    // Calculate accuracy for each predictor with additional metrics
    const predictorStats = [];
    
    for (const predictor of predictors) {
      // Get all predictions for this predictor with results for the selected year
      const predictionResults = await getQuery(`
        SELECT p.*, m.hscore, m.ascore
        FROM predictions p
        JOIN matches m ON p.match_id = m.match_id
        WHERE p.predictor_id = ?
        AND m.hscore IS NOT NULL AND m.ascore IS NOT NULL
        AND m.year = ?
      `, [predictor.predictor_id, selectedYear]);
      
      let tipPoints = 0;
      let totalBrierScore = 0;
      let totalBitsScore = 0;
      let totalPredictions = predictionResults.length;
      
      // Calculate metrics for each prediction
      predictionResults.forEach(pred => {
        const homeWon = pred.hscore > pred.ascore;
        const awayWon = pred.hscore < pred.ascore;
        const tie = pred.hscore === pred.ascore;
        
        // Determine outcome (1 if home team won, 0.5 if tie, 0 if away team won)
        const actualOutcome = homeWon ? 1 : (tie ? 0.5 : 0);
        
        // Use scoring service
        const brierScore = scoringService.calculateBrierScore(pred.home_win_probability, actualOutcome);
        totalBrierScore += brierScore;
        
        const bitsScore = scoringService.calculateBitsScore(pred.home_win_probability, actualOutcome);
        totalBitsScore += bitsScore;
        
        // Get tipped team (default to home if not stored)
        const tippedTeam = pred.tipped_team || 'home';
        
        // Calculate tip points
        const tipPointsForPred = scoringService.calculateTipPoints(pred.home_win_probability, pred.hscore, pred.ascore, tippedTeam);
        tipPoints += tipPointsForPred;
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
    
    // Filter out admin users from leaderboard
    const filteredPredictorStats = predictorStats.filter(stat => {
      const predictor = predictors.find(p => p.predictor_id === stat.id);
      return predictor && !predictor.is_admin;
    });

    // Sort by Brier score (lower is better)
    filteredPredictorStats.sort((a, b) => parseFloat(a.brierScore) - parseFloat(b.brierScore));

    res.render('stats', {
      years,
      selectedYear,
      predictorStats: filteredPredictorStats,
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