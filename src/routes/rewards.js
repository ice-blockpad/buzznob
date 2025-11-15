const express = require('express');
const { prisma } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');
const { deduplicateRequest } = require('../middleware/deduplication');
const cacheService = require('../services/cacheService');
const { refreshUserAndLeaderboardCaches } = require('../services/cacheRefreshHelpers');

const router = express.Router();

// Daily reward system (24-hour cooldown)
router.post('/daily/claim', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();

    // UTC helpers
    const toUtcYmd = (d) => ({ y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() });
    const startOfUtcDay = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
    const nextUtcMidnight = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0));
    const utcDayDiff = (a, b) => {
      const sa = startOfUtcDay(a).getTime();
      const sb = startOfUtcDay(b).getTime();
      return Math.round((sa - sb) / (24 * 60 * 60 * 1000)); // positive if a is after b
    };

    // Find last claim to evaluate same-day cooldown and streak continuity
    const lastClaim = await prisma.dailyReward.findFirst({
      where: { userId },
      orderBy: { claimedAt: 'desc' }
    });

    // Cooldown: one claim per UTC day – if already claimed today UTC, block until next UTC midnight
    if (lastClaim && utcDayDiff(now, lastClaim.claimedAt) === 0) {
      const nextAvail = nextUtcMidnight(now);
      const hoursRemaining = Math.ceil((nextAvail - now) / (1000 * 60 * 60));
      return res.status(400).json({
        success: false,
        error: 'DAILY_REWARD_COOLDOWN',
        message: `Daily reward is on cooldown. Try again in ${hoursRemaining} hours.`,
        data: { nextAvailableAt: nextAvail, hoursRemaining }
      });
    }

    // Load user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { streakCount: true, points: true }
    });
    if (!user) {
      return res.status(404).json({ success: false, error: 'USER_NOT_FOUND', message: 'User not found' });
    }

    // Determine streak based on UTC day continuity
    // Streak represents current day number (1 = first day, 2 = second day, etc.)
    let consecutiveDays = user.streakCount || 0;
    console.log(`[Daily Claim] User ${userId}: Current streakCount from DB: ${user.streakCount}`);
    console.log(`[Daily Claim] User ${userId}: Last claim exists: ${!!lastClaim}`);
    
    if (lastClaim) {
      const diffDays = utcDayDiff(now, lastClaim.claimedAt); // 1 means yesterday
      console.log(`[Daily Claim] User ${userId}: Days since last claim: ${diffDays}`);
      console.log(`[Daily Claim] User ${userId}: Last claim was at: ${lastClaim.claimedAt}`);
      console.log(`[Daily Claim] User ${userId}: Current time: ${now}`);
      
      if (diffDays === 1) {
        // Consecutive day - increment streak
        consecutiveDays = consecutiveDays + 1;
        console.log(`[Daily Claim] User ${userId}: Incrementing streak: ${consecutiveDays - 1} -> ${consecutiveDays}`);
      } else if (diffDays >= 2) {
        // Streak broken - reset to 1 (starting a new streak)
        consecutiveDays = 1;
        console.log(`[Daily Claim] User ${userId}: Streak broken (missed ${diffDays - 1} days), resetting to 1 (new streak)`);
      } else {
        // diffDays == 0 handled by cooldown above; negative shouldn't occur due to order
        consecutiveDays = consecutiveDays; 
        console.log(`[Daily Claim] User ${userId}: Same day or invalid diff (${diffDays}), keeping streak: ${consecutiveDays}`);
      }
    } else {
      // First ever claim - start at day 1
      consecutiveDays = 1;
      console.log(`[Daily Claim] User ${userId}: First ever claim, setting streak to 1`);
    }
    
    console.log(`[Daily Claim] User ${userId}: Final consecutiveDays: ${consecutiveDays}`);

    // Reward formula: 5 + 5 * (consecutiveDays - 1), max 50
    // Day 1 (consecutiveDays = 1): 5 + (0 * 5) = 5
    // Day 2 (consecutiveDays = 2): 5 + (1 * 5) = 10
    // Day 3 (consecutiveDays = 3): 5 + (2 * 5) = 15
    // ... up to Day 10 (consecutiveDays = 10): 5 + (9 * 5) = 50
    const computedBase = Math.min(5 + ((consecutiveDays - 1) * 5), 50);
    const rewardPoints = Math.max(5, computedBase);

    // Use transaction to atomically persist daily reward and update user points/streakCount
    // This prevents race conditions where multiple simultaneous requests could claim twice
    await prisma.$transaction(async (tx) => {
      // Double-check cooldown within transaction to prevent race conditions
      const lastClaimInTx = await tx.dailyReward.findFirst({
        where: { userId },
        orderBy: { claimedAt: 'desc' }
      });

      if (lastClaimInTx && utcDayDiff(now, lastClaimInTx.claimedAt) === 0) {
        const nextAvail = nextUtcMidnight(now);
        const hoursRemaining = Math.ceil((nextAvail - now) / (1000 * 60 * 60));
        throw new Error(`DAILY_REWARD_COOLDOWN:${nextAvail.toISOString()}:${hoursRemaining}`);
      }

      // Persist daily reward and update user points and streakCount atomically
      await tx.dailyReward.create({
        data: {
          userId,
          pointsEarned: rewardPoints,
          streakCount: consecutiveDays,
          streakBonus: 0
        }
      });

      await tx.user.update({
        where: { id: userId },
        data: {
          points: { increment: rewardPoints },
          streakCount: consecutiveDays
        }
      });
    });

    // Check for streak achievements
    const achievementsService = require('../services/achievements');
    setImmediate(() => {
      achievementsService.checkBadgeEligibility(userId).catch(err => {
        console.error('Failed to check streak achievements:', err);
      });
    });

    // Write-through cache: Refresh user profile cache after points change
    // Note: Leaderboard cache is time-based (10 min TTL) and will update automatically
    setImmediate(() => {
      refreshUserAndLeaderboardCaches(userId).catch(err => {
        console.error('Error refreshing caches after daily claim:', err);
      });
    });

    res.json({
      success: true,
      message: 'Daily reward claimed successfully',
      data: {
        pointsEarned: rewardPoints,
        baseReward: rewardPoints,
        streakBonus: 0,
        streakCount: consecutiveDays,
        totalPoints: user.points + rewardPoints
      }
    });

  } catch (error) {
    console.error('Daily reward claim error:', error);
    
    // Handle cooldown error from transaction
    if (error.message && error.message.startsWith('DAILY_REWARD_COOLDOWN:')) {
      const [, nextAvail, hoursRemaining] = error.message.split(':');
      return res.status(400).json({
        success: false,
        error: 'DAILY_REWARD_COOLDOWN',
        message: `Daily reward is on cooldown. Try again in ${hoursRemaining} hours.`,
        data: { nextAvailableAt: new Date(nextAvail), hoursRemaining: parseInt(hoursRemaining) }
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'DAILY_REWARD_ERROR',
      message: 'Failed to claim daily reward'
    });
  }
});

