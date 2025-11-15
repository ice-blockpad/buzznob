const { prisma } = require('../config/database');
const pushNotificationService = require('./pushNotificationService');

// Define app launch date (you can adjust this to your actual launch date)
const APP_LAUNCH_DATE = new Date('2025-10-23');
const FIRST_MONTH_END = new Date(APP_LAUNCH_DATE.getTime() + (30 * 24 * 60 * 60 * 1000));

/**
 * Check and award achievements for a user
 * @param {string} userId - The user ID to check achievements for
 */
async function checkBadgeEligibility(userId) {
  try {
    // Get user's total articles read
    const totalRead = await prisma.userActivity.count({
      where: { userId }
    });

    // Get user's total points and creation date
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { 
        points: true, 
        createdAt: true,
        streakCount: true,
        lastLogin: true
      }
    });

    // Get user's referral count
    const referralCount = await prisma.user.count({
      where: { referredBy: userId }
    });

    // Get user's completed mining sessions count
    const miningSessionsCount = await prisma.miningSession.count({
      where: {
        userId,
        isCompleted: true,
        isClaimed: true
      }
    });

    // Define all achievement types
    const achievements = [
      // Point-based achievements
      { type: 'points', value: 10000, name: 'Point Collector' },
      { type: 'points', value: 50000, name: 'Point Master' },
      { type: 'points', value: 100000, name: 'BuzzNob Legend' },
      
      // Reading-based achievements
      { type: 'reading', value: 1, name: 'Article Reader' },
      { type: 'reading', value: 10, name: 'Curious Mind' },
      { type: 'reading', value: 50, name: 'Knowledge Seeker' },
      { type: 'reading', value: 100, name: 'Avid Reader' },
      { type: 'reading', value: 200, name: 'Explorer' },
      { type: 'reading', value: 500, name: 'Article Master' },
      { type: 'reading', value: 1000, name: 'Mr. Know-It-All' },
      
      // Mining-based achievements
      { type: 'mining', value: 1, name: 'Stone Breaker' },
      { type: 'mining', value: 10, name: 'Gem Addict' },
      { type: 'mining', value: 25, name: 'Treasue Seeker' },
      { type: 'mining', value: 50, name: 'Diamond Hunter' },
      { type: 'mining', value: 100, name: '$BUZZ Digger' },
      
      // Social achievements (referral-based)
      { type: 'referrals', value: 1, name: 'First Referral' },
      { type: 'referrals', value: 10, name: 'Friend Magnet' },
      { type: 'referrals', value: 25, name: 'Social Butterfly' },
      { type: 'referrals', value: 50, name: 'Community Builder' },
      { type: 'referrals', value: 100, name: 'Influencer' },
      { type: 'referrals', value: 200, name: 'Social Nerd' },
      { type: 'referrals', value: 500, name: 'Key Opinion Leader' },
      
      // Special achievements
      { type: 'earlyAdopter', value: true, name: 'Early Adopter' },
      { type: 'streak', value: 3, name: 'Daily Streak' },
      { type: 'streak', value: 7, name: 'Weekly Warrior' },
      { type: 'streak', value: 30, name: 'Streak Master' }
    ];

    // Check each achievement
    for (const achievement of achievements) {
      await checkAndAwardAchievement(userId, achievement, {
        user,
        totalRead,
        referralCount,
        miningSessionsCount
      });
    }

  } catch (error) {
    console.error('Achievement check error:', error);
  }
}

/**
 * Check and award a specific achievement
 * @param {string} userId - The user ID
 * @param {Object} achievement - The achievement definition
 * @param {Object} userData - User data (points, articles read, etc.)
 */
async function checkAndAwardAchievement(userId, achievement, userData) {
  try {
    const { user, totalRead, referralCount, miningSessionsCount } = userData;
    
    // Check if badge exists in database
    const badgeExists = await prisma.badge.findUnique({
      where: { name: achievement.name }
    });

    if (!badgeExists) {
      console.log(`Badge "${achievement.name}" not found in database`);
      return;
    }

    // Check if user already has this badge
    const userHasBadge = await prisma.userBadge.findFirst({
      where: {
        userId,
        badgeId: badgeExists.id
      }
    });

    if (userHasBadge) {
      return; // User already has this badge
    }

    // Check if user meets the achievement criteria
    let shouldAwardBadge = false;
    
    switch (achievement.type) {
      case 'points':
        shouldAwardBadge = user.points >= achievement.value;
        break;
        
      case 'reading':
        shouldAwardBadge = totalRead >= achievement.value;
        break;
        
      case 'mining':
        shouldAwardBadge = miningSessionsCount >= achievement.value;
        break;
        
      case 'referrals':
        shouldAwardBadge = referralCount >= achievement.value;
        break;
        
      case 'earlyAdopter':
        shouldAwardBadge = user.createdAt <= FIRST_MONTH_END;
        break;
        
      case 'streak':
        shouldAwardBadge = user.streakCount >= achievement.value;
        break;
        
      default:
        console.log(`Unknown achievement type: ${achievement.type}`);
        return;
    }

    // Award the badge if criteria is met
    if (shouldAwardBadge) {
      await awardBadge(userId, badgeExists);
    }

  } catch (error) {
    console.error(`Error checking achievement "${achievement.name}":`, error);
  }
}

