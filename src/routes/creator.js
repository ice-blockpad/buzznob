const express = require('express');
const { prisma } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');
const upload = require('../middleware/upload');

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
      readTimeEstimate,
      isFeatured
    } = req.body;

    // Parse numeric values from FormData
    const parsedPointsValue = parseInt(pointsValue) || 10;
    const parsedReadTimeEstimate = parseInt(readTimeEstimate) || 5;
    const parsedIsFeatured = isFeatured === 'true' || isFeatured === true;

    // Handle image data
    let imageData = null;
    let imageType = null;
    let imageUrl = null;
    
    if (req.body.imageData) {
      imageData = req.body.imageData;
      imageType = req.body.imageType || 'image/jpeg';
      
      // Check image size
      const base64Size = imageData.length;
      const estimatedSizeKB = Math.round((base64Size * 0.75) / 1024);
      
      if (estimatedSizeKB > 200) {
        return res.status(400).json({
          success: false,
          error: 'IMAGE_TOO_LARGE',
          message: `Image size is ${estimatedSizeKB}KB. Maximum allowed size is 200KB.`
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

    if (!imageData) {
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
        readTimeEstimate: parsedReadTimeEstimate,
        isFeatured: parsedIsFeatured,
        imageUrl: imageUrl || null,
        imageData: imageData || null,
        imageType: imageType || null,
        status: 'pending',
        authorId: userId
      }
    });

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

// Get creator's articles
router.get('/articles', authenticateToken, requireCreator, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status; // 'approved', 'rejected', 'pending', or null for all
    const skip = (page - 1) * limit;

    const where = {
      authorId: userId
    };

    if (status) {
      where.status = status;
    }

    const articles = await prisma.article.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
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
      'pointsValue',
      'readTimeEstimate'
    ];

    // Only update provided fields
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        if (field === 'pointsValue' || field === 'readTimeEstimate') {
          updateData[field] = parseInt(req.body[field]) || (field === 'pointsValue' ? 10 : 5);
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
