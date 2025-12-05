/**
 * News Automation Cron Service
 * Schedules automatic news fetching and posting
 */

const cron = require('node-cron');
const fetchAndPostNews = require('../scripts/fetchAndPostNews');
const apiUsageTracker = require('./apiUsageTracker');

class NewsCron {
  constructor() {
    this.jobs = [];
    this.isRunning = false;
  }

  /**
   * Start all cron jobs
   */
  startAll() {
    // Reset API usage counters daily at midnight
    this.startDailyReset();

    // Fetch news every 6 hours (4 times per day)
    // Adjust schedule as needed: '0 */6 * * *' = every 6 hours
    this.startNewsFetching();

    console.log('✅ News automation cron jobs started');
  }

  /**
   * Start daily reset job (runs at midnight)
   */
  startDailyReset() {
    const job = cron.schedule('0 0 * * *', async () => {
      console.log('🔄 Resetting API usage counters...');
      try {
        await apiUsageTracker.resetAllUsages();
        console.log('✅ API usage counters reset');
      } catch (error) {
        console.error('❌ Error resetting API usage counters:', error);
      }
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    this.jobs.push({ name: 'daily-reset', job });
    console.log('✅ Daily reset job scheduled (runs at midnight UTC)');
  }

  /**
   * Start news fetching job
   */
  startNewsFetching() {
    // Get schedule from environment or use default (every 6 hours)
    const schedule = process.env.NEWS_FETCH_SCHEDULE || '0 */6 * * *';
    
    // Parse schedule description
    const scheduleDesc = this.getScheduleDescription(schedule);

    const job = cron.schedule(schedule, async () => {
      if (this.isRunning) {
        console.log('⏭️  News fetching already in progress, skipping...');
        return;
      }

      this.isRunning = true;
      console.log(`\n🔄 Starting scheduled news fetch (${new Date().toISOString()})...`);

      try {
        const result = await fetchAndPostNews({
          categories: ['DEFI', 'FINANCE', 'POLITICS', 'SPORT', 'ENTERTAINMENT', 'WEATHER', 'TECHNOLOGY', 'BUSINESS', 'HEALTH', 'SCIENCE', 'OTHERS'],
          maxArticlesPerCategory: parseInt(process.env.NEWS_MAX_ARTICLES_PER_CATEGORY) || 5,
          dryRun: false
        });

        if (result.success) {
          console.log(`✅ Scheduled news fetch completed: ${result.totalCreated} articles created`);
        } else {
          console.error(`❌ Scheduled news fetch failed: ${result.error}`);
        }
      } catch (error) {
        console.error('❌ Error in scheduled news fetch:', error);
      } finally {
        this.isRunning = false;
      }
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    this.jobs.push({ name: 'news-fetching', job });
    console.log(`✅ News fetching job scheduled: ${scheduleDesc}`);
  }

  /**
   * Get human-readable schedule description
   */
  getScheduleDescription(schedule) {
    const descriptions = {
      '0 */6 * * *': 'Every 6 hours',
      '0 */4 * * *': 'Every 4 hours',
      '0 */12 * * *': 'Every 12 hours',
      '0 0 * * *': 'Daily at midnight',
      '0 0,6,12,18 * * *': '4 times daily (midnight, 6am, noon, 6pm)',
      '0 */1 * * *': 'Every hour'
    };

    return descriptions[schedule] || schedule;
  }

  /**
   * Stop all cron jobs
   */
  stopAll() {
    this.jobs.forEach(({ name, job }) => {
      job.stop();
      console.log(`⏹️  Stopped cron job: ${name}`);
    });
    this.jobs = [];
  }

  /**
   * Get status of all jobs
   */
  getStatus() {
    return {
      jobs: this.jobs.map(({ name, job }) => ({
        name,
        running: job.running
      })),
      isRunning: this.isRunning
    };
  }

  /**
   * Manually trigger news fetch (for testing)
   */
  async triggerManualFetch() {
    if (this.isRunning) {
      throw new Error('News fetch already in progress');
    }

    this.isRunning = true;
    try {
      const result = await fetchAndPostNews({
        categories: ['GENERAL', 'CRYPTO', 'SPORTS', 'ENTERTAINMENT'],
        maxArticlesPerCategory: 5,
        dryRun: false
      });
      return result;
    } finally {
      this.isRunning = false;
    }
  }
}

// Singleton instance
const newsCron = new NewsCron();

module.exports = newsCron;

