const express = require('express');
const { prisma } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');
const { deduplicateRequest, clearCachePattern } = require('../middleware/deduplication');
const upload = require('../middleware/upload');
const cacheService = require('../services/cacheService');
const { fetchTrendingArticles, fetchFeaturedArticles } = require('../services/articleCacheHelpers');

const router = express.Router();

// Middleware to check admin role
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'ACCESS_DENIED',
      message: 'Admin access required'
    });
  }
  next();
};

// Get all users (admin)
router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search;
    const role = req.query.role;
    const skip = (page - 1) * limit;

    // Build cache key from query params
    const cacheKey = `admin:users:${page}:${limit}:${search || ''}:${role || ''}`;

    // Write-through cache: Get from cache, or fetch from DB and cache
    const result = await cacheService.getOrSet(cacheKey, async () => {
      const where = {};
      if (search) {
        where.OR = [
          { username: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { displayName: { contains: search, mode: 'insensitive' } }
        ];
      }
      if (role) where.role = role;

      const users = await prisma.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          email: true,
          displayName: true,
          avatarUrl: true,
          points: true,
          streakCount: true,
          role: true,
          isActive: true,
          isVerified: true,
          kycStatus: true,
          createdAt: true,
          lastLogin: true
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      });

      const totalCount = await prisma.user.count({ where });

      return {
        users,
        pagination: {
          page,
          limit,
          total: totalCount,
          pages: Math.ceil(totalCount / limit)
        }
      };
    }, 300); // 5 minutes TTL

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Get admin users error:', error);
    res.status(500).json({
      success: false,
      error: 'ADMIN_USERS_FETCH_ERROR',
      message: 'Failed to fetch users'
    });
  }
});

// Get user details (admin)
router.get('/users/:userId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    const cacheKey = `admin:user:${userId}`;

    // Write-through cache: Get from cache, or fetch from DB and cache
    const result = await cacheService.getOrSet(cacheKey, async () => {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          activities: {
            include: {
              article: {
                select: {
                  id: true,
                  title: true,
                  category: true
                }
              }
            },
            orderBy: { completedAt: 'desc' },
            take: 10
          },
          rewards: {
            orderBy: { createdAt: 'desc' },
            take: 10
          },
          userBadges: {
            include: {
              badge: true
            },
            orderBy: { earnedAt: 'desc' }
          },
          miningClaims: {
            orderBy: { createdAt: 'desc' },
            take: 10
          },
          kycSubmissions: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        }
      });

      if (!user) {
        return null; // Return null to indicate not found
      }

      // Get referral stats
      const referralCount = await prisma.user.count({
        where: { referredBy: userId }
      });

      return {
        user: {
          ...user,
          referralCount
        }
      };
    }, 300); // 5 minutes TTL

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Get admin user details error:', error);
    res.status(500).json({
      success: false,
      error: 'ADMIN_USER_DETAILS_ERROR',
      message: 'Failed to fetch user details'
    });
  }
});

// Update user (admin)
router.put('/users/:userId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      role,
      isActive,
      points,
      streakCount,
      kycStatus,
      isVerified,
      isCreator
    } = req.body;

    const updateData = {};
    if (role !== undefined) updateData.role = role;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (points !== undefined) updateData.points = points;
    if (streakCount !== undefined) updateData.streakCount = streakCount;
    if (kycStatus !== undefined) updateData.kycStatus = kycStatus;
    if (isVerified !== undefined) updateData.isVerified = isVerified;
    
    // Handle creator role assignment
    if (isCreator !== undefined) {
      updateData.role = isCreator ? 'creator' : 'user';
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        role: true,
        isActive: true,
        points: true,
        streakCount: true,
        kycStatus: true,
        isVerified: true,
        updatedAt: true
      }
    });

    // Write-through cache: Refresh user caches SYNCHRONOUSLY
    // This ensures cache is updated before response is sent, preventing stale data window
    try {
      const { refreshUserAndLeaderboardCaches } = require('../services/cacheRefreshHelpers');
      
      // If points changed, refresh user profile and leaderboard
      if (points !== undefined) {
        await refreshUserAndLeaderboardCaches(userId);
      } else {
        // Just refresh user profile cache
        await cacheService.delete(`admin:user:${userId}`);
        await cacheService.delete(`profile:${userId}`);
      }
      
      // Invalidate admin user list cache (any page could be affected)
      await cacheService.deletePattern('admin:users:*');
      // Invalidate admin stats cache (user count may have changed)
      await cacheService.delete('admin:stats');
    } catch (err) {
      // Non-blocking: Log error but don't fail the request
      console.error('Error refreshing caches after user update:', err);
    }

    res.json({
      success: true,
      message: 'User updated successfully',
      data: { user: updatedUser }
    });

  } catch (error) {
    console.error('Update admin user error:', error);
    res.status(500).json({
      success: false,
      error: 'ADMIN_USER_UPDATE_ERROR',
      message: 'Failed to update user'
    });
  }
});

