// Modified version of public/js/main.js
document.addEventListener('DOMContentLoaded', function() {
  // Format all existing date elements on the page
  const dateElements = document.querySelectorAll('.match-date');
  dateElements.forEach(element => {
    const originalDate = element.textContent;
    if (originalDate && originalDate.includes('T')) {
      element.setAttribute('data-original-date', originalDate);
      element.textContent = formatDateToLocalTimezone(originalDate);
    }
  });
  
  // Handle round selection
  const roundButtons = document.querySelectorAll('.round-button');
  if (roundButtons.length > 0) {
    roundButtons.forEach(button => {
      button.addEventListener('click', function() {
        const round = this.dataset.round;
        fetchMatchesForRound(round);
      });
    });
  }
  
  // Handle home prediction inputs
  initPredictionInputs();
  
  // Handle save prediction buttons
  initSavePredictionButtons();
});

// Update match list for selected round via AJAX
function fetchMatchesForRound(round) {
  // Get the current year from the URL or use the selected year
  const urlParams = new URLSearchParams(window.location.search);
  const year = urlParams.get('year') || new Date().getFullYear();
  
  // Show loading state
  const matchesContainer = document.getElementById('matches-container');
  if (matchesContainer) {
    matchesContainer.innerHTML = '<div class="loading">Loading matches...</div>';
  }
  
  // Update UI to show selected round
  const roundButtons = document.querySelectorAll('.round-button');
  roundButtons.forEach(btn => {
    btn.classList.remove('selected');
    if (btn.dataset.round === round) {
      btn.classList.add('selected');
    }
  });
  
  // Fetch matches from server with year parameter
  fetch(`/predictions/round/${round}?year=${year}`)
    .then(response => response.json())
    .then(matches => {
      renderMatches(matches);
    })
    .catch(error => {
      console.error('Error fetching matches:', error);
      if (matchesContainer) {
        matchesContainer.innerHTML = '<div class="error">Failed to load matches</div>';
      }
    });
}

// Render matches in the container
function renderMatches(matches) {
  const matchesContainer = document.getElementById('matches-container');
  if (!matchesContainer) return;
  
  if (matches.length === 0) {
    matchesContainer.innerHTML = '<div class="no-matches">No matches available for this round</div>';
    return;
  }
  
  let html = '';
  
  matches.forEach(match => {
    const isLocked = match.isLocked;
    const hasResult = match.home_score !== null && match.away_score !== null;
    const prediction = getPredictionValue(match.match_id) || '';
    const awayPrediction = prediction !== '' ? (100 - prediction) : '';
    const hasPrediction = prediction !== '';
    
    // Determine button class and text based on whether prediction exists
    const buttonClass = hasPrediction ? 'save-prediction saved-state' : 'save-prediction';
    const buttonText = hasPrediction ? 'Saved' : 'Save Prediction';
    
    html += `
      <div class="match-card ${hasResult ? 'has-result' : ''} ${isLocked ? 'locked' : ''}">
        <div class="match-header">
          <span class="match-date" data-original-date="${match.match_date}">${formatDateToLocalTimezone(match.match_date)}</span>
          <span class="match-location">${match.location}</span>
          ${isLocked ? '<span class="match-locked">LOCKED</span>' : ''}
        </div>
        
        <div class="match-teams">
          <div class="home-team">${match.home_team}</div>
          <div class="vs">vs</div>
          <div class="away-team">${match.away_team}</div>
        </div>
        
        ${hasResult ? `
          <div class="match-result">
            <span class="score">${match.home_score} - ${match.away_score}</span>
          </div>
        ` : ''}
        
        ${(!isLocked || window.isAdmin) ? `
          <div class="prediction-controls">
            <div class="prediction-inputs">
              <div class="team-prediction">
                <label>${match.home_team}:</label>
                <div class="input-with-symbol">
                  <input type="number" 
                         class="prediction-input home-prediction" 
                         data-match-id="${match.match_id}" 
                         data-original-value="${prediction}"
                         min="0" max="100" 
                         value="${prediction}">
                  <span class="input-symbol">%</span>
                </div>
              </div>
              
              <div class="team-prediction">
                <label>${match.away_team}:</label>
                <div class="input-with-symbol">
                  <input type="number" 
                         class="prediction-input away-prediction" 
                         data-match-id="${match.match_id}" 
                         min="0" max="100" 
                         value="${awayPrediction}"
                         readonly>
                  <span class="input-symbol">%</span>
                </div>
              </div>
            </div>
            <button class="${buttonClass}" data-match-id="${match.match_id}">
              ${buttonText}
            </button>
          </div>
        ` : (isLocked && !hasResult) ? `
          <div class="prediction-locked">
            ${prediction !== '' ? `
              <p>Your prediction: ${prediction}% for ${match.home_team}</p>
              <p>${100 - prediction}% for ${match.away_team}</p>
            ` : `
              <p>No prediction made</p>
            `}
            <p class="locked-message">Match has started - predictions locked</p>
          </div>
        ` : `
          <div class="prediction-result">
            ${prediction !== '' ? `
              <p>Your prediction: ${prediction}% for ${match.home_team}</p>
              ${calculateAccuracy(match, prediction)}
            ` : `
              <p>No prediction made</p>
            `}
          </div>
        `}
      </div>
    `;
  });
  
  matchesContainer.innerHTML = html;
  
  // Re-initialize event listeners for new elements
  initPredictionInputs();
  initSavePredictionButtons();
}

