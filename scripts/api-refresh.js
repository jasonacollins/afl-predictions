const { getQuery, getOne, runQuery, initializeDatabase } = require('../models/db');
const fetch = require('node-fetch');

async function refreshAPIData(year) {
  console.log(`Starting API refresh for year ${year}`);
  
  try {
    // Initialize database first
    await initializeDatabase();
    
    // Track statistics
    let insertCount = 0;
    let updateCount = 0;
    let skipCount = 0;
    
    // Make sure placeholder team exists
    const tbaTeam = await getOne('SELECT team_id FROM teams WHERE team_id = ?', [99]);
    if (!tbaTeam) {
      await runQuery('INSERT INTO teams (team_id, name) VALUES (?, ?)', 
        [99, 'To Be Announced']);
      console.log('Created placeholder team for TBA matches');
    }
    
    // Fetch team data first
    console.log('Syncing team data...');
    const teamsResponse = await fetch('https://api.squiggle.com.au/?q=teams');
    
    if (!teamsResponse.ok) {
      throw new Error(`Teams API returned status ${teamsResponse.status}`);
    }
    
    const teamsData = await teamsResponse.json();
    
    // Process each team
    for (const team of teamsData.teams) {
      // Skip teams with missing names
      if (!team.name) {
        console.log(`Skipping team with ID ${team.id} due to missing name`);
        skipCount++;
        continue;
      }
      
      // Check if team exists in our database
      const existingTeam = await getOne(
        'SELECT team_id, name FROM teams WHERE team_id = ?',
        [team.id]
      );
      
      if (!existingTeam) {
        // Insert new team with Squiggle ID
        await runQuery(
          'INSERT INTO teams (team_id, name) VALUES (?, ?)',
          [team.id, team.name]
        );
        console.log(`Added new team: ${team.name} with ID ${team.id}`);
      } else if (existingTeam.name !== team.name) {
        // Update team name if it changed
        await runQuery(
          'UPDATE teams SET name = ? WHERE team_id = ?',
          [team.name, team.id]
        );
        console.log(`Updated team name from ${existingTeam.name} to ${team.name}`);
      }
    }
    
    // Fetch games for the specified year
    console.log(`Fetching games data for ${year}...`);
    const gamesResponse = await fetch(`https://api.squiggle.com.au/?q=games;year=${year}`);
    
    if (!gamesResponse.ok) {
      throw new Error(`Games API returned status ${gamesResponse.status}`);
    }
    
    const gamesData = await gamesResponse.json();
    
    // Process each game
    for (const game of gamesData.games) {
      try {
        // Skip games with missing game ID
        if (!game.id) {
          console.log(`Skipping game with missing ID`);
          skipCount++;
          continue;
        }
        
        // Get team IDs from the API
        let homeTeamId = game.hteamid || null;
        let awayTeamId = game.ateamid || null;
        
        // For finals without assigned teams, use placeholder IDs
        if (!homeTeamId && game.hteam && game.hteam.toLowerCase().includes("to be announced")) {
          homeTeamId = 99; // Special ID for "To be announced"
        }

        if (!awayTeamId && game.ateam && game.ateam.toLowerCase().includes("to be announced")) {
          awayTeamId = 99; // Special ID for "To be announced"
        }
        
        // Ensure team IDs are valid
        if (!homeTeamId || !awayTeamId) {
          console.log(`Skipping game ${game.id} due to missing team IDs: home=${homeTeamId}, away=${awayTeamId}`);
          skipCount++;
          continue;
        }
        
        // Map round name
        let roundNumber = game.round.toString();
        if (game.roundname && game.roundname === 'Opening Round') {
          roundNumber = 'OR';
        } else if (game.is_final > 0) {
          // Handle finals rounds based on is_final
          switch(game.is_final) {
            case 2: roundNumber = 'Elimination Final'; break;
            case 3: roundNumber = 'Qualifying Final'; break;
            case 4: roundNumber = 'Semi Final'; break;
            case 5: roundNumber = 'Preliminary Final'; break;
            case 6: roundNumber = 'Grand Final'; break;
            default: roundNumber = 'Finals';
          }
        }
        
        // Convert Unix timestamp to ISO date if available
        let matchDate = null;
        if (game.unixtime) {
          matchDate = new Date(game.unixtime * 1000).toISOString();
        } else if (game.date) {
          matchDate = new Date(game.date).toISOString();
        }
        
        // Get home and away scores if game has started
        const homeScore = game.hscore !== undefined ? game.hscore : null;
        const awayScore = game.ascore !== undefined ? game.ascore : null;
        
        // Check if match already exists in database with the Squiggle ID
        const existingMatch = await getOne(
          'SELECT match_id FROM matches WHERE match_number = ?',
          [game.id]
        );
        
        if (existingMatch) {
          // Update existing match
          await runQuery(
            `UPDATE matches 
             SET round_number = ?, match_date = ?, location = ?, 
                 home_team_id = ?, away_team_id = ?, home_score = ?, away_score = ?, year = ?
             WHERE match_id = ?`,
            [
              roundNumber, 
              matchDate, 
              game.venue,
              homeTeamId, 
              awayTeamId, 
              homeScore, 
              awayScore,
              game.year || (matchDate ? new Date(matchDate).getFullYear() : new Date().getFullYear()),
              existingMatch.match_id
            ]
          );
          updateCount++;
        } else {
          // Insert new match
          await runQuery(
            `INSERT INTO matches 
             (match_number, round_number, match_date, location, 
              home_team_id, away_team_id, home_score, away_score, year)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              game.id, 
              roundNumber, 
              matchDate, 
              game.venue,
              homeTeamId, 
              awayTeamId, 
              homeScore, 
              awayScore,
              game.year || (matchDate ? new Date(matchDate).getFullYear() : new Date().getFullYear())
            ]
          );
          insertCount++;
        }
      } catch (gameError) {
        console.error(`Error processing game ${game.id}:`, gameError);
        skipCount++;
      }
    }
    
    return {
      success: true,
      message: `API refresh complete. Inserted ${insertCount} games, updated ${updateCount} games, skipped ${skipCount} games.`,
      insertCount,
      updateCount,
      skipCount
    };
  } catch (error) {
    console.error('API refresh error:', error);
    return {
      success: false,
      message: `Error refreshing API data: ${error.message}`,
      error: error.message
    };
  }
}

module.exports = { refreshAPIData };