// Delete user permanently (admin)
router.delete('/users/:userId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, email: true }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }

    // Delete user and all related data in a transaction
    await prisma.$transaction(async (tx) => {
      // Delete user activities
      await tx.userActivity.deleteMany({
        where: { userId: userId }
      });

      // Delete user rewards
      await tx.reward.deleteMany({
        where: { userId: userId }
      });

      // Delete user badges
      await tx.userBadge.deleteMany({
        where: { userId: userId }
      });

      // Delete mining claims
      await tx.miningClaim.deleteMany({
        where: { userId: userId }
      });

      // Delete KYC submissions
      await tx.kycSubmission.deleteMany({
        where: { userId: userId }
      });

      // Delete user articles (if any)
      await tx.article.deleteMany({
        where: { authorId: userId }
      });

      // Delete referral rewards
      await tx.referralReward.deleteMany({
        where: {
          OR: [
            { referrerId: userId },
            { refereeId: userId }
          ]
        }
      });

      // Finally delete the user
      await tx.user.delete({
        where: { id: userId }
      });
    });

    // Write-through cache: Invalidate all user-related caches SYNCHRONOUSLY
    try {
      // Invalidate user profile caches
      await cacheService.delete(`admin:user:${userId}`);
      await cacheService.delete(`profile:${userId}`);
      await cacheService.delete(`user:badges:${userId}`);
      await cacheService.delete(`user:achievements:${userId}`);
      await cacheService.delete(`achievements:${userId}`);
      await cacheService.delete(`admin:achievements:${userId}`);
      
      // Invalidate admin user list cache
      await cacheService.deletePattern('admin:users:*');
      
      // Invalidate leaderboard caches (user deleted, rankings changed)
      await cacheService.deletePattern('leaderboard:*');
      // Invalidate admin stats cache (user count changed)
      await cacheService.delete('admin:stats');
    } catch (err) {
      // Non-blocking: Log error but don't fail the request
      console.error('Error invalidating caches after user delete:', err);
    }

    res.json({
      success: true,
      message: 'User and all related data deleted permanently'
    });

  } catch (error) {
    console.error('Delete admin user error:', error);
    res.status(500).json({
      success: false,
      error: 'ADMIN_USER_DELETE_ERROR',
      message: 'Failed to delete user'
    });
  }
});

// Get user achievements (admin) (with write-through cache)
router.get('/users/:userId/achievements', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const cacheKey = `admin:achievements:${userId}`;

    // Write-through cache: Get from cache, or fetch from DB and cache
    const userAchievements = await cacheService.getOrSet(cacheKey, async () => {
      return await prisma.userBadge.findMany({
        where: { userId: userId },
        include: {
          badge: true
        },
        orderBy: {
          earnedAt: 'desc'
        }
      });
    }, 3600); // 1 hour TTL (write-through cache with safety net)

    res.json({
      success: true,
      data: userAchievements
    });
  } catch (error) {
    console.error('Error fetching user achievements:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user achievements'
    });
  }
});

// Toggle user achievement (admin)
router.patch('/users/:userId/achievements/:achievementId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId, achievementId } = req.params;
    const { isLocked } = req.body;

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, points: true }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }

    // Check if achievement exists
    const achievement = await prisma.badge.findUnique({
      where: { id: achievementId },
      select: { id: true, pointsValue: true }
    });

    if (!achievement) {
      return res.status(404).json({
        success: false,
        error: 'ACHIEVEMENT_NOT_FOUND',
        message: 'Achievement not found'
      });
    }

    // Check if user has this achievement
    let userAchievement = await prisma.userBadge.findFirst({
      where: {
        userId: userId,
        badgeId: achievementId
      }
    });

    // If user doesn't have the achievement and we're trying to unlock it, create it
    if (!userAchievement && !isLocked) {
      userAchievement = await prisma.userBadge.create({
        data: {
          userId: userId,
          badgeId: achievementId,
          isLocked: false
        }
      });
    }
    // If user doesn't have the achievement and we're trying to lock it, return error
    else if (!userAchievement && isLocked) {
      return res.status(400).json({
        success: false,
        error: 'ACHIEVEMENT_NOT_EARNED',
        message: 'Cannot lock an achievement that the user has not earned'
      });
    }
    // If user has the achievement, update its lock status
    else if (userAchievement) {
      await prisma.userBadge.update({
        where: { id: userAchievement.id },
        data: { isLocked: isLocked }
      });
    }

    let message = '';
    let pointsChange = 0;

    if (isLocked) {
      // Deduct points when locking achievement
      pointsChange = -achievement.pointsValue;
      message = `Achievement locked and ${achievement.pointsValue} points deducted from user balance`;
    } else {
      // Add points when unlocking achievement (whether it's new or existing)
      pointsChange = achievement.pointsValue;
      message = `Achievement unlocked and ${achievement.pointsValue} points added to user balance`;
    }

    // Use transaction to atomically update user points and achievement status
    // This prevents race conditions if admin toggles achievement multiple times rapidly
    await prisma.$transaction(async (tx) => {
      // Re-fetch achievement and user within transaction to get latest state
      const achievementInTx = await tx.badge.findUnique({
        where: { id: achievementId }
      });

      const userInTx = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true }
      });

      if (!achievementInTx) {
        throw new Error('ACHIEVEMENT_NOT_FOUND');
      }

      if (!userInTx) {
        throw new Error('USER_NOT_FOUND');
      }

      // Update user points atomically
      await tx.user.update({
        where: { id: userId },
        data: {
          points: {
            increment: pointsChange
          }
        }
      });
    });

    // Write-through cache: Refresh user profile and achievement caches SYNCHRONOUSLY
    // This ensures cache is updated before response is sent, preventing stale data window
    // Note: Leaderboard cache is time-based (10 min TTL) and will update automatically
    try {
      const { refreshUserAndLeaderboardCaches } = require('../services/cacheRefreshHelpers');
      await refreshUserAndLeaderboardCaches(userId);
      
      // Refresh user achievements cache
      await cacheService.delete(`achievements:${userId}`);
      await cacheService.delete(`user:badges:${userId}`);
      await cacheService.delete(`user:achievements:${userId}`);
      await cacheService.delete(`admin:achievements:${userId}`);
    } catch (err) {
      // Non-blocking: Log error but don't fail the request
      console.error('Error refreshing caches after achievement toggle:', err);
    }

    res.json({
      success: true,
      message: message,
      data: {
        achievementId: achievementId,
        isLocked: isLocked,
        pointsChange: pointsChange
      }
    });

  } catch (error) {
    console.error('Toggle user achievement error:', error);
    
    // Handle specific errors
    if (error.message === 'ACHIEVEMENT_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        error: 'ACHIEVEMENT_NOT_FOUND',
        message: 'Achievement not found'
      });
    }
    
    if (error.message === 'USER_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'ADMIN_ACHIEVEMENT_TOGGLE_ERROR',
      message: 'Failed to toggle achievement'
    });
  }
});

