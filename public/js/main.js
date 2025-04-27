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
  
  // Update round button states
  updateRoundButtonStates();
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
  
  // Update UI to show selected round - MODIFIED PART
  const roundButtons = document.querySelectorAll('.round-button');
  roundButtons.forEach(btn => {
    // Keep any existing state classes (completed, has-predictions, needs-predictions)
    // but remove the 'selected' class
    btn.classList.remove('selected');
    
    if (btn.dataset.round === round) {
      // Add selected class (this will override other colors due to !important)
      btn.classList.add('selected');
    }
  });
  
  // Fetch matches from server with year parameter
  fetch(`/predictions/round/${round}?year=${year}`)
    .then(response => response.json())
    .then(matches => {
      renderMatches(matches);
      // Call our new function to update round button states
      updateRoundButtonStates();
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
    const hasResult = match.hscore !== null && match.ascore !== null;
    
    // Get prediction data
    let prediction = '';
    let tippedTeam = 'home';
    
    if (window.userPredictions && window.userPredictions[match.match_id]) {
      if (typeof window.userPredictions[match.match_id] === 'object') {
        prediction = window.userPredictions[match.match_id].probability || '';
        tippedTeam = window.userPredictions[match.match_id].tippedTeam || 'home';
      } else {
        prediction = window.userPredictions[match.match_id] || '';
      }
    }
    
    const awayPrediction = prediction !== '' ? (100 - prediction) : '';
    const hasPrediction = prediction !== '';
    
    // Determine button class and text based on whether prediction exists
    const buttonClass = hasPrediction ? 'save-prediction saved-state' : 'save-prediction';
    const buttonText = hasPrediction ? 'Saved' : 'Save Prediction';
    
    html += `
      <div class="match-card ${hasResult ? 'has-result' : ''} ${isLocked ? 'locked' : ''}">
        <div class="match-header">
          <span class="match-date" data-original-date="${match.match_date}">${formatDateToLocalTimezone(match.match_date)}</span>
          <span class="match-venue">${match.venue}</span>
          ${isLocked ? '<span class="match-locked">LOCKED</span>' : ''}
        </div>
        
        <div class="match-teams">
          <div class="home-team">${(match.home_team === 'Greater Western Sydney' && match.home_team_abbrev) ? match.home_team_abbrev : match.home_team}</div>
          <div class="vs">vs</div>
          <div class="away-team">${(match.away_team === 'Greater Western Sydney' && match.away_team_abbrev) ? match.away_team_abbrev : match.away_team}</div>
        </div>
        
        ${hasResult ? `
          <div class="match-result">
            <span class="score">${match.hscore} - ${match.ascore}</span>
          </div>
        ` : ''}
        
        ${!isLocked ? `
          <div class="prediction-controls">
            <div class="prediction-inputs">
              <div class="team-prediction">
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
            
            ${parseInt(prediction) === 50 ? `
              <div id="team-selection-${match.match_id}" class="team-selection">
                <p>Who do you think will win?</p>
                <div class="team-buttons">
                  <button type="button" class="team-button home-team-button ${tippedTeam === 'home' ? 'selected' : ''}" data-team="home">${(match.home_team === 'Greater Western Sydney' && match.home_team_abbrev) ? match.home_team_abbrev : match.home_team}</button>
                  <button type="button" class="team-button away-team-button ${tippedTeam === 'away' ? 'selected' : ''}" data-team="away">${(match.away_team === 'Greater Western Sydney' && match.away_team_abbrev) ? match.away_team_abbrev : match.away_team}</button>
                </div>
              </div>
            ` : ''}
            
            <button class="${buttonClass}" 
                    data-match-id="${match.match_id}"
                    data-tipped-team="${tippedTeam}">
              ${buttonText}
            </button>
          </div>
        ` : isLocked ? `
          <div class="prediction-locked">
            ${hasPrediction ? `
              <p>Your prediction: ${prediction}% for ${(match.home_team === 'Greater Western Sydney' && match.home_team_abbrev) ? match.home_team_abbrev : match.home_team}</p>
              ${parseInt(prediction) === 50 ? `
                <p>Tipped: ${tippedTeam === 'home' ? ((match.home_team === 'Greater Western Sydney' && match.home_team_abbrev) ? match.home_team_abbrev : match.home_team) : ((match.away_team === 'Greater Western Sydney' && match.away_team_abbrev) ? match.away_team_abbrev : match.away_team)} to win</p>
              ` : ''}
            ` : `
              <p>No prediction made</p>
            `}
            ${!hasResult ? `<p class="locked-message">Match has started - predictions locked</p>` : ''}
            ${hasResult ? `
              ${hasPrediction ? calculateAccuracy(match, prediction, tippedTeam) : ''}
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  });
  
  matchesContainer.innerHTML = html;
  
  // Re-initialize event listeners for new elements
  initPredictionInputs();
  initSavePredictionButtons();
  }

// Calculate prediction accuracy text
function calculateAccuracy(match, prediction, tippedTeam) {
  if (match.hscore === null || match.ascore === null || prediction === '') {
    return '';
  }
  
  const homeWon = match.hscore > match.ascore;
  const awayWon = match.hscore < match.ascore;
  const tie = match.hscore === match.ascore;
  
  // Determine actual outcome
  const actualOutcome = homeWon ? 1 : (tie ? 0.5 : 0);
  
  // Calculate Brier score using the global function
  const brierScore = calculateBrierScore(parseInt(prediction), actualOutcome).toFixed(4);
  
  // Calculate Bits score using the global function  
  const bitsScore = calculateBitsScore(parseInt(prediction), actualOutcome).toFixed(4);
  
  // Calculate tip points using the global function
  const tipPoints = calculateTipPoints(parseInt(prediction), match.hscore, match.ascore, tippedTeam);
  
  // Determine tip class
  let tipClass = "incorrect";
  if (tipPoints === 1) {
    tipClass = "correct";
  } else if (tie && parseInt(prediction) !== 50) {
    tipClass = "partial";
  }
  
  return `<div class="metrics-details">
    <p>Tip: <span class="${tipClass}">${tipPoints}</span> | Brier: ${brierScore} | Bits: ${bitsScore}</p>
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
          
          // Remove team selection
          removeTeamSelection(matchId);
          
          // Update button to show "Clear Prediction" state
          if (saveButton && originalValue !== '') {
            saveButton.textContent = 'Clear Prediction';
            saveButton.classList.remove('saved-state', 'update-state');
            saveButton.classList.add('delete-state');
            
            // Reset tipped team
            delete saveButton.dataset.tippedTeam;
          }
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
          
          // Update button state based on whether the value has changed
          if (saveButton) {
            const hasPrediction = originalValue !== '';
            const valueChanged = value !== originalValue;
            
            if (hasPrediction && valueChanged) {
              // Existing prediction is being changed
              saveButton.textContent = 'Update Prediction';
              saveButton.classList.remove('saved-state', 'delete-state');
              saveButton.classList.add('update-state');
            } else if (hasPrediction && !valueChanged) {
              // Reverting to original prediction
              saveButton.textContent = 'Saved';
              saveButton.classList.add('saved-state');
              saveButton.classList.remove('update-state', 'delete-state');
            } else if (!hasPrediction) {
              // New prediction
              saveButton.textContent = 'Save Prediction';
              saveButton.classList.remove('saved-state', 'update-state', 'delete-state');
            }
            
            // Handle team selection for 50% predictions
            const teamSelectionContainer = document.getElementById(`team-selection-${matchId}`);
            // Inside the if block for homeValue === 50
            if (homeValue === 50) {
              // If not already visible, add team selection
              if (!teamSelectionContainer) {
                // Get the match card containing this input
                const matchCard = input.closest('.match-card');
                
                if (matchCard) {
                  // Get team names from the match card
                  const homeTeam = matchCard.querySelector('.home-team').textContent;
                  const awayTeam = matchCard.querySelector('.away-team').textContent;
                  
                  addTeamSelection(matchId, homeTeam, awayTeam, saveButton);
                }
              }
            } else {
              // Remove team selection for non-50% predictions
              removeTeamSelection(matchId);
              // Clear tipped team data
              delete saveButton.dataset.tippedTeam;
            }
          }
        }
      }
    });
  });
}