// Calculate prediction accuracy text
function calculateAccuracy(match, prediction) {
  if (match.home_score === null || match.away_score === null || prediction === '') {
    return '';
  }
  
  const homeWon = match.home_score > match.away_score;
  const awayWon = match.home_score < match.away_score;
  const tie = match.home_score === match.away_score;
  
  // Calculate all metrics
  const prob = parseInt(prediction) / 100;
  const actualOutcome = homeWon ? 1 : (tie ? 0.5 : 0);
  
  // Calculate Brier score
  const brierScore = Math.pow(prob - actualOutcome, 2).toFixed(4);
  
  // Calculate Bits score
  const safeProb = Math.max(0.001, Math.min(0.999, prob));
  let bitsScore;
  if (homeWon) {
    bitsScore = (1 + Math.log2(safeProb)).toFixed(4);
  } else if (awayWon) {
    bitsScore = (1 + Math.log2(1 - safeProb)).toFixed(4);
  } else {
    bitsScore = (1 + Math.log2(1 - Math.abs(0.5 - safeProb))).toFixed(4);
  }
  
  // Calculate tip points
  let tipPoints;
  let tipClass;
  
  if (parseInt(prediction) === 50) {
    if (tie) {
      tipPoints = 1.0;
      tipClass = "correct";
    } else {
      tipPoints = 0.5;
      tipClass = "partial";
    }
  } else if ((homeWon && prediction > 50) || (awayWon && prediction < 50)) {
    tipPoints = 1.0;
    tipClass = "correct";
  } else if (tie) {
    tipPoints = 0.5;
    tipClass = "partial";
  } else {
    tipPoints = 0.0;
    tipClass = "incorrect";
  }
  
  return `<div class="metrics-details">
    <p>Tip: <span class="${tipClass}">${tipPoints.toFixed(1)}</span> | Brier: ${brierScore} | Bits: ${bitsScore}</p>
  </div>`;
}

// Handle prediction inputs
function initPredictionInputs() {
  const homeInputs = document.querySelectorAll('.home-prediction');
  
  homeInputs.forEach(input => {
    // Store the original value for comparison
    const originalValue = input.value;
    input.dataset.originalValue = originalValue;
    
    input.addEventListener('input', function() {
      const matchId = this.dataset.matchId;
      const value = this.value.trim();
      const originalValue = this.dataset.originalValue;
      
      // Find the corresponding away input
      const awayInput = document.querySelector(`.away-prediction[data-match-id="${matchId}"]`);
      
      // Find the corresponding save button
      const saveButton = document.querySelector(`.save-prediction[data-match-id="${matchId}"]`);
      
      if (awayInput) {
        if (value === '' || isNaN(parseInt(value))) {
          // If home is empty or not a number, clear away as well
          awayInput.value = '';
        } else {
          // Otherwise calculate the away percentage
          let homeValue = parseInt(value);
          
          // Enforce limits
          if (homeValue < 0) {
            homeValue = 0;
            this.value = 0;
          } else if (homeValue > 100) {
            homeValue = 100;
            this.value = 100;
          }
          
          awayInput.value = 100 - homeValue;
        }
        
        // Update button state based on whether the value has changed
        if (saveButton) {
          const hasPrediction = originalValue !== '';
          const valueChanged = value !== originalValue;
          
          if (hasPrediction && valueChanged) {
            // Existing prediction is being changed
            saveButton.textContent = 'Update Prediction';
            saveButton.classList.remove('saved-state');
            saveButton.classList.add('update-state');
          } else if (hasPrediction && !valueChanged) {
            // Reverting to original prediction
            saveButton.textContent = 'Saved';
            saveButton.classList.add('saved-state');
            saveButton.classList.remove('update-state');
          } else if (!hasPrediction) {
            // New prediction
            saveButton.textContent = 'Save Prediction';
            saveButton.classList.remove('saved-state', 'update-state');
          }
        }
      }
    });
  });
}