// Get system statistics (admin)
router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const cacheKey = 'admin:stats';

    // Write-through cache: Get from cache, or fetch from DB and cache
    const stats = await cacheService.getOrSet(cacheKey, async () => {
      // Get total users
      const totalUsers = await prisma.user.count();
      
      // Get active users by time period (based on daily reward claims)
      // Uses UTC day boundaries to match daily reward system
      const now = new Date();
      
      // UTC day helper functions (matching daily reward logic)
      const startOfUtcDay = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
      const startOfUtcWeek = (d) => {
        const day = d.getUTCDay();
        const diff = d.getUTCDate() - day; // Sunday = 0
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff, 0, 0, 0, 0));
      };
      const startOfUtcMonth = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
      
      const todayUtcStart = startOfUtcDay(now);
      const weekUtcStart = startOfUtcWeek(now);
      const monthUtcStart = startOfUtcMonth(now);
      
      // Count unique users who claimed daily reward today (since 00:00 UTC)
      const activeToday = await prisma.dailyReward.groupBy({
        by: ['userId'],
        where: {
          claimedAt: {
            gte: todayUtcStart
          }
        }
      }).then(results => results.length);
      
      // Count unique users who claimed daily reward this week (since start of week UTC)
      const activeLastWeek = await prisma.dailyReward.groupBy({
        by: ['userId'],
        where: {
          claimedAt: {
            gte: weekUtcStart
          }
        }
      }).then(results => results.length);
      
      // Count unique users who claimed daily reward this month (since start of month UTC)
      const activeLastMonth = await prisma.dailyReward.groupBy({
        by: ['userId'],
        where: {
          claimedAt: {
            gte: monthUtcStart
          }
        }
      }).then(results => results.length);
      
      // Get total articles
      const totalArticles = await prisma.article.count();
      
      // Pending reviews: count articles awaiting review
      const pendingReviews = await prisma.article.count({
        where: { status: 'pending' }
      });

      return {
        totalUsers,
        activeToday,
        activeLastWeek,
        activeLastMonth,
        totalArticles,
        pendingReviews
      };
    }, 300); // 5 minutes TTL (stats change frequently)

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('Get admin stats error:', error);
    res.status(500).json({
      success: false,
      error: 'ADMIN_STATS_ERROR',
      message: 'Failed to fetch admin statistics'
    });
  }
});

// Create available reward (admin)
router.post('/rewards', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      name,
      description,
      type,
      category,
      pointsRequired,
      value,
      currency,
      stock,
      imageUrl,
      terms
    } = req.body;

    // Validate required fields
    if (!name || !type || !category || !pointsRequired || !value) {
      return res.status(400).json({
        success: false,
        error: 'REWARD_DATA_REQUIRED',
        message: 'Required reward fields are missing'
      });
    }

    const reward = await prisma.availableReward.create({
      data: {
        name,
        description,
        type,
        category,
        pointsRequired,
        value,
        currency,
        stock,
        imageUrl,
        terms
      }
    });

    // Write-through cache: Invalidate reward list cache SYNCHRONOUSLY
    try {
      await cacheService.deletePattern('rewards:*');
      await cacheService.deletePattern('availableRewards:*');
    } catch (err) {
      // Non-blocking: Log error but don't fail the request
      console.error('Error invalidating reward caches after create:', err);
    }

    res.json({
      success: true,
      message: 'Reward created successfully',
      data: { reward }
    });

  } catch (error) {
    console.error('Create admin reward error:', error);
    res.status(500).json({
      success: false,
      error: 'ADMIN_REWARD_CREATE_ERROR',
      message: 'Failed to create reward'
    });
  }
});

// Update available reward (admin)
router.put('/rewards/:rewardId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { rewardId } = req.params;
    const updateData = req.body;

    const reward = await prisma.availableReward.update({
      where: { id: rewardId },
      data: updateData
    });

    // Write-through cache: Invalidate reward caches SYNCHRONOUSLY
    try {
      await cacheService.delete(`reward:${rewardId}`);
      await cacheService.deletePattern('rewards:*');
      await cacheService.deletePattern('availableRewards:*');
    } catch (err) {
      // Non-blocking: Log error but don't fail the request
      console.error('Error invalidating reward caches after update:', err);
    }

    res.json({
      success: true,
      message: 'Reward updated successfully',
      data: { reward }
    });

  } catch (error) {
    console.error('Update admin reward error:', error);
    res.status(500).json({
      success: false,
      error: 'ADMIN_REWARD_UPDATE_ERROR',
      message: 'Failed to update reward'
    });
  }
});

// Delete available reward (admin)
router.delete('/rewards/:rewardId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { rewardId } = req.params;

    await prisma.availableReward.delete({
      where: { id: rewardId }
    });

    // Write-through cache: Invalidate reward caches SYNCHRONOUSLY
    try {
      await cacheService.delete(`reward:${rewardId}`);
      await cacheService.deletePattern('rewards:*');
      await cacheService.deletePattern('availableRewards:*');
    } catch (err) {
      // Non-blocking: Log error but don't fail the request
      console.error('Error invalidating reward caches after delete:', err);
    }

    res.json({
      success: true,
      message: 'Reward deleted successfully'
    });

  } catch (error) {
    console.error('Delete admin reward error:', error);
    res.status(500).json({
      success: false,
      error: 'ADMIN_REWARD_DELETE_ERROR',
      message: 'Failed to delete reward'
    });
  }
});

// Article Management Endpoints

// Debug middleware to see what's being received
const debugMiddleware = (req, res, next) => {
  console.log('=== Debug Middleware ===');
  console.log('Content-Type:', req.headers['content-type']);
  console.log('Body keys:', Object.keys(req.body || {}));
  console.log('Files:', req.files);
  console.log('File:', req.file);
  next();
};