// Function to update round button states
function updateRoundButtonStates() {
  // Get all round buttons
  const roundButtons = document.querySelectorAll('.round-button');
  
  // For each round button, check its state
  roundButtons.forEach(async (button) => {
    const round = button.dataset.round;
    
    // Get the current year from the URL or use the selected year
    const urlParams = new URLSearchParams(window.location.search);
    const year = urlParams.get('year') || new Date().getFullYear();
    
    try {
      // 1. Check if the round is completed
      // Fetch matches for this round to check if they're completed
      const response = await fetch(`/predictions/round/${round}?year=${year}`);
      const matches = await response.json();
      
      // Round is completed if all matches have scores
      const isCompleted = matches.length > 0 && matches.every(match => 
        match.hscore !== null && match.ascore !== null
      );
      
      // 2. Check if the round has any predictions
      const hasPredictions = matches.some(match => 
        window.userPredictions && window.userPredictions[match.match_id]
      );
      
      // 3. Set the appropriate class
      button.classList.remove('completed', 'has-predictions', 'needs-predictions');
      
      if (isCompleted) {
        button.classList.add('completed');
      } else if (hasPredictions) {
        button.classList.add('has-predictions');
      } else {
        button.classList.add('needs-predictions');
      }
    } catch (error) {
      console.error('Error checking round state:', error);
    }
  });
}

