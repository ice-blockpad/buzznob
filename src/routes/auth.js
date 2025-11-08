const express = require('express');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { prisma } = require('../config/database');
const { generateToken, generateRefreshToken } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');
const pushNotificationService = require('../services/pushNotificationService');

const router = express.Router();
const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_CALLBACK_URL
);

// Generate unique referral code
function generateUniqueReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Google OAuth routes
router.get('/google', (req, res) => {
  // Allow passing a return URL via state (used to redirect back to frontend)
  const state = req.query.state || req.query.returnUrl || 'default';
  const authUrl = googleClient.generateAuthUrl({
    access_type: 'offline',
    scope: ['profile', 'email'],
    state
  });
  
  res.redirect(authUrl);
});

router.get('/google/callback', async (req, res) => {
  try {
    const { code, state, code_verifier } = req.query;
    
    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'AUTHORIZATION_CODE_MISSING',
        message: 'Authorization code is required'
      });
    }

    // Exchange code for tokens with PKCE support
    const tokenRequest = {
      code: code,
      redirect_uri: process.env.GOOGLE_CALLBACK_URL
    };

    // Add code verifier if provided (PKCE)
    if (code_verifier) {
      tokenRequest.code_verifier = code_verifier;
    }

    const { tokens } = await googleClient.getToken(tokenRequest);
    googleClient.setCredentials(tokens);

    // Get user info from Google
    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    
    const payload = ticket.getPayload();
    const { sub: googleId, email, name, given_name, family_name, picture } = payload;

    // Check if user exists by externalId (Google ID) only
    // Email is no longer unique - users can register freely with any auth type
    let user = await prisma.user.findUnique({
      where: { externalId: googleId }
    });

    if (!user) {
      // For new users, don't create account yet - store temporary session data
      // This will be used to create the account after profile completion and referral choice
      const tempSessionData = {
        externalId: googleId, // Use externalId instead of googleId
        email,
        displayName: name,
        firstName: given_name || name?.split(' ')[0] || '',
        lastName: family_name || name?.split(' ').slice(1).join(' ') || '',
        avatarUrl: picture,
        isNewUser: true
      };

      // For new users, redirect back to app with temp data
      // The app will handle the profile completion flow
      if (state && state !== 'default' && /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//i.test(state)) {
        const returnUrl = state;
        const userDataParam = encodeURIComponent(JSON.stringify(tempSessionData));
        const redirectTo = `${returnUrl}#accessToken=null&refreshToken=null&requiresProfileCompletion=true&userData=${userDataParam}`;
        return res.redirect(302, redirectTo);
      }

        // Default: return JSON response (mobile or direct API usage)
      return res.json({
        success: true,
        message: 'New user - profile completion required',
        data: {
          user: tempSessionData,
          accessToken: null, // No token until account is finalized
          refreshToken: null,
          requiresProfileCompletion: true
        }
      });
    } else {
      // Update last login
      user = await prisma.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date() }
      });
    }

    // Generate jwt tokens
    const accessToken = generateToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    // Store refresh token
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshToken,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
      }
    });

    // Create user session in database
    await prisma.userSession.create({
      data: {
        userId: user.id,
        accessToken: accessToken,
        refreshToken: refreshToken,
        deviceInfo: req.headers['user-agent'] || 'Unknown',
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.headers['user-agent'],
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
      }
    });

    // If a state return URL is provided, redirect back to frontend/app with tokens
    // Support both http/https URLs and custom app schemes (like buzznob://)
    if (state && state !== 'default' && /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//i.test(state)) {
      const returnUrl = state;
      const redirectTo = `${returnUrl}#accessToken=${encodeURIComponent(accessToken)}&refreshToken=${encodeURIComponent(refreshToken)}`;
      return res.redirect(302, redirectTo);
    }

    // Default: return JSON response (mobile or direct API usage)
    res.json({
      success: true,
      message: 'Authentication successful',
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          displayName: user.displayName,
          firstName: user.firstName,
          lastName: user.lastName,
          avatarUrl: user.avatarUrl,
          points: user.points,
          streakCount: user.streakCount,
          referralCode: user.referralCode,
          role: user.role,
          isActive: user.isActive,
          isVerified: user.isVerified,
          kycStatus: user.kycStatus
        },
        accessToken,
        refreshToken
      }
    });

  } catch (error) {
    console.error('Google OAuth error:', error);
    res.status(500).json({
      success: false,
      error: 'GOOGLE_OAUTH_ERROR',
      message: 'Google authentication failed'
    });
  }
});