// Create article (admin/creator)
router.post('/articles', authenticateToken, debugMiddleware, upload.fields([{ name: 'image', maxCount: 1 }, { name: 'file', maxCount: 1 }]), async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    console.log('=== Article Creation Debug ===');
    console.log('User ID:', userId);
    console.log('User Role:', userRole);
    console.log('Request body keys:', Object.keys(req.body));
    console.log('Request file:', req.file);
    console.log('Request files:', req.files);

    // Check if user is admin or creator
    if (userRole !== 'admin' && userRole !== 'creator') {
      return res.status(403).json({
        success: false,
        error: 'ACCESS_DENIED',
        message: 'Only admins and creators can create articles'
      });
    }

    const {
      title,
      content,
      category,
      sourceName,
      sourceUrl,
      pointsValue,
      isFeatured
    } = req.body;

    // Parse numeric values from FormData (which sends everything as strings)
    const parsedPointsValue = parseInt(pointsValue) || 10;
    const parsedIsFeatured = isFeatured === 'true' || isFeatured === true;

    // Handle image - prefer Cloudflare R2 URL over base64
    let finalImageUrl = null;
    let finalImageData = null;
    let finalImageType = null;
    
    if (req.body.imageUrl) {
      // New: Cloudflare R2 URL (preferred)
      console.log('Using Cloudflare R2 URL for article image');
      finalImageUrl = req.body.imageUrl;
      // Clear base64 data when using R2 URL
      finalImageData = null;
    } else if (req.body.imageData) {
      // Legacy: Base64 data (backward compatibility)
      console.log('Storing image data in database (legacy mode)');
      finalImageData = req.body.imageData;
      finalImageType = req.body.imageType || 'image/jpeg';
      
      // Check image size (base64 is ~33% larger than original)
      const base64Size = finalImageData.length;
      const estimatedOriginalSize = (base64Size * 3) / 4; // Approximate original size
      const maxSize = 200 * 1024; // 200KB
      
      console.log('Image data length:', base64Size);
      console.log('Estimated original size:', Math.round(estimatedOriginalSize / 1024) + 'KB');
      console.log('Image type:', finalImageType);
      
      if (estimatedOriginalSize > maxSize) {
        return res.status(400).json({
          success: false,
          error: 'IMAGE_TOO_LARGE',
          message: `Image size is ${Math.round(estimatedOriginalSize / 1024)}KB. Maximum allowed size is 200KB.`
        });
      }

      // Check image format (validate MIME type) - allow WebP for articles
      const allowedTypes = /jpeg|jpg|png|webp/;
      if (finalImageType && !allowedTypes.test(finalImageType)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_IMAGE_FORMAT',
          message: 'Only JPEG, JPG, PNG, and WebP images are allowed for articles.'
        });
      }
    } else {
      console.log('No image provided');
    }

    // Validate required fields
    if (!title || !content || !category) {
      return res.status(400).json({
        success: false,
        error: 'ARTICLE_DATA_REQUIRED',
        message: 'Title, content, and category are required'
      });
    }

    // Validate that image is provided
    if (!finalImageUrl && !finalImageData) {
      return res.status(400).json({
        success: false,
        error: 'IMAGE_REQUIRED',
        message: 'Featured image is required for all articles'
      });
    }

    // Determine article status based on user role
    const articleStatus = userRole === 'admin' ? 'published' : 'pending';
    const publishedAt = userRole === 'admin' ? new Date() : null;

    // Create article
    const article = await prisma.article.create({
      data: {
        title: title.trim(),
        content: content.trim(),
        category: category.toUpperCase(),
        sourceName: sourceName || 'BuzzNob',
        sourceUrl: sourceUrl || null,
        pointsValue: parsedPointsValue,
        isFeatured: parsedIsFeatured,
        imageUrl: finalImageUrl || null,
        imageData: finalImageData || null,
        imageType: finalImageType || null,
        status: articleStatus,
        authorId: userId,
        publishedAt: publishedAt
      }
    });

    // Write-through cache: Refresh article caches and invalidate portal caches SYNCHRONOUSLY if article is published
    if (articleStatus === 'published') {
      try {
        await cacheService.refreshArticleCaches(
          fetchTrendingArticles,
          fetchFeaturedArticles,
          article.id
        );
        // Invalidate creator articles cache (if author is creator)
        await cacheService.deletePattern(`creator:articles:${userId}:*`);
        // Invalidate public articles cache (new published article)
        await cacheService.deletePattern(`public:articles:${userId}:*`);
        // Invalidate public profile cache (articles count changed)
        await cacheService.delete(`public:profile:${userId}`);
        // Invalidate admin caches
        await cacheService.deletePattern('admin:articles:*');
        await cacheService.delete('admin:stats');
      } catch (err) {
        // Non-blocking: Log error but don't fail the request
        console.error('Error refreshing caches after create:', err);
      }
    }

    res.json({
      success: true,
      message: 'Article created successfully',
      data: { article }
    });

  } catch (error) {
    console.error('Create article error:', error);
    res.status(500).json({
      success: false,
      error: 'ARTICLE_CREATE_ERROR',
      message: 'Failed to create article'
    });
  }
});

