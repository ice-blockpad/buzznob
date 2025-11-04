const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

// Initialize R2 client (Cloudflare R2 is S3-compatible)
// Note: R2 requires forcePathStyle for presigned URLs to work correctly
const r2Client = new S3Client({
  region: process.env.R2_REGION || 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  forcePathStyle: true, // Required for R2 presigned URLs
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const R2_BUCKET = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_BASE_URL = process.env.R2_PUBLIC_BASE_URL; // Your custom domain

// Allowed MIME types
const ALLOWED_MIME_TYPES = {
  profile: ['image/jpeg', 'image/png'], // JPEG and PNG only
  article: ['image/jpeg', 'image/png', 'image/webp'], // JPEG, PNG, and WebP for articles
};

// File size limits (in bytes)
const MAX_FILE_SIZES = {
  profile: 200 * 1024, // 200KB
  article: 200 * 1024, // 200KB
};

/**
 * Generate a unique object key with timestamp
 * Format: {type}/{id}/{timestamp}_{random}.{ext}
 */
function generateObjectKey(type, id, mimeType) {
  const timestamp = Date.now();
  const randomString = crypto.randomBytes(6).toString('hex');
  
  // Map MIME type to file extension
  const mimeToExt = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  const extension = mimeToExt[mimeType.toLowerCase()] || 'jpg';
  
  if (type === 'profile') {
    return `users/${id}/profile/${timestamp}_${randomString}.${extension}`;
  } else if (type === 'article') {
    return `articles/${id}/images/${timestamp}_${randomString}.${extension}`;
  }
  
  throw new Error(`Invalid upload type: ${type}`);
}

/**
 * Generate presigned URL for direct upload to R2
 * @param {string} type - 'profile' or 'article'
 * @param {string} id - User ID or Article ID
 * @param {string} mimeType - MIME type (e.g., 'image/jpeg')
 * @param {number} fileSize - File size in bytes
 * @returns {Promise<{uploadUrl: string, publicUrl: string, key: string, expiresAt: number}>}
 */
async function generatePresignedUrl(type, id, mimeType, fileSize) {
  // Validate type
  if (!['profile', 'article'].includes(type)) {
    throw new Error('Invalid upload type. Must be "profile" or "article"');
  }

  // Validate MIME type
  const allowedTypes = ALLOWED_MIME_TYPES[type];
  if (!allowedTypes.includes(mimeType.toLowerCase())) {
    throw new Error(`Invalid MIME type. Allowed types: ${allowedTypes.join(', ')}`);
  }

  // Validate file size
  const maxSize = MAX_FILE_SIZES[type];
  if (fileSize > maxSize) {
    throw new Error(`File size exceeds maximum allowed size of ${maxSize / 1024}KB`);
  }

  // Generate object key
  const key = generateObjectKey(type, id, mimeType);

  // Generate presigned URL (expires in 5 minutes)
  // CRITICAL: Do NOT set ContentType in PutObjectCommand
  // If ContentType is set here, it's included in the signature and must match EXACTLY
  // React Native fetch may add/modify headers, causing signature mismatch → AccessDenied
  // We validate MIME type on backend before generating URL, but don't enforce in signature
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    // Explicitly don't set ContentType - client will set it in request headers
    // This allows React Native to work without signature mismatches
  });

  const expiresIn = 5 * 60; // 5 minutes
  const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn });
  
  console.log('Generated presigned URL:', {
    key,
    mimeType,
    fileSize,
    bucket: R2_BUCKET,
    expiresIn: `${expiresIn}s`,
  });

  // Generate public URL (using custom domain)
  const publicUrl = `${R2_PUBLIC_BASE_URL}/${key}`;

  return {
    uploadUrl,
    publicUrl,
    key,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

/**
 * Verify R2 configuration
 */
function verifyConfig() {
  const required = [
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
    'R2_PUBLIC_BASE_URL',
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing R2 configuration: ${missing.join(', ')}`);
  }

  return true;
}

module.exports = {
  generatePresignedUrl,
  verifyConfig,
  MAX_FILE_SIZES,
  ALLOWED_MIME_TYPES,
};

