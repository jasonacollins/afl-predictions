// services/prediction-service.js
const { getQuery, getOne, runQuery } = require('../models/db');

// Get predictions for a specific user
async function getPredictionsForUser(userId) {
  return await getQuery(
    'SELECT * FROM predictions WHERE predictor_id = ?',
    [userId]
  );
}

// Get all predictions with match and predictor information
async function getAllPredictionsWithDetails() {
  return await getQuery(`
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
}

// Save or update prediction
async function savePrediction(matchId, predictorId, probability) {
  const existing = await getOne(
    'SELECT * FROM predictions WHERE match_id = ? AND predictor_id = ?',
    [matchId, predictorId]
  );
  
  if (existing) {
    await runQuery(
      'UPDATE predictions SET home_win_probability = ? WHERE match_id = ? AND predictor_id = ?',
      [probability, matchId, predictorId]
    );
  } else {
    await runQuery(
      'INSERT INTO predictions (match_id, predictor_id, home_win_probability) VALUES (?, ?, ?)',
      [matchId, predictorId, probability]
    );
  }
}

// Delete prediction
async function deletePrediction(matchId, predictorId) {
  await runQuery(
    'DELETE FROM predictions WHERE match_id = ? AND predictor_id = ?',
    [matchId, predictorId]
  );
}

async function getPredictionsWithResultsForYear(predictorId, year) {
  return await getQuery(`
    SELECT p.*, m.hscore, m.ascore
    FROM predictions p
    JOIN matches m ON p.match_id = m.match_id
    WHERE p.predictor_id = ?
    AND m.hscore IS NOT NULL AND m.ascore IS NOT NULL
    AND m.year = ?
  `, [predictorId, year]);
}

module.exports = {
  getPredictionsForUser,
  getAllPredictionsWithDetails,
  savePrediction,
  deletePrediction,
  getPredictionsWithResultsForYear
};
