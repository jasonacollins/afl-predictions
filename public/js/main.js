document.addEventListener('DOMContentLoaded', function() {
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
// In public/js/main.js
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
    
    html += `
      <div class="match-card ${hasResult ? 'has-result' : ''} ${isLocked ? 'locked' : ''}">
        <div class="match-header">
          <span class="match-date">${match.match_date}</span>
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
            <button class="save-prediction" data-match-id="${match.match_id}">
              Save Prediction
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
              <p class="result-accuracy">
                ${calculateAccuracy(match, prediction)}
              </p>
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
  
  const correct = 
    (homeWon && prediction > 50) || 
    (awayWon && prediction < 50) || 
    (tie && prediction == 50);
  
  return correct ? 
    '<span class="correct">Correct prediction! 🎉</span>' : 
    '<span class="incorrect">Incorrect prediction 😔</span>';
}

// Handle prediction inputs
function initPredictionInputs() {
  const homeInputs = document.querySelectorAll('.home-prediction');
  
  homeInputs.forEach(input => {
    input.addEventListener('input', function() {
      const matchId = this.dataset.matchId;
      const value = this.value.trim();
      
      // Find the corresponding away input
      const awayInput = document.querySelector(`.away-prediction[data-match-id="${matchId}"]`);
      
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
      button.textContent = 'Saved!';
      setTimeout(() => {
        button.textContent = originalText;
        button.disabled = false;
      }, 1500);
      
      // Update stored prediction
      updateStoredPrediction(matchId, probability);
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
