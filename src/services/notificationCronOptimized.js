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
    }, {
      scheduled: false,
      timezone: 'UTC'
    });

    this.jobs.push(job);
    job.start(); // Start the job since scheduled: false
    console.log('✅ Optimized mining completion check cron job started');
  }

  /**
   * Process users in paginated batches with deduplication
   * Tracks which users have been processed in this run to prevent duplicates
   * The date-based lock ensures this only runs once per UTC day
   */
  async processUsersInBatchesWithDeduplication(notificationData) {
    let offset = 0;
    let totalProcessed = 0;
    let totalSent = 0;
    let hasMore = true;
    
    // Track which users we've already processed in this run
    // This prevents duplicate notifications if the same user appears multiple times
    const processedUserIds = new Set();

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

        // Filter out users already processed in this run
        const usersToNotify = users.filter(u => !processedUserIds.has(u.id));
        
        // Mark these users as processed to prevent duplicates within this run
        usersToNotify.forEach(u => processedUserIds.add(u.id));
        
        // Group push tokens into batches of 100
        const pushTokens = usersToNotify
          .map(u => u.pushToken)
          .filter(Boolean);

        // Send notifications in batches with rate limiting
        if (pushTokens.length > 0) {
          await this.sendBatchWithRateLimit(
            [...pushTokens], // Copy array to avoid mutation
            notificationData
          );
          totalSent += pushTokens.length;
        }

        totalProcessed += users.length;
        offset += this.PAGE_SIZE;
        hasMore = users.length === this.PAGE_SIZE;

        console.log(`📊 Processed ${totalProcessed} users, sent ${totalSent} notifications...`);

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

    return { totalProcessed, totalSent };
  }

  /**
   * Optimized daily claim notifications
   * Processes 5M users efficiently using pagination and batching
   * Includes deduplication to prevent duplicate notifications
   */
  startDailyClaimNotifications() {
    const job = cron.schedule('12 0 * * *', async () => {
      const now = new Date();
      const todayUtc = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate()
      ));
      
      // Use date-based lock key to ensure only one execution per UTC day
      // Format: daily_claim_notification_YYYY-MM-DD
      const dateStr = todayUtc.toISOString().split('T')[0];
      const lockKey = `daily_claim_notification_${dateStr}`;
      
      // Log the actual execution time for debugging
      const executionTime = new Date().toISOString();
      const executionTimeUTC = new Date().toUTCString();
      console.log(`⏰ [TIMEZONE DEBUG] Cron executed at: ${executionTime} (${executionTimeUTC})`);
      
      // Use distributed lock to prevent duplicate execution in PM2 cluster mode
      // TTL of 1 hour to ensure lock is held for entire execution
      const lockResult = await distributedLock.withLock(lockKey, async () => {
        try {
          const startTime = Date.now();
          
          console.log('🚀 Starting daily claim notifications...');
          console.log(`📅 UTC Date: ${dateStr}`);
          console.log(`🔒 Lock key: ${lockKey}`);
          console.log(`⏰ Execution time (UTC): ${new Date().toUTCString()}`);

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

          // Process in paginated batches with deduplication
          const { totalProcessed, totalSent } = await this.processUsersInBatchesWithDeduplication(notification);

          const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
          console.log(`✅ Daily claim notifications complete!`);
          console.log(`   Total users processed: ${totalProcessed.toLocaleString()}`);
          console.log(`   Notifications sent: ${totalSent.toLocaleString()}`);
          console.log(`   Skipped (already notified): ${(totalProcessed - totalSent).toLocaleString()}`);
          console.log(`   Duration: ${duration} minutes`);
          if (totalSent > 0) {
            console.log(`   Rate: ${(totalSent / (Date.now() - startTime) * 1000).toFixed(0)} notifications/second`);
          }
        } catch (error) {
          console.error('❌ Error in daily claim notification cron:', error);
          console.error('❌ Error stack:', error.stack);
        }
      }, 3600); // 1 hour TTL to ensure lock is held for entire execution
      
      // Log if lock was not acquired (another instance is handling it)
      if (lockResult === null) {
        console.log(`⏭️  Daily claim notification skipped for ${dateStr} - lock held by another instance`);
      }
    }, {
      scheduled: false,
      timezone: 'UTC'
    });

    this.jobs.push(job);
    job.start(); // Start the job since scheduled: false
    console.log('✅ Optimized daily claim notification cron job started (runs at 00:12 UTC daily)');
    console.log(`⏰ Server timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
    console.log(`⏰ Current server time (UTC): ${new Date().toUTCString()}`);
  }

  /**
   * Start all cron jobs
   * Stops existing jobs first to prevent duplicate registrations
   */
  startAll() {
    // Stop existing jobs first to prevent duplicates
    if (this.jobs.length > 0) {
      console.log(`⚠️  Stopping ${this.jobs.length} existing cron jobs before restarting...`);
      this.stopAll();
    }
    
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

