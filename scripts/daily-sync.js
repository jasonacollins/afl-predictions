const { refreshAPIData } = require('./api-refresh');

async function dailySync() {
  console.log(`Running daily sync at ${new Date().toISOString()}`);
  try {
    // Get current year
    const currentYear = new Date().getFullYear();
    // Use default options (forceScoreUpdate = false for daily automated sync)
    const results = await refreshAPIData(currentYear, { forceScoreUpdate: false });
    console.log(`Sync complete. Results: ${JSON.stringify(results)}`);
    process.exit(0);
  } catch (error) {
    console.error('Daily sync failed:', error);
    process.exit(1);
  }
}

dailySync();