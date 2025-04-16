const express = require('express');
const router = express.Router();
const { getQuery, getOne, runQuery } = require('../models/db');
const { isAuthenticated } = require('./auth');

// Require authentication for all prediction routes
router.use(isAuthenticated);

// Get predictions page
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
    
    // Get first round by default
    const selectedRound = rounds.length > 0 ? rounds[0].round_number : null;
    
    // Get matches for the selected round AND year
    let matches = [];
    if (selectedRound) {
      matches = await getQuery(
        `SELECT m.*, 
         t1.name as home_team, 
         t1.abbrev as home_team_abbrev,
         t2.name as away_team,
         t2.abbrev as away_team_abbrev 
         FROM matches m
         JOIN teams t1 ON m.home_team_id = t1.team_id
         JOIN teams t2 ON m.away_team_id = t2.team_id
         WHERE m.round_number = ? AND m.year = ?  /* Add year filter here */
         ORDER BY m.match_number`,
        [selectedRound, selectedYear] /* Add selectedYear to parameters */
      );
      
      // Process matches to add isLocked field
      matches = matches.map(match => {
        let isLocked = false;
        
        if (match.match_date) {
          try {
            // Date should be in ISO format after import
            const matchDate = new Date(match.match_date);
            isLocked = new Date() > matchDate;
          } catch (error) {
            console.error('Error parsing date:', match.match_date);
          }
        }
        
        return {
          ...match,
          isLocked
        };
      });
    }
    
    // Get user predictions
    const predictorId = req.session.user.id;
    const userPredictions = await getQuery(
      'SELECT * FROM predictions WHERE predictor_id = ?',
      [predictorId]
    );
    
    // Create predictions map
    const predictionsMap = {};
    userPredictions.forEach(pred => {
      predictionsMap[pred.match_id] = pred.home_win_probability;
    });
    
    res.render('predictions', {
      years,
      selectedYear,
      rounds,
      selectedRound,
      matches,
      predictions: predictionsMap
    });
  } catch (error) {
    console.error('Error loading predictions page:', error);
    res.render('error', { error: 'Failed to load predictions' });
  }
});

// Get matches for a specific round (AJAX)
router.get('/round/:round', async (req, res) => {
  try {
    const round = req.params.round;
    const year = req.query.year || new Date().getFullYear();
    
    const matches = await getQuery(
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
    
    // Process matches just to determine if they're locked - but don't format the dates
    const processedMatches = matches.map(match => {
      let isLocked = false;
      
      if (match.match_date) {
        try {
          // Date should be in ISO format after import
          const matchDate = new Date(match.match_date);
          isLocked = new Date() > matchDate;
        } catch (error) {
          console.error('Error parsing date:', match.match_date);
        }
      }
      
      // Return match with isLocked flag but keep the original date
      return {
        ...match,
        isLocked
      };
    });
    
    res.json(processedMatches);
  } catch (error) {
    console.error('Error fetching matches:', error);
    res.status(500).json({ error: 'Failed to fetch matches' });
  }
});

// Save prediction
router.post('/save', async (req, res) => {
  try {
    const { matchId, probability } = req.body;
    const predictorId = req.session.user.id;
    
    if (!matchId || probability === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Check if match is locked (except for admins)
    if (!req.session.isAdmin) {
      const match = await getOne(
        `SELECT m.match_date FROM matches m WHERE m.match_id = ?`,
        [matchId]
      );
      
      if (match && match.match_date) {
        try {
          const matchDate = new Date(match.match_date);
          if (new Date() > matchDate) {
            return res.status(403).json({ 
              error: 'This match has started and predictions are locked' 
            });
          }
        } catch (error) {
          console.error('Error checking match lock status:', error);
        }
      }
    }
    
    // Check if this is a deletion request (empty string or null)
    if (probability === "" || probability === null) {
      // Delete the prediction
      await runQuery(
        'DELETE FROM predictions WHERE match_id = ? AND predictor_id = ?',
        [matchId, predictorId]
      );
      return res.json({ success: true, action: 'deleted' });
    }
    
    // Sanitize probability value
    let prob = parseInt(probability);
    if (isNaN(prob)) prob = 50;
    if (prob < 0) prob = 0;
    if (prob > 100) prob = 100;
    
    // Check if prediction exists
    const existing = await getOne(
      'SELECT * FROM predictions WHERE match_id = ? AND predictor_id = ?',
      [matchId, predictorId]
    );
    
    if (existing) {
      await runQuery(
        'UPDATE predictions SET home_win_probability = ? WHERE match_id = ? AND predictor_id = ?',
        [prob, matchId, predictorId]
      );
    } else {
      await runQuery(
        'INSERT INTO predictions (match_id, predictor_id, home_win_probability) VALUES (?, ?, ?)',
        [matchId, predictorId, prob]
      );
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving prediction:', error);
    res.status(500).json({ error: 'Failed to save prediction' });
  }
});

module.exports = router;