/**
 * Award a badge to a user
 * @param {string} userId - The user ID
 * @param {Object} badge - The badge object from database
 */
async function awardBadge(userId, badge) {
  try {
    // Use transaction to atomically create badge and award points
    // This prevents race conditions where checkBadgeEligibility is called multiple times simultaneously
    await prisma.$transaction(async (tx) => {
      // Double-check if user already has this badge within transaction
      // This prevents duplicate badges if awardBadge is called multiple times concurrently
      const existingUserBadge = await tx.userBadge.findFirst({
        where: {
          userId,
          badgeId: badge.id
        }
      });

      if (existingUserBadge) {
        // User already has this badge, skip awarding
        console.log(`⏭️  User ${userId} already has badge "${badge.name}", skipping`);
        return;
      }

      // Create user badge record atomically
      await tx.userBadge.create({
        data: {
          userId,
          badgeId: badge.id
        }
      });

      // Award points for earning the badge (based on badge's pointsRequired)
      if (badge.pointsRequired && badge.pointsRequired > 0) {
        await tx.user.update({
          where: { id: userId },
          data: {
            points: {
              increment: badge.pointsRequired
            }
          }
        });
      }

      console.log(`🏆 Awarded badge "${badge.name}" to user ${userId} (+${badge.pointsRequired} points)`);
    });

    // Write-through cache: Refresh user profile and achievement caches
    // (achievementsCount changed, and points may have changed)
    // Note: Leaderboard cache is time-based (10 min TTL) and will update automatically
    const { refreshUserAndLeaderboardCaches } = require('./cacheRefreshHelpers');
    const cacheService = require('./cacheService');
    setImmediate(async () => {
      try {
        // Refresh user profile cache (points may have changed)
        // Leaderboard will update automatically every 10 minutes
        await refreshUserAndLeaderboardCaches(userId);
        
        // Refresh user achievements cache
        await cacheService.delete(`achievements:${userId}`);
        await cacheService.delete(`user:badges:${userId}`);
        await cacheService.delete(`user:achievements:${userId}`);
        await cacheService.delete(`admin:achievements:${userId}`);
      } catch (err) {
        console.error('Error refreshing caches after achievement award:', err);
      }
    });

    // Send push notification when achievement is unlocked (after transaction completes)
    setImmediate(() => {
      pushNotificationService.sendAchievementUnlockedNotification(
        userId,
        badge.name,
        badge.pointsRequired || 0
      ).catch(err => console.error('Failed to send achievement notification:', err));
    });

  } catch (error) {
    // Handle unique constraint violation (user already has badge) gracefully
    if (error.code === 'P2002') {
      console.log(`⏭️  User ${userId} already has badge "${badge.name}" (unique constraint)`);
      return;
    }
    console.error(`Error awarding badge "${badge.name}":`, error);
  }
}

/**
 * Get all achievements for a user
 * @param {string} userId - The user ID
 * @returns {Object} User's achievements data
 */
async function getUserAchievements(userId) {
  try {
    const userBadges = await prisma.userBadge.findMany({
      where: { userId },
      include: {
        badge: true
      },
      orderBy: { earnedAt: 'desc' }
    });

    const allBadges = await prisma.badge.findMany({
      orderBy: { pointsRequired: 'asc' }
    });

    return {
      userBadges,
      allBadges,
      totalEarned: userBadges.length,
      totalAvailable: allBadges.length
    };

  } catch (error) {
    console.error('Error getting user achievements:', error);
    throw error;
  }
}

/**
 * Check achievements for all users (admin function)
 */
async function checkAllUsersAchievements() {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, username: true }
    });

    console.log(`Checking achievements for ${users.length} users...`);

    for (const user of users) {
      await checkBadgeEligibility(user.id);
    }

    console.log('✅ Achievement check completed for all users');

  } catch (error) {
    console.error('Error checking all users achievements:', error);
  }
}

module.exports = {
  checkBadgeEligibility,
  checkAndAwardAchievement,
  awardBadge,
  getUserAchievements,
  checkAllUsersAchievements
};
