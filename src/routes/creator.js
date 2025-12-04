const express = require('express');
const { prisma } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');
const upload = require('../middleware/upload');
const cacheService = require('../services/cacheService');
const { parsePaginationParams, buildCursorQuery, buildOffsetQuery, buildPaginationResponse, buildPaginationResponseWithTotal } = require('../utils/pagination');

const router = express.Router();

// Middleware to check creator role
const requireCreator = (req, res, next) => {
  if (req.user.role !== 'creator' && req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'ACCESS_DENIED',
      message: 'Creator access required'
    });
  }
  next();
};

// Submit article for review (creator)
router.post('/articles', authenticateToken, requireCreator, upload.fields([{ name: 'image', maxCount: 1 }]), async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    console.log('=== Creator Article Submission ===');
    console.log('User ID:', userId);
    console.log('User Role:', userRole);

    const {
      title,
      content,
      category,
      sourceName,
      sourceUrl,
      pointsValue,
      isFeatured
    } = req.body;

    // Parse numeric values from FormData
    const parsedPointsValue = parseInt(pointsValue) || 5;
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
      
      // Check image size
      const base64Size = finalImageData.length;
      const estimatedSizeKB = Math.round((base64Size * 0.75) / 1024);
      
      if (estimatedSizeKB > 200) {
        return res.status(400).json({
          success: false,
          error: 'IMAGE_TOO_LARGE',
          message: `Image size is ${estimatedSizeKB}KB. Maximum allowed size is 200KB.`
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
    }

    // Validate required fields
    if (!title || !content || !category) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELDS',
        message: 'Title, content, and category are required'
      });
    }

    if (!finalImageUrl && !finalImageData) {
      return res.status(400).json({
        success: false,
        error: 'IMAGE_REQUIRED',
        message: 'Featured image is required for all articles'
      });
    }

    // Create article with pending status
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
        status: 'pending',
        authorId: userId
      }
    });

    // Write-through cache: Invalidate creator articles cache SYNCHRONOUSLY (new article added)
    try {
      await cacheService.deletePattern(`creator:articles:${userId}:*`);
    } catch (err) {
      // Non-blocking: Log error but don't fail the request
      console.error('Error invalidating creator articles cache:', err);
    }

    res.json({
      success: true,
      message: 'Article submitted for review successfully',
      data: { article }
    });

  } catch (error) {
    console.error('Submit article error:', error);
    res.status(500).json({
      success: false,
      error: 'ARTICLE_SUBMIT_ERROR',
      message: 'Failed to submit article for review'
    });
  }
});

