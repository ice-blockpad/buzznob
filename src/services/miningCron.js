const cron = require('node-cron');
const { prisma } = require('../config/database');

/**
 * Mining Cron Jobs
 * Handles scheduled mining-related tasks
 */
class MiningCron {
  constructor() {
    this.jobs = [];
    this.isUpdatingRates = false; // Prevent concurrent updates
  }

  /**
   * Update mining rates for all active sessions
   * Formula: baseRate + (activeReferrals * 10% of baseRate)
   * Example: 20 + (7 * 2) = 34 tokens/6hrs for 7 active referrals
   */
  async updateMiningRates() {
    // Prevent concurrent runs
    if (this.isUpdatingRates) {
      console.log('⏭️ Mining rate update already in progress, skipping...');
      return;
    }

    this.isUpdatingRates = true;
    const startTime = Date.now();
    console.log('🔄 Starting mining rate update cron job...');

    try {
      // Find all users with active mining sessions
      const activeSessions = await prisma.miningSession.findMany({
        where: {
          isActive: true
        },
        select: {
          id: true,
          userId: true,
          baseReward: true,
          currentRate: true,
          startedAt: true,
          lastUpdate: true,
          totalMined: true
        },
        orderBy: {
          userId: 'asc'
        }
      });

      console.log(`📊 Found ${activeSessions.length} active mining sessions`);

      let updatedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      // Process each session
      for (const session of activeSessions) {
        try {
          // Count active referrals for this user
          const user = await prisma.user.findUnique({
            where: { id: session.userId },
            include: { referrals: true }
          });

          if (!user) {
            console.warn(`⚠️ User ${session.userId} not found, skipping session ${session.id}`);
            skippedCount++;
            continue;
          }

          let activeReferrals = 0;
          if (user.referrals && user.referrals.length > 0) {
            // Find referred users who are currently mining
            const activeReferredUsers = await prisma.user.findMany({
              where: {
                referredBy: session.userId,
                miningSessions: {
                  some: {
                    isActive: true,
                    startedAt: {
                      gte: new Date(Date.now() - 6 * 60 * 60 * 1000) // Started within 6 hours
                    }
                  }
                }
              }
            });
            activeReferrals = activeReferredUsers.length;
          }

          // Calculate correct rate: baseRate + (activeReferrals * 10% of baseRate)
          // Example: 20 + (7 * 10% of 20) = 20 + (7 * 2) = 20 + 14 = 34
          const baseReward = session.baseReward; // Usually 20
          const referralBonus = activeReferrals * 10; // 10% per referral
          const correctRate = baseReward + (baseReward * referralBonus / 100);

          // Only update if rate is different (prevent unnecessary updates)
          if (Math.abs(session.currentRate - correctRate) > 0.01) {
            // Calculate tokens mined since last update
            const now = new Date();
            const sessionEndTime = new Date(session.startedAt.getTime() + 6 * 60 * 60 * 1000);
            
            // Cap elapsed time to not exceed the 6-hour session duration
            const maxElapsedTime = Math.min(
              now.getTime() - session.lastUpdate.getTime(),
              sessionEndTime.getTime() - session.lastUpdate.getTime()
            );
            const elapsedHours = maxElapsedTime / (1000 * 60 * 60);
            const minedSinceLastUpdate = (session.currentRate * elapsedHours) / 6;

            // Don't update lastUpdate beyond the session end time
            const newLastUpdate = new Date(Math.min(now.getTime(), sessionEndTime.getTime()));

            // Update the session with correct rate
            await prisma.miningSession.update({
              where: { id: session.id },
              data: {
                currentRate: correctRate,
                totalMined: session.totalMined + minedSinceLastUpdate,
                lastUpdate: newLastUpdate
              }
            });

            updatedCount++;
            console.log(`✅ Updated session ${session.id}: User ${session.userId} - Rate ${session.currentRate.toFixed(2)} → ${correctRate.toFixed(2)} (${activeReferrals} active referrals)`);
          } else {
            skippedCount++;
          }
        } catch (error) {
          errorCount++;
          console.error(`❌ Error updating session ${session.id}:`, error.message);
          // Continue with next session
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log('═══════════════════════════════════════════════════════════');
      console.log('📊 Mining Rate Update Summary:');
      console.log(`   • Total sessions checked: ${activeSessions.length}`);
      console.log(`   • Updated: ${updatedCount}`);
      console.log(`   • Skipped (already correct): ${skippedCount}`);
      console.log(`   • Errors: ${errorCount}`);
      console.log(`   • Duration: ${duration}s`);
      console.log('═══════════════════════════════════════════════════════════');

    } catch (error) {
      console.error('❌ Error in mining rate update cron:', error);
    } finally {
      this.isUpdatingRates = false;
    }
  }

  /**
   * Start mining rate update cron job
   * Runs immediately on startup, then every 10 minutes
   */
  startMiningRateUpdate() {
    // Run immediately on startup
    this.updateMiningRates().catch(err => {
      console.error('❌ Error running initial mining rate update:', err);
    });

    // Schedule to run every 10 minutes
    const job = cron.schedule('*/10 * * * *', async () => {
      await this.updateMiningRates();
    });

    this.jobs.push(job);
    console.log('✅ Mining rate update cron job started (runs immediately, then every 10 minutes)');
  }

  /**
   * Start all cron jobs
   */
  startAll() {
    this.startMiningRateUpdate();
    console.log('✅ All mining cron jobs started');
  }

  /**
   * Stop all cron jobs
   */
  stopAll() {
    this.jobs.forEach((job) => job.stop());
    this.jobs = [];
    this.isUpdatingRates = false;
    console.log('✅ All mining cron jobs stopped');
  }
}

const miningCron = new MiningCron();
module.exports = miningCron;

