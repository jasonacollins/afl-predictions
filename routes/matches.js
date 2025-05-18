const express = require('express');
const router = express.Router();
const { getQuery, getOne, runQuery } = require('../models/db');
const { isAuthenticated } = require('./auth');
const scoringService = require('../services/scoring-service');
const roundService = require('../services/round-service');
const matchService = require('../services/match-service');
const predictionService = require('../services/prediction-service');
const predictorService = require('../services/predictor-service');
const { catchAsync, createValidationError, createNotFoundError } = require('../utils/error-handler');
const { logger } = require('../utils/logger');

// Require authentication for all matches routes
router.use(isAuthenticated);

// This function ensures all predictors have predictions for all completed matches
const ensureDefaultPredictions = catchAsync(async (selectedYear) => {
  logger.info(`Starting default predictions check for year ${selectedYear}`);
  
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
  let defaultPredictionsCreated = 0;
  
  // For each predictor, check if they have predictions for all completed matches
  for (const predictor of predictors) {
    // Skip if predictor joined after the selected year
    if (predictor.year_joined && predictor.year_joined > selectedYear) {
      logger.debug(`Skipping predictor ${predictor.predictor_id}: joined in ${predictor.year_joined}, selected year is ${selectedYear}`);
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
          logger.error('Error parsing match date', { 
            matchDate: match.match_date,
            error: err.message 
          });
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
        
        defaultPredictionsCreated++;
        logger.debug(`Created default prediction for predictor ${predictor.predictor_id}, match ${match.match_id}`);
      }
    }
  }
  
  logger.info(`Default predictions check completed - created ${defaultPredictionsCreated} predictions`);
});

// Get all matches
router.get('/round/:round', catchAsync(async (req, res) => {
  const round = req.params.round;
  const year = req.query.year || new Date().getFullYear();
  
  logger.debug(`Fetching matches for round ${round}, year ${year}`);
  
  // Get matches for the specific round and year
  const matches = await matchService.getMatchesByRoundAndYear(round, year);
  
  res.json(matches);
}));

// Get all rounds
router.get('/', catchAsync(async (req, res) => {
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
  const rounds = await roundService.getRoundsForYear(selectedYear);
  
  res.json(rounds);
}));

// Get stats page
router.get('/stats', catchAsync(async (req, res) => {
  const startTime = Date.now();
  
  // Get the selected year or default to current year
  const currentYear = new Date().getFullYear();
  const selectedYear = req.query.year ? parseInt(req.query.year) : currentYear;
  
  logger.info(`Stats page accessed by user ${req.session.user.id} for year ${selectedYear}`);
  
  // Get all available years
  let yearQuery = 'SELECT DISTINCT year FROM matches ORDER BY year DESC';
  if (!req.session.isAdmin) {
    yearQuery = 'SELECT DISTINCT year FROM matches WHERE year >= 2022 ORDER BY year DESC';
  }
  const years = await getQuery(yearQuery);    
  
  // Ensure all predictors have predictions for completed matches
  await ensureDefaultPredictions(selectedYear);
  
  // Get all predictors, but include admin status
  const predictors = await predictorService.getPredictorsWithAdminStatus();
  
  // Get matches with results for the selected year
  const completedMatches = await matchService.getCompletedMatchesForYear(selectedYear);
  
  // Get current user's predictions for completed matches in the selected year
  const userPredictions = await predictionService.getPredictionsForUser(req.session.user.id);
  
  // Calculate accuracy for each predictor with additional metrics
  const predictorStats = [];
  
  for (const predictor of predictors) {
    // Get all predictions for this predictor with results for the selected year
    const predictionResults = await predictionService.getPredictionsWithResultsForYear(predictor.predictor_id, selectedYear);
    
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
      display_name: predictor.display_name,
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
        logger.error('Error formatting date for stats', { 
          matchDate: match.match_date, 
          error: error.message 
        });
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

  const processingTime = Date.now() - startTime;
  logger.info(`Stats page generated in ${processingTime}ms`, {
    userId: req.session.user.id,
    year: selectedYear,
    predictorCount: predictorStats.length,
    matchCount: completedMatches.length
  });

  res.render('stats', {
    years,
    selectedYear,
    predictorStats: filteredPredictorStats,
    completedMatches,
    userPredictions,
    currentUser: req.session.user
  });
}));

module.exports = router;