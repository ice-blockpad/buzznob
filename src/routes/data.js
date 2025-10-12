const express = require('express');
const { prisma } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');

const router = express.Router();

// Export user data
router.get('/export', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get all user data
    const userData = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        activities: {
          include: {
            article: {
              select: {
                id: true,
                title: true,
                category: true,
                pointsValue: true
              }
            }
          },
          orderBy: { completedAt: 'desc' }
        },
        rewards: {
          orderBy: { createdAt: 'desc' }
        },
        userBadges: {
          include: {
            badge: true
          },
          orderBy: { earnedAt: 'desc' }
        },
        miningClaims: {
          orderBy: { createdAt: 'desc' }
        },
        kycSubmissions: {
          orderBy: { createdAt: 'desc' }
        },
        walletData: {
          select: {
            id: true,
            publicKey: true,
            isActive: true,
            createdAt: true
          }
        }
      }
    });

    if (!userData) {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }

    // Format data for export
    const exportData = {
      user: {
        id: userData.id,
        username: userData.username,
        email: userData.email,
        displayName: userData.displayName,
        points: userData.points,
        streakCount: userData.streakCount,
        role: userData.role,
        isVerified: userData.isVerified,
        kycStatus: userData.kycStatus,
        createdAt: userData.createdAt,
        lastLogin: userData.lastLogin
      },
      activities: userData.activities.map(activity => ({
        id: activity.id,
        article: activity.article,
        pointsEarned: activity.pointsEarned,
        readDuration: activity.readDuration,
        completedAt: activity.completedAt
      })),
      rewards: userData.rewards.map(reward => ({
        id: reward.id,
        type: reward.rewardType,
        value: reward.rewardValue,
        status: reward.status,
        claimedAt: reward.claimedAt,
        expiresAt: reward.expiresAt,
        createdAt: reward.createdAt
      })),
      badges: userData.userBadges.map(userBadge => ({
        id: userBadge.badge.id,
        name: userBadge.badge.name,
        description: userBadge.badge.description,
        category: userBadge.badge.category,
        earnedAt: userBadge.earnedAt
      })),
      miningClaims: userData.miningClaims.map(claim => ({
        id: claim.id,
        amount: claim.amount,
        miningRate: claim.miningRate,
        referralBonus: claim.referralBonus,
        claimedAt: claim.claimedAt
      })),
      kycSubmissions: userData.kycSubmissions.map(kyc => ({
        id: kyc.id,
        status: kyc.status,
        submittedAt: kyc.createdAt,
        reviewedAt: kyc.reviewedAt
      })),
      walletData: userData.walletData.map(wallet => ({
        id: wallet.id,
        publicKey: wallet.publicKey,
        isActive: wallet.isActive,
        createdAt: wallet.createdAt
      })),
      exportDate: new Date().toISOString(),
      totalActivities: userData.activities.length,
      totalPointsEarned: userData.activities.reduce((sum, activity) => sum + activity.pointsEarned, 0),
      totalBadges: userData.userBadges.length,
      totalRewards: userData.rewards.length,
      totalMiningClaims: userData.miningClaims.length
    };

    // Set response headers for download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="buzznob-data-${userData.username}-${Date.now()}.json"`);

    res.json({
      success: true,
      message: 'Data exported successfully',
      data: exportData
    });

  } catch (error) {
    console.error('Export user data error:', error);
    res.status(500).json({
      success: false,
      error: 'DATA_EXPORT_ERROR',
      message: 'Failed to export user data'
    });
  }
});

// Get user analytics
router.get('/analytics', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get reading statistics by category
    const categoryStats = await prisma.userActivity.groupBy({
      by: ['article'],
      where: { userId },
      _count: { id: true },
      _sum: { pointsEarned: true }
    });

    // Get articles for category names
    const articleIds = categoryStats.map(stat => stat.article);
    const articles = await prisma.article.findMany({
      where: { id: { in: articleIds } },
      select: { id: true, category: true }
    });

    const categoryData = categoryStats.reduce((acc, stat) => {
      const article = articles.find(a => a.id === stat.article);
      const category = article?.category || 'Unknown';
      
      if (!acc[category]) {
        acc[category] = { count: 0, points: 0 };
      }
      acc[category].count += stat._count.id;
      acc[category].points += stat._sum.pointsEarned || 0;
      return acc;
    }, {});

    // Get reading trends (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dailyStats = await prisma.userActivity.groupBy({
      by: ['completedAt'],
      where: {
        userId,
        completedAt: {
          gte: thirtyDaysAgo
        }
      },
      _count: { id: true },
      _sum: { pointsEarned: true }
    });

    // Get streak information
    const activities = await prisma.userActivity.findMany({
      where: { userId },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true }
    });

    // Calculate current streak
    let currentStreak = 0;
    if (activities.length > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      for (let i = 0; i < activities.length; i++) {
        const activityDate = new Date(activities[i].completedAt);
        activityDate.setHours(0, 0, 0, 0);
        
        const daysDiff = Math.floor((today - activityDate) / (1000 * 60 * 60 * 24));
        
        if (daysDiff === i) {
          currentStreak++;
        } else {
          break;
        }
      }
    }

    // Get monthly reading stats
    const monthlyStats = await prisma.userActivity.groupBy({
      by: ['completedAt'],
      where: { userId },
      _count: { id: true },
      _sum: { pointsEarned: true }
    });

    const monthlyData = monthlyStats.reduce((acc, stat) => {
      const date = new Date(stat.completedAt);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!acc[monthKey]) {
        acc[monthKey] = { count: 0, points: 0 };
      }
      acc[monthKey].count += stat._count.id;
      acc[monthKey].points += stat._sum.pointsEarned || 0;
      return acc;
    }, {});

    res.json({
      success: true,
      data: {
        categoryStats: Object.entries(categoryData).map(([category, data]) => ({
          category,
          articlesRead: data.count,
          pointsEarned: data.points
        })),
        currentStreak,
        totalArticlesRead: activities.length,
        monthlyStats: Object.entries(monthlyData).map(([month, data]) => ({
          month,
          articlesRead: data.count,
          pointsEarned: data.points
        })),
        dailyStats: dailyStats.map(stat => ({
          date: stat.completedAt.toISOString().split('T')[0],
          articlesRead: stat._count.id,
          pointsEarned: stat._sum.pointsEarned || 0
        }))
      }
    });

  } catch (error) {
    console.error('Get user analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'ANALYTICS_ERROR',
      message: 'Failed to get user analytics'
    });
  }
});

// Use error handler middleware
router.use(errorHandler);

module.exports = router;