// TEST ROUTE - Should always log
router.get('/test-user-exists', async (req, res) => {
  console.error('🚨🚨🚨 TEST ROUTE HIT 🚨🚨🚨');
  return res.json({ success: true, message: 'Test route works' });
});

// Lightweight existence check used by mobile pre-profile flow
// GET /auth/user-exists?externalId=...&email=...&particleUserId=...
router.get('/user-exists', async (req, res) => {
  // CRITICAL: This should ALWAYS log if the route is hit
  console.error('🚨🚨🚨 ROUTE HANDLER EXECUTED - user-exists 🚨🚨🚨');
  console.log('='.repeat(80));
  console.log('🔍 [ROUTE HANDLER] /user-exists endpoint HIT');
  console.log('🔍 Request method:', req.method);
  console.log('🔍 Request path:', req.path);
  console.log('🔍 Request originalUrl:', req.originalUrl);
  console.log('🔍 Request query:', JSON.stringify(req.query));
  console.log('🔍 Request headers:', JSON.stringify(req.headers, null, 2));
  console.log('='.repeat(80));
  
  try {
    const { particleUserId } = req.query;
    console.log('Extracted particleUserId:', particleUserId);
    
    if (!particleUserId) {
      console.log('❌ Missing particleUserId');
      return res.status(400).json({ success: false, message: 'particleUserId required' });
    }

    // Use findUnique since particleUserId is unique in schema
    const user = await prisma.user.findUnique({
      where: {
        particleUserId: particleUserId
      },
      select: { id: true, username: true, particleUserId: true },
    });

    const exists = !!user;
    console.log(`User existence check - particleUserId: ${particleUserId}, exists: ${exists}${user ? `, username: ${user.username}` : ''}`);
    console.log(`User existence check - Full response: ${JSON.stringify({ success: true, exists })}`);

    return res.json({ success: true, exists });
  } catch (error) {
    console.error('User exists check error:', error);
    return res.status(500).json({ success: false, message: 'Failed to check user existence' });
  }
});

