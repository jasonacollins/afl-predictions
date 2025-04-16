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
          location TEXT,
          home_team_id INTEGER,
          away_team_id INTEGER,
          home_score INTEGER,
          away_score INTEGER,
          year INTEGER DEFAULT 2025,
          FOREIGN KEY (home_team_id) REFERENCES teams (team_id),
          FOREIGN KEY (away_team_id) REFERENCES teams (team_id)
        )
      `);
      
      await runQuery(`
        CREATE TABLE IF NOT EXISTS predictors (
          predictor_id INTEGER PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          password TEXT NOT NULL,
          is_admin INTEGER DEFAULT 0
        )
      `);
      
      await runQuery(`
        CREATE TABLE IF NOT EXISTS predictions (
          prediction_id INTEGER PRIMARY KEY,
          match_id INTEGER NOT NULL,
          predictor_id INTEGER NOT NULL,
          home_win_probability INTEGER NOT NULL,
          prediction_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          tipped_team TEXT DEFAULT 'home',
          FOREIGN KEY (match_id) REFERENCES matches (match_id),
          FOREIGN KEY (predictor_id) REFERENCES predictors (predictor_id),
          UNIQUE (match_id, predictor_id)
        )
      `);
      
      // Create default admin user
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('adminpass', salt);
      
      await runQuery(
        'INSERT INTO predictors (name, password, is_admin) VALUES (?, ?, ?)',
        ['Admin', hashedPassword, 1]
      );
      
      console.log('Database schema created successfully!');
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
