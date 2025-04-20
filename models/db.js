const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');

// Database path
const dbPath = process.env.DB_PATH || path.join(__dirname, '../data/afl_predictions.db');
const db = new sqlite3.Database(dbPath);

// Helper to run queries with promises
function runQuery(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve(this);
      }
    });
  });
}

// Helper to get query results with promises
function getQuery(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// Helper to get a single row
function getOne(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

// Initialize database if needed
async function initializeDatabase() {
  try {
    // Check if schema exists
    const tableExists = await getOne(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='predictors'"
    );

    if (!tableExists) {
      console.log('Creating database schema...');
      
      // Create tables
      await runQuery(`
        CREATE TABLE IF NOT EXISTS teams (
          team_id INTEGER PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          abbrev TEXT
        )
      `);
      
      await runQuery(`
        CREATE TABLE IF NOT EXISTS matches (
          match_id INTEGER PRIMARY KEY,
          match_number INTEGER NOT NULL,
          round_number TEXT NOT NULL,
          match_date TEXT,
          venue TEXT,
          home_team_id INTEGER,
          away_team_id INTEGER,
          hscore INTEGER,
          hgoals INTEGER,
          hbehinds INTEGER,
          ascore INTEGER,
          agoals INTEGER,
          abehinds INTEGER,
          year INTEGER DEFAULT 2025,
          complete INTEGER, /* Added complete column */
          FOREIGN KEY (home_team_id) REFERENCES teams (team_id),
          FOREIGN KEY (away_team_id) REFERENCES teams (team_id)
        )
      `);
      
      // Rest of the function...
    } else {
      // Check for missing columns and add them if needed
      console.log('Checking for schema updates...');
      
      // Check if 'year' column exists in matches table
      const yearColumnExists = await getOne(
        "SELECT 1 FROM pragma_table_info('matches') WHERE name='year'"
      );
      
      if (!yearColumnExists) {
        console.log('Adding year column to matches table');
        await runQuery("ALTER TABLE matches ADD COLUMN year INTEGER DEFAULT 2025");
      }
      
      // Check if 'complete' column exists in matches table
      const completeColumnExists = await getOne(
        "SELECT 1 FROM pragma_table_info('matches') WHERE name='complete'"
      );
      
      if (!completeColumnExists) {
        console.log('Adding complete column to matches table');
        await runQuery("ALTER TABLE matches ADD COLUMN complete INTEGER");
      }
    }
  } catch (err) {
    console.error('Error initializing database:', err);
  }
}

module.exports = {
  runQuery,
  getQuery,
  getOne,
  initializeDatabase,
  db,
};
