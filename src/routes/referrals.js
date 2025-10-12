const express = require('express');
const { prisma } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');

const router = express.Router();

// Generate referral code for user
router.post('/generate-code', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Check if user already has a referral code
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true }
    });

    if (existingUser.referralCode) {
      return res.json({
        success: true,
        data: {
          referralCode: existingUser.referralCode,
          message: 'Referral code already exists'
        }
      });
    }

    // Generate unique referral code
    const generateReferralCode = () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let result = '';
      for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    };

    let referralCode;
    let isUnique = false;

    // Ensure referral code is unique
    while (!isUnique) {
      referralCode = generateReferralCode();
      const existingCode = await prisma.user.findUnique({
        where: { referralCode }
      });
      if (!existingCode) {
        isUnique = true;
      }
    }

    // Update user with referral code
    await prisma.user.update({
      where: { id: userId },
      data: { referralCode }
    });

    res.json({
      success: true,
      message: 'Referral code generated successfully',
      data: { referralCode }
    });

  } catch (error) {
    console.error('Generate referral code error:', error);
    res.status(500).json({
      success: false,
      error: 'REFERRAL_CODE_GENERATION_ERROR',
      message: 'Failed to generate referral code'
    });
  }
});

// Get user's referral code
router.get('/my-code', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true }
    });

    if (!user.referralCode) {
      return res.status(404).json({
        success: false,
        error: 'REFERRAL_CODE_NOT_FOUND',
        message: 'Referral code not found. Generate one first.'
      });
    }

    res.json({
      success: true,
      data: { referralCode: user.referralCode }
    });

  } catch (error) {
    console.error('Get referral code error:', error);
    res.status(500).json({
      success: false,
      error: 'REFERRAL_CODE_FETCH_ERROR',
      message: 'Failed to get referral code'
    });
  }
});

// Use referral code (when signing up)
router.post('/use-code', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { referralCode } = req.body;

    if (!referralCode) {
      return res.status(400).json({
        success: false,
        error: 'REFERRAL_CODE_REQUIRED',
        message: 'Referral code is required'
      });
    }

    // Check if user already used a referral code
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { referredBy: true }
    });

    if (user.referredBy) {
      return res.status(400).json({
        success: false,
        error: 'REFERRAL_CODE_ALREADY_USED',
        message: 'You have already used a referral code'
      });
    }

    // Find referrer by referral code
    const referrer = await prisma.user.findUnique({
      where: { referralCode }
    });

    if (!referrer) {
      return res.status(404).json({
        success: false,
        error: 'INVALID_REFERRAL_CODE',
        message: 'Invalid referral code'
      });
    }

    if (referrer.id === userId) {
      return res.status(400).json({
        success: false,
        error: 'CANNOT_REFER_SELF',
        message: 'You cannot use your own referral code'
      });
    }

    // Update user with referrer
    await prisma.user.update({
      where: { id: userId },
      data: { referredBy: referrer.id }
    });

    // Create referral reward record
    const referralReward = await prisma.referralReward.create({
      data: {
        referrerId: referrer.id,
        refereeId: userId,
        pointsEarned: 100, // Reward for referrer
        status: 'pending'
      }
    });

    // Award points to referrer
    await prisma.user.update({
      where: { id: referrer.id },
      data: {
        points: {
          increment: 100
        }
      }
    });

    // Award points to referee
    await prisma.user.update({
      where: { id: userId },
      data: {
        points: {
          increment: 50 // Welcome bonus for referee
        }
      }
    });

    res.json({
      success: true,
      message: 'Referral code applied successfully',
      data: {
        referrerName: referrer.displayName || referrer.username,
        pointsEarned: 50
      }
    });

  } catch (error) {
    console.error('Use referral code error:', error);
    res.status(500).json({
      success: false,
      error: 'REFERRAL_CODE_USE_ERROR',
      message: 'Failed to use referral code'
    });
  }
});

// Get referral stats
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get referral count
    const referralCount = await prisma.user.count({
      where: { referredBy: userId }
    });

    // Get total points earned from referrals
    const referralRewards = await prisma.referralReward.aggregate({
      where: { referrerId: userId },
      _sum: { pointsEarned: true }
    });

    // Get recent referrals
    const recentReferrals = await prisma.user.findMany({
      where: { referredBy: userId },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    res.json({
      success: true,
      data: {
        referralCount,
        totalPointsEarned: referralRewards._sum.pointsEarned || 0,
        recentReferrals
      }
    });

  } catch (error) {
    console.error('Get referral stats error:', error);
    res.status(500).json({
      success: false,
      error: 'REFERRAL_STATS_ERROR',
      message: 'Failed to get referral stats'
    });
  }
});

// Get referral history
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const referrals = await prisma.user.findMany({
      where: { referredBy: userId },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        points: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    });

    const totalCount = await prisma.user.count({
      where: { referredBy: userId }
    });

    res.json({
      success: true,
      data: {
        referrals,
        pagination: {
          page,
          limit,
          total: totalCount,
          pages: Math.ceil(totalCount / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get referral history error:', error);
    res.status(500).json({
      success: false,
      error: 'REFERRAL_HISTORY_ERROR',
      message: 'Failed to get referral history'
    });
  }
});

// Use error handler middleware
router.use(errorHandler);

module.exports = router;
