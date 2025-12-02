/**
 * Version Check Middleware
 * Blocks API requests from old app versions
 * This works even for old app versions that don't have the forced update screen
 */

// Minimum required app version
const MINIMUM_REQUIRED_VERSION = '1.0.6';

/**
 * Compare two version strings
 * Returns: -1 if v1 < v2, 0 if v1 === v2, 1 if v1 > v2
 */
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  
  const maxLength = Math.max(parts1.length, parts2.length);
  
  for (let i = 0; i < maxLength; i++) {
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;
    
    if (part1 < part2) return -1;
    if (part1 > part2) return 1;
  }
  
  return 0;
}

/**
 * Check if version meets minimum requirement
 */
function isVersionSupported(version, minimumVersion) {
  return compareVersions(version, minimumVersion) >= 0;
}

/**
 * Version check middleware
 * Checks X-App-Version header and blocks old versions
 */
const checkAppVersion = (req, res, next) => {
  // Debug: Log the actual path to verify (uncomment to debug)
  // console.log('Version check - req.path:', req.path, 'req.originalUrl:', req.originalUrl, 'req.baseUrl:', req.baseUrl);
  
  // Skip version check for:
  // - Health check endpoint
  // - App version endpoint itself (so new apps can check)
  // - Auth endpoints (so users can at least try to login and see the error)
  // - Public referral endpoint (used by referral page website, not mobile app)
  // Check both formats since middleware is mounted at /api (req.path is relative to mount point)
  if (
    req.path === '/health' ||
    req.path === '/api/app/version' ||
    req.path === '/app/version' ||
    req.path.startsWith('/api/auth') ||
    req.path.startsWith('/auth') ||
    req.path === '/api/referrals/user-by-code' ||
    req.path === '/referrals/user-by-code' ||
    req.path === '/api/auth/check-username' ||
    req.path === '/auth/check-username'
  ) {
    return next();
  }

  // Get app version from header
  const appVersion = req.headers['x-app-version'];
  
  // If no version header is sent, check if we should allow it
  // During transition period (when minimum version is low like 1.0.4), allow requests without header
  // This allows users with versions 1.0.4-1.0.5 who installed before header code was added
  if (!appVersion) {
    // If minimum version is 1.0.4 or lower, allow requests without header (transition period)
    // This allows 1.0.4 and 1.0.5 users who don't have the header code yet
    const minVersionParts = MINIMUM_REQUIRED_VERSION.split('.').map(Number);
    const isTransitionPeriod = minVersionParts[0] === 1 && minVersionParts[1] === 0 && minVersionParts[2] <= 4;
    
    if (isTransitionPeriod) {
      // Allow request during transition period (for versions 1.0.4-1.0.5 without header code)
      console.warn(`⚠️  Allowing request without X-App-Version header (transition period, min: ${MINIMUM_REQUIRED_VERSION}):`, req.method, req.path);
      return next();
    } else {
      // Block requests without header when minimum version is higher (strict enforcement)
      console.warn(`🚫 Blocked request without X-App-Version header (likely old app):`, req.method, req.path);
      
      return res.status(426).json({
        success: false,
        error: 'APP_UPDATE_REQUIRED',
        message: `App update required. Please update to version ${MINIMUM_REQUIRED_VERSION} or later.`,
        code: 'UPDATE_REQUIRED',
        minimumVersion: MINIMUM_REQUIRED_VERSION,
        currentVersion: 'unknown',
        appStoreUrls: {
          ios: 'https://apps.apple.com/app/buzznob/id123456789', // Update with your iOS App Store URL
          android: 'https://play.google.com/store/apps/details?id=com.buzznob.mobile', // Update with your Android Play Store URL
        }
      });
    }
  }

  // Check if version is supported
  if (!isVersionSupported(appVersion, MINIMUM_REQUIRED_VERSION)) {
    console.warn(`🚫 Blocked request from old app version: ${appVersion} (minimum: ${MINIMUM_REQUIRED_VERSION})`);
    
    return res.status(426).json({
      success: false,
      error: 'APP_UPDATE_REQUIRED',
      message: `App update required. Please update to version ${MINIMUM_REQUIRED_VERSION} or later.`,
      code: 'UPDATE_REQUIRED',
      minimumVersion: MINIMUM_REQUIRED_VERSION,
      currentVersion: appVersion,
      appStoreUrls: {
        ios: 'https://apps.apple.com/app/buzznob/id123456789', // Update with your iOS App Store URL
        android: 'https://play.google.com/store/apps/details?id=com.buzznob.mobile', // Update with your Android Play Store URL
      }
    });
  }

  // Version is supported, continue
  next();
};

module.exports = {
  checkAppVersion,
  MINIMUM_REQUIRED_VERSION
};