// Handle save prediction buttons
function initSavePredictionButtons() {
  const saveButtons = document.querySelectorAll('.save-prediction');
  
  saveButtons.forEach(button => {
    button.addEventListener('click', function() {
      const matchId = this.dataset.matchId;
      const input = document.querySelector(`.home-prediction[data-match-id="${matchId}"]`);
      
      if (input) {
        const probability = input.value.trim();
        
        // Validate input
        if (probability === '') {
          alert('Please enter a prediction percentage');
          return;
        }
        
        const probabilityNum = parseInt(probability);
        if (isNaN(probabilityNum) || probabilityNum < 0 || probabilityNum > 100) {
          alert('Please enter a valid percentage between 0 and 100');
          return;
        }
        
        savePrediction(matchId, probabilityNum, this);
      }
    });
  });
}

// Save prediction via AJAX
function savePrediction(matchId, probability, button) {
  // Show saving state
  const originalText = button.textContent;
  button.textContent = 'Saving...';
  button.disabled = true;
  
  fetch('/predictions/save', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      matchId: matchId,
      probability: probability
    }),
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      // Update button to saved state
      button.textContent = 'Saved';
      button.classList.add('saved-state');
      button.classList.remove('update-state');
      
      // Update stored prediction
      updateStoredPrediction(matchId, probability);
      
      // Update the original value in the input
      const input = document.querySelector(`.home-prediction[data-match-id="${matchId}"]`);
      if (input) {
        input.dataset.originalValue = probability;
      }
      
      // Enable button after a delay
      setTimeout(() => {
        button.disabled = false;
      }, 500);
    } else {
      button.textContent = data.error || 'Error!';
      setTimeout(() => {
        button.textContent = originalText;
        button.disabled = false;
      }, 1500);
    }
  })
  .catch(error => {
    console.error('Error saving prediction:', error);
    button.textContent = 'Failed!';
    setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false;
    }, 1500);
  });
}

// Helper to get prediction value from page data
function getPredictionValue(matchId) {
  if (window.userPredictions && window.userPredictions[matchId] !== undefined) {
    return window.userPredictions[matchId];
  }
  return '';
}

// Update stored prediction
function updateStoredPrediction(matchId, value) {
  if (!window.userPredictions) {
    window.userPredictions = {};
  }
  window.userPredictions[matchId] = parseInt(value);
}

// Helper for admin user selection
function selectUser(userId, userName) {
  document.getElementById('selected-user').textContent = userName;
  document.getElementById('selected-user-id').value = userId;
  
  // Highlight selected user
  const userButtons = document.querySelectorAll('.user-button');
  userButtons.forEach(btn => {
    btn.classList.remove('selected');
    if (btn.dataset.userId === userId) {
      btn.classList.add('selected');
    }
  });
  
  // If on admin page, fetch predictions for this user
  if (window.location.pathname.includes('/admin')) {
    fetch(`/admin/predictions/${userId}`)
      .then(response => response.json())
      .then(data => {
        window.userPredictions = data.predictions;
        // If matches are already displayed, refresh the UI
        if (document.querySelector('.match-card')) {
          const currentRound = document.querySelector('.round-button.selected').dataset.round;
          fetchMatchesForRound(currentRound);
        }
      })
      .catch(error => {
        console.error('Error fetching user predictions:', error);
      });
  }
}

function formatDateToLocalTimezone(isoDateString) {
  if (!isoDateString) return '';
  
  try {
    // Create a date object from the ISO string
    const date = new Date(isoDateString);
    
    // Check if date is valid
    if (isNaN(date.getTime())) return isoDateString;
    
    // Format with Australian English date formatting
    const options = { 
      weekday: 'short',
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    };
    
    return date.toLocaleString('en-AU', options);
  } catch (error) {
    console.error('Error formatting date:', error);
    return isoDateString;
  }
}