// Helper function to add team selection UI
function addTeamSelection(matchId, homeTeam, awayTeam, saveButton) {
  // First remove any existing team selection
  removeTeamSelection(matchId);
  
  // Create team selection container
  const teamSelection = document.createElement('div');
  teamSelection.className = 'team-selection';
  teamSelection.id = `team-selection-${matchId}`;
  teamSelection.innerHTML = `
    <p>Who do you think will win?</p>
    <div class="team-buttons">
      <button type="button" class="team-button home-team-button" data-team="home">${(homeTeam === 'Greater Western Sydney' && saveButton.closest('.match-card').querySelector('.home-team').dataset.abbrev) ? saveButton.closest('.match-card').querySelector('.home-team').dataset.abbrev : homeTeam}</button>
      <button type="button" class="team-button away-team-button" data-team="away">${(awayTeam === 'Greater Western Sydney' && saveButton.closest('.match-card').querySelector('.away-team').dataset.abbrev) ? saveButton.closest('.match-card').querySelector('.away-team').dataset.abbrev : awayTeam}</button>
    </div>
  `;
  
  // Insert it before the save button
  saveButton.parentNode.insertBefore(teamSelection, saveButton);
  
  // Add event listeners to team buttons
  const homeButton = teamSelection.querySelector('.home-team-button');
  const awayButton = teamSelection.querySelector('.away-team-button');
  
  homeButton.addEventListener('click', function() {
    homeButton.classList.add('selected');
    awayButton.classList.remove('selected');
    saveButton.dataset.tippedTeam = 'home';
  });
  
  awayButton.addEventListener('click', function() {
    awayButton.classList.add('selected');
    homeButton.classList.remove('selected');
    saveButton.dataset.tippedTeam = 'away';
  });
  
  // Default to home team
  homeButton.click();
}

function removeTeamSelection(matchId) {
  const teamSelection = document.getElementById(`team-selection-${matchId}`);
  if (teamSelection) {
    teamSelection.remove();
  }
}

// Handle save prediction buttons
function initSavePredictionButtons() {
  const saveButtons = document.querySelectorAll('.save-prediction');
  
  saveButtons.forEach(button => {
    button.addEventListener('click', function() {
      const matchId = this.dataset.matchId;
      const input = document.querySelector(`.home-prediction[data-match-id="${matchId}"]`);
      
      if (input) {
        // Check if this is the Clear Prediction button
        const isDeleteAction = this.classList.contains('delete-state');
        
        // If it's clear prediction, allow empty value
        const probability = isDeleteAction ? "" : input.value.trim();
        
        // Validate input only if it's not a delete action and not an empty string
        if (!isDeleteAction && probability !== '') {
          const probabilityNum = parseInt(probability);
          if (isNaN(probabilityNum) || probabilityNum < 0 || probabilityNum > 100) {
            alert('Please enter a valid percentage between 0 and 100');
            return;
          }
        }
        
        // For 50% predictions, ensure a team is selected
        if (!isDeleteAction && probability !== '' && parseInt(probability) === 50) {
          const tippedTeam = this.dataset.tippedTeam;
          if (!tippedTeam) {
            alert('Please select which team you think will win');
            return;
          }
        }
        
        savePrediction(matchId, probability, this);
      }
    });
  });
  
  // Also add click handlers for the team selection buttons that may already be in the DOM
  document.querySelectorAll('.team-button').forEach(button => {
    button.addEventListener('click', function() {
      const teamSelection = this.closest('.team-selection');
      if (!teamSelection) return;
      
      const matchId = teamSelection.id.replace('team-selection-', '');
      const saveButton = document.querySelector(`.save-prediction[data-match-id="${matchId}"]`);
      if (!saveButton) return;
      
      const teamButtons = teamSelection.querySelectorAll('.team-button');
      teamButtons.forEach(btn => btn.classList.remove('selected'));
      this.classList.add('selected');
      
      saveButton.dataset.tippedTeam = this.dataset.team;
    });
  });
}

// Save prediction via AJAX
function savePrediction(matchId, probability, button) {
  // Check if this is a deletion (empty value)
  const isDeleting = probability === "" || probability === null;
  
  // Show saving state
  const originalText = button.textContent;
  button.textContent = isDeleting ? 'Clearing...' : 'Saving...';
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
      if (isDeleting) {
        // Prediction was cleared
        button.textContent = 'Prediction Cleared';
        setTimeout(() => {
          button.textContent = 'Save Prediction';
          button.classList.remove('saved-state', 'update-state', 'delete-state');
          button.disabled = false;
        }, 1500);
        
        // Remove from stored predictions
        if (window.userPredictions && window.userPredictions[matchId] !== undefined) {
          delete window.userPredictions[matchId];
        }
        
        // Update data-original-value attribute on input
        const input = document.querySelector(`.home-prediction[data-match-id="${matchId}"]`);
        if (input) {
          input.dataset.originalValue = '';
        }
      } else {
        // Prediction was saved or updated
        button.textContent = 'Saved';
        button.classList.add('saved-state');
        button.classList.remove('update-state', 'delete-state');
        
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
      }
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
    if (typeof window.userPredictions[matchId] === 'object') {
      return window.userPredictions[matchId].probability || '';
    }
    return window.userPredictions[matchId];
  }
  return '';
}

// Update stored prediction
function updateStoredPrediction(matchId, value, tippedTeam) {
  if (!window.userPredictions) {
    window.userPredictions = {};
  }
  window.userPredictions[matchId] = {
    probability: parseInt(value),
    tippedTeam: tippedTeam
  };
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