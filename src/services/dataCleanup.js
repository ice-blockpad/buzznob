const { prisma } = require('../config/database');

/**
 * Data Cleanup Service
 * Handles deletion of old records based on retention policies
 */

/**
 * Update user count fields before deleting records
 * @param {string} userId - User ID
 * @returns {Promise<void>}
 */
async function updateUserCounts(userId) {
  try {
    // Count UserActivity records
    const activityCount = await prisma.userActivity.count({
      where: { userId }
    });

    // Update only totalArticlesReadCount
    // NOTE: totalMiningSessionsCount should NOT be recalculated here
    // It's a lifetime count that's incremented when sessions are claimed
    // and should never decrease, even after aggregation/deletion
    await prisma.user.update({
      where: { id: userId },
      data: {
        totalArticlesReadCount: activityCount
        // totalMiningSessionsCount is maintained by the claim endpoint
      }
    });
  } catch (error) {
    console.error(`Error updating counts for user ${userId}:`, error);
    throw error;
  }
}

/**
 * Cleanup Daily Rewards - Keep only last 1 record per user (older than 7 days)
 * @returns {Promise<Object>} Cleanup results
 */
async function cleanupDailyRewards() {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    // Get all users
    const users = await prisma.user.findMany({
      select: { id: true }
    });

    let totalDeleted = 0;
    let errors = 0;

    for (const user of users) {
      try {
        // Get the most recent claim
        const lastClaim = await prisma.dailyReward.findFirst({
          where: { userId: user.id },
          orderBy: { claimedAt: 'desc' }
        });

        if (lastClaim) {
          // Delete all records older than 7 days, except the last one
          const deleteResult = await prisma.dailyReward.deleteMany({
            where: {
              userId: user.id,
              claimedAt: {
                lt: sevenDaysAgo
              },
              id: {
                not: lastClaim.id // Keep the last claim
              }
            }
          });
          
          totalDeleted += deleteResult.count;
        } else {
          // No last claim, delete all older than 7 days
          const deleteResult = await prisma.dailyReward.deleteMany({
            where: {
              userId: user.id,
              claimedAt: {
                lt: sevenDaysAgo
              }
            }
          });
          
          totalDeleted += deleteResult.count;
        }
      } catch (error) {
        console.error(`Error cleaning daily rewards for user ${user.id}:`, error);
        errors++;
      }
    }

    return {
      deleted: totalDeleted,
      errors
    };
  } catch (error) {
    console.error('Error in cleanupDailyRewards:', error);
    throw error;
  }
}

/**
 * Cleanup User Activities - Delete records older than 7 days
 * Note: ReadArticle records are kept forever for duplicate prevention
 * Solution B: Reward claim status is tracked in ReadArticle.rewardClaimedAt, so UserActivity can be safely deleted
 * @returns {Promise<Object>} Cleanup results
 */
async function cleanupUserActivities() {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    // Update counts for all users before deletion
    const users = await prisma.user.findMany({
      select: { id: true }
    });

    for (const user of users) {
      try {
        await updateUserCounts(user.id);
      } catch (error) {
        console.error(`Error updating counts for user ${user.id}:`, error);
      }
    }

    // Delete old activities (reward claim status is preserved in ReadArticle.rewardClaimedAt)
    const deleteResult = await prisma.userActivity.deleteMany({
      where: {
        completedAt: {
          lt: sevenDaysAgo
        }
      }
    });

    return {
      deleted: deleteResult.count,
      errors: 0
    };
  } catch (error) {
    console.error('Error in cleanupUserActivities:', error);
    throw error;
  }
}

/**
 * Cleanup Mining Sessions - Delete completed+claimed sessions older than 7 days
 * Keep active sessions and recent completed sessions
 * @returns {Promise<Object>} Cleanup results
 */
async function cleanupMiningSessions() {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    // Update counts for all users before deletion
    const users = await prisma.user.findMany({
      select: { id: true }
    });

    for (const user of users) {
      try {
        await updateUserCounts(user.id);
      } catch (error) {
        console.error(`Error updating counts for user ${user.id}:`, error);
      }
    }

    // Delete old completed+claimed sessions
    const deleteResult = await prisma.miningSession.deleteMany({
      where: {
        isCompleted: true,
        isClaimed: true,
        completedAt: {
          lt: sevenDaysAgo
        }
      }
    });

    return {
      deleted: deleteResult.count,
      errors: 0
    };
  } catch (error) {
    console.error('Error in cleanupMiningSessions:', error);
    throw error;
  }
}

/**
 * Cleanup Mining Claims - Delete records older than 12 months (after aggregation)
 * @returns {Promise<Object>} Cleanup results
 */