// Get daily reward status (UTC day boundary)
router.get('/daily/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const requestKey = `daily:status:${userId}`;
    
    const status = await deduplicateRequest(requestKey, async () => {
      const now = new Date();
      
      // UTC day helper functions
      const startOfUtcDay = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
      const nextUtcMidnight = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0));
      const utcDayDiff = (a, b) => {
        const sa = startOfUtcDay(a).getTime();
        const sb = startOfUtcDay(b).getTime();
        return Math.round((sa - sb) / (24 * 60 * 60 * 1000));
      };

      // Get user and their most recent claim (regardless of when it was)
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { streakCount: true }
      });

      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }

      const lastClaim = await prisma.dailyReward.findFirst({
        where: { userId },
        orderBy: { claimedAt: 'desc' }
      });

      const lastClaimedAt = lastClaim ? new Date(lastClaim.claimedAt) : null;
      const currentStreak = parseInt(user.streakCount) || 0;

      // Calculate next consecutive day based on UTC day continuity (same logic as claim endpoint)
      let nextConsecutive = currentStreak || 0;
      
      if (lastClaimedAt) {
        const diffDays = utcDayDiff(now, lastClaimedAt);
        console.log(`[Daily Status] User ${userId}: Current streak: ${currentStreak}, Days since last claim: ${diffDays}`);
        
        if (diffDays === 0) {
          // Already claimed today UTC - next claim will be tomorrow, continuing streak
          nextConsecutive = currentStreak + 1;
          console.log(`[Daily Status] User ${userId}: Already claimed today, next claim will be day ${nextConsecutive}`);
        } else if (diffDays === 1) {
          // Last claim was yesterday UTC - next claim continues streak
          nextConsecutive = currentStreak + 1;
          console.log(`[Daily Status] User ${userId}: Last claim was yesterday, next claim will be day ${nextConsecutive}`);
        } else if (diffDays >= 2) {
          // Streak broken - next claim will reset to day 1
          nextConsecutive = 1;
          console.log(`[Daily Status] User ${userId}: Streak broken (missed ${diffDays - 1} days), next claim will be day 1`);
        }
      } else {
        // No previous claim - next claim will be day 1
        nextConsecutive = 1;
        console.log(`[Daily Status] User ${userId}: No previous claim, next claim will be day 1`);
      }

      // Reward formula: 5 + 5 * (nextConsecutive - 1), max 50
      // Day 1 (nextConsecutive = 1): 5 + (0 * 5) = 5
      // Day 2 (nextConsecutive = 2): 5 + (1 * 5) = 10
      // Day 3 (nextConsecutive = 3): 5 + (2 * 5) = 15
      // Day 4 (nextConsecutive = 4): 5 + (3 * 5) = 20
      // ... up to Day 10 (nextConsecutive = 10): 5 + (9 * 5) = 50
      const computedBase = Math.min(5 + ((nextConsecutive - 1) * 5), 50);
      const baseReward = Math.max(5, computedBase);
      const totalReward = baseReward; // no separate streak bonus in new model
      
      // Check if on cooldown (already claimed today UTC)
      let isOnCooldown = false;
      let nextAvailableAt = null;
      let hoursRemaining = 0;

      if (lastClaimedAt) {
        const diffDays = utcDayDiff(now, lastClaimedAt);
        if (diffDays === 0) {
          // Already claimed today UTC
          isOnCooldown = true;
          nextAvailableAt = nextUtcMidnight(now);
          hoursRemaining = Math.ceil((nextAvailableAt - now) / (1000 * 60 * 60));
        }
      }

      console.log(`[Daily Status] User ${userId}: Next reward will be ${totalReward} $BUZZ (day ${nextConsecutive})`);

      return {
        isOnCooldown,
        nextAvailableAt,
        hoursRemaining,
        baseReward,
        streakBonus: 0,
        totalReward,
        currentStreak: currentStreak
      };
    });

    res.json({
      success: true,
      data: status
    });

  } catch (error) {
    if (error.message === 'USER_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    console.error('Get daily status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch daily status'
    });
  }
});