// Get published articles (admin view)
router.get('/articles', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const cacheKey = `admin:articles:${page}:${limit}`;

    // Write-through cache: Get from cache, or fetch from DB and cache
    const result = await cacheService.getOrSet(cacheKey, async () => {
      const articles = await prisma.article.findMany({
        where: {
          status: 'published'
        },
        orderBy: { publishedAt: 'desc' },
        skip,
        take: limit,
        include: {
          activities: {
            select: {
              id: true,
              userId: true,
              pointsEarned: true
            }
          },
          author: {
            select: {
              id: true,
              username: true,
              displayName: true,
              role: true
            }
          }
        }
      });

      const totalCount = await prisma.article.count({
        where: { status: 'published' }
      });

      // Add computed fields
      const articlesWithStats = articles.map(article => ({
        ...article,
        views: article.activities.length
      }));

      return {
        articles: articlesWithStats,
        pagination: {
          page,
          limit,
          total: totalCount,
          pages: Math.ceil(totalCount / limit)
        }
      };
    }, 300); // 5 minutes TTL

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Get admin articles error:', error);
    res.status(500).json({
      success: false,
      error: 'ARTICLES_FETCH_ERROR',
      message: 'Failed to fetch articles'
    });
  }
});

// Get pending articles for review (admin view)
router.get('/articles/pending', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const cacheKey = `admin:articles:pending:${page}:${limit}`;

    // Write-through cache: Get from cache, or fetch from DB and cache
    const result = await cacheService.getOrSet(cacheKey, async () => {
      const articles = await prisma.article.findMany({
        where: {
          status: 'pending'
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          author: {
            select: {
              id: true,
              username: true,
              displayName: true,
              email: true,
              role: true
            }
          }
        }
      });

      const totalCount = await prisma.article.count({
        where: { status: 'pending' }
      });

      return {
        articles,
        pagination: {
          page,
          limit,
          total: totalCount,
          pages: Math.ceil(totalCount / limit)
        }
      };
    }, 120); // 2 minutes TTL (pending articles change frequently)

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Get pending articles error:', error);
    res.status(500).json({
      success: false,
      error: 'PENDING_ARTICLES_ERROR',
      message: 'Failed to fetch pending articles'
    });
  }
});

// Update article (admin/creator)
router.put('/articles/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userRole = req.user.role;

    // Check if user is admin or creator
    if (userRole !== 'admin' && userRole !== 'creator') {
      return res.status(403).json({
        success: false,
        error: 'ACCESS_DENIED',
        message: 'Only admins and creators can update articles'
      });
    }

    const updateData = {};
    const allowedFields = [
      'title',
      'content',
      'category',
      'sourceName',
      'sourceUrl',
      'pointsValue',
      'isFeatured',
      'imageUrl'
    ];

    // Only update provided fields
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        if (field === 'category') {
          updateData[field] = req.body[field].toUpperCase();
        } else if (field === 'title' || field === 'content') {
          updateData[field] = req.body[field].trim();
        } else {
          updateData[field] = req.body[field];
        }
      }
    }

    const article = await prisma.article.update({
      where: { id },
      data: updateData
    });

    // Write-through cache: Refresh article caches SYNCHRONOUSLY if article is published
    if (article.status === 'published') {
      try {
        await cacheService.refreshArticleCaches(
          fetchTrendingArticles,
          fetchFeaturedArticles,
          article.id
        );
        // Invalidate admin article caches
        await cacheService.deletePattern('admin:articles:*');
      } catch (err) {
        // Non-blocking: Log error but don't fail the request
        console.error('Error refreshing article caches after update:', err);
      }
    } else {
      // If article is pending or rejected, invalidate admin caches SYNCHRONOUSLY
      try {
        await cacheService.deletePattern('admin:articles:*');
        await cacheService.deletePattern('admin:articles:pending:*');
      } catch (err) {
        // Non-blocking: Log error but don't fail the request
        console.error('Error invalidating admin article caches after update:', err);
      }
    }

    res.json({
      success: true,
      message: 'Article updated successfully',
      data: { article }
    });

  } catch (error) {
    console.error('Update article error:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        error: 'ARTICLE_NOT_FOUND',
        message: 'Article not found'
      });
    }

    res.status(500).json({
      success: false,
      error: 'ARTICLE_UPDATE_ERROR',
      message: 'Failed to update article'
    });
  }
});

// Toggle trending status for article (admin only)
router.patch('/articles/:id/trending', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { isFeatured } = req.body;

    if (typeof isFeatured !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_DATA',
        message: 'isFeatured must be a boolean value'
      });
    }

    const article = await prisma.article.update({
      where: { id },
      data: { isFeatured }
    });

    // Write-through cache: Refresh article caches SYNCHRONOUSLY after trending toggle
    if (article.status === 'published') {
      try {
        await cacheService.refreshArticleCaches(
          fetchTrendingArticles,
          fetchFeaturedArticles,
          article.id
        );
        // Invalidate admin article caches
        await cacheService.deletePattern('admin:articles:*');
      } catch (err) {
        // Non-blocking: Log error but don't fail the request
        console.error('Error refreshing article caches after trending toggle:', err);
      }
    }

    res.json({
      success: true,
      message: `Article ${isFeatured ? 'set as trending' : 'removed from trending'} successfully`,
      data: { article }
    });

  } catch (error) {
    console.error('Toggle trending status error:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        error: 'ARTICLE_NOT_FOUND',
        message: 'Article not found'
      });
    }

    res.status(500).json({
      success: false,
      error: 'TRENDING_TOGGLE_ERROR',
      message: 'Failed to toggle trending status'
    });
  }
});

// Toggle featured article status (admin only)
// Update manual read count for an article
router.patch('/articles/:id/read-count', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { readCount } = req.body;

    if (typeof readCount !== 'number' || readCount < 0) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_DATA',
        message: 'readCount must be a non-negative number'
      });
    }

    const article = await prisma.article.update({
      where: { id },
      data: { manualReadCount: readCount },
      select: { id: true, title: true, manualReadCount: true, status: true }
    });

    // Write-through cache: Refresh read count and article caches SYNCHRONOUSLY
    try {
      await cacheService.refreshReadCount(id, async () => readCount, 3600); // 1 hour TTL
      if (article.status === 'published') {
        await cacheService.refreshArticleCaches(
          fetchTrendingArticles,
          fetchFeaturedArticles,
          id
        );
      }
    } catch (err) {
      // Non-blocking: Log error but don't fail the request
      console.error('Error refreshing caches after read count update:', err);
    }

    res.json({
      success: true,
      message: 'Read count updated successfully',
      data: { article }
    });
  } catch (error) {
    console.error('Update read count error:', error);
    res.status(500).json({
      success: false,
      error: 'UPDATE_READ_COUNT_ERROR',
      message: 'Failed to update read count'
    });
  }
});

