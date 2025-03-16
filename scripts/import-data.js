const fs = require('fs');
const { parse } = require('csv-parse/sync');
const path = require('path');
const { db, runQuery, getOne, initializeDatabase } = require('../models/db');
const bcrypt = require('bcrypt');

// Main import function
async function importData() {
  try {
    console.log('Starting data import process...');
    
    // Initialize database (create tables if needed)
    await initializeDatabase();
    
    // Read CSV file
    const csvPath = path.join(__dirname, '../data/afl-2025-UTC.csv');
    if (!fs.existsSync(csvPath)) {
      console.error(`CSV file not found: ${csvPath}`);
      console.log('Please place the CSV file at the correct location and try again.');
      process.exit(1);
    }
    
    const csvData = fs.readFileSync(csvPath, 'utf-8');
    const records = parse(csvData, { columns: true, skip_empty_lines: true });
    
    console.log(`Found ${records.length} matches in the CSV file.`);
    
    // Track teams for ID reference
    const teams = {};
    
    // Process each row in the CSV
    for (const row of records) {
      const homeTeam = row['Home Team'];
      const awayTeam = row['Away Team'];
      
      // Process home team
      if (!teams[homeTeam]) {
        await runQuery('INSERT OR IGNORE INTO teams (name) VALUES (?)', [homeTeam]);
        const result = await getOne('SELECT team_id FROM teams WHERE name = ?', [homeTeam]);
        teams[homeTeam] = result.team_id;
      }
      
      // Process away team
      if (!teams[awayTeam]) {
        await runQuery('INSERT OR IGNORE INTO teams (name) VALUES (?)', [awayTeam]);
        const result = await getOne('SELECT team_id FROM teams WHERE name = ?', [awayTeam]);
        teams[awayTeam] = result.team_id;
      }
      
      // Parse match data
      const matchNumber = parseInt(row['Match Number']);
      const roundNumber = row['Round Number'];
      const rawDate = row['Date'];
      const location = row['Location'];
      
      // Parse date properly to avoid format confusion
      let formattedDate = rawDate;
      
      // If date is in DD/MM/YYYY format (possibly with time)
      const dateParts = rawDate.split('/');
      if (dateParts.length === 3) {
        const day = parseInt(dateParts[0]);
        const month = parseInt(dateParts[1]) - 1; // Months are 0-indexed in JS
        const year = parseInt(dateParts[2]);
        
        // Extract time if present
        let hours = 0, minutes = 0;
        if (rawDate.includes(' ')) {
          const timePart = rawDate.split(' ')[1];
          if (timePart && timePart.includes(':')) {
            const timeParts = timePart.split(':');
            hours = parseInt(timeParts[0]);
            minutes = parseInt(timeParts[1]);
          }
        }
        
        // Create a proper Date object
        const dateObj = new Date(year, month, day, hours, minutes);
        
        // Store ISO format in the database
        formattedDate = dateObj.toISOString();
        
        console.log(`Parsed date: ${rawDate} → ${formattedDate}`);
      }
      
      // Parse result if available
      let homeScore = null;
      let awayScore = null;
      
      if (row['Result'] && row['Result'].trim() !== '') {
        const scores = row['Result'].split(' - ');
        if (scores.length === 2) {
          homeScore = parseInt(scores[0]);
          awayScore = parseInt(scores[1]);
        }
      }
      
      // Insert match
      await runQuery(`
        INSERT OR IGNORE INTO matches 
        (match_number, round_number, match_date, location, 
         home_team_id, away_team_id, home_score, away_score)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        matchNumber, roundNumber, formattedDate, location,
        teams[homeTeam], teams[awayTeam], homeScore, awayScore
      ]);
    }
    
    console.log('Matches imported successfully.');
    
    // Create default users if needed
    const defaultUsers = [
      { name: 'Tom', password: 'tompass', isAdmin: 0 },
      { name: 'Leo', password: 'leopass', isAdmin: 0 },
      { name: 'Alex', password: 'alexpass', isAdmin: 0 },
      { name: 'Admin', password: 'adminpass', isAdmin: 1 }
    ];
    
    console.log('Creating default users...');
    
    for (const user of defaultUsers) {
      // Check if user exists
      const existingUser = await getOne(
        'SELECT * FROM predictors WHERE name = ?',
        [user.name]
      );
      
      if (!existingUser) {
        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(user.password, salt);
        
        // Insert user
        await runQuery(
          'INSERT INTO predictors (name, password, is_admin) VALUES (?, ?, ?)',
          [user.name, hashedPassword, user.isAdmin]
        );
        
        console.log(`Created user: ${user.name}`);
      } else {
        console.log(`User already exists: ${user.name}`);
      }
    }
    
    console.log('Data import complete!');
    process.exit(0);
  } catch (error) {
    console.error('Error importing data:', error);
    process.exit(1);
  }
}

// Run the import
importData();