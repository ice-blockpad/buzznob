const cron = require('node-cron');
const { prisma } = require('../config/database');
const pushNotificationService = require('./pushNotificationService');
const distributedLock = require('./distributedLock');

/**
 * Optimized Notification Cron Jobs for Scale (5M+ users)
 * Uses batching, pagination, and rate limiting
 */
class NotificationCronOptimized {
  constructor() {
    this.jobs = [];
    // Expo API supports up to 100 notifications per request
    this.BATCH_SIZE = 100;
    // Process 10,000 users at a time to avoid memory issues
    this.PAGE_SIZE = 10000;
    // Rate limit: 50 requests/second (3000/minute) to stay under Expo's limits
    this.RATE_LIMIT = 50; // requests per second
    this.requestQueue = [];
    this.processingQueue = false;
  }

  /**
   * Rate-limited batch sender
   * Ensures we don't exceed Expo's rate limits
   */
  async sendBatchWithRateLimit(pushTokens, notification) {
    return new Promise((resolve, reject) => {
      const delay = 1000 / this.RATE_LIMIT; // milliseconds between requests
      
      const sendNext = async () => {
        if (pushTokens.length === 0) {
          resolve();
          return;
        }

        const batch = pushTokens.splice(0, this.BATCH_SIZE);
        
        try {
          await pushNotificationService.sendBulkNotifications(batch, notification);
          
          // Wait before next batch to respect rate limit
          if (pushTokens.length > 0) {
            setTimeout(sendNext, delay);
          } else {
            resolve();
          }
        } catch (error) {
          console.error('Error sending batch:', error);
          // Continue with next batch even if one fails
          if (pushTokens.length > 0) {
            setTimeout(sendNext, delay);
          } else {
            resolve();
          }
        }
      };

      sendNext();
    });
  }

  /**
   * Process users in paginated batches
   * Fetches users in chunks to avoid memory issues
   */
  async processUsersInBatches(notificationFn, notificationData) {
    let offset = 0;
    let totalProcessed = 0;
    let hasMore = true;

    while (hasMore) {
      try {
        // Fetch users in pages
        const users = await prisma.user.findMany({
          where: {
            pushToken: { not: null },
            isActive: true,
          },
          select: { 
            id: true,
            pushToken: true 
          },
          skip: offset,
          take: this.PAGE_SIZE,
          orderBy: { id: 'asc' }, // Consistent ordering
        });

        if (users.length === 0) {
          hasMore = false;
          break;
        }

        // Group push tokens into batches of 100
        const pushTokens = users
          .map(u => u.pushToken)
          .filter(Boolean);

        // Send notifications in batches with rate limiting
        await this.sendBatchWithRateLimit(
          [...pushTokens], // Copy array to avoid mutation
          notificationData
        );

        totalProcessed += users.length;
        offset += this.PAGE_SIZE;
        hasMore = users.length === this.PAGE_SIZE;

        console.log(`📊 Processed ${totalProcessed} users...`);

        // Small delay between pages to avoid overwhelming database
        if (hasMore) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error(`Error processing batch at offset ${offset}:`, error);
        // Continue with next batch
        offset += this.PAGE_SIZE;
      }
    }

    return totalProcessed;
  }

  /**
   * Optimized mining completion check
   * Processes completed sessions in batches
   */
  startMiningCompletionCheck() {
    const job = cron.schedule('*/5 * * * *', async () => {
      // Use distributed lock to prevent duplicate execution in PM2 cluster mode
      await distributedLock.withLock('mining_completion_check', async () => {
        try {
          // Find completed but unclaimed mining sessions from last 5 minutes
          const completedSessions = await prisma.miningSession.findMany({
          where: {
            isCompleted: true,
            isClaimed: false,
            completedAt: {
              gte: new Date(Date.now() - 5 * 60 * 1000),
            },
          },
          include: {
            user: {
              select: {
                id: true,
                pushToken: true,
              },
            },
          },
          take: 1000, // Limit to prevent memory issues
        });

        if (completedSessions.length === 0) {
          return;
        }

        // Group by push token and batch
        const pushTokens = completedSessions
          .map(s => s.user?.pushToken)
          .filter(Boolean);

        if (pushTokens.length === 0) {
          return;
        }

        const notification = {
          title: '⛏️ Mining Complete!',
          body: 'Your mining session has ended. Claim your rewards now!',
          data: { type: 'mining_complete' },
        };

        // Send in batches with rate limiting
        await this.sendBatchWithRateLimit(pushTokens, notification);
        
          console.log(`✅ Sent ${pushTokens.length} mining completion notifications`);
        } catch (error) {
          console.error('Error in mining completion check cron:', error);
        }
      }, 300); // 5 minute TTL (matches cron interval)
    });

    this.jobs.push(job);
    console.log('✅ Optimized mining completion check cron job started');
  }

  /**
   * Optimized daily claim notifications
   * Processes 5M users efficiently using pagination and batching
   */
  startDailyClaimNotifications() {
    const job = cron.schedule('0 0 * * *', async () => {
      // Use distributed lock to prevent duplicate execution in PM2 cluster mode
      // TTL of 1 hour to ensure lock is held for entire execution
      await distributedLock.withLock('daily_claim_notification', async () => {
        try {
          const startTime = Date.now();
          console.log('🚀 Starting daily claim notifications...');

          // First, get total count for progress tracking
          const totalUsers = await prisma.user.count({
            where: {
              pushToken: { not: null },
              isActive: true,
            },
          });

          console.log(`📊 Total users to notify: ${totalUsers.toLocaleString()}`);

          const notification = {
            title: '🎁 Daily Reward Available!',
            body: 'Your daily reward is ready to claim!',
            data: { type: 'daily_claim' },
          };

          // Process in paginated batches
          const totalProcessed = await this.processUsersInBatches(
            null, // Not using function, using direct notification
            notification
          );

          const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
          console.log(`✅ Daily claim notifications complete!`);
          console.log(`   Processed: ${totalProcessed.toLocaleString()} users`);
          console.log(`   Duration: ${duration} minutes`);
          console.log(`   Rate: ${(totalProcessed / (Date.now() - startTime) * 1000).toFixed(0)} users/second`);
        } catch (error) {
          console.error('Error in daily claim notification cron:', error);
        }
      }, 3600); // 1 hour TTL to ensure lock is held for entire execution
    });

    this.jobs.push(job);
    console.log('✅ Optimized daily claim notification cron job started');
  }

  /**
   * Start all cron jobs
   */
  startAll() {
    this.startMiningCompletionCheck();
    this.startDailyClaimNotifications();
    console.log('✅ All optimized notification cron jobs started');
  }

  /**
   * Stop all cron jobs
   */
  stopAll() {
    this.jobs.forEach((job) => job.stop());
    this.jobs = [];
    console.log('✅ All notification cron jobs stopped');
  }
}

const notificationCronOptimized = new NotificationCronOptimized();
module.exports = notificationCronOptimized;

