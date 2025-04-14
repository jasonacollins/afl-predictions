const { runQuery, initializeDatabase } = require('../models/db');

async function updateSchema() {
  try {
    console.log('Initializing database...');
    await initializeDatabase();
    
    console.log('Checking if tipped_team column exists...');
    const columnExists = await runQuery(
      "SELECT count(*) as count FROM pragma_table_info('predictions') WHERE name='tipped_team'"
    );
    
    if (columnExists.changes === 0) {
      console.log('Adding tipped_team column to predictions table...');
      await runQuery(
        "ALTER TABLE predictions ADD COLUMN tipped_team TEXT DEFAULT 'home'"
      );
      console.log('Column added successfully');
    } else {
      console.log('tipped_team column already exists');
    }
    
    console.log('Schema update complete');
    process.exit(0);
  } catch (error) {
    console.error('Error updating schema:', error);
    process.exit(1);
  }
}

updateSchema();