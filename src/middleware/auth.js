const jwt = require('jsonwebtoken');
const { prisma } = require('../config/database');

// Verify JWT token and validate session in database
const authenticateToken = async (req, res, next) => {
  try {
    // Only log in development
    if (process.env.NODE_ENV !== 'production') {
      console.log('🔑 Auth middleware: Checking authentication for', req.method, req.path);
    }
    
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (process.env.NODE_ENV !== 'production') {
      console.log('🔑 Auth middleware: Token present:', !!token);
    }

    if (!token) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('❌ Auth middleware: No token provided');
      }
      return res.status(401).json({
        success: false,
        error: 'ACCESS_TOKEN_REQUIRED',
        message: 'Access token is required'
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (process.env.NODE_ENV !== 'production') {
      console.log('🔑 Auth middleware: Token decoded for user:', decoded.userId);
    }
    
    // Check if session exists in database and is active
    const session = await prisma.userSession.findFirst({
      where: {
        accessToken: token,
        isActive: true,
        expiresAt: {
          gt: new Date()
        }
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            externalId: true,
            particleUserId: true,
            walletAddress: true,
            displayName: true,
            avatarUrl: true,
            points: true,
            streakCount: true,
            lastLogin: true,
            role: true,
            isActive: true,
            isVerified: true
          }
        }
      }
    });

    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'INVALID_SESSION',
        message: 'Session not found or expired'
      });
    }

    if (!session.user) {
      return res.status(401).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }

    if (!session.user.isActive) {
      return res.status(401).json({
        success: false,
        error: 'USER_INACTIVE',
        message: 'User account is inactive'
      });
    }

    // Update last used timestamp
    await prisma.userSession.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() }
    });

    req.user = session.user;
    req.session = session;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'INVALID_TOKEN',
        message: 'Invalid token'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'TOKEN_EXPIRED',
        message: 'Token has expired'
      });
    }

    return res.status(500).json({
      success: false,
      error: 'AUTHENTICATION_ERROR',
      message: 'Authentication failed'
    });
  }
};

// Optional authentication (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: {
          id: true,
          username: true,
          email: true,
          externalId: true,
          particleUserId: true,
          walletAddress: true,
          displayName: true,
          avatarUrl: true,
          points: true,
          streakCount: true,
          lastLogin: true,
          role: true,
          isActive: true,
          isVerified: true
        }
      });
      
      if (user) {
        req.user = user;
      }
    }
    
    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
};

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

// Generate refresh token
const generateRefreshToken = (userId) => {
  return jwt.sign(
    { userId, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }
  );
};

module.exports = {
  authenticateToken,
  optionalAuth,
  generateToken,
  generateRefreshToken
};
