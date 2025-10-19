const express = require('express');
const { prisma } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');
const upload = require('../middleware/upload');

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

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          page,
          limit,
          total: totalCount,
          pages: Math.ceil(totalCount / limit)
        }
      }
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
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }

    // Get referral stats
    const referralCount = await prisma.user.count({
      where: { referredBy: userId }
    });

    res.json({
      success: true,
      data: {
        user: {
          ...user,
          referralCount
        }
      }
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
      isVerified
    } = req.body;

    const updateData = {};
    if (role !== undefined) updateData.role = role;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (points !== undefined) updateData.points = points;
    if (streakCount !== undefined) updateData.streakCount = streakCount;
    if (kycStatus !== undefined) updateData.kycStatus = kycStatus;
    if (isVerified !== undefined) updateData.isVerified = isVerified;

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

// Get system statistics (admin)
router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Get total users
    const totalUsers = await prisma.user.count();
    
    // Get active users by time period
    const now = new Date();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const oneMonthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    
    const activeToday = await prisma.user.count({
      where: {
        lastLogin: {
          gte: oneDayAgo
        }
      }
    });
    
    const activeLastWeek = await prisma.user.count({
      where: {
        lastLogin: {
          gte: oneWeekAgo
        }
      }
    });
    
    const activeLastMonth = await prisma.user.count({
      where: {
        lastLogin: {
          gte: oneMonthAgo
        }
      }
    });
    
    // Get total articles
    const totalArticles = await prisma.article.count();
    
    // Pending reviews: count articles awaiting review
    const pendingReviews = await prisma.article.count({
      where: { status: 'pending' }
    });

    res.json({
      success: true,
      data: {
        totalUsers,
        activeToday,
        activeLastWeek,
        activeLastMonth,
        totalArticles,
        pendingReviews
      }
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
      readTimeEstimate,
      isFeatured
    } = req.body;

    // Parse numeric values from FormData (which sends everything as strings)
    const parsedPointsValue = parseInt(pointsValue) || 10;
    const parsedReadTimeEstimate = parseInt(readTimeEstimate) || 5;
    const parsedIsFeatured = isFeatured === 'true' || isFeatured === true;

    // Handle image data - store directly in database
    let imageData = null;
    let imageType = null;
    let imageUrl = null;
    
    if (req.body.imageData) {
      // Store image data directly in database
      console.log('Storing image data in database');
      imageData = req.body.imageData;
      imageType = req.body.imageType || 'image/jpeg';
      
      // Check image size (base64 is ~33% larger than original)
      const base64Size = imageData.length;
      const estimatedOriginalSize = (base64Size * 3) / 4; // Approximate original size
      const maxSize = 200 * 1024; // 200KB
      
      console.log('Image data length:', base64Size);
      console.log('Estimated original size:', Math.round(estimatedOriginalSize / 1024) + 'KB');
      console.log('Image type:', imageType);
      
      if (estimatedOriginalSize > maxSize) {
        return res.status(400).json({
          success: false,
          error: 'IMAGE_TOO_LARGE',
          message: `Image size is ${Math.round(estimatedOriginalSize / 1024)}KB. Maximum allowed size is 200KB.`
        });
      }
    } else if (req.body.imageUrl) {
      // Fallback for URL-based images
      imageUrl = req.body.imageUrl;
      console.log('Using image URL:', imageUrl);
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
    if (!imageData && !imageUrl) {
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
        readTimeEstimate: parsedReadTimeEstimate,
        isFeatured: parsedIsFeatured,
        imageUrl: imageUrl || null,
        imageData: imageData || null,
        imageType: imageType || null,
        status: articleStatus,
        authorId: userId,
        publishedAt: publishedAt
      }
    });

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
            displayName: true
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

    res.json({
      success: true,
      data: {
        articles: articlesWithStats,
        pagination: {
          page,
          limit,
          total: totalCount,
          pages: Math.ceil(totalCount / limit)
        }
      }
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
            email: true
          }
        }
      }
    });

    const totalCount = await prisma.article.count({
      where: { status: 'pending' }
    });

    res.json({
      success: true,
      data: {
        articles,
        pagination: {
          page,
          limit,
          total: totalCount,
          pages: Math.ceil(totalCount / limit)
        }
      }
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
      'readTimeEstimate',
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
            email: true
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
            email: true
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

    // Get articles that have been reviewed by this admin OR created by this admin
    const reviewedArticles = await prisma.article.findMany({
      where: {
        OR: [
          {
            reviewedBy: userId,
            status: {
              in: ['approved', 'rejected', 'published']
            }
          },
          {
            authorId: userId,
            status: {
              in: ['published']
            }
          }
        ]
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
            email: true
          }
        },
        reviewer: {
          select: {
            id: true,
            username: true,
            displayName: true
          }
        }
      }
    });

    const totalCount = await prisma.article.count({
      where: {
        OR: [
          {
            reviewedBy: userId,
            status: {
              in: ['approved', 'rejected', 'published']
            }
          },
          {
            authorId: userId,
            status: {
              in: ['published']
            }
          }
        ]
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

    res.json({
      success: true,
      data: {
        reviewHistory,
        pagination: {
          page,
          limit,
          total: totalCount,
          pages: Math.ceil(totalCount / limit)
        }
      }
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

// Use error handler middleware
router.use(errorHandler);

module.exports = router;