async function cleanupMiningClaims() {
  try {
    const twelveMonthsAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    
    // Delete claims older than 12 months (should already be aggregated)
    const deleteResult = await prisma.miningClaim.deleteMany({
      where: {
        claimedAt: {
          lt: twelveMonthsAgo
        }
      }
    });

    return {
      deleted: deleteResult.count,
      errors: 0
    };
  } catch (error) {
    console.error('Error in cleanupMiningClaims:', error);
    throw error;
  }
}

/**
 * Run cleanup operations without aggregation (for daily cleanup)
 * Aggregation runs separately on monthly schedule
 * @returns {Promise<Object>} Overall cleanup results
 */
async function runCleanupWithoutAggregation() {
  const startTime = Date.now();
  console.log('🧹 Starting data cleanup (without aggregation)...');

  const results = {
    dailyRewards: { deleted: 0, errors: 0 },
    userActivities: { deleted: 0, errors: 0 },
    miningSessions: { deleted: 0, errors: 0 },
    duration: 0
  };

  try {
    // 1. Cleanup Daily Rewards
    console.log('📅 Cleaning up daily rewards...');
    results.dailyRewards = await cleanupDailyRewards();
    console.log(`✅ Daily rewards: ${results.dailyRewards.deleted} deleted, ${results.dailyRewards.errors} errors`);

    // 2. Cleanup User Activities
    console.log('📚 Cleaning up user activities...');
    results.userActivities = await cleanupUserActivities();
    console.log(`✅ User activities: ${results.userActivities.deleted} deleted, ${results.userActivities.errors} errors`);

    // 3. Cleanup Mining Sessions
    console.log('⛏️  Cleaning up mining sessions...');
    results.miningSessions = await cleanupMiningSessions();
    console.log(`✅ Mining sessions: ${results.miningSessions.deleted} deleted, ${results.miningSessions.errors} errors`);

    // Note: Mining claims aggregation runs monthly at 00:00 UTC on the 1st

    results.duration = Date.now() - startTime;
    console.log(`✅ Data cleanup completed in ${(results.duration / 1000).toFixed(2)}s`);

    return results;
  } catch (error) {
    console.error('❌ Error in runCleanupWithoutAggregation:', error);
    results.duration = Date.now() - startTime;
    throw error;
  }
}

/**
 * Run all cleanup operations (including aggregation)
 * Used for manual runs or testing
 * @returns {Promise<Object>} Overall cleanup results
 */
async function runCleanup() {
  const startTime = Date.now();
  console.log('🧹 Starting full data cleanup (including aggregation)...');

  const results = {
    dailyRewards: { deleted: 0, errors: 0 },
    userActivities: { deleted: 0, aggregated: 0, errors: 0 },
    miningSessions: { deleted: 0, errors: 0 },
    miningClaims: { deleted: 0, errors: 0 },
    duration: 0
  };

  try {
    // 1. Cleanup Daily Rewards
    console.log('📅 Cleaning up daily rewards...');
    results.dailyRewards = await cleanupDailyRewards();
    console.log(`✅ Daily rewards: ${results.dailyRewards.deleted} deleted, ${results.dailyRewards.errors} errors`);

    // 2. Cleanup User Activities
    console.log('📚 Cleaning up user activities...');
    results.userActivities = await cleanupUserActivities();
    console.log(`✅ User activities: ${results.userActivities.deleted} deleted, ${results.userActivities.errors} errors`);

    // 3. Cleanup Mining Sessions
    console.log('⛏️  Cleaning up mining sessions...');
    results.miningSessions = await cleanupMiningSessions();
    console.log(`✅ Mining sessions: ${results.miningSessions.deleted} deleted, ${results.miningSessions.errors} errors`);

    // 4. Aggregate and cleanup Mining Claims
    console.log('💰 Aggregating and cleaning up mining claims...');
    // Use current month start as cutoff (aggregate previous complete months)
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth();
    const currentMonthStart = new Date(Date.UTC(currentYear, currentMonth, 1, 0, 0, 0, 0));
    const { aggregateAllUsersClaims } = require('./dataAggregation');
    const aggregationResult = await aggregateAllUsersClaims(currentMonthStart);
    console.log(`✅ Mining claims aggregated: ${aggregationResult.summariesCreated} summaries, ${aggregationResult.claimsDeleted} deleted`);
    
    // Then cleanup claims older than 12 months
    results.miningClaims = await cleanupMiningClaims();
    console.log(`✅ Mining claims: ${results.miningClaims.deleted} deleted, ${results.miningClaims.errors} errors`);

    results.duration = Date.now() - startTime;
    console.log(`✅ Data cleanup completed in ${(results.duration / 1000).toFixed(2)}s`);

    return results;
  } catch (error) {
    console.error('❌ Error in runCleanup:', error);
    results.duration = Date.now() - startTime;
    throw error;
  }
}

module.exports = {
  updateUserCounts,
  cleanupDailyRewards,
  cleanupUserActivities,
  cleanupMiningSessions,
  cleanupMiningClaims,
  runCleanup,
  runCleanupWithoutAggregation
};

