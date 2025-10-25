const express = require('express');
const { prisma } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');
const upload = require('../middleware/upload');

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
        avatarData: true,
        avatarType: true,
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
        updatedAt: true,
        _count: {
          select: {
            activities: true,
            userBadges: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }

    // Calculate user's rank (how many users have more points)
    const usersWithMorePoints = await prisma.user.count({
      where: {
        points: {
          gt: user.points
        }
      }
    });
    const userRank = usersWithMorePoints + 1;

    // Add computed fields
    const userWithStats = {
      ...user,
      totalArticlesRead: user._count.activities,
      achievementsCount: user._count.userBadges,
      rank: userRank
    };

    // Remove the _count field
    delete userWithStats._count;

    res.json({
      success: true,
      data: { user: userWithStats }
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
        googleId: true,
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

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user: { ...updatedUser, rank: userRank } }
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
    const { displayName, bio, avatarData, avatarType, avatarName } = req.body;

    // Handle avatar data - store directly in database
    let avatarUrl = null;
    
    if (avatarData) {
      // Store avatar data directly in database
      console.log('Storing avatar data in database');
      
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
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(displayName && { displayName }),
        ...(bio && { bio }),
        ...(avatarData && { 
          avatarData, // Store base64 data directly
          avatarUrl: null // Clear Google avatar when user uploads custom image
        }),
        ...(avatarType && { avatarType }),
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

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user: { ...updatedUser, rank: userRank } }
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

// Get user badges/achievements
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

// Get user achievements count
router.get('/achievements', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

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

    res.json({
      success: true,
      data: {
        totalCount: achievementsCount,
        recentAchievements
      }
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

 // Get creators list (for social features)
router.get('/creators', authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || '';
    const skip = (page - 1) * limit;

    // Build where clause for creators (users with creator or admin role)
    const whereClause = {
      role: {
        in: ['creator', 'admin']
      },
      isActive: true
    };

    // Add search functionality
    if (search) {
      whereClause.OR = [
        { username: { contains: search, mode: 'insensitive' } },
        { displayName: { contains: search, mode: 'insensitive' } },
        { bio: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Get creators with follower count
    const creators = await prisma.user.findMany({
      where: whereClause,
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
      orderBy: {
        points: 'desc'
      },
      skip,
      take: limit
    });

    // Get current user's following list
    const userFollows = await prisma.follow.findMany({
      where: { followerId: req.user.id },
      select: { followingId: true }
    });

    const followingIds = userFollows.map(follow => follow.followingId);

    // Transform creators to include follower count
    const creatorsWithStats = creators.map(creator => ({
      id: creator.id,
      username: creator.username,
      displayName: creator.displayName,
      bio: creator.bio,
      avatarUrl: creator.avatarUrl,
      avatarData: creator.avatarData,
      avatarType: creator.avatarType,
      role: creator.role,
      points: creator.points,
      followersCount: creator._count.followers,
      createdAt: creator.createdAt,
      isCreator: creator.role === 'creator' || creator.role === 'admin'
    }));

    res.json({
      success: true,
      data: {
        creators: creatorsWithStats,
        followingIds
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

// Get public profile
router.get('/:userId/public-profile', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;

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
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }

    // Check if current user is following this user
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
        createdAt: user.createdAt,
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

// Get a user's published articles (public view)
router.get('/:userId/articles', async (req, res) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50; // 50 articles per page
    const search = req.query.search || '';
    const offset = (page - 1) * limit;

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'User not found'
      });
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
        readTimeEstimate: true,
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

    return res.json({
      success: true,
      data: {
        articles,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
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

module.exports = router;