// Reset manual read count to actual count
router.patch('/articles/:id/read-count/reset', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Get actual read count
    const actualCount = await prisma.userActivity.count({
      where: { articleId: id }
    });

    const article = await prisma.article.update({
      where: { id },
      data: { manualReadCount: null },
      select: { id: true, title: true, manualReadCount: true, status: true }
    });

    // Write-through cache: Refresh read count and article caches SYNCHRONOUSLY
    try {
      await cacheService.refreshReadCount(id, async () => actualCount, 3600); // 1 hour TTL
      if (article.status === 'published') {
        await cacheService.refreshArticleCaches(
          fetchTrendingArticles,
          fetchFeaturedArticles,
          id
        );
      }
    } catch (err) {
      // Non-blocking: Log error but don't fail the request
      console.error('Error refreshing caches after read count reset:', err);
    }

    res.json({
      success: true,
      message: 'Read count reset to actual count',
      data: { 
        article,
        actualCount
      }
    });
  } catch (error) {
    console.error('Reset read count error:', error);
    res.status(500).json({
      success: false,
      error: 'RESET_READ_COUNT_ERROR',
      message: 'Failed to reset read count'
    });
  }
});

// Get actual read count for an article
router.get('/articles/:id/read-count/actual', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const cacheKey = `admin:article:${id}:read-count:actual`;

    // Write-through cache: Get from cache, or fetch from DB and cache
    const result = await cacheService.getOrSet(cacheKey, async () => {
      const actualCount = await prisma.userActivity.count({
        where: { articleId: id }
      });

      return { actualCount };
    }, 300); // 5 minutes TTL

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Get actual read count error:', error);
    res.status(500).json({
      success: false,
      error: 'GET_READ_COUNT_ERROR',
      message: 'Failed to get actual read count'
    });
  }
});

router.patch('/articles/:id/featured', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { isFeaturedArticle } = req.body;

    if (typeof isFeaturedArticle !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_DATA',
        message: 'isFeaturedArticle must be a boolean value'
      });
    }

    const article = await prisma.article.update({
      where: { id },
      data: { isFeaturedArticle }
    });

    // Write-through cache: Refresh article caches SYNCHRONOUSLY after featured toggle
    if (article.status === 'published') {
      try {
        await cacheService.refreshArticleCaches(
          fetchTrendingArticles,
          fetchFeaturedArticles,
          article.id
        );
        // Invalidate admin article caches
        await cacheService.deletePattern('admin:articles:*');
      } catch (err) {
        // Non-blocking: Log error but don't fail the request
        console.error('Error refreshing article caches after featured toggle:', err);
      }
    }

    res.json({
      success: true,
      message: `Article ${isFeaturedArticle ? 'set as featured' : 'removed from featured'} successfully`,
      data: { article }
    });

  } catch (error) {
    console.error('Toggle featured article status error:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        error: 'ARTICLE_NOT_FOUND',
        message: 'Article not found'
      });
    }

    res.status(500).json({
      success: false,
      error: 'FEATURED_TOGGLE_ERROR',
      message: 'Failed to toggle featured article status'
    });
  }
});

// Delete article (admin only)
router.delete('/articles/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    console.log(`Delete article request - User: ${userId}, Role: ${userRole}, Article ID: ${id}`);

    // Double-check admin role
    if (userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'ACCESS_DENIED',
        message: 'Only admins can delete articles'
      });
    }

    // Check if article exists first
    const existingArticle = await prisma.article.findUnique({
      where: { id }
    });

    if (!existingArticle) {
      return res.status(404).json({
        success: false,
        error: 'ARTICLE_NOT_FOUND',
        message: 'Article not found'
      });
    }

    // Delete the article
    await prisma.article.delete({
      where: { id }
    });

    console.log(`Article ${id} deleted successfully by admin ${userId}`);

    // Write-through cache: Refresh article caches SYNCHRONOUSLY after deletion
    try {
      await cacheService.refreshArticleCaches(
        fetchTrendingArticles,
        fetchFeaturedArticles,
        id
      );
      // Invalidate admin article caches
      await cacheService.deletePattern('admin:articles:*');
      await cacheService.deletePattern('admin:articles:pending:*');
      await cacheService.deletePattern('admin:articles:review-history:*');
      await cacheService.delete('admin:stats');
    } catch (err) {
      // Non-blocking: Log error but don't fail the request
      console.error('Error refreshing article caches after delete:', err);
    }

    res.json({
      success: true,
      message: 'Article deleted successfully'
    });

  } catch (error) {
    console.error('Delete article error:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        error: 'ARTICLE_NOT_FOUND',
        message: 'Article not found'
      });
    }

    res.status(500).json({
      success: false,
      error: 'ARTICLE_DELETE_ERROR',
      message: 'Failed to delete article'
    });
  }
});

