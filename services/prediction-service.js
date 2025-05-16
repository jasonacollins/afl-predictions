// services/prediction-service.js
const { getQuery, getOne, runQuery } = require('../models/db');
const { AppError, createNotFoundError, createValidationError } = require('../utils/error-handler');
const { logger } = require('../utils/logger');

// Get predictions for a specific user
async function getPredictionsForUser(userId) {
  try {
    logger.debug(`Fetching predictions for user ID: ${userId}`);
    
    const predictions = await getQuery(
      'SELECT * FROM predictions WHERE predictor_id = ?',
      [userId]
    );
    
    logger.info(`Retrieved ${predictions.length} predictions for user ID: ${userId}`);
    
    return predictions;
  } catch (error) {
    logger.error('Error fetching predictions for user', { 
      userId,
      error: error.message 
    });
    throw new AppError('Failed to fetch predictions', 500, 'DATABASE_ERROR');
  }
}

// Get all predictions with match and predictor information
async function getAllPredictionsWithDetails() {
  try {
    logger.debug('Fetching all predictions with details');
    
    const predictions = await getQuery(`
      SELECT 
        p.*,
        pr.name as predictor_name,
        m.match_number,
        m.round_number,
        m.match_date,
        t1.name as home_team,
        t2.name as away_team,
        m.hscore,
        m.ascore
      FROM predictions p
      JOIN predictors pr ON p.predictor_id = pr.predictor_id
      JOIN matches m ON p.match_id = m.match_id
      JOIN teams t1 ON m.home_team_id = t1.team_id
      JOIN teams t2 ON m.away_team_id = t2.team_id
      ORDER BY pr.name, m.match_date
    `);
    
    logger.info(`Retrieved ${predictions.length} predictions with details`);
    
    return predictions;
  } catch (error) {
    logger.error('Error fetching all predictions with details', { error: error.message });
    throw new AppError('Failed to fetch predictions', 500, 'DATABASE_ERROR');
  }
}

// Save or update prediction
async function savePrediction(matchId, predictorId, probability, options = {}) {  try {
    // Validate inputs
    if (!matchId || !predictorId || probability === undefined) {
      throw createValidationError('Match ID, predictor ID, and probability are required');
    }
    
    if (probability !== null && (probability < 0 || probability > 100)) {
      throw createValidationError('Probability must be between 0 and 100');
    }
    
    logger.debug(`Saving prediction for match ${matchId}, predictor ${predictorId}: ${probability}%`);
    
    const existing = await getOne(
      'SELECT * FROM predictions WHERE match_id = ? AND predictor_id = ?',
      [matchId, predictorId]
    );
    
    if (existing) {
      const result = await runQuery(
        'UPDATE predictions SET home_win_probability = ? WHERE match_id = ? AND predictor_id = ?',
        [probability, matchId, predictorId]
      );
      
      logger.info(`Updated prediction for match ${matchId}, predictor ${predictorId}: ${probability}%`);
      
      return { action: 'updated', changes: result.changes };
    } else {
      const result = await runQuery(
        'INSERT INTO predictions (match_id, predictor_id, home_win_probability) VALUES (?, ?, ?)',
        [matchId, predictorId, probability]
      );
      
      logger.info(`Created new prediction for match ${matchId}, predictor ${predictorId}: ${probability}%`);
      
      return { action: 'created', changes: result.changes };
    }
  } catch (error) {
    if (error.isOperational) {
      throw error; // Re-throw validation errors
    }
    
    logger.error('Error saving prediction', { 
      matchId,
      predictorId,
      probability,
      error: error.message 
    });
    throw new AppError('Failed to save prediction', 500, 'DATABASE_ERROR');
  }
}

// Delete prediction
async function deletePrediction(matchId, predictorId) {
  try {
    if (!matchId || !predictorId) {
      throw createValidationError('Match ID and predictor ID are required');
    }
    
    logger.debug(`Deleting prediction for match ${matchId}, predictor ${predictorId}`);
    
    const result = await runQuery(
      'DELETE FROM predictions WHERE match_id = ? AND predictor_id = ?',
      [matchId, predictorId]
    );
    
    if (result.changes === 0) {
      logger.warn(`No prediction found for match ${matchId}, predictor ${predictorId}`);
      throw createNotFoundError('Prediction');
    }
    
    logger.info(`Deleted prediction for match ${matchId}, predictor ${predictorId}`);
    
    return { changes: result.changes };
  } catch (error) {
    if (error.isOperational) {
      throw error; // Re-throw validation/not found errors
    }
    
    logger.error('Error deleting prediction', { 
      matchId,
      predictorId,
      error: error.message 
    });
    throw new AppError('Failed to delete prediction', 500, 'DATABASE_ERROR');
  }
}

async function getPredictionsWithResultsForYear(predictorId, year) {
  try {
    logger.debug(`Fetching predictions with results for predictor ${predictorId}, year ${year}`);
    
    const predictions = await getQuery(`
      SELECT p.*, m.hscore, m.ascore
      FROM predictions p
      JOIN matches m ON p.match_id = m.match_id
      WHERE p.predictor_id = ?
      AND m.hscore IS NOT NULL AND m.ascore IS NOT NULL
      AND m.year = ?
    `, [predictorId, year]);
    
    logger.info(`Retrieved ${predictions.length} predictions with results for predictor ${predictorId}, year ${year}`);
    
    return predictions;
  } catch (error) {
    logger.error('Error fetching predictions with results for year', { 
      predictorId,
      year,
      error: error.message 
    });
    throw new AppError('Failed to fetch predictions', 500, 'DATABASE_ERROR');
  }
}

module.exports = {
  getPredictionsForUser,
  getAllPredictionsWithDetails,
  savePrediction,
  deletePrediction,
  getPredictionsWithResultsForYear
};
