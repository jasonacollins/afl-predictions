const { runQuery } = require('../models/db'); // Corrected path
const fetch = require('node-fetch'); // Or your preferred fetch library

/**
 * Fetches the latest game data from the Squiggle API for a given year,
 * updates the local database fixture (including completion percentage),
 * and updates scores for completed games.
 * Assumes a 'complete' column (INTEGER) exists in the 'matches' table.
 * @param {number} year The year to refresh data for.
 * @returns {Promise<object>} An object indicating success or failure, along with counts.
 */
async function refreshAPIData(year) {
  let insertCount = 0;
  let updateCount = 0; // For fixture updates (excluding scores/final completion)
  let scoresUpdated = 0; // Specifically for final score/completion updates
  const skippedFixtureUpdates = []; // Games skipped during initial insert/update phase
  const skippedScoreUpdates = []; // Games skipped during score update phase

  console.log(`Starting API refresh process for year ${year}...`);

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
    // **MODIFIED** to use 'complete' field name
    const scoreUpdateQuery = `
      UPDATE matches
      SET
        home_score = ?,
        away_score = ?,
        complete = 100 -- Set completion to 100 in 'complete' column
      WHERE
        match_number = ?
        -- Optional: Add AND complete != 100 if you only want to update ONCE when it hits 100
        -- AND (complete IS NULL OR complete != 100)
    `;

    console.log(`Attempting to update final scores and completion status in the database...`);
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
      const params = [homeScore, awayScore, squiggleGameId];

      try {
        const result = await runQuery(scoreUpdateQuery, params);

        if (result.changes > 0) {
          scoresUpdated++;
          // console.log(`Successfully updated final scores & completion for match_number: ${squiggleGameId}`);
        } else {
          // If changes is 0, check if the match exists. If it does, it might already be 100% with correct scores.
          const checkExistsQuery = 'SELECT complete, home_score, away_score FROM matches WHERE match_number = ?'; // Check 'complete' column
          const existsResult = await runQuery(checkExistsQuery, [squiggleGameId]);

          if (existsResult.length === 0) {
             const skipMsg = `Skipping score update for Game ID ${squiggleGameId}: Match not found in database. Fixture might be out of sync.`;
             console.warn(skipMsg);
             skippedScoreUpdates.push(skipMsg);
          } else {
             // Match exists, but no rows changed. Check if it was already 100% complete with same scores.
             const existing = existsResult[0];
             if (existing.complete === 100 && existing.home_score === homeScore && existing.away_score === awayScore) { // Check 'complete' column
                 const skipMsg = `Skipped score update for Game ID ${squiggleGameId}: Match already 100% complete with correct scores in DB.`;
                 // console.log(skipMsg);
                 skippedScoreUpdates.push(skipMsg);
             } else {
                 // It exists, but wasn't updated for some other reason (e.g., WHERE clause condition if you added one)
                 const skipMsg = `Skipped score update for Game ID ${squiggleGameId}: Match found but DB update failed unexpectedly (Current completion: ${existing.complete}).`; // Use 'complete' column
                 console.warn(skipMsg);
                 skippedScoreUpdates.push(skipMsg);
             }
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
                         `Skipped Score Updates: ${skippedScoreUpdates.length}.`;
    console.log(finalMessage);

    return {
      success: true,
      message: finalMessage,
      insertCount,
      updateCount, // Fixture updates (might include partial completion %)
      scoresUpdated, // Rows where final score AND completion=100 were set
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
      // ... return partial counts ...
    };
  }
}

module.exports = { refreshAPIData };