// Approve article for publication (admin only)
router.patch('/articles/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check if article exists and is pending
    const article = await prisma.article.findUnique({
      where: { id },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            displayName: true,
            email: true,
            role: true
          }
        }
      }
    });

    if (!article) {
      return res.status(404).json({
        success: false,
        error: 'ARTICLE_NOT_FOUND',
        message: 'Article not found'
      });
    }

    if (article.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_STATUS',
        message: 'Article is not in pending status'
      });
    }

    // Update article status to published
    const updatedArticle = await prisma.article.update({
      where: { id },
      data: {
        status: 'published',
        reviewedBy: userId,
        reviewedAt: new Date(),
        publishedAt: new Date()
      }
    });

    console.log(`Article ${id} approved and published by admin ${userId}`);

    // Write-through cache: Refresh article caches and invalidate portal caches SYNCHRONOUSLY after publishing
    try {
      await cacheService.refreshArticleCaches(
        fetchTrendingArticles,
        fetchFeaturedArticles,
        updatedArticle.id
      );
      // Invalidate creator articles cache (article now published)
      await cacheService.deletePattern(`creator:articles:${article.authorId}:*`);
      // Invalidate public articles cache (new published article)
      await cacheService.deletePattern(`public:articles:${article.authorId}:*`);
      // Invalidate public profile cache (articles count changed)
      await cacheService.delete(`public:profile:${article.authorId}`);
      // Invalidate admin caches
      await cacheService.deletePattern('admin:articles:*');
      await cacheService.deletePattern('admin:articles:pending:*');
      await cacheService.deletePattern('admin:articles:review-history:*');
      await cacheService.delete('admin:stats');
    } catch (err) {
      // Non-blocking: Log error but don't fail the request
      console.error('Error refreshing caches after approve:', err);
    }

    res.json({
      success: true,
      message: 'Article approved and published successfully',
      data: updatedArticle
    });

  } catch (error) {
    console.error('Approve article error:', error);
    res.status(500).json({
      success: false,
      error: 'ARTICLE_APPROVE_ERROR',
      message: 'Failed to approve article'
    });
  }
});

// Reject article (admin only)
router.patch('/articles/:id/reject', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const userId = req.user.id;

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'REJECTION_REASON_REQUIRED',
        message: 'Rejection reason is required'
      });
    }

    // Check if article exists and is pending
    const article = await prisma.article.findUnique({
      where: { id },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            displayName: true,
            email: true,
            role: true
          }
        }
      }
    });

    if (!article) {
      return res.status(404).json({
        success: false,
        error: 'ARTICLE_NOT_FOUND',
        message: 'Article not found'
      });
    }

    if (article.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_STATUS',
        message: 'Article is not in pending status'
      });
    }

    // Update article status to rejected
    const updatedArticle = await prisma.article.update({
      where: { id },
      data: {
        status: 'rejected',
        reviewedBy: userId,
        reviewedAt: new Date(),
        rejectionReason: reason.trim()
      }
    });

    console.log(`Article ${id} rejected by admin ${userId}. Reason: ${reason}`);

    // Write-through cache: Invalidate article caches SYNCHRONOUSLY
    try {
      // Invalidate pending articles cache (article no longer pending)
      await cacheService.deletePattern('admin:articles:pending:*');
      // Invalidate review history cache (new review entry)
      await cacheService.deletePattern('admin:articles:review-history:*');
      // Invalidate admin articles cache (if article was published before)
      await cacheService.deletePattern('admin:articles:*');
      // Invalidate creator articles cache
      await cacheService.deletePattern(`creator:articles:${article.authorId}:*`);
      // Invalidate public articles cache
      await cacheService.deletePattern(`public:articles:${article.authorId}:*`);
      // Invalidate admin stats cache (article count changed)
      await cacheService.delete('admin:stats');
    } catch (err) {
      // Non-blocking: Log error but don't fail the request
      console.error('Error invalidating caches after reject:', err);
    }

    res.json({
      success: true,
      message: 'Article rejected successfully',
      data: updatedArticle
    });

  } catch (error) {
    console.error('Reject article error:', error);
    res.status(500).json({
      success: false,
      error: 'ARTICLE_REJECT_ERROR',
      message: 'Failed to reject article'
    });
  }
});

// Get review history (admin only)
router.get('/articles/review-history', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    const userId = req.user.id;

    const cacheKey = `admin:articles:review-history:${page}:${limit}`;

    // Write-through cache: Get from cache, or fetch from DB and cache
    const result = await cacheService.getOrSet(cacheKey, async () => {
      // Get all articles that have been reviewed by any admin
      const reviewedArticles = await prisma.article.findMany({
        where: {
          status: {
            in: ['approved', 'rejected', 'published']
          },
          reviewedBy: {
            not: null
          }
        },
        orderBy: { reviewedAt: 'desc' },
        skip,
        take: limit,
        include: {
          author: {
            select: {
              id: true,
              username: true,
              displayName: true,
              email: true,
              role: true
            }
          },
          reviewer: {
            select: {
              id: true,
              username: true,
              displayName: true,
              role: true
            }
          }
        }
      });

      const totalCount = await prisma.article.count({
        where: {
          status: {
            in: ['approved', 'rejected', 'published']
          },
          reviewedBy: {
            not: null
          }
        }
      });

      // Transform data for frontend
      const reviewHistory = reviewedArticles.map(article => {
        const isCreatedByAdmin = article.authorId === userId;
        const isReviewedByAdmin = article.reviewedBy === userId;
        
        return {
          id: article.id,
          articleId: article.id,
          articleTitle: article.title,
          action: article.status === 'published' ? 'approved' : article.status,
          reviewedAt: article.reviewedAt || article.publishedAt || article.createdAt,
          sortDate: article.reviewedAt || article.publishedAt || article.createdAt,
          reviewerName: isCreatedByAdmin ? 'Self (Created)' : (article.reviewer?.displayName || article.reviewer?.username || 'Admin'),
          comments: article.rejectionReason || (article.status === 'approved' || article.status === 'published' ? 
            (isCreatedByAdmin ? 'Article created and published directly' : 'Article approved for publication') : 'No comments'),
          authorName: article.author?.displayName || article.author?.username || 'Unknown',
          category: article.category,
          createdAt: article.createdAt
        };
      });

      return {
        reviewHistory,
        pagination: {
          page,
          limit,
          total: totalCount,
          pages: Math.ceil(totalCount / limit)
        }
      };
    }, 300); // 5 minutes TTL

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Get review history error:', error);
    res.status(500).json({
      success: false,
      error: 'REVIEW_HISTORY_ERROR',
      message: 'Failed to fetch review history'
    });
  }
});