// Get available rewards
router.get('/available', authenticateToken, async (req, res) => {
  try {
    const rewards = await prisma.availableReward.findMany({
      where: { isActive: true },
      orderBy: { pointsRequired: 'asc' }
    });

    res.json({
      success: true,
      data: { rewards }
    });

  } catch (error) {
    console.error('Get available rewards error:', error);
    res.status(500).json({
      success: false,
      error: 'REWARDS_FETCH_ERROR',
      message: 'Failed to fetch available rewards'
    });
  }
});

// Redeem reward
router.post('/redeem', authenticateToken, async (req, res) => {
  try {
    const { rewardId } = req.body;
    const userId = req.user.id;

    // Validate required fields
    if (!rewardId) {
      return res.status(400).json({
        success: false,
        error: 'REWARD_ID_REQUIRED',
        message: 'Reward ID is required'
      });
    }

    // Get available reward details
    const availableReward = await prisma.availableReward.findUnique({
      where: { id: rewardId }
    });

    if (!availableReward) {
      return res.status(404).json({
        success: false,
        error: 'REWARD_NOT_FOUND',
        message: 'Reward not found'
      });
    }

    if (!availableReward.isActive) {
      return res.status(400).json({
        success: false,
        error: 'REWARD_INACTIVE',
        message: 'Reward is no longer available'
      });
    }

    // Check stock if applicable
    if (availableReward.stock !== null && availableReward.stock <= 0) {
      return res.status(400).json({
        success: false,
        error: 'REWARD_OUT_OF_STOCK',
        message: 'Reward is out of stock'
      });
    }

    // Use transaction to atomically create reward, deduct points, and update stock
    // This prevents race conditions where user could overspend points or oversell stock
    const reward = await prisma.$transaction(async (tx) => {
      // Re-fetch user and reward within transaction to get latest values
      const userInTx = await tx.user.findUnique({
        where: { id: userId },
        select: { points: true }
      });

      const availableRewardInTx = await tx.availableReward.findUnique({
        where: { id: rewardId }
      });

      if (!userInTx) {
        throw new Error('USER_NOT_FOUND');
      }

      if (!availableRewardInTx || !availableRewardInTx.isActive) {
        throw new Error('REWARD_NOT_AVAILABLE');
      }

      // Check stock within transaction
      if (availableRewardInTx.stock !== null && availableRewardInTx.stock <= 0) {
        throw new Error('REWARD_OUT_OF_STOCK');
      }

      // Check points within transaction
      if (userInTx.points < availableRewardInTx.pointsRequired) {
        throw new Error('INSUFFICIENT_POINTS');
      }

      // Create reward record
      const newReward = await tx.reward.create({
        data: {
          userId,
          rewardType: availableRewardInTx.type,
          rewardValue: availableRewardInTx.value,
          status: 'pending',
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
        }
      });

      // Deduct points from user
      await tx.user.update({
        where: { id: userId },
        data: {
          points: {
            decrement: availableRewardInTx.pointsRequired
          }
        }
      });

      // Update stock if applicable
      if (availableRewardInTx.stock !== null) {
        await tx.availableReward.update({
          where: { id: rewardId },
          data: {
            stock: {
              decrement: 1
            }
          }
        });
      }

      return newReward;
    });

    // Write-through cache: Refresh user profile cache after points change
    // Note: Leaderboard cache is time-based (10 min TTL) and will update automatically
    setImmediate(() => {
      refreshUserAndLeaderboardCaches(userId).catch(err => {
        console.error('Error refreshing caches after reward redeem:', err);
      });
    });

    res.json({
      success: true,
      message: 'Reward redeemed successfully',
      data: {
        reward: {
          id: reward.id,
          type: reward.rewardType,
          value: reward.rewardValue,
          status: reward.status,
          expiresAt: reward.expiresAt
        },
        remainingPoints: req.user.points - availableReward.pointsRequired
      }
    });

  } catch (error) {
    console.error('Redeem reward error:', error);
    res.status(500).json({
      success: false,
      error: 'REWARD_REDEEM_ERROR',
      message: 'Failed to redeem reward'
    });
  }
});

