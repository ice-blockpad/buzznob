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
   * Start daily cleanup cron job (for non-aggregation cleanup)
   * Runs daily at 2:00 AM UTC
   */
  startDailyCleanup() {
    const job = cron.schedule('0 2 * * *', async () => {
      const lockKey = `data_cleanup_${new Date().toISOString().split('T')[0]}`;
      
      await distributedLock.withLock(lockKey, async () => {
        try {
          console.log('🧹 [CLEANUP CRON] Starting scheduled data cleanup...');
          // Run cleanup but skip aggregation (aggregation runs monthly)
          const results = await dataCleanup.runCleanupWithoutAggregation();
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
    job.start(); // Start the job since scheduled: false
    console.log('✅ Data cleanup cron job scheduled (daily at 2:00 AM UTC)');
  }

  /**
   * Start monthly aggregation cron job
   * Runs on the 1st of each month at 00:00 UTC (same time as daily claim notifications)
   */
  startMonthlyAggregation() {
    const job = cron.schedule('9 0 1 * *', async () => {
      const now = new Date();
      const monthYear = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
      const lockKey = `data_aggregation_${monthYear}`;
      
      await distributedLock.withLock(lockKey, async () => {
        try {
          console.log('💰 [AGGREGATION CRON] Starting monthly aggregation...');
          // Use current month start as cutoff (aggregate previous complete months)
          const currentYear = now.getUTCFullYear();
          const currentMonth = now.getUTCMonth();
          const currentMonthStart = new Date(Date.UTC(currentYear, currentMonth, 1, 0, 0, 0, 0));
          
          const { aggregateAllUsersClaims } = require('./dataAggregation');
          const aggregationResult = await aggregateAllUsersClaims(currentMonthStart);
          console.log(`✅ [AGGREGATION CRON] Aggregation completed: ${aggregationResult.summariesCreated} summaries, ${aggregationResult.claimsDeleted} claims deleted`);
          
          // Also cleanup claims older than 12 months
          const { cleanupMiningClaims } = require('./dataCleanup');
          const cleanupResult = await cleanupMiningClaims();
          console.log(`✅ [AGGREGATION CRON] Old claims cleanup: ${cleanupResult.deleted} deleted`);
        } catch (error) {
          console.error('❌ [AGGREGATION CRON] Error in monthly aggregation:', error);
        }
      }, 3600); // 1 hour TTL
    }, {
      scheduled: false,
      timezone: 'UTC'
    });

    this.jobs.push(job);
    job.start(); // Start the job since scheduled: false
    console.log('✅ Monthly aggregation cron job scheduled (1st of each month at 00:09 UTC)');
  }

  /**
   * Start all cron jobs
   */
  startAll() {
    this.startDailyCleanup();
    this.startMonthlyAggregation();
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

