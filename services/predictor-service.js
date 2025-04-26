// services/predictor-service.js
const { getQuery, getOne, runQuery } = require('../models/db');
const bcrypt = require('bcrypt');

const PASSWORD_MIN_LENGTH = 12;

// Get all predictors
async function getAllPredictors() {
  return await getQuery(
    'SELECT predictor_id, name, is_admin, year_joined FROM predictors ORDER BY name'
  );
}

// Get predictor by ID
async function getPredictorById(predictorId) {
  return await getOne(
    'SELECT * FROM predictors WHERE predictor_id = ?',
    [predictorId]
  );
}

// Get predictor by name
async function getPredictorByName(name) {
  return await getOne(
    'SELECT * FROM predictors WHERE name = ?',
    [name]
  );
}

// Create new predictor
async function createPredictor(username, password, isAdmin, yearJoined) {
  const salt = await bcrypt.genSalt(12);
  const hashedPassword = await bcrypt.hash(password, salt);
  
  const isAdminValue = isAdmin ? 1 : 0;
  const yearJoinedValue = yearJoined || new Date().getFullYear();
  
  await runQuery(
    'INSERT INTO predictors (name, password, is_admin, year_joined) VALUES (?, ?, ?, ?)',
    [username, hashedPassword, isAdminValue, yearJoinedValue]
  );
}

// Reset password
async function resetPassword(predictorId, newPassword) {
  const salt = await bcrypt.genSalt(12);
  const hashedPassword = await bcrypt.hash(newPassword, salt);
  
  await runQuery(
    'UPDATE predictors SET password = ? WHERE predictor_id = ?',
    [hashedPassword, predictorId]
  );
}

// Delete predictor
async function deletePredictor(predictorId) {
  // Delete predictions first (foreign key constraint)
  await runQuery(
    'DELETE FROM predictions WHERE predictor_id = ?',
    [predictorId]
  );
  
  // Delete the predictor
  await runQuery(
    'DELETE FROM predictors WHERE predictor_id = ?',
    [predictorId]
  );
}

async function getPredictorsWithAdminStatus() {
  return await getQuery(
    'SELECT predictor_id, name, is_admin FROM predictors ORDER BY name'
  );
}

module.exports = {
  PASSWORD_MIN_LENGTH,
  getAllPredictors,
  getPredictorById,
  getPredictorByName,
  createPredictor,
  resetPassword,
  deletePredictor,
  getPredictorsWithAdminStatus
};
