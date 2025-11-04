const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');
const { generatePresignedUrl, verifyConfig } = require('../services/r2Service');

const router = express.Router();

// Verify R2 configuration on startup
try {
  verifyConfig();
  console.log('✅ R2 service configured successfully');
} catch (error) {
  console.error('❌ R2 service configuration error:', error.message);
  console.warn('⚠️  Image uploads will not work until R2 is properly configured');
}

/**
 * POST /api/uploads/sign
 * Generate presigned URL for direct upload to Cloudflare R2
 * 
 * Body: {
 *   type: 'profile' | 'article',
 *   mimeType: 'image/jpeg' | 'image/png' | 'image/webp' (webp allowed for articles only),
 *   fileSize: number (bytes),
 *   targetId?: string (optional - for articles, can be provided later)
 * }
 */
router.post('/sign', authenticateToken, async (req, res) => {
  try {
    const { type, mimeType, fileSize, targetId } = req.body;

    // Validate required fields
    if (!type || !mimeType || !fileSize) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELDS',
        message: 'type, mimeType, and fileSize are required',
      });
    }

    // Validate type
    if (!['profile', 'article'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_TYPE',
        message: 'type must be "profile" or "article"',
      });
    }

    // Use user ID for profile, or provided targetId for articles
    const id = type === 'profile' ? req.user.id : (targetId || req.user.id);

    console.log('Generating presigned URL:', { type, id, mimeType, fileSize });

    // Generate presigned URL
    const result = await generatePresignedUrl(type, id, mimeType, fileSize);
    
    console.log('Presigned URL generated successfully:', {
      key: result.key,
      expiresAt: new Date(result.expiresAt).toISOString(),
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Generate presigned URL error:', error);
    
    // Handle specific error types
    if (error.message.includes('Invalid MIME type')) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_MIME_TYPE',
        message: error.message,
      });
    }

    if (error.message.includes('File size exceeds')) {
      return res.status(400).json({
        success: false,
        error: 'FILE_TOO_LARGE',
        message: error.message,
      });
    }

    res.status(500).json({
      success: false,
      error: 'PRESIGNED_URL_ERROR',
      message: error.message || 'Failed to generate presigned URL',
    });
  }
});

module.exports = router;

