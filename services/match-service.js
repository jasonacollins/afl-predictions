// services/match-service.js
const { getQuery, getOne, runQuery } = require('../models/db');

// Get matches with team information
async function getMatchesWithTeams(whereClause = '', params = []) {
  const query = `
    SELECT m.*, 
      t1.name as home_team, 
      t1.abbrev as home_team_abbrev,
      t2.name as away_team,
      t2.abbrev as away_team_abbrev 
    FROM matches m
    JOIN teams t1 ON m.home_team_id = t1.team_id
    JOIN teams t2 ON m.away_team_id = t2.team_id
    ${whereClause}
  `;
  return await getQuery(query, params);
}

// Get matches for specific round and year
async function getMatchesByRoundAndYear(round, year) {
  return await getMatchesWithTeams(
    'WHERE m.round_number = ? AND m.year = ? ORDER BY m.match_number',
    [round, year]
  );
}

// Get completed matches for year
async function getCompletedMatchesForYear(year) {
  return await getMatchesWithTeams(
    'WHERE m.hscore IS NOT NULL AND m.ascore IS NOT NULL AND m.year = ? ORDER BY m.match_date DESC',
    [year]
  );
}

// Process matches to add isLocked field
function processMatchLockStatus(matches) {
  return matches.map(match => {
    let isLocked = false;
    
    if (match.match_date) {
      try {
        const matchDate = new Date(match.match_date);
        isLocked = new Date() > matchDate;
      } catch (error) {
        console.error('Error parsing date:', match.match_date);
      }
    }
    
    return {
      ...match,
      isLocked
    };
  });
}

module.exports = {
  getMatchesWithTeams,
  getMatchesByRoundAndYear,
  getCompletedMatchesForYear,
  processMatchLockStatus
};