// Mobile Google OAuth
router.post('/google-mobile', async (req, res) => {
  try {
    const { accessToken, userInfo } = req.body;

    if (!accessToken || !userInfo) {
      return res.status(400).json({
        success: false,
        error: 'ACCESS_TOKEN_REQUIRED',
        message: 'Google access token and user info are required'
      });
    }

    // Verify Google access token by making a request to Google's userinfo endpoint
    try {
      const googleResponse = await fetch(
        `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${accessToken}`
      );
      
      if (!googleResponse.ok) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_GOOGLE_TOKEN',
          message: 'Invalid Google access token'
        });
      }
      
      const googleUserInfo = await googleResponse.json();
      
      // Verify that the userInfo matches the verified token
      if (userInfo.id !== googleUserInfo.id || userInfo.email !== googleUserInfo.email) {
        return res.status(400).json({
          success: false,
          error: 'TOKEN_VERIFICATION_FAILED',
          message: 'Token verification failed - user info mismatch'
        });
      }
    } catch (verifyError) {
      console.error('Google token verification error:', verifyError);
      return res.status(400).json({
        success: false,
        error: 'INVALID_GOOGLE_TOKEN',
        message: 'Invalid Google access token'
      });
    }

    // Use verified userInfo from Google
    const { sub: googleId, email, name, given_name, family_name, picture } = {
      sub: userInfo.id,
      email: userInfo.email,
      name: userInfo.name,
      given_name: userInfo.given_name,
      family_name: userInfo.family_name,
      picture: userInfo.picture
    };

    // Check if user exists by externalId (Google ID) only
    // Email is no longer unique - users can register freely with any auth type
    let user = await prisma.user.findUnique({
      where: { externalId: googleId }
    });

    if (!user) {
      // For new users, don't create account yet - store temporary session data
      // This will be used to create the account after profile completion and referral choice
      const tempSessionData = {
        externalId: googleId, // Use externalId instead of googleId
        email,
        displayName: name,
        firstName: given_name || name?.split(' ')[0] || '',
        lastName: family_name || name?.split(' ').slice(1).join(' ') || '',
        avatarUrl: picture,
        isNewUser: true
      };

      // Store temporary session data (we'll use this in the finalize endpoint)
      // For now, return the temp data to frontend
      return res.json({
        success: true,
        message: 'New user - profile completion required',
        data: {
          user: tempSessionData,
          accessToken: null, // No token until account is finalized
          refreshToken: null,
          requiresProfileCompletion: true
        }
      });
    } else {
      // Update last login
      user = await prisma.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date() }
      });
    }

    // Generate tokens
    const accessTokenJWT = generateToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    // Create user session in database
    await prisma.userSession.create({
      data: {
        userId: user.id,
        accessToken: accessTokenJWT,
        refreshToken: refreshToken,
        deviceInfo: req.headers['user-agent'] || 'Mobile App',
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.headers['user-agent'],
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
      }
    });

    res.json({
      success: true,
      message: 'Authentication successful',
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          displayName: user.displayName,
          firstName: user.firstName,
          lastName: user.lastName,
          avatarUrl: user.avatarUrl,
          points: user.points,
          streakCount: user.streakCount,
          referralCode: user.referralCode,
          role: user.role,
          isActive: user.isActive,
          isVerified: user.isVerified,
          kycStatus: user.kycStatus
        },
        accessToken: accessTokenJWT,
        refreshToken
      }
    });

  } catch (error) {
    console.error('Mobile Google OAuth error:', error);
    res.status(500).json({
      success: false,
      error: 'GOOGLE_OAUTH_ERROR',
      message: 'Google authentication failed'
    });
  }
});

// Check username availability
router.post('/check-username', async (req, res) => {
  try {
    const { username } = req.body;

    if (!username || username.trim().length < 3) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_USERNAME',
        message: 'Username must be at least 3 characters long'
      });
    }

    // Check if username contains only letters, numbers, and underscores
    const usernameRegex = /^[a-zA-Z0-9_]+$/;
    if (!usernameRegex.test(username.trim())) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_USERNAME_FORMAT',
        message: 'Username can only contain letters, numbers, and underscores (_)'
      });
    }

    // Check if username is already taken
    const existingUsername = await prisma.user.findUnique({
      where: { username: username.trim() }
    });

    if (existingUsername) {
      return res.status(400).json({
        success: false,
        error: 'USERNAME_TAKEN',
        message: 'Username is already taken'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Username is available'
    });

  } catch (error) {
    console.error('Username check error:', error);
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to check username availability'
    });
  }
});

