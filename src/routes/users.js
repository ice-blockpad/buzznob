const express = require('express');
const { prisma } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');

const router = express.Router();

// Get current user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        username: true,
        email: true,
        googleId: true,
        walletAddress: true,
        displayName: true,
        role: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        points: true,
        streakCount: true,
        lastLogin: true,
        referralCode: true,
        role: true,
        isActive: true,
        isVerified: true,
        kycStatus: true,
        bio: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: { user }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      error: 'PROFILE_FETCH_ERROR',
      message: 'Failed to fetch user profile'
    });
  }
});

// Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { username, displayName, firstName, lastName, bio, referralCode } = req.body;

    // Check if username is already taken
    if (username) {
      const existingUser = await prisma.user.findFirst({
        where: {
          username,
          id: { not: req.user.id }
        }
      });

      if (existingUser) {
        return res.status(400).json({
          success: false,
          error: 'USERNAME_TAKEN',
          message: 'Username is already taken'
        });
      }
    }

    // Handle referral code if provided
    let referredBy = null;
    if (referralCode) {
      const referrer = await prisma.user.findUnique({
        where: { referralCode }
      });
      
      if (referrer && referrer.id !== req.user.id) {
        referredBy = referrer.id;
        
        // Give referral bonus points to referrer
        await prisma.user.update({
          where: { id: referrer.id },
          data: { points: { increment: 100 } } // 100 points for successful referral
        });
        
        // Create referral reward record
        await prisma.referralReward.create({
          data: {
            referrerId: referrer.id,
            refereeId: req.user.id,
            pointsEarned: 100,
            status: 'claimed'
          }
        });
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(username && { username }),
        ...(displayName && { displayName }),
        ...(firstName && { firstName }),
        ...(lastName && { lastName }),
        ...(bio && { bio }),
        ...(referredBy && { referredBy })
      },
      select: {
        id: true,
        username: true,
        email: true,
        googleId: true,
        walletAddress: true,
        displayName: true,
        firstName: true,
        lastName: true,
        bio: true,
        avatarUrl: true,
        points: true,
        streakCount: true,
        lastLogin: true,
        createdAt: true,
        updatedAt: true
      }
    });

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user: updatedUser }
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      error: 'PROFILE_UPDATE_ERROR',
      message: 'Failed to update user profile'
    });
  }
});

// Get user stats
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user activities count
    const activitiesCount = await prisma.userActivity.count({
      where: { userId }
    });

    // Get total points earned
    const totalPoints = await prisma.userActivity.aggregate({
      where: { userId },
      _sum: { pointsEarned: true }
    });

    // Get badges count
    const badgesCount = await prisma.userBadge.count({
      where: { userId }
    });

    // Get current streak
    const currentStreak = req.user.streakCount;

    // Get articles read this week
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const articlesThisWeek = await prisma.userActivity.count({
      where: {
        userId,
        completedAt: {
          gte: oneWeekAgo
        }
      }
    });

    res.json({
      success: true,
      data: {
        totalArticlesRead: activitiesCount,
        totalPointsEarned: totalPoints._sum.pointsEarned || 0,
        badgesEarned: badgesCount,
        currentStreak,
        articlesThisWeek
      }
    });

  } catch (error) {
    console.error('Get user stats error:', error);
    res.status(500).json({
      success: false,
      error: 'STATS_FETCH_ERROR',
      message: 'Failed to fetch user statistics'
    });
  }
});

// Get user activity history
router.get('/activity', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const activities = await prisma.userActivity.findMany({
      where: { userId },
      include: {
        article: {
          select: {
            id: true,
            title: true,
            category: true,
            pointsValue: true,
            readTimeEstimate: true
          }
        }
      },
      orderBy: { completedAt: 'desc' },
      skip,
      take: limit
    });

    const totalCount = await prisma.userActivity.count({
      where: { userId }
    });

    res.json({
      success: true,
      data: {
        activities,
        pagination: {
          page,
          limit,
          total: totalCount,
          pages: Math.ceil(totalCount / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get user activity error:', error);
    res.status(500).json({
      success: false,
      error: 'ACTIVITY_FETCH_ERROR',
      message: 'Failed to fetch user activity'
    });
  }
});

// Get user badges
router.get('/badges', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const userBadges = await prisma.userBadge.findMany({
      where: { userId },
      include: {
        badge: true
      },
      orderBy: { earnedAt: 'desc' }
    });

    res.json({
      success: true,
      data: { badges: userBadges }
    });

  } catch (error) {
    console.error('Get user badges error:', error);
    res.status(500).json({
      success: false,
      error: 'BADGES_FETCH_ERROR',
      message: 'Failed to fetch user badges'
    });
  }
});

// Upgrade to creator (verify Google Play purchase)
router.post('/upgrade-to-creator', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { purchaseToken, productId, transactionReceipt } = req.body;

    // Check if user is already a creator or admin
    if (req.user.role === 'creator' || req.user.role === 'admin') {
      return res.status(400).json({
        success: false,
        error: 'ALREADY_CREATOR',
        message: 'User already has creator access'
      });
    }

    // TODO: Verify purchase with Google Play API
    // For now, we'll trust the purchase token (in production, MUST verify with Google)
    // const isValidPurchase = await verifyGooglePlayPurchase(purchaseToken, productId);
    
    // Log the purchase for record keeping
    console.log(`✅ Creator upgrade purchase: User ${userId}, Product ${productId}`);

    // Upgrade user to creator role
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        role: 'creator',
        isVerified: true,
        // Award 5,000 BUZZ tokens as welcome bonus
        points: {
          increment: 5000
        }
      },
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        role: true,
        points: true,
        isVerified: true
      }
    });

    res.json({
      success: true,
      message: 'Congratulations! You are now a Creator!',
      data: { user: updatedUser }
    });

  } catch (error) {
    console.error('Upgrade to creator error:', error);
    res.status(500).json({
      success: false,
      error: 'CREATOR_UPGRADE_ERROR',
      message: 'Failed to upgrade to creator'
    });
  }
});

// Delete user account
router.delete('/account', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Delete user and all related data (cascade delete)
    await prisma.user.delete({
      where: { id: userId }
    });

    res.json({
      success: true,
      message: 'Account deleted successfully'
    });

  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({
      success: false,
      error: 'ACCOUNT_DELETE_ERROR',
      message: 'Failed to delete account'
    });
  }
});

module.exports = router;
