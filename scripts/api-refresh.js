const { runQuery, getOne } = require('../models/db'); // Corrected path
const fetch = require('node-fetch'); // Or your preferred fetch library

/**
 * Fetches the latest game data from the Squiggle API for a given year,
 * updates the local database fixture (including completion percentage),
 * and updates scores for completed games.
 * Assumes a 'complete' column (INTEGER) exists in the 'matches' table.
 * @param {number} year The year to refresh data for.
 * @param {object} options Options for the refresh (e.g. forceScoreUpdate).
 * @returns {Promise<object>} An object indicating success or failure, along with counts.
 */
async function refreshAPIData(year, options = {}) {
  let insertCount = 0;
  let updateCount = 0; // For fixture updates (excluding scores/final completion)
  let scoresUpdated = 0; // Specifically for final score/completion updates
  const skippedFixtureUpdates = []; // Games skipped during initial insert/update phase
  const skippedScoreUpdates = []; // Games skipped during score update phase

  // Extract the override option (default to false)
  const forceScoreUpdate = options.forceScoreUpdate || false;

  console.log(`Starting API refresh process for year ${year}...${forceScoreUpdate ? ' (with force score update enabled)' : ''}`);

  try {
    // --- Fetching Teams (Placeholder) ---
    console.log('Fetching team data (if necessary)...');
    // ...

    // --- Fetching Games from Squiggle API ---
    console.log(`Fetching games data for year ${year} from Squiggle API...`);
    const apiUrl = `https://api.squiggle.com.au/?q=games;year=${year}`;
    const userAgent = 'AFL-Predictions-App/1.0 (your-email@example.com)'; // Replace placeholder
    const response = await fetch(apiUrl, { headers: { 'User-Agent': userAgent } });

    if (!response.ok) throw new Error(`Squiggle API request failed: ${response.status} ${response.statusText} (URL: ${apiUrl})`);
    const data = await response.json();
    if (!data || !data.games) throw new Error('Invalid data structure received from Squiggle API');
    const gamesFromAPI = data.games;
    console.log(`Received ${gamesFromAPI.length} games from API for ${year}.`);

    // --- Process Games (Insert/Update Fixture - Placeholder) ---
    // IMPORTANT: Modify this section to include the 'complete' column
    console.log('Processing fixture updates (inserting new games, updating existing)...');
    // --- Your fixture insert/update logic goes here ---
    /* Example Modifications:
       const insertQuery = 'INSERT INTO matches (..., complete) VALUES (..., ?)'; // Use 'complete' column name
       const updateFixtureQuery = 'UPDATE matches SET ..., complete = ? WHERE match_number = ?'; // Use 'complete' column name

       for (const game of gamesFromAPI) {
           // ... find if exists ...
           const completionPercentage = parseInt(game.complete, 10) || 0; // Get completion % from API

           if (/* needs insert * /) {
               const insertParams = [..., completionPercentage]; // Add completion % to 'complete' column
               await runQuery(insertQuery, insertParams);
               insertCount++;
           } else if (/* needs update * /) {
               // Update fixture details AND current completion percentage
               const updateParams = [..., completionPercentage, game.id]; // Add completion % and match_number
               const fixtureUpdateResult = await runQuery(updateFixtureQuery, updateParams);
               if (fixtureUpdateResult.changes > 0) updateCount++;
           }
       }
    */
    // --- End of fixture logic ---


    // --- Update Final Scores & Set Completion to 100 for Completed Games ---
    console.log(`Filtering for completed games (complete=100) with scores for year ${year}...`);
    const completedGamesWithScores = gamesFromAPI.filter(game =>
      game.complete === 100 && // Specifically filter for 100% complete
      game.hscore !== null && game.hscore !== undefined &&
      game.ascore !== null && game.ascore !== undefined &&
      game.id !== null && game.id !== undefined
    );
    console.log(`Found ${completedGamesWithScores.length} fully completed games from API to potentially update in DB.`);

    // Define the SQL query to update final scores AND set completion to 100
    // MODIFIED to conditionally include the completion check based on override flag
    const scoreUpdateQuery = `
      UPDATE matches
      SET
        hscore = ?,
        ascore = ?,
        hgoals = ?,
        hbehinds = ?,
        agoals = ?,
        abehinds = ?,
        complete = 100 -- Set completion to 100 in 'complete' column
      WHERE
        match_number = ?
        ${forceScoreUpdate ? '' : 'AND (complete IS NULL OR complete != 100)'}
    `;

    console.log(`Attempting to update final scores and completion status in the database...${forceScoreUpdate ? ' (force update mode)' : ''}`);
    for (const game of completedGamesWithScores) {
      // We already know game.complete is 100 here due to the filter
      const homeScore = parseInt(game.hscore, 10);
      const awayScore = parseInt(game.ascore, 10);
      const squiggleGameId = game.id;

      if (isNaN(homeScore) || isNaN(awayScore)) {
        const skipMsg = `Skipping score update for Game ID ${squiggleGameId} (Round ${game.round}): Invalid scores received from API (H: ${game.hscore}, A: ${game.ascore})`;
        console.warn(skipMsg);
        skippedScoreUpdates.push(skipMsg);
        continue;
      }

      // Params for the score update query
      const params = [
        homeScore, 
        awayScore,
        game.hgoals || null,
        game.hbehinds || null,
        game.agoals || null,
        game.abehinds || null,
        squiggleGameId
      ];      

      try {
        const result = await runQuery(scoreUpdateQuery, params);

        if (result.changes > 0) {
          scoresUpdated++;
          // console.log(`Successfully updated final scores & completion for match_number: ${squiggleGameId}`);
        } else {
          // If changes is 0, it could be because the match wasn't found,
          // or because it was already complete=100 (due to the WHERE clause).
          // We only want to log a "skip" if the match wasn't found or if there's another unexpected issue.
          const checkExistsQuery = 'SELECT complete, hscore, ascore FROM matches WHERE match_number = ?';
          // Use getOne for SELECT queries expected to return a single row
          const existing = await getOne(checkExistsQuery, [squiggleGameId]); // <--- CHANGE runQuery to getOne

          // Check if a row was actually returned by getOne
          if (!existing) {
             // Match genuinely not found in DB - THIS is a skip we should report.
             const skipMsg = `Skipping score update for Game ID ${squiggleGameId}: Match not found in database. Fixture might be out of sync.`;
             console.warn(skipMsg);
             skippedScoreUpdates.push(skipMsg);
          } else {
             // Match exists. Check if it was NOT already complete=100.
             // If it wasn't complete=100, but still wasn't updated, log it as a potential issue.
             if (existing.complete !== 100) {
                 const skipMsg = `Skipped score update for Game ID ${squiggleGameId}: Match found but DB update failed unexpectedly (Current completion: ${existing.complete}).`;
                 console.warn(skipMsg);
                 skippedScoreUpdates.push(skipMsg);
             }
             // If existing.complete === 100, we do nothing here.
             // The UPDATE was correctly prevented by the WHERE clause, it's not an error or a skip we need to report in the summary.
          }
        }
      } catch (err) {
        const errorMsg = `Error updating final scores/completion for match_number ${squiggleGameId}: ${err.message}`;
        console.error(errorMsg);
        skippedScoreUpdates.push(errorMsg);
      }
    }

    console.log(`Final score/completion update process complete. Updated: ${scoresUpdated}, Skipped: ${skippedScoreUpdates.length}`);

    // --- Return combined results ---
    const finalMessage = `API refresh complete for ${year}. ` +
                         `Inserted Fixtures: ${insertCount}, Updated Fixtures: ${updateCount}, ` +
                         `Updated Final Scores/Completion: ${scoresUpdated}, ` + // Changed label
                         `Skipped Fixture Updates: ${skippedFixtureUpdates.length}, `+
                         `Skipped Score Updates: ${skippedScoreUpdates.length}.` +
                         `${forceScoreUpdate ? ' (Force update mode was enabled)' : ''}`;
    console.log(finalMessage);

    return {
      success: true,
      message: finalMessage,
      insertCount,
      updateCount, // Fixture updates (might include partial completion %)
      scoresUpdated, // Rows where final score AND completion=100 were set
      forceUpdate: forceScoreUpdate,
      skippedFixtureUpdateCount: skippedFixtureUpdates.length,
      skippedScoreUpdateCount: skippedScoreUpdates.length,
      // skippedFixtureUpdates: skippedFixtureUpdates.length > 0 ? skippedFixtureUpdates : null,
      // skippedScoreUpdates: skippedScoreUpdates.length > 0 ? skippedScoreUpdates : null
    };

  } catch (error) {
    console.error(`API refresh failed for year ${year}:`, error);
    return {
      success: false,
      message: `Error refreshing API data for year ${year}: ${error.message}`,
      error: error.message,
      forceUpdate: forceScoreUpdate
      // ... return partial counts ...
    };
  }
}

module.exports = { refreshAPIData };