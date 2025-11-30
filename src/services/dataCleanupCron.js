const cron = require('node-cron');
const distributedLock = require('./distributedLock');
const dataCleanup = require('./dataCleanup');

/**
 * Data Cleanup Cron Jobs
 * Handles scheduled data cleanup tasks
 */
class DataCleanupCron {
  constructor() {
    this.jobs = [];
  }

  /**
   * Start daily cleanup cron job
   * Runs daily at 2:00 AM UTC
   */
  startDailyCleanup() {
    const job = cron.schedule('0 2 * * *', async () => {
      const lockKey = `data_cleanup_${new Date().toISOString().split('T')[0]}`;
      
      await distributedLock.withLock(lockKey, async () => {
        try {
          console.log('🧹 [CLEANUP CRON] Starting scheduled data cleanup...');
          const results = await dataCleanup.runCleanup();
          console.log('✅ [CLEANUP CRON] Cleanup completed:', results);
        } catch (error) {
          console.error('❌ [CLEANUP CRON] Error in scheduled cleanup:', error);
        }
      }, 3600); // 1 hour TTL
    }, {
      scheduled: false,
      timezone: 'UTC'
    });

    this.jobs.push(job);
    console.log('✅ Data cleanup cron job scheduled (daily at 2:00 AM UTC)');
  }

  /**
   * Start all cron jobs
   */
  startAll() {
    this.startDailyCleanup();
    console.log('✅ All data cleanup cron jobs started');
  }

  /**
   * Stop all cron jobs
   */
  stopAll() {
    this.jobs.forEach((job) => job.stop());
    this.jobs = [];
    console.log('🛑 All data cleanup cron jobs stopped');
  }
}

const dataCleanupCron = new DataCleanupCron();
module.exports = dataCleanupCron;

