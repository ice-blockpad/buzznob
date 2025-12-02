const express = require('express');
const router = express.Router();

/**
 * GET /api/app/update-required
 * Simple endpoint that returns update message for old apps
 * Old apps can call this to get a clear update message
 */
router.get('/update-required', (req, res) => {
  const MINIMUM_REQUIRED_VERSION = '1.0.6';
  const APP_STORE_URLS = {
    ios: 'https://apps.apple.com/app/buzznob/id123456789',
    android: 'https://play.google.com/store/apps/details?id=com.buzznob.mobile',
  };
  
  const updateMessage = `⚠️ UPDATE REQUIRED ⚠️\n\n` +
    `Your app version is outdated and no longer supported.\n\n` +
    `Please update to version ${MINIMUM_REQUIRED_VERSION} or later to continue using BUZZNOB.\n\n` +
    `To update:\n` +
    `1. Open your App Store (iOS) or Play Store (Android)\n` +
    `2. Search for "BUZZNOB"\n` +
    `3. Tap "Update" or "Install"\n\n` +
    `The app will not work until you update.`;
  
  res.status(426).json({
    success: false,
    error: 'APP_UPDATE_REQUIRED',
    message: updateMessage,
    code: 'UPDATE_REQUIRED',
    minimumVersion: MINIMUM_REQUIRED_VERSION,
    appStoreUrls: APP_STORE_URLS
  });
});

/**
 * GET /api/app/version
 * Returns the minimum required app version
 * This endpoint is used to force users to update their app
 */
router.get('/version', (req, res) => {
  try {
    // Minimum required version - update this when you want to force an update
    // Format: "major.minor.patch" (e.g., "1.0.7")
    const MINIMUM_REQUIRED_VERSION = '1.0.7';
    
    // Current latest version (optional, for display purposes)
    const LATEST_VERSION = '1.0.7';
    
    // App store URLs (update these with your actual store URLs)
    const APP_STORE_URLS = {
      ios: 'https://apps.apple.com/app/buzznob/id123456789', // Update with your iOS App Store URL
      android: 'https://play.google.com/store/apps/details?id=com.buzznob.mobile', // Update with your Android Play Store URL
    };
    
    res.json({
      success: true,
      data: {
        minimumRequiredVersion: MINIMUM_REQUIRED_VERSION,
        latestVersion: LATEST_VERSION,
        appStoreUrls: APP_STORE_URLS,
        updateRequired: true, // Set to false if you want to allow older versions temporarily
      }
    });
  } catch (error) {
    console.error('Error getting app version info:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get app version information'
    });
  }
});

module.exports = router;