// Serve image from database
router.get('/articles/:id/image', async (req, res) => {
  try {
    const { id } = req.params;
    
    const article = await prisma.article.findUnique({
      where: { id },
      select: {
        imageData: true,
        imageType: true
      }
    });

    if (!article || !article.imageData) {
      return res.status(404).json({
        success: false,
        error: 'IMAGE_NOT_FOUND',
        message: 'Image not found'
      });
    }

    // Set appropriate headers
    res.setHeader('Content-Type', article.imageType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
    
    // Send the base64 image data
    res.send(article.imageData);
    
  } catch (error) {
    console.error('Serve image error:', error);
    res.status(500).json({
      success: false,
      error: 'IMAGE_SERVE_ERROR',
      message: 'Failed to serve image'
    });
  }
});

// ==================== QUEST MANAGEMENT ====================

// Get all quests (admin)
router.get('/quests', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const quests = await prisma.quest.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { completions: true }
        }
      }
    });

    res.json({
      success: true,
      data: { quests }
    });
  } catch (error) {
    console.error('Get quests error:', error);
    res.status(500).json({
      success: false,
      error: 'QUESTS_FETCH_ERROR',
      message: 'Failed to fetch quests'
    });
  }
});

// Create quest (admin only)
router.post('/quests', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      title,
      description,
      icon,
      color,
      url,
      reward,
      category
    } = req.body;

    // Validate required fields
    if (!title || !icon) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Title and icon are required'
      });
    }

    // Validate category
    const validCategories = ['social', 'promotional'];
    const questCategory = category && validCategories.includes(category.toLowerCase()) 
      ? category.toLowerCase() 
      : 'social';

    // Validate reward
    const questReward = parseInt(reward) || 50;
    if (questReward < 0) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Reward must be a positive number'
      });
    }

    // Use transaction to ensure atomicity
    const quest = await prisma.$transaction(async (tx) => {
      return await tx.quest.create({
        data: {
          title: title.trim(),
          description: description?.trim() || null,
          icon,
          color: color || '#1DA1F2',
          url: url?.trim() || null,
          reward: questReward,
          category: questCategory,
          isActive: true
        }
      });
    });

    console.log(`Quest ${quest.id} created successfully by admin ${userId}`);

    res.json({
      success: true,
      message: 'Quest created successfully',
      data: { quest }
    });

  } catch (error) {
    console.error('Create quest error:', error);
    res.status(500).json({
      success: false,
      error: 'QUEST_CREATE_ERROR',
      message: 'Failed to create quest'
    });
  }
});

// Update quest (admin only)
router.put('/quests/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const {
      title,
      description,
      icon,
      color,
      url,
      reward,
      category,
      isActive
    } = req.body;

    // Check if quest exists
    const existingQuest = await prisma.quest.findUnique({
      where: { id }
    });

    if (!existingQuest) {
      return res.status(404).json({
        success: false,
        error: 'QUEST_NOT_FOUND',
        message: 'Quest not found'
      });
    }

    // Build update data
    const updateData = {};
    if (title !== undefined) updateData.title = title.trim();
    if (description !== undefined) updateData.description = description?.trim() || null;
    if (icon !== undefined) updateData.icon = icon;
    if (color !== undefined) updateData.color = color;
    if (url !== undefined) updateData.url = url?.trim() || null;
    if (reward !== undefined) {
      const questReward = parseInt(reward);
      if (questReward < 0) {
        return res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Reward must be a positive number'
        });
      }
      updateData.reward = questReward;
    }
    if (category !== undefined) {
      const validCategories = ['social', 'promotional'];
      updateData.category = validCategories.includes(category.toLowerCase()) 
        ? category.toLowerCase() 
        : existingQuest.category;
    }
    if (isActive !== undefined) updateData.isActive = isActive === true || isActive === 'true';

    // Use transaction to ensure atomicity
    const quest = await prisma.$transaction(async (tx) => {
      return await tx.quest.update({
        where: { id },
        data: updateData
      });
    });

    console.log(`Quest ${id} updated successfully by admin ${userId}`);

    res.json({
      success: true,
      message: 'Quest updated successfully',
      data: { quest }
    });

  } catch (error) {
    console.error('Update quest error:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        error: 'QUEST_NOT_FOUND',
        message: 'Quest not found'
      });
    }

    res.status(500).json({
      success: false,
      error: 'QUEST_UPDATE_ERROR',
      message: 'Failed to update quest'
    });
  }
});

// Delete quest (admin only)
router.delete('/quests/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check if quest exists
    const existingQuest = await prisma.quest.findUnique({
      where: { id }
    });

    if (!existingQuest) {
      return res.status(404).json({
        success: false,
        error: 'QUEST_NOT_FOUND',
        message: 'Quest not found'
      });
    }

    // Use transaction to ensure atomicity (delete quest and all completions)
    await prisma.$transaction(async (tx) => {
      // Delete all quest completions first (cascade should handle this, but being explicit)
      await tx.questCompletion.deleteMany({
        where: { questId: id }
      });

      // Delete the quest
      await tx.quest.delete({
        where: { id }
      });
    });

    console.log(`Quest ${id} deleted successfully by admin ${userId}`);

    res.json({
      success: true,
      message: 'Quest deleted successfully'
    });

  } catch (error) {
    console.error('Delete quest error:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        error: 'QUEST_NOT_FOUND',
        message: 'Quest not found'
      });
    }

    res.status(500).json({
      success: false,
      error: 'QUEST_DELETE_ERROR',
      message: 'Failed to delete quest'
    });
  }
});

// Use error handler middleware
router.use(errorHandler);

module.exports = router;