// Finalize user account creation after profile completion and referral choice
router.post('/finalize-account', async (req, res) => {
  try {
    const { 
      googleId, // Deprecated: kept for backward compatibility, use externalId instead
      externalId, // Provider-specific ID (Google ID, Discord ID, Twitter ID, etc.)
      particleUserId, // Particle Network UUID
      providerType, // 'google', 'apple', 'facebook', 'discord', 'github', 'twitter', 'twitch', 'microsoft', 'linkedin'
      email, 
      displayName, 
      firstName, 
      lastName, 
      avatarUrl,
      username,
      bio,
      referralCode 
    } = req.body;

    // Normalize user identity
    // externalId is the provider-specific ID (Google ID, Discord ID, Twitter ID, etc.)
    // For email/OTP users, externalId may be undefined - they only have particleUserId
    const providerExternalId = externalId || googleId; // Support both for backward compatibility

    // particleUserId is REQUIRED (all Particle Network users have this)
    // externalId is optional (only present for social auth providers, not email/OTP)
    // email is optional (some providers like Twitter may not provide email)
    if (!particleUserId || !username || !displayName) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_REQUIRED_FIELDS',
        message: 'Particle User ID, username, and display name are required'
      });
    }
    
    // Normalize email - store undefined if not provided (important for providers without email)
    const normalizedEmail = email && email.trim() ? email.trim() : undefined;

    // Validate referral code if provided (do this first for both existing and new users)
    let referrerId = null;
    if (referralCode) {
      const referrer = await prisma.user.findUnique({
        where: { referralCode: referralCode.trim() }
      });
      
      if (!referrer) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_REFERRAL_CODE',
          message: 'Referral code is invalid or does not exist'
        });
      }
      
      referrerId = referrer.id;
    }

    // Check if user already exists by particleUserId (primary check - this is the correct check)
    // particleUserId is unique per Particle Network account, which is what we want
    let user = await prisma.user.findUnique({
      where: {
        particleUserId: particleUserId
      }
    });

    if (user) {
      // User already exists, update with new profile data
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          // Only update externalId if provided (social auth users), leave unchanged for email/OTP users
          ...(providerExternalId && { externalId: providerExternalId }),
          // Keep the same particleUserId (don't change it - it's tied to the wallet address)
          particleUserId: user.particleUserId, // Don't update particleUserId - it's tied to wallet
          // Update email if provided, otherwise keep existing
          ...(normalizedEmail !== undefined && { email: normalizedEmail }),
          username,
          displayName,
          firstName: displayName.split(' ')[0] || '',
          lastName: displayName.split(' ').slice(1).join(' ') || '',
          bio: bio || '',
          avatarUrl: avatarUrl || user.avatarUrl, // Preserve existing avatar if new one not provided
          lastLogin: new Date(),
        }
      });
    } else {
      // Check if username contains only letters, numbers, and underscores
      const usernameRegex = /^[a-zA-Z0-9_]+$/;
      if (!usernameRegex.test(username.trim())) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_USERNAME_FORMAT',
          message: 'Username can only contain letters, numbers, and underscores (_)'
        });
      }

      // Check if username is already taken
      const existingUsername = await prisma.user.findUnique({
        where: { username }
      });

      if (existingUsername) {
        return res.status(400).json({
          success: false,
          error: 'USERNAME_TAKEN',
          message: 'Username is already taken'
        });
      }

      // Check if email matches admin email from environment (only if email is provided)
      const adminEmails = process.env.ADMIN_EMAIL ? process.env.ADMIN_EMAIL.split(',').map(e => e.trim()) : [];
      const isAdmin = normalizedEmail && adminEmails.includes(normalizedEmail);

      // Create the user account
      user = await prisma.user.create({
        data: {
          // Only set externalId if provided (social auth users), leave null for email/OTP users
          ...(providerExternalId && { externalId: providerExternalId }),
          particleUserId: particleUserId, // Particle Network UUID (required) - unique per account
          email: normalizedEmail, // Store email if provided, undefined if not (allows Twitter, etc.)
          username,
          displayName,
          firstName: displayName.split(' ')[0] || '', // Extract first name from display name
          lastName: displayName.split(' ').slice(1).join(' ') || '', // Extract last name from display name
          bio: bio || '',
          avatarUrl,
          lastLogin: new Date(),
          referralCode: generateUniqueReferralCode(),
          referredBy: referrerId,
          role: isAdmin ? 'admin' : 'user',
          isVerified: isAdmin ? true : false,
          points: 0 // Start with 0 points
        }
      });
    }

    // Handle referral code if provided
    if (referralCode && referrerId) {
      try {
        // Get the referrer (we already validated it during user creation)
        const referrer = await prisma.user.findUnique({
          where: { id: referrerId }
        });

        // Award points to both users
        await prisma.user.update({
          where: { id: user.id },
          data: { points: { increment: 100 } }
        });

        await prisma.user.update({
          where: { id: referrer.id },
          data: { points: { increment: 50 } }
        });

        // Create referral reward record
        await prisma.referralReward.create({
          data: {
            referrerId: referrer.id,
            refereeId: user.id,
            pointsEarned: 50, // Points earned by the referrer
            status: 'completed'
          }
        });

        console.log(`✅ Referral reward processed: ${referrer.email} -> ${user.email}`);
        
        // Send push notification to referrer about new referral
        setImmediate(() => {
          pushNotificationService.sendNewReferralNotification(
            referrer.id,
            user.displayName || user.username
          ).catch(err => console.error('Failed to send referral notification:', err));
        });
      } catch (referralError) {
        console.error('Referral processing error:', referralError);
        return res.status(500).json({
          success: false,
          error: 'REFERRAL_PROCESSING_ERROR',
          message: 'Failed to process referral code. Please try again.'
        });
      }
    }

    // Generate tokens
    const accessTokenJWT = generateToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    // Create user session in database
    await prisma.userSession.create({
      data: {
        userId: user.id,
        accessToken: accessTokenJWT,
        refreshToken: refreshToken,
        deviceInfo: req.headers['user-agent'] || 'Mobile App',
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.headers['user-agent'],
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
      }
    });

    res.json({
      success: true,
      message: 'Account created successfully',
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          displayName: user.displayName,
          firstName: user.firstName,
          lastName: user.lastName,
          bio: user.bio,
          avatarUrl: user.avatarUrl,
          points: user.points,
          streakCount: user.streakCount,
          referralCode: user.referralCode,
          role: user.role,
          isActive: user.isActive,
          isVerified: user.isVerified,
          kycStatus: user.kycStatus
        },
        accessToken: accessTokenJWT,
        refreshToken
      }
    });

  } catch (error) {
    console.error('Finalize account error:', error);
    res.status(500).json({
      success: false,
      error: 'ACCOUNT_CREATION_ERROR',
      message: 'Failed to create account'
    });
  }
});

