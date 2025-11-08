const cron = require('node-cron');
const { prisma } = require('../config/database');
const pushNotificationService = require('./pushNotificationService');

/**
 * Notification Cron Jobs
 * Handles scheduled notification tasks
 */
class NotificationCron {
  constructor() {
    this.jobs = [];
  }

  /**
   * Check for completed mining sessions and send notifications
   * Runs every 5 minutes
   * Note: This is a backup - notifications are also sent immediately when sessions complete
   * Only sends notifications for sessions that completed 2+ minutes ago to avoid duplicates
   */
  startMiningCompletionCheck() {
    const job = cron.schedule('*/5 * * * *', async () => {
      try {
        const now = Date.now();
        const twoMinutesAgo = new Date(now - 2 * 60 * 1000); // 2 minutes ago
        const fiveMinutesAgo = new Date(now - 5 * 60 * 1000); // 5 minutes ago

        // Find completed but unclaimed sessions that completed 2-5 minutes ago
        // This gives immediate notification time to send, avoiding duplicates
        // Only acts as backup if immediate notification failed
        const completedSessions = await prisma.miningSession.findMany({
          where: {
            isCompleted: true,
            isClaimed: false,
            completedAt: {
              gte: fiveMinutesAgo, // At least 5 minutes ago
              lte: twoMinutesAgo,   // But at least 2 minutes ago (avoid duplicates)
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
        });

        // Batch mining completion notifications (usually only a few per 5 minutes)
        const pushTokens = completedSessions
          .map(s => s.user?.pushToken)
          .filter(Boolean);

        if (pushTokens.length > 0) {
          const notification = {
            title: '⛏️ Mining Complete!',
            body: 'Your mining session has ended. Claim your rewards now!',
            data: { type: 'mining_complete' },
          };

          // Send in batches of 100 (Expo's limit)
          const BATCH_SIZE = 100;
          for (let i = 0; i < pushTokens.length; i += BATCH_SIZE) {
            const batch = pushTokens.slice(i, i + BATCH_SIZE);
            await pushNotificationService.sendBulkNotifications(batch, notification);
          }
          
          console.log(`✅ Sent ${pushTokens.length} backup mining completion notifications`);
        }
      } catch (error) {
        console.error('Error in mining completion check cron:', error);
      }
    });

    this.jobs.push(job);
    console.log('✅ Mining completion check cron job started (runs every 5 minutes as backup)');
  }

  /**
   * Daily claim notifications are handled LOCALLY on each device
   * No backend cron job needed - each device schedules its own notification
   * This avoids server load and works even when device is offline
   */
  startDailyClaimNotifications() {
    // Daily claim notifications are scheduled locally on each device
    // See: app/src/services/notificationService.js -> scheduleDailyClaimNotification()
    // No server-side cron job needed
    console.log('ℹ️ Daily claim notifications are handled locally on each device');
  }

  /**
   * Start all cron jobs
   */
  startAll() {
    this.startMiningCompletionCheck();
    this.startDailyClaimNotifications(); // No-op (handled locally)
    console.log('✅ All notification cron jobs started');
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

const notificationCron = new NotificationCron();
module.exports = notificationCron;

