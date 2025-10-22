const express = require('express');
const { prisma } = require('../config/database');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');

const router = express.Router();

// Get trending articles
router.get('/trending', optionalAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    const articles = await prisma.article.findMany({
      where: {
        isFeatured: true,
        status: 'published' // Only show published articles
      },
      orderBy: { createdAt: 'desc' },
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

    res.json({
      success: true,
      data: { articles }
    });

  } catch (error) {
    console.error('Get trending articles error:', error);
    res.status(500).json({
      success: false,
      error: 'TRENDING_ARTICLES_FETCH_ERROR',
      message: 'Failed to fetch trending articles'
    });
  }
});

// Get articles with pagination and filtering
router.get('/', optionalAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const category = req.query.category;
    const featured = req.query.featured === 'true';
    const skip = (page - 1) * limit;

    const where = {
      status: 'published' // Only show published articles to public
    };
    if (category) where.category = category;
    if (featured) where.isFeatured = true;

    const articles = await prisma.article.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
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

    const totalCount = await prisma.article.count({ where });

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
    console.error('Get articles error:', error);
    res.status(500).json({
      success: false,
      error: 'ARTICLES_FETCH_ERROR',
      message: 'Failed to fetch articles'
    });
  }
});

// Search articles
router.get('/search', optionalAuth, async (req, res) => {
  try {
    const { q: query, category } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'SEARCH_QUERY_REQUIRED',
        message: 'Search query is required'
      });
    }

    const where = {
      status: 'published', // Only search published articles
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { content: { contains: query, mode: 'insensitive' } }
      ]
    };

    if (category) {
      where.category = category;
    }

    const articles = await prisma.article.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
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

    const totalCount = await prisma.article.count({ where });

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
    console.error('Search articles error:', error);
    res.status(500).json({
      success: false,
      error: 'SEARCH_ERROR',
      message: 'Failed to search articles'
    });
  }
});

