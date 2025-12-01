const express = require('express');
const { prisma } = require('../config/database');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');
const { deduplicateRequest } = require('../middleware/deduplication');
const cacheService = require('../services/cacheService');
const { refreshUserAndLeaderboardCaches } = require('../services/cacheRefreshHelpers');
const { parsePaginationParams, buildCursorQuery, buildOffsetQuery, buildPaginationResponse, buildPaginationResponseWithTotal } = require('../utils/pagination');

const router = express.Router();

// Get trending articles (with write-through cache)
router.get('/trending', optionalAuth, async (req, res) => {
  try {
    const pagination = parsePaginationParams(req, { defaultLimit: 10, maxLimit: 50 });
    const cacheKey = `articles:trending:${pagination.limit}:${pagination.cursor || 'initial'}`;

    // Write-through cache: Get from cache, or fetch from DB and cache
    const articlesWithReadCount = await cacheService.getOrSet(cacheKey, async () => {
      // Build query with cursor support
      const cursorQuery = buildCursorQuery(pagination, 'id', 'desc');
      const where = {
        isFeatured: true,
        status: 'published',
        ...cursorQuery.where
      };

      const articles = await prisma.article.findMany({
        where,
        orderBy: cursorQuery.orderBy,
        take: cursorQuery.take,
        select: {
          id: true,
          title: true,
          content: true,
          category: true,
          sourceUrl: true,
          sourceName: true,
          pointsValue: true,
          isFeatured: true,
          manualReadCount: true,
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

      // Get read counts for all articles
      const articleIds = articles.map(a => a.id);
      const readCountMap = new Map();
      
      if (articleIds.length > 0) {
        const readCounts = await prisma.userActivity.groupBy({
          by: ['articleId'],
          where: {
            articleId: { in: articleIds }
          },
          _count: {
            articleId: true
          }
        });

        readCounts.forEach(item => {
          readCountMap.set(item.articleId, item._count.articleId);
        });
      }

      return articles.map(article => {
        const actualCount = readCountMap.get(article.id) || 0;
        const readCount = article.manualReadCount !== null ? article.manualReadCount : actualCount;
        return {
          ...article,
          readCount
        };
      });
    }, 600); // 10 minutes TTL (write-through cache with safety net)

    res.json({
      success: true,
      data: { articles: articlesWithReadCount }
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

// Get featured articles (with write-through cache)
router.get('/featured', optionalAuth, async (req, res) => {
  try {
    const pagination = parsePaginationParams(req, { defaultLimit: 10, maxLimit: 50 });
    const cacheKey = `articles:featured:${pagination.limit}:${pagination.cursor || 'initial'}`;

    // Write-through cache: Get from cache, or fetch from DB and cache
    const articlesWithReadCount = await cacheService.getOrSet(cacheKey, async () => {
      // Build query with cursor support
      const cursorQuery = buildCursorQuery(pagination, 'id', 'desc');
      const where = {
        isFeaturedArticle: true,
        status: 'published',
        ...cursorQuery.where
      };

      const articles = await prisma.article.findMany({
        where,
        orderBy: cursorQuery.orderBy,
        take: cursorQuery.take,
        select: {
          id: true,
          title: true,
          content: true,
          category: true,
          sourceUrl: true,
          sourceName: true,
          pointsValue: true,
          isFeatured: true,
          isFeaturedArticle: true,
          manualReadCount: true,
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

      // Get read counts for all articles
      const articleIds = articles.map(a => a.id);
      const readCountMap = new Map();
      
      if (articleIds.length > 0) {
        const readCounts = await prisma.userActivity.groupBy({
          by: ['articleId'],
          where: {
            articleId: { in: articleIds }
          },
          _count: {
            articleId: true
          }
        });

        readCounts.forEach(item => {
          readCountMap.set(item.articleId, item._count.articleId);
        });
      }

      return articles.map(article => {
        const actualCount = readCountMap.get(article.id) || 0;
        const readCount = article.manualReadCount !== null ? article.manualReadCount : actualCount;
        return {
          ...article,
          readCount
        };
      });
    }, 600); // 10 minutes TTL (write-through cache with safety net)

    const paginationResponse = buildPaginationResponse(articlesWithReadCount, pagination, 'id');

    res.json({
      success: true,
      data: {
        articles: paginationResponse.data,
        ...paginationResponse
      }
    });

  } catch (error) {
    console.error('Get featured articles error:', error);
    res.status(500).json({
      success: false,
      error: 'FEATURED_ARTICLES_FETCH_ERROR',
      message: 'Failed to fetch featured articles'
    });
  }
});

// Get articles with pagination and filtering
router.get('/', optionalAuth, async (req, res) => {
  try {
    const pagination = parsePaginationParams(req);
    const category = req.query.category;
    const featured = req.query.featured === 'true';

    const baseWhere = {
      status: 'published' // Only show published articles to public
    };
    if (category) baseWhere.category = category;
    if (featured) baseWhere.isFeatured = true;

    // Use cursor-based pagination if cursor provided, otherwise use offset
    let articles;
    let totalCount = null;

    if (pagination.hasCursor || (!pagination.hasOffset && !pagination.hasCursor)) {
      // Cursor-based pagination (recommended)
      const cursorQuery = buildCursorQuery(pagination, 'id', 'desc');
      const where = {
        ...baseWhere,
        ...cursorQuery.where
      };

      articles = await prisma.article.findMany({
        where,
        orderBy: cursorQuery.orderBy,
        take: cursorQuery.take,
        select: {
          id: true,
          title: true,
          content: true,
          category: true,
          sourceUrl: true,
          sourceName: true,
          pointsValue: true,
          isFeatured: true,
          manualReadCount: true,
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
    } else {
      // Offset-based pagination (backward compatibility)
      const offsetQuery = buildOffsetQuery(pagination, 'id', 'desc');
      articles = await prisma.article.findMany({
        where: baseWhere,
        orderBy: offsetQuery.orderBy,
        skip: offsetQuery.skip,
        take: offsetQuery.take,
        select: {
          id: true,
          title: true,
          content: true,
          category: true,
          sourceUrl: true,
          sourceName: true,
          pointsValue: true,
          isFeatured: true,
          manualReadCount: true,
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
      totalCount = await prisma.article.count({ where: baseWhere });
    }

    // Get read counts for all articles
    const articleIds = articles.map(a => a.id);
    const readCounts = await prisma.userActivity.groupBy({
      by: ['articleId'],
      where: {
        articleId: { in: articleIds }
      },
      _count: {
        articleId: true
      }
    });

    const readCountMap = new Map();
    readCounts.forEach(item => {
      readCountMap.set(item.articleId, item._count.articleId);
    });

    // Check if user has read each article (if authenticated)
    let articlesWithReadStatus = articles;
    if (req.user && req.user.id) {
      const userActivities = await prisma.userActivity.findMany({
        where: {
          userId: req.user.id,
          articleId: { in: articleIds }
        },
        select: {
          articleId: true
        }
      });
      
      const readArticleIds = new Set(userActivities.map(activity => activity.articleId));
      articlesWithReadStatus = articles.map(article => {
        const actualCount = readCountMap.get(article.id) || 0;
        const readCount = article.manualReadCount !== null ? article.manualReadCount : actualCount;
        return {
          ...article,
          isRead: readArticleIds.has(article.id),
          readCount
        };
      });
    } else {
      // If not authenticated, all articles are unread
      articlesWithReadStatus = articles.map(article => {
        const actualCount = readCountMap.get(article.id) || 0;
        const readCount = article.manualReadCount !== null ? article.manualReadCount : actualCount;
        return {
          ...article,
          isRead: false,
          readCount
        };
      });
    }

    // Build pagination response
    let paginationResponse;
    if (pagination.hasCursor || (!pagination.hasOffset && !pagination.hasCursor)) {
      // Cursor-based response
      paginationResponse = buildPaginationResponse(articlesWithReadStatus, pagination, 'id');
    } else {
      // Offset-based response with total count
      paginationResponse = buildPaginationResponseWithTotal(articlesWithReadStatus, pagination, totalCount);
    }

    res.json({
      success: true,
      data: {
        articles: paginationResponse.data,
        ...paginationResponse
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
    const pagination = parsePaginationParams(req);

    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'SEARCH_QUERY_REQUIRED',
        message: 'Search query is required'
      });
    }

    const baseWhere = {
      status: 'published', // Only search published articles
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { content: { contains: query, mode: 'insensitive' } }
      ]
    };

    if (category) {
      baseWhere.category = category;
    }

    // Use cursor-based pagination if cursor provided, otherwise use offset
    let articles;
    let totalCount = null;

    if (pagination.hasCursor || (!pagination.hasOffset && !pagination.hasCursor)) {
      // Cursor-based pagination (recommended)
      const cursorQuery = buildCursorQuery(pagination, 'id', 'desc');
      const where = {
        ...baseWhere,
        ...cursorQuery.where
      };

      articles = await prisma.article.findMany({
        where,
        orderBy: cursorQuery.orderBy,
        take: cursorQuery.take,
      select: {
        id: true,
        title: true,
        content: true,
        category: true,
        sourceUrl: true,
        sourceName: true,
        pointsValue: true,
        isFeatured: true,
        manualReadCount: true,
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
    } else {
      // Offset-based pagination (backward compatibility)
      const offsetQuery = buildOffsetQuery(pagination, 'id', 'desc');
      articles = await prisma.article.findMany({
        where: baseWhere,
        orderBy: offsetQuery.orderBy,
        skip: offsetQuery.skip,
        take: offsetQuery.take,
        select: {
          id: true,
          title: true,
          content: true,
          category: true,
          sourceUrl: true,
          sourceName: true,
          pointsValue: true,
          isFeatured: true,
          manualReadCount: true,
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
      totalCount = await prisma.article.count({ where: baseWhere });
    }

    // Get read counts for all articles
    const articleIds = articles.map(a => a.id);
    const readCounts = await prisma.userActivity.groupBy({
      by: ['articleId'],
      where: {
        articleId: { in: articleIds }
      },
      _count: {
        articleId: true
      }
    });

    const readCountMap = new Map();
    readCounts.forEach(item => {
      readCountMap.set(item.articleId, item._count.articleId);
    });

    // Check if user has read each article (if authenticated)
    let articlesWithReadStatus = articles;
    if (req.user && req.user.id) {
      const userActivities = await prisma.userActivity.findMany({
        where: {
          userId: req.user.id,
          articleId: { in: articleIds }
        },
        select: {
          articleId: true
        }
      });
      
      const readArticleIds = new Set(userActivities.map(activity => activity.articleId));
      articlesWithReadStatus = articles.map(article => {
        const actualCount = readCountMap.get(article.id) || 0;
        const readCount = article.manualReadCount !== null ? article.manualReadCount : actualCount;
        return {
          ...article,
          isRead: readArticleIds.has(article.id),
          readCount
        };
      });
    } else {
      // If not authenticated, all articles are unread
      articlesWithReadStatus = articles.map(article => {
        const actualCount = readCountMap.get(article.id) || 0;
        const readCount = article.manualReadCount !== null ? article.manualReadCount : actualCount;
        return {
          ...article,
          isRead: false,
          readCount
        };
      });
    }

    // Build pagination response
    let paginationResponse;
    if (pagination.hasCursor || (!pagination.hasOffset && !pagination.hasCursor)) {
      // Cursor-based response
      paginationResponse = buildPaginationResponse(articlesWithReadStatus, pagination, 'id');
    } else {
      // Offset-based response with total count
      paginationResponse = buildPaginationResponseWithTotal(articlesWithReadStatus, pagination, totalCount);
    }

    res.json({
      success: true,
      data: {
        articles: paginationResponse.data,
        ...paginationResponse
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
    const pagination = parsePaginationParams(req);

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

    const baseWhere = {
      authorId: creatorId,
      status: 'published' // Only show published articles
    };

    // Use cursor-based pagination if cursor provided, otherwise use offset
    let articles;
    let totalCount = null;

    if (pagination.hasCursor || (!pagination.hasOffset && !pagination.hasCursor)) {
      // Cursor-based pagination (recommended)
      const cursorQuery = buildCursorQuery(pagination, 'id', 'desc');
      const where = {
        ...baseWhere,
        ...cursorQuery.where
      };

      articles = await prisma.article.findMany({
        where,
        orderBy: cursorQuery.orderBy,
        take: cursorQuery.take,
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
          status: true,
          createdAt: true,
          publishedAt: true
        }
      });
    } else {
      // Offset-based pagination (backward compatibility)
      const offsetQuery = buildOffsetQuery(pagination, 'id', 'desc');
      articles = await prisma.article.findMany({
        where: baseWhere,
        orderBy: offsetQuery.orderBy,
        skip: offsetQuery.skip,
        take: offsetQuery.take,
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
          status: true,
          createdAt: true,
          publishedAt: true
        }
      });
      totalCount = await prisma.article.count({ where: baseWhere });
    }

    // Build pagination response
    let paginationResponse;
    if (pagination.hasCursor || (!pagination.hasOffset && !pagination.hasCursor)) {
      // Cursor-based response
      paginationResponse = buildPaginationResponse(articles, pagination, 'id');
    } else {
      // Offset-based response with total count
      paginationResponse = buildPaginationResponseWithTotal(articles, pagination, totalCount);
    }

    res.json({
      success: true,
      data: {
        articles: paginationResponse.data,
        ...paginationResponse
      }
    });

  } catch (error) {
    console.error('Get articles by creator error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: 'GET_CREATOR_ARTICLES_ERROR',
      message: 'Failed to get creator articles',
      ...(process.env.NODE_ENV === 'development' && { details: error.message })
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

    // Check if user already read this article (using ReadArticle for permanent duplicate prevention)
    const existingRead = await prisma.readArticle.findFirst({
      where: {
        userId,
        articleId: id
      }
    });

    if (existingRead) {
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

    // Use transaction to atomically create activity and update points
    // This prevents race conditions where user could read same article twice or bypass daily limit
    const activity = await prisma.$transaction(async (tx) => {
      // Re-fetch article inside transaction to prevent TOCTOU vulnerability
      // This ensures we use the current pointsValue even if admin updates it between initial fetch and transaction
      const articleInTx = await tx.article.findFirst({
        where: { 
          id,
          status: 'published' // Double-check article is still published
        },
        select: {
          id: true,
          pointsValue: true,
          status: true
        }
      });

      if (!articleInTx) {
        throw new Error('ARTICLE_NOT_FOUND_OR_UNPUBLISHED');
      }

      // Double-check if article already read within transaction (using ReadArticle)
      const existingReadInTx = await tx.readArticle.findFirst({
        where: {
          userId,
          articleId: id
        }
      });

      if (existingReadInTx) {
        throw new Error('ARTICLE_ALREADY_READ');
      }

      // Double-check daily limit within transaction
      const todayActivitiesInTx = await tx.userActivity.count({
        where: {
          userId,
          completedAt: {
            gte: today,
            lt: tomorrow
          }
        }
      });

      if (todayActivitiesInTx >= 3) {
        throw new Error('DAILY_ARTICLE_LIMIT_REACHED');
      }

      // Create ReadArticle record for permanent duplicate prevention
      await tx.readArticle.create({
        data: {
          userId,
          articleId: id
        }
      });

      // Create user activity and update points atomically using current pointsValue
      const newActivity = await tx.userActivity.create({
        data: {
          userId,
          articleId: id,
          pointsEarned: articleInTx.pointsValue, // Use pointsValue from transaction
          readDuration: readDuration || null
        }
      });

      // Update user points and count
      await tx.user.update({
        where: { id: userId },
        data: {
          points: {
            increment: articleInTx.pointsValue // Use pointsValue from transaction
          },
          totalArticlesReadCount: {
            increment: 1
          }
        }
      });

      return { activity: newActivity, pointsEarned: articleInTx.pointsValue };
    });

    // Check for badge eligibility
    await achievementsService.checkBadgeEligibility(userId);

    // Write-through cache: Refresh read count and user profile cache SYNCHRONOUSLY
    // This ensures cache is updated before response is sent, preventing stale data window
    // Note: Leaderboard cache is time-based (10 min TTL) and will update automatically
    try {
      // Refresh read count cache
      const readCount = await prisma.userActivity.count({
        where: { articleId: id }
      });
      const articleData = await prisma.article.findUnique({
        where: { id },
        select: { manualReadCount: true }
      });
      const actualCount = articleData?.manualReadCount !== null ? articleData.manualReadCount : readCount;
      await cacheService.writeThroughReadCount(id, async () => actualCount, 600); // 10 minutes TTL
      
      // Refresh user profile cache (points changed)
      // Leaderboard will update automatically every 10 minutes
      await refreshUserAndLeaderboardCaches(userId);
    } catch (err) {
      // Non-blocking: Log error but don't fail the request
      console.error('Error refreshing caches after article read:', err);
    }

    res.json({
      success: true,
      message: 'Article marked as read',
      data: {
        pointsEarned: activity.pointsEarned,
        totalPoints: req.user.points + activity.pointsEarned
      }
    });

  } catch (error) {
    console.error('Mark article as read error:', error);
    
    // Handle specific errors from transaction
    if (error.message === 'ARTICLE_NOT_FOUND_OR_UNPUBLISHED') {
      return res.status(404).json({
        success: false,
        error: 'ARTICLE_NOT_FOUND',
        message: 'Article not found or has been unpublished'
      });
    }
    
    if (error.message === 'ARTICLE_ALREADY_READ') {
      return res.status(400).json({
        success: false,
        error: 'ARTICLE_ALREADY_READ',
        message: 'Article has already been read'
      });
    }
    
    if (error.message === 'DAILY_ARTICLE_LIMIT_REACHED') {
      return res.status(400).json({
        success: false,
        error: 'DAILY_ARTICLE_LIMIT_REACHED',
        message: 'You have reached the daily reward limit of 3 articles. Come back tomorrow to earn more rewards!',
        data: {
          articlesReadToday: 3,
          dailyLimit: 3
        }
      });
    }
    
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

// Import achievements service
const achievementsService = require('../services/achievements');

module.exports = router;
