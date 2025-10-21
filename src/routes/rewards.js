const express = require('express');
const { prisma } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');

const router = express.Router();

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

    // Get users with their points for the period
    const leaderboard = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        points: true,
        streakCount: true,
        role: true,
        activities: {
          where: {
            completedAt: {
              gte: startDate,
              lte: endDate
            }
          },
          select: {
            pointsEarned: true
          }
        }
      },
      orderBy: { points: 'desc' },
      take: limit
    });

    // Calculate period points
    const leaderboardWithPeriodPoints = leaderboard.map(user => ({
      ...user,
      periodPoints: user.activities.reduce((sum, activity) => sum + activity.pointsEarned, 0)
    }));

    // Sort by period points
    leaderboardWithPeriodPoints.sort((a, b) => b.periodPoints - a.periodPoints);

    res.json({
      success: true,
      data: {
        leaderboard: leaderboardWithPeriodPoints.map((user, index) => ({
          rank: index + 1,
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          totalPoints: user.points,
          periodPoints: user.periodPoints,
          streakCount: user.streakCount
        })),
        period,
        startDate,
        endDate
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
