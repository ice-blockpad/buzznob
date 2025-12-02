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
  // Skip version check for:
  // - Health check endpoint
  // - App version endpoint itself (so new apps can check)
  // - Auth endpoints (so users can at least try to login and see the error)
  if (
    req.path === '/health' ||
    req.path === '/api/app/version' ||
    req.path.startsWith('/api/auth')
  ) {
    return next();
  }

  // Get app version from header
  const appVersion = req.headers['x-app-version'];
  
  // If no version header is sent, allow the request (for backward compatibility)
  // But log it for monitoring
  if (!appVersion) {
    console.warn('⚠️  API request without X-App-Version header:', req.method, req.path);
    return next();
  }

  // Check if version is supported
  if (!isVersionSupported(appVersion, MINIMUM_REQUIRED_VERSION)) {
    console.warn(`🚫 Blocked request from old app version: ${appVersion} (minimum: ${MINIMUM_REQUIRED_VERSION})`);
    
    return res.status(426).json({
      success: false,
      error: 'APP_UPDATE_REQUIRED',
      message: `App update required. Please update to the latest version.`,
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

