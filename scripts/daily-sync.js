const { syncGamesFromAPI } = require('./sync-games');

async function dailySync() {
  console.log(`Running daily sync at ${new Date().toISOString()}`);
  try {
    // Get current year
    const currentYear = new Date().getFullYear();
    const results = await syncGamesFromAPI({ year: currentYear });
    console.log(`Sync complete. Inserted: ${results.insertCount}, Updated: ${results.updateCount}, Skipped: ${results.skipCount}`);
    process.exit(0);
  } catch (error) {
    console.error('Daily sync failed:', error);
    process.exit(1);
  }
}

dailySync();