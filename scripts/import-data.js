const { initializeDatabase } = require('../models/db');
const { syncTeams } = require('./sync-games');

async function importData() {
  try {
    console.log('Initializing database...');
    await initializeDatabase();
    
    console.log('Importing teams...');
    await syncTeams();
    
    console.log('Data import complete');
    process.exit(0);
  } catch (error) {
    console.error('Error importing data:', error);
    process.exit(1);
  }
}

importData();