// Refresh token
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: 'REFRESH_TOKEN_REQUIRED',
        message: 'Refresh token is required'
      });
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    
    if (decoded.type !== 'refresh') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_REFRESH_TOKEN',
        message: 'Invalid refresh token type'
      });
    }

    // Check if refresh token exists in database
    const storedToken = await prisma.refreshToken.findFirst({
      where: {
        userId: decoded.userId,
        tokenHash: refreshToken,
        isRevoked: false,
        expiresAt: {
          gt: new Date()
        }
      }
    });

    if (!storedToken) {
      return res.status(401).json({
        success: false,
        error: 'INVALID_REFRESH_TOKEN',
        message: 'Invalid or expired refresh token'
      });
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }

    // Generate new tokens
    const newAccessToken = generateToken(user.id);
    const newRefreshToken = generateRefreshToken(user.id);

    // Revoke old refresh token
    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { isRevoked: true }
    });

    // Store new refresh token
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: newRefreshToken,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
      }
    });

    // Deactivate old session and create new one
    await prisma.userSession.updateMany({
      where: {
        userId: user.id,
        refreshToken: refreshToken
      },
      data: { isActive: false }
    });

    await prisma.userSession.create({
      data: {
        userId: user.id,
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        deviceInfo: req.headers['user-agent'] || 'Unknown',
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.headers['user-agent'],
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
      }
    });

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken
      }
    });

  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({
      success: false,
      error: 'TOKEN_REFRESH_ERROR',
      message: 'Token refresh failed'
    });
  }
});

// Logout
router.post('/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      // Revoke refresh token
      await prisma.refreshToken.updateMany({
        where: { tokenHash: refreshToken },
        data: { isRevoked: true }
      });

      // Deactivate user session
      await prisma.userSession.updateMany({
        where: {
          refreshToken: refreshToken,
          isActive: true
        },
        data: { isActive: false }
      });
    }

    res.json({
      success: true,
      message: 'Logout successful'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      error: 'LOGOUT_ERROR',
      message: 'Logout failed'
    });
  }
});

module.exports = router;