// Get user's rewards
router.get('/my-rewards', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const rewards = await prisma.reward.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    });

    const totalCount = await prisma.reward.count({
      where: { userId }
    });

    res.json({
      success: true,
      data: {
        rewards,
        pagination: {
          page,
          limit,
          total: totalCount,
          pages: Math.ceil(totalCount / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get user rewards error:', error);
    res.status(500).json({
      success: false,
      error: 'USER_REWARDS_FETCH_ERROR',
      message: 'Failed to fetch user rewards'
    });
  }
});

// Get leaderboard (with time-based cache - 10 minutes TTL)
router.get('/leaderboard', async (req, res) => {
  try {
    const period = req.query.period || 'weekly';
    const limit = parseInt(req.query.limit) || 50;
    const cacheKey = `leaderboard:${period}:${limit}`;

    // Calculate dates outside the callback so they're accessible to the SQL query
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
      case 'all_time':
        startDate = new Date(0);
        break;
      default:
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    }

    // Time-based cache: Get from cache, or fetch from DB and cache
    // Cache expires every 10 minutes (no write-through refresh)
    const leaderboard = await cacheService.getOrSet(cacheKey, async () => {
      // Single optimized query to get leaderboard with period points
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
    }, 600); // 10 minutes TTL (time-based cache, no write-through refresh)

    res.json({
      success: true,
      data: {
        leaderboard,
        period
      }
    });

  } catch (error) {
    console.error('Get leaderboard error:', error);
    res.status(500).json({
      success: false,
      error: 'LEADERBOARD_FETCH_ERROR',
      message: 'Failed to fetch leaderboard'
    });
  }
});

// Get user rank
router.get('/user-rank', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Count how many users have more points than the current user
    const usersWithMorePoints = await prisma.user.count({
      where: {
        points: {
          gt: req.user.points
        }
      }
    });
    
    const userRank = usersWithMorePoints + 1;
    
    res.json({
      success: true,
      data: {
        rank: userRank,
        points: req.user.points
      }
    });
    
  } catch (error) {
    console.error('Get user rank error:', error);
    res.status(500).json({
      success: false,
      error: 'USER_RANK_FETCH_ERROR',
      message: 'Failed to fetch user rank'
    });
  }
});