// Get creator's articles (with write-through cache)
router.get('/articles', authenticateToken, requireCreator, async (req, res) => {
  try {
    const userId = req.user.id;
    const pagination = parsePaginationParams(req);
    const status = req.query.status; // 'approved', 'rejected', 'pending', or null for all

    // Create cache key based on user, cursor/offset, limit, and status
    const cacheKey = `creator:articles:${userId}:${pagination.cursor || pagination.offset || 'initial'}:${pagination.limit}:${status || 'all'}`;

    // Write-through cache: Get from cache, or fetch from DB and cache
    const result = await cacheService.getOrSet(cacheKey, async () => {
      const baseWhere = {
        authorId: userId
      };

      if (status) {
        baseWhere.status = status;
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
          include: {
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
      } else {
        // Offset-based pagination (backward compatibility)
        const offsetQuery = buildOffsetQuery(pagination, 'createdAt', 'desc');
        articles = await prisma.article.findMany({
          where: baseWhere,
          orderBy: offsetQuery.orderBy,
          skip: offsetQuery.skip,
          take: offsetQuery.take,
          include: {
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
        totalCount = await prisma.article.count({ where: baseWhere });
      }

      // Build pagination response
      let paginationResponse;
      if (pagination.hasCursor || (!pagination.hasOffset && !pagination.hasCursor)) {
        paginationResponse = buildPaginationResponse(articles, pagination, 'id');
      } else {
        paginationResponse = buildPaginationResponseWithTotal(articles, pagination, totalCount);
      }

      return {
        articles: paginationResponse.data,
        ...paginationResponse
      };
    }, 600); // 10 minutes TTL (write-through cache with safety net)

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Get creator articles error:', error);
    res.status(500).json({
      success: false,
      error: 'CREATOR_ARTICLES_ERROR',
      message: 'Failed to fetch creator articles'
    });
  }
});

// Update article (creator - only rejected articles can be updated)
router.put('/articles/:id', authenticateToken, requireCreator, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check if article exists and belongs to creator
    const article = await prisma.article.findFirst({
      where: {
        id,
        authorId: userId
      }
    });

    if (!article) {
      return res.status(404).json({
        success: false,
        error: 'ARTICLE_NOT_FOUND',
        message: 'Article not found or you do not have permission to edit it'
      });
    }

    // Only rejected articles can be updated
    if (article.status !== 'rejected') {
      return res.status(400).json({
        success: false,
        error: 'ARTICLE_NOT_EDITABLE',
        message: 'Only rejected articles can be edited and resubmitted'
      });
    }

    const updateData = {};
    const allowedFields = [
      'title',
      'content',
      'category',
      'sourceName',
      'sourceUrl',
      'pointsValue'
    ];

    // Only update provided fields
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        if (field === 'pointsValue') {
          updateData[field] = parseInt(req.body[field]) || 10;
        } else if (field === 'category') {
          updateData[field] = req.body[field].toUpperCase();
        } else {
          updateData[field] = req.body[field];
        }
      }
    });

    // Reset status to pending when article is updated
    updateData.status = 'pending';
    updateData.rejectionReason = null;
    updateData.reviewedBy = null;
    updateData.reviewedAt = null;

    const updatedArticle = await prisma.article.update({
      where: { id },
      data: updateData
    });

    // Write-through cache: Invalidate creator articles cache SYNCHRONOUSLY (article updated)
    try {
      await cacheService.deletePattern(`creator:articles:${userId}:*`);
    } catch (err) {
      // Non-blocking: Log error but don't fail the request
      console.error('Error invalidating creator articles cache:', err);
    }

    res.json({
      success: true,
      message: 'Article updated and resubmitted for review',
      data: updatedArticle
    });

  } catch (error) {
    console.error('Update creator article error:', error);
    res.status(500).json({
      success: false,
      error: 'ARTICLE_UPDATE_ERROR',
      message: 'Failed to update article'
    });
  }
});

// Delete article (creator - only pending or rejected articles can be deleted)
router.delete('/articles/:id', authenticateToken, requireCreator, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check if article exists and belongs to creator
    const article = await prisma.article.findFirst({
      where: {
        id,
        authorId: userId
      }
    });

    if (!article) {
      return res.status(404).json({
        success: false,
        error: 'ARTICLE_NOT_FOUND',
        message: 'Article not found or you do not have permission to delete it'
      });
    }

    // Only pending or rejected articles can be deleted
    if (article.status === 'published' || article.status === 'approved') {
      return res.status(400).json({
        success: false,
        error: 'ARTICLE_NOT_DELETABLE',
        message: 'Published or approved articles cannot be deleted'
      });
    }

    await prisma.article.delete({
      where: { id }
    });

    // Write-through cache: Invalidate creator articles cache SYNCHRONOUSLY (article deleted)
    try {
      await cacheService.deletePattern(`creator:articles:${userId}:*`);
      // Also invalidate public articles cache if article was published
      if (article.status === 'published') {
        await cacheService.deletePattern(`public:articles:${userId}:*`);
        await cacheService.delete(`public:profile:${userId}`);
      }
    } catch (err) {
      // Non-blocking: Log error but don't fail the request
      console.error('Error invalidating caches after article delete:', err);
    }

    res.json({
      success: true,
      message: 'Article deleted successfully'
    });

  } catch (error) {
    console.error('Delete creator article error:', error);
    res.status(500).json({
      success: false,
      error: 'ARTICLE_DELETE_ERROR',
      message: 'Failed to delete article'
    });
  }
});

module.exports = router;