// Get articles by creator
router.get('/creator/:creatorId', optionalAuth, async (req, res) => {
  try {
    const { creatorId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    // Verify creator exists
    const creator = await prisma.user.findUnique({
      where: { id: creatorId },
      select: { id: true, username: true, displayName: true, firstName: true, lastName: true, role: true }
    });

    if (!creator) {
      return res.status(404).json({
        success: false,
        error: 'CREATOR_NOT_FOUND',
        message: 'Creator not found'
      });
    }

    // Get articles by creator
    const articles = await prisma.article.findMany({
      where: {
        authorId: creatorId,
        status: 'published' // Only show published articles
      },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
      select: {
        id: true,
        title: true,
        content: true,
        excerpt: true,
        category: true,
        sourceUrl: true,
        sourceName: true,
        pointsValue: true,
        readTimeEstimate: true,
        isFeatured: true,
        imageUrl: true,
        imageData: true,
        imageType: true,
        status: true,
        createdAt: true,
        publishedAt: true
      }
    });

    // Get total count for pagination
    const totalCount = await prisma.article.count({
      where: {
        authorId: creatorId,
        status: 'published'
      }
    });

    res.json({
      success: true,
      data: {
        articles,
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages: Math.ceil(totalCount / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get articles by creator error:', error);
    res.status(500).json({
      success: false,
      error: 'GET_CREATOR_ARTICLES_ERROR',
      message: 'Failed to get creator articles'
    });
  }
});

// Get single article
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const article = await prisma.article.findFirst({
      where: { 
        id,
        status: 'published' // Only allow access to published articles
      },
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

    if (!article) {
      return res.status(404).json({
        success: false,
        error: 'ARTICLE_NOT_FOUND',
        message: 'Article not found'
      });
    }

    // Check if user has read this article (if authenticated)
    let isRead = false;
    if (req.user && req.user.id) {
      const userActivity = await prisma.userActivity.findFirst({
        where: {
          userId: req.user.id,
          articleId: id
        }
      });
      isRead = !!userActivity;
    }

    res.json({
      success: true,
      data: { 
        article: {
          ...article,
          isRead
        }
      }
    });

  } catch (error) {
    console.error('Get article error:', error);
    res.status(500).json({
      success: false,
      error: 'ARTICLE_FETCH_ERROR',
      message: 'Failed to fetch article'
    });
  }
});

// Mark article as read and earn points
router.post('/:id/read', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { readDuration } = req.body; // in seconds
    const userId = req.user.id;

    // Check if article exists and is published
    const article = await prisma.article.findFirst({
      where: { 
        id,
        status: 'published' // Only allow reading published articles
      }
    });

    if (!article) {
      return res.status(404).json({
        success: false,
        error: 'ARTICLE_NOT_FOUND',
        message: 'Article not found'
      });
    }

    // Check if user already read this article
    const existingActivity = await prisma.userActivity.findFirst({
      where: {
        userId,
        articleId: id
      }
    });

    if (existingActivity) {
      return res.status(400).json({
        success: false,
        error: 'ARTICLE_ALREADY_READ',
        message: 'Article has already been read'
      });
    }

    // Check daily article reading limit (3 articles per day)
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1); // Start of tomorrow

    const todayActivities = await prisma.userActivity.count({
      where: {
        userId,
        completedAt: {
          gte: today,
          lt: tomorrow
        }
      }
    });

    if (todayActivities >= 3) {
      return res.status(400).json({
        success: false,
        error: 'DAILY_ARTICLE_LIMIT_REACHED',
        message: 'You have reached the daily reward limit of 3 articles. Come back tomorrow to earn more rewards!',
        data: {
          articlesReadToday: todayActivities,
          dailyLimit: 3
        }
      });
    }

    // Create user activity
    const activity = await prisma.userActivity.create({
      data: {
        userId,
        articleId: id,
        pointsEarned: article.pointsValue,
        readDuration: readDuration || null
      }
    });

    // Update user points
    await prisma.user.update({
      where: { id: userId },
      data: {
        points: {
          increment: article.pointsValue
        }
      }
    });

    // Check for badge eligibility
    await checkBadgeEligibility(userId);

    res.json({
      success: true,
      message: 'Article marked as read',
      data: {
        pointsEarned: article.pointsValue,
        totalPoints: req.user.points + article.pointsValue
      }
    });

  } catch (error) {
    console.error('Mark article as read error:', error);
    res.status(500).json({
      success: false,
      error: 'ARTICLE_READ_ERROR',
      message: 'Failed to mark article as read'
    });
  }
});

// Get trending articles
router.get('/trending', optionalAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    // Get articles with most reads in the last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const trendingArticles = await prisma.article.findMany({
      where: {
        status: 'published', // Only show published articles
        createdAt: {
          gte: sevenDaysAgo
        }
      },
      include: {
        activities: {
          where: {
            completedAt: {
              gte: sevenDaysAgo
            }
          }
        }
      },
      orderBy: {
        activities: {
          _count: 'desc'
        }
      },
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
        _count: {
          select: {
            activities: true
          }
        }
      }
    });

    res.json({
      success: true,
      data: { articles: trendingArticles }
    });

  } catch (error) {
    console.error('Get trending articles error:', error);
    res.status(500).json({
      success: false,
      error: 'TRENDING_ARTICLES_ERROR',
      message: 'Failed to fetch trending articles'
    });
  }
});

// Helper function to check badge eligibility
async function checkBadgeEligibility(userId) {
  try {
    // Get user's total articles read
    const totalRead = await prisma.userActivity.count({
      where: { userId }
    });

    // Get user's total points
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { points: true }
    });

    // Check for milestone badges (using actual badge names from database)
    const milestoneBadges = [
      { points: 100, name: 'Point Collector' },
      { points: 500, name: 'Point Master' },
      { points: 1000, name: 'BuzzNob Legend' },
      { read: 1, name: 'Article Reader' },
      { read: 10, name: 'Curious Mind' },
      { read: 25, name: 'Knowledge Seeker' },
      { read: 50, name: 'Avid Reader' },
      { read: 100, name: 'Article Master' },
      { read: 1000, name: 'Content Legend' }
    ];

    for (const badge of milestoneBadges) {
      const badgeExists = await prisma.badge.findUnique({
        where: { name: badge.name }
      });

      if (!badgeExists) continue;

      const userHasBadge = await prisma.userBadge.findFirst({
        where: {
          userId,
          badgeId: badgeExists.id
        }
      });

      if (!userHasBadge) {
        if (badge.points && user.points >= badge.points) {
          await prisma.userBadge.create({
            data: {
              userId,
              badgeId: badgeExists.id
            }
          });
        } else if (badge.read && totalRead >= badge.read) {
          await prisma.userBadge.create({
            data: {
              userId,
              badgeId: badgeExists.id
            }
          });
        }
      }
    }
  } catch (error) {
    console.error('Badge eligibility check error:', error);
  }
}

module.exports = router;
