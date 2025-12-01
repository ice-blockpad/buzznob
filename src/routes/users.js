const express = require('express');
const { prisma } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');
const upload = require('../middleware/upload');
const { deduplicateRequest } = require('../middleware/deduplication');
const cacheService = require('../services/cacheService');
const { parsePaginationParams, buildCursorQuery, buildOffsetQuery, buildPaginationResponse, buildPaginationResponseWithTotal } = require('../utils/pagination');

const router = express.Router();

// Get current user profile (with write-through cache)
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const cacheKey = `profile:${req.user.id}`;
    
    // Write-through cache: Get from cache, or fetch from DB and cache
    const result = await cacheService.getOrSet(cacheKey, async () => {
      // Use a single query with raw SQL for better performance
      const result = await prisma.$queryRaw`
        SELECT 
          u.id, u.username, u.email, u.external_id as "externalId", u.particle_user_id as "particleUserId", u.wallet_address as "walletAddress",
          u.display_name as "displayName", u.role, u.first_name as "firstName", u.last_name as "lastName",
          u.avatar_url as "avatarUrl", u.avatar_data as "avatarData", u.avatar_type as "avatarType",
          u.points, u.streak_count as "streakCount", u.last_login as "lastLogin", 
          u.referral_code as "referralCode", u.is_active as "isActive", u.is_verified as "isVerified",
          u.kyc_status as "kycStatus", u.bio, u.created_at as "createdAt", u.updated_at as "updatedAt",
          COALESCE(u.total_articles_read_count, 0) as "totalArticlesRead",
          COUNT(DISTINCT ub.id) as "achievementsCount",
          (SELECT COUNT(*) FROM users WHERE points > u.points) + 1 as rank
        FROM users u
        LEFT JOIN user_badges ub ON u.id = ub.user_id
        WHERE u.id = ${req.user.id}
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
    }, 120); // 2 minutes TTL

    res.json({
      success: true,
      data: { user: result }
    });

  } catch (error) {
    if (error.message === 'USER_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }
    
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
    const { username, displayName, firstName, lastName, bio } = req.body;

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


    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(username && { username }),
        ...(displayName && { displayName }),
        ...(firstName && { firstName }),
        ...(lastName && { lastName }),
        ...(bio && { bio }),
      },
      select: {
        id: true,
        username: true,
        email: true,
        externalId: true,
        particleUserId: true,
        walletAddress: true,
        displayName: true,
        role: true,
        firstName: true,
        lastName: true,
        bio: true,
        avatarUrl: true,
        avatarData: true,
        avatarType: true,
        points: true,
        streakCount: true,
        lastLogin: true,
        createdAt: true,
        updatedAt: true
      }
    });

    // Calculate user's rank for the updated user
    const usersWithMorePoints = await prisma.user.count({
      where: {
        points: {
          gt: updatedUser.points
        }
      }
    });
    const userRank = usersWithMorePoints + 1;

    const profileData = { ...updatedUser, rank: userRank };

    // Write-through cache: Refresh user profile cache SYNCHRONOUSLY
    // This ensures cache is updated before response is sent
    try {
      await cacheService.refreshUserProfile(req.user.id, profileData);
      // Write-through: Refresh public profile cache with fresh data
      await cacheService.refreshPublicProfile(req.user.id, async () => {
        const user = await prisma.user.findUnique({
          where: { id: req.user.id },
          select: {
            id: true,
            username: true,
            displayName: true,
            bio: true,
            avatarUrl: true,
            avatarData: true,
            avatarType: true,
            role: true,
            points: true,
            createdAt: true,
            _count: {
              select: {
                followers: true,
                following: true,
                authoredArticles: {
                  where: { status: 'published' }
                }
              }
            }
          }
        });

        if (!user) {
          return null;
        }

        return {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          bio: user.bio,
          avatarUrl: user.avatarUrl,
          avatarData: user.avatarData,
          avatarType: user.avatarType,
          role: user.role,
          points: user.points,
          followersCount: user._count.followers,
          followingCount: user._count.following,
          articlesCount: user._count.authoredArticles,
          createdAt: user.createdAt
        };
      });
      // Invalidate creators list cache if user is creator/admin (profile data changed)
      if (updatedUser.role === 'creator' || updatedUser.role === 'admin') {
        await cacheService.deletePattern('creators:list:*');
      }
    } catch (err) {
      // Non-blocking: Log error but don't fail the request
      console.error('Error refreshing user profile cache:', err);
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user: profileData }
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

// Update user profile with file upload (avatar)
router.post('/profile', authenticateToken, upload.fields([{ name: 'avatar', maxCount: 1 }]), async (req, res) => {
  try {
    const { displayName, bio, avatarUrl, avatarData, avatarType, avatarName } = req.body;

    // Handle avatar - prefer Cloudflare R2 URL over base64
    let finalAvatarUrl = null;
    let finalAvatarData = null;
    let finalAvatarType = null;
    
    if (avatarUrl) {
      // New: Cloudflare R2 URL (preferred)
      console.log('Using Cloudflare R2 URL for avatar');
      finalAvatarUrl = avatarUrl;
      // Clear base64 data when using R2 URL
      finalAvatarData = null;
    } else if (avatarData) {
      // Legacy: Base64 data (backward compatibility)
      console.log('Storing avatar data in database (legacy mode)');
      
      // Check image size (base64 is ~33% larger than original)
      const base64Size = avatarData.length;
      const estimatedOriginalSize = (base64Size * 3) / 4; // Approximate original size
      const maxSize = 200 * 1024; // 200KB
      
      console.log('Avatar data length:', base64Size);
      console.log('Estimated original size:', Math.round(estimatedOriginalSize / 1024) + 'KB');
      console.log('Avatar type:', avatarType);
      
      if (estimatedOriginalSize > maxSize) {
        return res.status(400).json({
          success: false,
          error: 'AVATAR_TOO_LARGE',
          message: `Avatar size is ${Math.round(estimatedOriginalSize / 1024)}KB. Maximum allowed size is 200KB.`
        });
      }

      // Check image format (same as creator functionality)
      const allowedTypes = /jpeg|jpg|png/;
      if (avatarType && !allowedTypes.test(avatarType)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_IMAGE_FORMAT',
          message: 'Only JPEG, JPG, and PNG images are allowed.'
        });
      }
      
      finalAvatarData = avatarData;
      finalAvatarType = avatarType;
      // Clear Google avatar when user uploads custom image
      finalAvatarUrl = null;
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(displayName && { displayName }),
        ...(bio && { bio }),
        ...(finalAvatarUrl !== null && { avatarUrl: finalAvatarUrl }),
        ...(finalAvatarData !== null && { avatarData: finalAvatarData }),
        ...(finalAvatarType && { avatarType: finalAvatarType }),
      },
      select: {
        id: true,
        username: true,
        email: true,
        externalId: true,
        particleUserId: true,
        walletAddress: true,
        displayName: true,
        firstName: true,
        lastName: true,
        bio: true,
        avatarUrl: true,
        avatarData: true,
        avatarType: true,
        role: true,
        points: true,
        streakCount: true,
        lastLogin: true,
        createdAt: true,
        updatedAt: true
      }
    });

    // Calculate user's rank for the updated user
    const usersWithMorePoints = await prisma.user.count({
      where: {
        points: {
          gt: updatedUser.points
        }
      }
    });
    const userRank = usersWithMorePoints + 1;

    const profileData = { ...updatedUser, rank: userRank };

    // Write-through cache: Refresh user profile cache SYNCHRONOUSLY
    // This ensures cache is updated before response is sent
    try {
      await cacheService.refreshUserProfile(req.user.id, profileData);
      // Write-through: Refresh public profile cache with fresh data
      await cacheService.refreshPublicProfile(req.user.id, async () => {
        const user = await prisma.user.findUnique({
          where: { id: req.user.id },
          select: {
            id: true,
            username: true,
            displayName: true,
            bio: true,
            avatarUrl: true,
            avatarData: true,
            avatarType: true,
            role: true,
            points: true,
            createdAt: true,
            _count: {
              select: {
                followers: true,
                following: true,
                authoredArticles: {
                  where: { status: 'published' }
                }
              }
            }
          }
        });

        if (!user) {
          return null;
        }

        return {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          bio: user.bio,
          avatarUrl: user.avatarUrl,
          avatarData: user.avatarData,
          avatarType: user.avatarType,
          role: user.role,
          points: user.points,
          followersCount: user._count.followers,
          followingCount: user._count.following,
          articlesCount: user._count.authoredArticles,
          createdAt: user.createdAt
        };
      });
      // Invalidate creators list cache if user is creator/admin (avatar/profile data changed)
      if (updatedUser.role === 'creator' || updatedUser.role === 'admin') {
        await cacheService.deletePattern('creators:list:*');
      }
    } catch (err) {
      // Non-blocking: Log error but don't fail the request
      console.error('Error refreshing user profile cache:', err);
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user: profileData }
    });

  } catch (error) {
    console.error('Update profile with file error:', error);
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

// Get user badges/achievements (with write-through cache)
router.get('/badges', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const cacheKey = `user:badges:${userId}`;

    // Write-through cache: Get from cache, or fetch from DB and cache
    const userBadges = await cacheService.getOrSet(cacheKey, async () => {
      return await prisma.userBadge.findMany({
        where: { userId },
        include: {
          badge: true
        },
        orderBy: { earnedAt: 'desc' }
      });
    }, 3600); // 1 hour TTL (write-through cache with safety net)

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

// Get user achievements count (with write-through cache)
router.get('/achievements', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const cacheKey = `user:achievements:${userId}`;

    // Write-through cache: Get from cache, or fetch from DB and cache
    const data = await cacheService.getOrSet(cacheKey, async () => {
      // Get total achievements count
      const achievementsCount = await prisma.userBadge.count({
        where: { userId }
      });

      // Get recent achievements (last 5)
      const recentAchievements = await prisma.userBadge.findMany({
        where: { userId },
        include: {
          badge: true
        },
        orderBy: { earnedAt: 'desc' },
        take: 5
      });

      return {
        totalCount: achievementsCount,
        recentAchievements
      };
    }, 3600); // 1 hour TTL (write-through cache with safety net)

    res.json({
      success: true,
      data
    });

  } catch (error) {
    console.error('Get user achievements error:', error);
    res.status(500).json({
      success: false,
      error: 'ACHIEVEMENTS_FETCH_ERROR',
      message: 'Failed to fetch user achievements'
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
    
    // Use transaction to atomically upgrade user and award points
    // This prevents duplicate upgrades if endpoint is called multiple times
    const updatedUser = await prisma.$transaction(async (tx) => {
      // Re-check role within transaction to prevent duplicate upgrades
      const userInTx = await tx.user.findUnique({
        where: { id: userId },
        select: { role: true }
      });

      if (!userInTx) {
        throw new Error('USER_NOT_FOUND');
      }

      if (userInTx.role === 'creator' || userInTx.role === 'admin') {
        throw new Error('ALREADY_CREATOR');
      }

      // Log the purchase for record keeping
      console.log(`✅ Creator upgrade purchase: User ${userId}, Product ${productId}`);

      // Upgrade user to creator role and award points atomically
      return await tx.user.update({
        where: { id: userId },
        data: {
          role: 'creator',
          isVerified: true,
          // Award 10,000 BUZZ tokens as welcome bonus
          points: {
            increment: 10000
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
    });

    // Write-through cache: Refresh user profile cache SYNCHRONOUSLY (role and points changed)
    // This ensures cache is updated before response is sent, preventing stale data window
    try {
      const { refreshUserAndLeaderboardCaches } = require('../services/cacheRefreshHelpers');
      await refreshUserAndLeaderboardCaches(userId);
      // Invalidate creators list cache (new creator added)
      await cacheService.deletePattern('creators:list:*');
    } catch (err) {
      // Non-blocking: Log error but don't fail the request
      console.error('Error refreshing caches after creator upgrade:', err);
    }

    res.json({
      success: true,
      message: 'Congratulations! You are now a Creator!',
      data: { user: updatedUser }
    });

  } catch (error) {
    console.error('Upgrade to creator error:', error);
    
    // Handle specific errors
    if (error.message === 'USER_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }
    
    if (error.message === 'ALREADY_CREATOR') {
      return res.status(400).json({
        success: false,
        error: 'ALREADY_CREATOR',
        message: 'User already has creator access'
      });
    }
    
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

    // Write-through cache: Invalidate all user-related caches SYNCHRONOUSLY
    try {
      // Invalidate user profile caches
      await cacheService.delete(`profile:${userId}`);
      await cacheService.delete(`public:profile:${userId}`);
      await cacheService.delete(`admin:user:${userId}`);
      // Invalidate creators list cache (if user was a creator)
      await cacheService.deletePattern('creators:list:*');
      // Invalidate admin user list cache
      await cacheService.deletePattern('admin:users:*');
      // Invalidate leaderboard caches (user deleted, rankings changed)
      await cacheService.deletePattern('leaderboard:*');
      // Invalidate admin stats cache (user count changed)
      await cacheService.delete('admin:stats');
    } catch (err) {
      // Non-blocking: Log error but don't fail the request
      console.error('Error invalidating caches after account delete:', err);
    }

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

 // Get creators list (for social features) (with write-through cache)
router.get('/creators', authenticateToken, async (req, res) => {
  try {
    const pagination = parsePaginationParams(req);
    const search = req.query.search || '';

    // Create cache key based on cursor/offset, limit, and search
    const cacheKey = `creators:list:${pagination.cursor || pagination.offset || 'initial'}:${pagination.limit}:${search || 'all'}`;

    // Write-through cache: Get from cache, or fetch from DB and cache
    const cachedData = await cacheService.getOrSet(cacheKey, async () => {
      // Build where clause for creators (users with creator or admin role)
      const baseWhere = {
        role: {
          in: ['creator', 'admin']
        },
        isActive: true
      };

      // Add search functionality
      if (search) {
        baseWhere.OR = [
          { username: { contains: search, mode: 'insensitive' } },
          { displayName: { contains: search, mode: 'insensitive' } },
          { bio: { contains: search, mode: 'insensitive' } }
        ];
      }

      // Use cursor-based pagination if cursor provided, otherwise use offset
      let creators;
      let totalCount = null;

      if (pagination.hasCursor || (!pagination.hasOffset && !pagination.hasCursor)) {
        // Cursor-based pagination (recommended) - ordered by points desc, then id
        const cursorQuery = buildCursorQuery(pagination, 'id', 'desc');
        const where = {
          ...baseWhere,
          ...cursorQuery.where
        };

        creators = await prisma.user.findMany({
          where,
          select: {
            id: true,
            username: true,
            displayName: true,
            bio: true,
            avatarUrl: true,
            avatarData: true,
            avatarType: true,
            role: true,
            points: true,
            createdAt: true,
            _count: {
              select: {
                followers: true
              }
            }
          },
          orderBy: [
            { points: 'desc' },
            { id: 'desc' }
          ],
          take: cursorQuery.take
        });
      } else {
        // Offset-based pagination (backward compatibility)
        const offsetQuery = buildOffsetQuery(pagination, 'points', 'desc');
        creators = await prisma.user.findMany({
          where: baseWhere,
          select: {
            id: true,
            username: true,
            displayName: true,
            bio: true,
            avatarUrl: true,
            avatarData: true,
            avatarType: true,
            role: true,
            points: true,
            createdAt: true,
            _count: {
              select: {
                followers: true
              }
            }
          },
          orderBy: offsetQuery.orderBy,
          skip: offsetQuery.skip,
          take: offsetQuery.take
        });
        totalCount = await prisma.user.count({ where: baseWhere });
      }

      // Build pagination response
      let paginationResponse;
      if (pagination.hasCursor || (!pagination.hasOffset && !pagination.hasCursor)) {
        paginationResponse = buildPaginationResponse(creators, pagination, 'id');
      } else {
        paginationResponse = buildPaginationResponseWithTotal(creators, pagination, totalCount);
      }

      return {
        creators: paginationResponse.data,
        ...paginationResponse
      };
    }, 600); // 10 minutes TTL (write-through cache with safety net)

    // Get current user's following list (user-specific, not cached)
    const userFollows = await prisma.follow.findMany({
      where: { followerId: req.user.id },
      select: { followingId: true }
    });

    const followingIds = userFollows.map(follow => follow.followingId);

    // Transform creators to include follower count
    const creatorsWithStats = cachedData.creators.map(creator => ({
      id: creator.id,
      username: creator.username,
      displayName: creator.displayName,
      bio: creator.bio,
      avatarUrl: creator.avatarUrl,
      avatarData: creator.avatarData,
      avatarType: creator.avatarType,
      role: creator.role,
      points: creator.points,
      followersCount: creator._count?.followers || 0,
      createdAt: creator.createdAt,
      isCreator: creator.role === 'creator' || creator.role === 'admin'
    }));

    res.json({
      success: true,
      data: {
        creators: creatorsWithStats,
        followingIds,
        ...(cachedData.nextCursor !== undefined ? { nextCursor: cachedData.nextCursor } : {}),
        ...(cachedData.nextOffset !== undefined ? { nextOffset: cachedData.nextOffset } : {}),
        ...(cachedData.hasMore !== undefined ? { hasMore: cachedData.hasMore } : {}),
        limit: cachedData.limit
      }
    });

  } catch (error) {
    console.error('Get creators error:', error);
    res.status(500).json({
      success: false,
      error: 'CREATORS_FETCH_ERROR',
      message: 'Failed to fetch creators'
    });
  }
});

// Follow a user
router.post('/:userId/follow', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const followerId = req.user.id;

    // Prevent self-follow
    if (userId === followerId) {
      return res.status(400).json({
        success: false,
        error: 'CANNOT_FOLLOW_SELF',
        message: 'You cannot follow yourself'
      });
    }

    // Check if user exists
    const userToFollow = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, displayName: true, role: true }
    });

    if (!userToFollow) {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }

    // Check if already following
    const existingFollow = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId,
          followingId: userId
        }
      }
    });

    if (existingFollow) {
      return res.status(400).json({
        success: false,
        error: 'ALREADY_FOLLOWING',
        message: 'You are already following this user'
      });
    }

    // Create follow relationship
    await prisma.follow.create({
      data: {
        followerId,
        followingId: userId
      }
    });

    // Write-through cache: Invalidate creators list and public profile caches SYNCHRONOUSLY (follower count changed)
    try {
      // Invalidate creators list cache (follower counts changed)
      await cacheService.deletePattern('creators:list:*');
      // Invalidate public profile cache (follower count changed)
      await cacheService.delete(`public:profile:${userId}`);
    } catch (err) {
      // Non-blocking: Log error but don't fail the request
      console.error('Error invalidating caches after follow:', err);
    }

    res.json({
      success: true,
      message: `You are now following ${userToFollow.displayName || userToFollow.username}`
    });

  } catch (error) {
    console.error('Follow user error:', error);
    res.status(500).json({
      success: false,
      error: 'FOLLOW_ERROR',
      message: 'Failed to follow user'
    });
  }
});

// Unfollow a user
router.post('/:userId/unfollow', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const followerId = req.user.id;

    // Check if follow relationship exists
    const existingFollow = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId,
          followingId: userId
        }
      }
    });

    if (!existingFollow) {
      return res.status(400).json({
        success: false,
        error: 'NOT_FOLLOWING',
        message: 'You are not following this user'
      });
    }

    // Remove follow relationship
    await prisma.follow.delete({
      where: {
        followerId_followingId: {
          followerId,
          followingId: userId
        }
      }
    });

    // Write-through cache: Invalidate creators list and public profile caches SYNCHRONOUSLY (follower count changed)
    try {
      // Invalidate creators list cache (follower counts changed)
      await cacheService.deletePattern('creators:list:*');
      // Invalidate public profile cache (follower count changed)
      await cacheService.delete(`public:profile:${userId}`);
    } catch (err) {
      // Non-blocking: Log error but don't fail the request
      console.error('Error invalidating caches after unfollow:', err);
    }

    res.json({
      success: true,
      message: 'You have unfollowed this user'
    });

  } catch (error) {
    console.error('Unfollow user error:', error);
    res.status(500).json({
      success: false,
      error: 'UNFOLLOW_ERROR',
      message: 'Failed to unfollow user'
    });
  }
});

// Get public profile (with write-through cache)
router.get('/:userId/public-profile', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const cacheKey = `public:profile:${userId}`;

    // Write-through cache: Get from cache, or fetch from DB and cache
    const cachedProfile = await cacheService.getOrSet(cacheKey, async () => {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          username: true,
          displayName: true,
          bio: true,
          avatarUrl: true,
          avatarData: true,
          avatarType: true,
          role: true,
          points: true,
          createdAt: true,
          _count: {
            select: {
              followers: true,
              following: true,
              authoredArticles: {
                where: { status: 'published' }
              }
            }
          }
        }
      });

      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }

      return {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        bio: user.bio,
        avatarUrl: user.avatarUrl,
        avatarData: user.avatarData,
        avatarType: user.avatarType,
        role: user.role,
        points: user.points,
        followersCount: user._count.followers,
        followingCount: user._count.following,
        articlesCount: user._count.authoredArticles,
        createdAt: user.createdAt
      };
    }, 600); // 10 minutes TTL (write-through cache with safety net)

    // Check if current user is following this user (user-specific, not cached)
    const isFollowing = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: req.user.id,
          followingId: userId
        }
      }
    });

    res.json({
      success: true,
      data: {
        ...cachedProfile,
        isFollowing: !!isFollowing
      }
    });

  } catch (error) {
    console.error('Get public profile error:', error);
    res.status(500).json({
      success: false,
      error: 'PROFILE_FETCH_ERROR',
      message: 'Failed to fetch user profile'
    });
  }
});

// Get a user's published articles (public view) (with write-through cache)
router.get('/:userId/articles', async (req, res) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50; // 50 articles per page
    const search = req.query.search || '';
    const offset = (page - 1) * limit;

    // Create cache key based on user, page, limit, and search
    const cacheKey = `public:articles:${userId}:${page}:${limit}:${search || 'all'}`;

    // Write-through cache: Get from cache, or fetch from DB and cache
    const result = await cacheService.getOrSet(cacheKey, async () => {
      // Verify user exists
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true }
      });

      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }

      // Build where clause for articles
      const whereClause = { 
        authorId: userId, 
        status: 'published' 
      };

      // Add search functionality
      if (search) {
        whereClause.OR = [
          { title: { contains: search, mode: 'insensitive' } },
          { content: { contains: search, mode: 'insensitive' } }
        ];
      }

      // Fetch published articles authored by this user
      const articles = await prisma.article.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        select: {
          id: true,
          title: true,
          content: true,
          category: true,
          sourceUrl: true,
          sourceName: true,
          pointsValue: true,
          isFeatured: true,
          imageUrl: true,
          imageData: true,
          imageType: true,
          createdAt: true,
          publishedAt: true,
          status: true,
        }
      });

      const total = await prisma.article.count({
        where: whereClause
      });

      return {
        articles,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      };
    }, 3600); // 1 hour TTL (write-through cache with safety net)

    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Get user published articles error:', error);
    return res.status(500).json({
      success: false,
      error: 'GET_USER_ARTICLES_ERROR',
      message: 'Failed to fetch user articles'
    });
  }
});

// Register push notification token
router.post('/push-token', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { pushToken } = req.body;

    if (!pushToken) {
      return res.status(400).json({
        success: false,
        error: 'PUSH_TOKEN_REQUIRED',
        message: 'Push token is required'
      });
    }

    // Update user's push token
    await prisma.user.update({
      where: { id: userId },
      data: { pushToken }
    });

    res.json({
      success: true,
      message: 'Push token registered successfully'
    });

  } catch (error) {
    console.error('Register push token error:', error);
    res.status(500).json({
      success: false,
      error: 'PUSH_TOKEN_REGISTRATION_ERROR',
      message: 'Failed to register push token'
    });
  }
});

// Invalidate user profile cache (for frontend to call after point changes)
router.post('/profile/invalidate-cache', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Delete user profile cache
    await cacheService.delete(`profile:${userId}`);
    
    // Also delete public profile cache if it exists
    await cacheService.delete(`public:profile:${userId}`);
    
    console.log(`🗑️  Invalidated profile cache for user ${userId} (requested by user)`);
    
    res.json({
      success: true,
      message: 'Profile cache invalidated successfully'
    });
  } catch (error) {
    console.error('Invalidate cache error:', error);
    res.status(500).json({
      success: false,
      error: 'CACHE_INVALIDATION_ERROR',
      message: 'Failed to invalidate cache'
    });
  }
});

module.exports = router;
