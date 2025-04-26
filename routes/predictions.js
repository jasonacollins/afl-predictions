const express = require('express');
const router = express.Router();
const { getQuery, getOne, runQuery } = require('../models/db');
const { isAuthenticated } = require('./auth');
const scoringService = require('../services/scoring-service');
const roundService = require('../services/round-service');
const matchService = require('../services/match-service');
const predictionService = require('../services/prediction-service');
const predictorService = require('../services/predictor-service');

// Require authentication for all prediction routes
router.use(isAuthenticated);

// Get predictions page
router.get('/', async (req, res) => {
  try {
    // Get the selected year or default to current year
    const currentYear = new Date().getFullYear();
    const selectedYear = req.query.year ? parseInt(req.query.year) : currentYear;
    
    // Get all available years (filtered for non-admin users)
    let yearQuery = 'SELECT DISTINCT year FROM matches ORDER BY year DESC';
    if (!req.session.isAdmin) {
      // Get the user's year_joined
      const user = await getOne('SELECT year_joined FROM predictors WHERE predictor_id = ?', [req.session.user.id]);
      const userYearJoined = user.year_joined || 2022;
      
      // Filter years based on when the user joined
      yearQuery = `SELECT DISTINCT year FROM matches WHERE year >= ${userYearJoined} ORDER BY year DESC`;
    }
    const years = await getQuery(yearQuery);
        
    // Get all rounds for the selected year
    const rounds = await roundService.getRoundsForYear(selectedYear);
    
    // Find the earliest round with incomplete matches (where complete != 100)
    let selectedRound = null;
    if (!req.query.round) { // Only auto-select if round not specified in URL
      const incompleteRound = await getOne(
        `SELECT m.round_number 
         FROM matches m 
         WHERE m.year = ? AND (m.complete IS NULL OR m.complete != 100)
         ORDER BY ${roundService.ROUND_ORDER_SQL},
         m.match_date
         LIMIT 1`,
        [selectedYear]
      );
      
      if (incompleteRound) {
        selectedRound = incompleteRound.round_number;
      }
    }
    
    // If no incomplete round found or round is specified in query, use the first round or query parameter
    if (!selectedRound) {
      selectedRound = req.query.round || (rounds.length > 0 ? rounds[0].round_number : null);
    }
    
    // Get matches for the selected round AND year
    let matches = [];
    if (selectedRound) {
      matches = await matchService.getMatchesByRoundAndYear(selectedRound, selectedYear);
      matches = matchService.processMatchLockStatus(matches);
    }
    
    // Get user predictions
    const predictorId = req.session.user.id;
    const userPredictions = await predictionService.getPredictionsForUser(req.session.user.id);
    
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
      predictions: predictionsMap,
      calculateTipPoints: scoringService.calculateTipPoints,
      calculateBrierScore: scoringService.calculateBrierScore,
      calculateBitsScore: scoringService.calculateBitsScore
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
    
    const matches = await matchService.getMatchesByRoundAndYear(round, year);
    const processedMatches = matchService.processMatchLockStatus(matches);
    
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
    
    // Check if match is locked (now applies to ALL users on this route)
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
        // Optionally, you might want to prevent saving if the date is invalid
        // return res.status(500).json({ error: 'Error checking match status' });
      }
    }
    
    // Check if this is a deletion request (empty string or null)
    if (probability === "" || probability === null) {
      await predictionService.deletePrediction(matchId, predictorId);
      return res.json({ success: true, action: 'deleted' });
    }

    // Sanitize probability value
    let prob = parseInt(probability);
    if (isNaN(prob)) prob = 50;
    if (prob < 0) prob = 0;
    if (prob > 100) prob = 100;
    
    await predictionService.savePrediction(matchId, predictorId, prob);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving prediction:', error);
    res.status(500).json({ error: 'Failed to save prediction' });
  }
});

module.exports = router;