// Get badges (with write-through cache)
router.get('/badges', authenticateToken, async (req, res) => {
  try {
    const cacheKey = 'badges:all';

    // Write-through cache: Get from cache, or fetch from DB and cache
    const badges = await cacheService.getOrSet(cacheKey, async () => {
      return await prisma.badge.findMany({
        orderBy: { pointsRequired: 'asc' }
      });
    }, 3600); // 1 hour TTL (write-through cache with safety net)

    res.json({
      success: true,
      data: { badges }
    });

  } catch (error) {
    console.error('Get badges error:', error);
    res.status(500).json({
      success: false,
      error: 'BADGES_FETCH_ERROR',
      message: 'Failed to fetch badges'
    });
  }
});

// Claim reward (admin function - for testing)
router.post('/:rewardId/claim', authenticateToken, async (req, res) => {
  try {
    const { rewardId } = req.params;
    const userId = req.user.id;

    const reward = await prisma.reward.findFirst({
      where: {
        id: rewardId,
        userId
      }
    });

    if (!reward) {
      return res.status(404).json({
        success: false,
        error: 'REWARD_NOT_FOUND',
        message: 'Reward not found'
      });
    }

    if (reward.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'REWARD_ALREADY_CLAIMED',
        message: 'Reward has already been claimed'
      });
    }

    if (reward.expiresAt && reward.expiresAt < new Date()) {
      return res.status(400).json({
        success: false,
        error: 'REWARD_EXPIRED',
        message: 'Reward has expired'
      });
    }

    // Update reward status
    const updatedReward = await prisma.reward.update({
      where: { id: rewardId },
      data: {
        status: 'claimed',
        claimedAt: new Date()
      }
    });

    res.json({
      success: true,
      message: 'Reward claimed successfully',
      data: { reward: updatedReward }
    });

  } catch (error) {
    console.error('Claim reward error:', error);
    res.status(500).json({
      success: false,
      error: 'REWARD_CLAIM_ERROR',
      message: 'Failed to claim reward'
    });
  }
});

module.exports = router;
