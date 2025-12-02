const express = require('express');
const router = express.Router();

/**
 * GET /api/app/version
 * Returns the minimum required app version
 * This endpoint is used to force users to update their app
 */
router.get('/version', (req, res) => {
  try {
    // Minimum required version - update this when you want to force an update
    // Format: "major.minor.patch" (e.g., "1.0.6")
    const MINIMUM_REQUIRED_VERSION = '1.0.6';
    
    // Current latest version (optional, for display purposes)
    const LATEST_VERSION = '1.0.6';
    
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
        updateRequired: true, // Frontend will check if user's version >= minimumRequiredVersion
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

