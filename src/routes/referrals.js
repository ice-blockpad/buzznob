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
        avatarData: true,
        role: true,
        createdAt: true,
        miningSessions: {
          where: { isActive: true },
          orderBy: { startedAt: 'desc' },
          take: 1,
          select: {
            startedAt: true,
            duration: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    // Add mining status based on active mining sessions (active if mining started within last 6 hours)
    const now = new Date();
    const sixHoursAgo = new Date(now - 6 * 60 * 60 * 1000);
    
    const recentReferralsWithStatus = recentReferrals.map(referral => {
      const latestMiningSession = referral.miningSessions[0];
      const isActive = latestMiningSession && latestMiningSession.startedAt >= sixHoursAgo;
      
      return {
        ...referral,
        isActive,
        miningSessions: undefined // Remove from response
      };
    });

    // Count active and inactive referrals
    const activeCount = recentReferralsWithStatus.filter(r => r.isActive).length;
    const inactiveCount = recentReferralsWithStatus.filter(r => !r.isActive).length;

    res.json({
      success: true,
      data: {
        referralCount,
        totalPointsEarned: referralRewards._sum.pointsEarned || 0,
        recentReferrals: recentReferralsWithStatus,
        activeCount,
        inactiveCount
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
        avatarData: true,
        points: true,
        role: true,
        createdAt: true,
        miningSessions: {
          where: { isActive: true },
          orderBy: { startedAt: 'desc' },
          take: 1,
          select: {
            startedAt: true,
            duration: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    });

    // Add mining status based on active mining sessions (active if mining started within last 6 hours)
    const now = new Date();
    const sixHoursAgo = new Date(now - 6 * 60 * 60 * 1000);
    
    const referralsWithStatus = referrals.map(referral => {
      const latestMiningSession = referral.miningSessions[0];
      const isActive = latestMiningSession && latestMiningSession.startedAt >= sixHoursAgo;
      
      return {
        ...referral,
        isActive,
        miningSessions: undefined // Remove from response
      };
    });

    const totalCount = await prisma.user.count({
      where: { referredBy: userId }
    });

    // Count active and inactive referrals
    const activeCount = referralsWithStatus.filter(r => r.isActive).length;
    const inactiveCount = referralsWithStatus.filter(r => !r.isActive).length;

    res.json({
      success: true,
      data: {
        referrals: referralsWithStatus,
        activeCount,
        inactiveCount,
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
