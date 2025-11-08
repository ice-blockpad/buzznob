const express = require('express');
const jwt = require('jsonwebtoken');
const { prisma } = require('../config/database');
const { generateToken, generateRefreshToken } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');
const pushNotificationService = require('../services/pushNotificationService');

const router = express.Router();

// Generate unique referral code
function generateUniqueReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Lightweight existence check used by mobile pre-profile flow
// GET /auth/user-exists?externalId=...&email=...&particleUserId=...
router.get('/user-exists', async (req, res) => {
  try {
    const { particleUserId } = req.query;
    if (!particleUserId) {
      return res.status(400).json({ success: false, message: 'particleUserId required' });
    }

    const user = await prisma.user.findFirst({
      where: {
        particleUserId: particleUserId
      },
      select: { id: true },
    });

    return res.json({ success: true, exists: !!user });
  } catch (error) {
    console.error('User exists check error:', error);
    return res.status(500).json({ success: false, message: 'Failed to check user existence' });
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