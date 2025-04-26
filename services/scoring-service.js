// services/scoring-service.js
/**
 * Centralized scoring service for AFL predictions
 * This file is designed to work in both Node.js and browser environments
 */

// Calculate Brier score: lower is better (0-1 range)
function calculateBrierScore(predictedProbability, actualOutcome) {
  // Convert percentage to probability (0-1)
  const probability = predictedProbability / 100;
  // Brier score is (forecast - outcome)^2
  return Math.pow(probability - actualOutcome, 2);
}

// Calculate Bits score: higher is better
function calculateBitsScore(predictedProbability, actualOutcome) {
  // Convert percentage to probability (0-1)
  const probability = predictedProbability / 100;
  
  // Avoid log(0) by setting minimum probability
  const safeProb = Math.max(0.001, Math.min(0.999, probability));
  
  if (actualOutcome === 1) {
    // If home team won (actualOutcome = 1)
    return 1 + Math.log2(safeProb);
  } else if (actualOutcome === 0) {
    // If away team won (actualOutcome = 0)
    return 1 + Math.log2(1 - safeProb);
  } else {
    // For draws (actualOutcome = 0.5)
    // Use proximity to 0.5 as the measure
    return 1 + Math.log2(1 - Math.abs(0.5 - safeProb));
  }
}

// Calculate tip correctness with revised logic for 50% predictions
function calculateTipPoints(predictedProbability, homeScore, awayScore, tippedTeam = 'home') {
  // Determine actual outcome
  const homeWon = homeScore > awayScore;
  const awayWon = homeScore < awayScore;
  const tie = homeScore === awayScore;
  
  // For 50% predictions, use the tipped team
  if (predictedProbability === 50) {
    if (tie) {
      return 0; // No points for a draw with 50% prediction
    }
    return (homeWon && tippedTeam === 'home') || (awayWon && tippedTeam === 'away') ? 1 : 0;
  } 
  
  // For other predictions, standard logic
  if (tie) {
    return 0; // No points for a draw
  }
  
  return (homeWon && predictedProbability > 50) || (awayWon && predictedProbability < 50) ? 1 : 0;
}

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calculateBrierScore,
    calculateBitsScore,
    calculateTipPoints
  };
}

// Export for browser
if (typeof window !== 'undefined') {
  window.calculateBrierScore = calculateBrierScore;
  window.calculateBitsScore = calculateBitsScore;
  window.calculateTipPoints = calculateTipPoints;
}