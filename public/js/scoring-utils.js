/**
 * Utility functions for calculating prediction accuracy
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

// Calculate tip correctness with half-point for 50% predictions
function calculateTipPoints(predictedProbability, homeScore, awayScore) {
  // Convert to probability (0-1)
  const probability = predictedProbability / 100;
  
  // Determine actual outcome
  if (homeScore > awayScore) {
    // Home team won
    if (predictedProbability === 50) {
      return 0.5; // Half point for 50% prediction
    }
    return predictedProbability > 50 ? 1 : 0;
  } 
  else if (homeScore < awayScore) {
    // Away team won
    if (predictedProbability === 50) {
      return 0.5; // Half point for 50% prediction
    }
    return predictedProbability < 50 ? 1 : 0;
  }
  else {
    // Draw
    if (predictedProbability === 50) {
      return 1; // Full point for correctly predicting a draw
    }
    return 0.5; // Half point for any prediction in case of a draw
  }
}

// Export to make available globally
if (typeof window !== 'undefined') {
  window.calculateBrierScore = calculateBrierScore;
  window.calculateBitsScore = calculateBitsScore;
  window.calculateTipPoints = calculateTipPoints;
}

// For Node.js environment if needed
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calculateBrierScore,
    calculateBitsScore,
    calculateTipPoints
  };
}
