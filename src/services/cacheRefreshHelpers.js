const { prisma } = require('../config/database');
const cacheService = require('./cacheService');

/**
 * Fetch user profile from database
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - User profile data
 */
async function fetchUserProfile(userId) {
  try {
    const result = await prisma.$queryRaw`
      SELECT 
        u.id, u.username, u.email, u.external_id as "externalId", u.particle_user_id as "particleUserId", u.wallet_address as "walletAddress",
        u.display_name as "displayName", u.role, u.first_name as "firstName", u.last_name as "lastName",
        u.avatar_url as "avatarUrl", u.avatar_data as "avatarData", u.avatar_type as "avatarType",
        u.points, u.streak_count as "streakCount", u.last_login as "lastLogin", 
        u.referral_code as "referralCode", u.is_active as "isActive", u.is_verified as "isVerified",
        u.kyc_status as "kycStatus", u.bio, u.created_at as "createdAt", u.updated_at as "updatedAt",
        COALESCE((SELECT COUNT(*) FROM read_articles WHERE user_id = u.id), 0) as "totalArticlesRead",
        COUNT(DISTINCT ub.id) as "achievementsCount",
        (SELECT COUNT(*) FROM users WHERE points > u.points) + 1 as rank
      FROM users u
      LEFT JOIN user_badges ub ON u.id = ub.user_id
      WHERE u.id = ${userId}
      GROUP BY u.id
    `;

    if (!result || result.length === 0) {
      throw new Error('USER_NOT_FOUND');
    }

    const user = result[0];
    return {
      ...user,
      totalArticlesRead: parseInt(user.totalArticlesRead) || 0,
      achievementsCount: parseInt(user.achievementsCount) || 0,
      rank: parseInt(user.rank) || 1
    };
  } catch (error) {
    console.error(`Error fetching user profile for ${userId}:`, error);
    throw error;
  }
}

/**
 * Fetch leaderboard from database
 * @param {string} period - Leaderboard period (daily, weekly, monthly, all_time)
 * @param {number} limit - Number of users to fetch
 * @returns {Promise<Array>} - Leaderboard data
 */
async function fetchLeaderboard(period, limit = 50) {
  try {
    let startDate;
    const endDate = new Date();

    switch (period) {
      case 'daily':
        startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
        break;
      case 'weekly':
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'monthly':
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'all':
      case 'all_time':
        startDate = new Date(0);
        break;
      default:
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    }

    const result = await prisma.$queryRaw`
      WITH user_period_points AS (
        SELECT 
          ua.user_id,
          COALESCE(SUM(ua.points_earned), 0) as period_points
        FROM user_activities ua
        WHERE ua.completed_at >= ${startDate} 
          AND ua.completed_at <= ${endDate}
        GROUP BY ua.user_id
      )
      SELECT 
        u.id,
        u.username,
        u.display_name as "displayName",
        u.avatar_url as "avatarUrl",
        u.avatar_data as "avatarData",
        u.points,
        u.streak_count as "streakCount",
        u.role,
        COALESCE(upp.period_points, 0) as "periodPoints"
      FROM users u
      LEFT JOIN user_period_points upp ON u.id = upp.user_id
      ORDER BY u.points DESC
      LIMIT ${limit}
    `;

    return result.map((user, index) => ({
      rank: index + 1,
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      avatarData: user.avatarData,
      totalPoints: parseInt(user.points),
      periodPoints: parseInt(user.periodPoints),
      streakCount: parseInt(user.streakCount)
    }));
  } catch (error) {
    console.error(`Error fetching leaderboard for period ${period}:`, error);
    throw error;
  }
}

/**
 * Refresh user profile cache only
 * Used when user points change (daily claim, article read, mining, etc.)
 * 
 * Note: Leaderboard cache is now time-based (10 min TTL) and does not refresh
 * on points changes. It will automatically update every 10 minutes.
 * 
 * This function:
 * 1. Fetches fresh user profile from database
 * 2. Updates user profile cache (2 min TTL)
 * 
 * @param {string} userId - User ID
 * @returns {Promise<void>}
 */
async function refreshUserAndLeaderboardCaches(userId) {
  try {
    // Fetch fresh user profile from database
    const profileData = await fetchUserProfile(userId);
    
    // Write-through: Update cache directly with fresh data (no delete needed)
    // Pass data directly instead of a function to avoid unnecessary re-fetch
    await cacheService.refreshUserProfile(userId, profileData);
    
    // Leaderboard cache is now time-based (10 min TTL) - no refresh needed
    // It will automatically expire and refresh every 10 minutes
    
    console.log(`✅ Refreshed user profile cache for user ${userId}`);
  } catch (error) {
    console.error(`Error refreshing user profile cache for ${userId}:`, error);
    // Don't throw - cache refresh failures shouldn't break the app
    // The TTL will ensure cache expires and refreshes eventually
  }
}

module.exports = {
  refreshUserAndLeaderboardCaches,
  fetchUserProfile,
  fetchLeaderboard
};

