const express = require('express');
const { prisma } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');
const { deduplicateRequest } = require('../middleware/deduplication');

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

    // Persist daily reward and update user points and streakCount
    // streakCount now represents current day number (1, 2, 3, etc.)
    await prisma.dailyReward.create({
      data: {
        userId,
        pointsEarned: rewardPoints,
        streakCount: consecutiveDays, // Already >= 1, no need for Math.max(0, ...)
        streakBonus: 0
      }
    });

    await prisma.user.update({
      where: { id: userId },
      data: {
        points: { increment: rewardPoints },
        streakCount: consecutiveDays // Already >= 1, no need for Math.max(0, ...)
      }
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
    res.status(500).json({
      success: false,
      error: 'DAILY_REWARD_ERROR',
      message: 'Failed to claim daily reward'
    });
  }
});

// Get daily reward status (24-hour cooldown)
router.get('/daily/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const requestKey = `daily:status:${userId}`;
    
    const status = await deduplicateRequest(requestKey, async () => {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));

      // Single query to get both recent claim and user streak
      const result = await prisma.$queryRaw`
        SELECT 
          u.streak_count as "streakCount",
          dr.claimed_at as "lastClaimedAt",
          dr.points_earned as "lastPointsEarned",
          dr.streak_count as "lastStreakCount",
          dr.streak_bonus as "lastStreakBonus"
        FROM users u
        LEFT JOIN daily_rewards dr ON u.id = dr.user_id 
          AND dr.claimed_at >= ${twentyFourHoursAgo}
        WHERE u.id = ${userId}
        ORDER BY dr.claimed_at DESC
        LIMIT 1
      `;

      if (!result || result.length === 0) {
        throw new Error('USER_NOT_FOUND');
      }

      const data = result[0];
      // Compute next reward based on UTC day continuity
      const startOfUtcDay = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
      const nextUtcMidnight = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0));
      const utcDayDiff = (a, b) => {
        const sa = startOfUtcDay(a).getTime();
        const sb = startOfUtcDay(b).getTime();
        return Math.round((sa - sb) / (24 * 60 * 60 * 1000));
      };

      const lastClaimedAt = data.lastClaimedAt ? new Date(data.lastClaimedAt) : null;
      let nextConsecutive = parseInt(data.streakCount) || 0;
      if (lastClaimedAt) {
        const diffDays = utcDayDiff(now, lastClaimedAt);
        if (diffDays === 0) {
          // already claimed today; preview for tomorrow as continued streak
          nextConsecutive = nextConsecutive + 1;
        } else if (diffDays === 1) {
          // Will claim tomorrow - increment streak
          nextConsecutive = nextConsecutive + 1;
        } else if (diffDays >= 2) {
          // Streak broken - will reset to 1 on next claim
          nextConsecutive = 1;
        }
      } else {
        // No previous claim - next claim will be day 1
        nextConsecutive = 1;
      }
      // Reward formula: 5 + 5 * (nextConsecutive - 1), max 50
      // Day 1 (nextConsecutive = 1): 5 + (0 * 5) = 5
      // Day 2 (nextConsecutive = 2): 5 + (1 * 5) = 10
      // ... up to Day 10 (nextConsecutive = 10): 5 + (9 * 5) = 50
      const computedBase = Math.min(5 + ((nextConsecutive - 1) * 5), 50);
      const baseReward = Math.max(5, computedBase);
      const totalReward = baseReward; // no separate streak bonus in new model
      
    let isOnCooldown = false;
    let nextAvailableAt = null;
    let hoursRemaining = 0;

      if (data.lastClaimedAt) {
        const last = new Date(data.lastClaimedAt);
        if (utcDayDiff(now, last) === 0) {
          isOnCooldown = true;
          nextAvailableAt = nextUtcMidnight(now);
          hoursRemaining = Math.ceil((nextAvailableAt - now) / (1000 * 60 * 60));
        }
      }

      return {
        isOnCooldown,
        nextAvailableAt,
        hoursRemaining,
        baseReward,
        streakBonus: 0,
        totalReward,
        currentStreak: parseInt(data.streakCount) || 0
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

    // Check if user has enough points
    if (req.user.points < availableReward.pointsRequired) {
      return res.status(400).json({
        success: false,
        error: 'INSUFFICIENT_POINTS',
        message: 'Not enough points to redeem this reward'
      });
    }

    // Create reward record
    const reward = await prisma.reward.create({
      data: {
        userId,
        rewardType: availableReward.type,
        rewardValue: availableReward.value,
        status: 'pending',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
      }
    });

    // Deduct points from user
    await prisma.user.update({
      where: { id: userId },
      data: {
        points: {
          decrement: availableReward.pointsRequired
        }
      }
    });

    // Update stock if applicable
    if (availableReward.stock !== null) {
      await prisma.availableReward.update({
        where: { id: rewardId },
        data: {
          stock: {
            decrement: 1
          }
        }
      });
    }

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

// Get leaderboard
router.get('/leaderboard', async (req, res) => {
  try {
    const period = req.query.period || 'weekly';
    const limit = parseInt(req.query.limit) || 50;
    const requestKey = `leaderboard:${period}:${limit}`;

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

    const leaderboard = await deduplicateRequest(requestKey, async () => {

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
    });

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

// Get badges
router.get('/badges', authenticateToken, async (req, res) => {
  try {
    const badges = await prisma.badge.findMany({
      orderBy: { pointsRequired: 'asc' }
    });

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
