const express = require('express');
const { prisma } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');
const { deduplicateRequest } = require('../middleware/deduplication');
const cacheService = require('../services/cacheService');

const router = express.Router();

// Generate referral code for user
router.post('/generate-code', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Check if user already has a referral code
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true }
    });

    if (existingUser.referralCode) {
      return res.json({
        success: true,
        data: {
          referralCode: existingUser.referralCode,
          message: 'Referral code already exists'
        }
      });
    }

    // Generate unique referral code
    const generateReferralCode = () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let result = '';
      for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    };

    let referralCode;
    let isUnique = false;

    // Ensure referral code is unique
    while (!isUnique) {
      referralCode = generateReferralCode();
      const existingCode = await prisma.user.findUnique({
        where: { referralCode }
      });
      if (!existingCode) {
        isUnique = true;
      }
    }

    // Update user with referral code
    await prisma.user.update({
      where: { id: userId },
      data: { referralCode }
    });

    // Write-through cache: Invalidate referral code cache SYNCHRONOUSLY (if cached)
    try {
      await cacheService.delete(`referral:code:${userId}`);
      // Also refresh user profile cache (referralCode is part of profile)
      const { refreshUserAndLeaderboardCaches } = require('../services/cacheRefreshHelpers');
      await refreshUserAndLeaderboardCaches(userId);
    } catch (err) {
      // Non-blocking: Log error but don't fail the request
      console.error('Error invalidating referral code cache:', err);
    }

    res.json({
      success: true,
      message: 'Referral code generated successfully',
      data: { referralCode }
    });

  } catch (error) {
    console.error('Generate referral code error:', error);
    res.status(500).json({
      success: false,
      error: 'REFERRAL_CODE_GENERATION_ERROR',
      message: 'Failed to generate referral code'
    });
  }
});

// Get user's referral code
router.get('/my-code', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const cacheKey = `referral:code:${userId}`;

    // Write-through cache: Get from cache or fetch and cache (1 hour TTL)
    const referralCode = await cacheService.getOrSet(cacheKey, async () => {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { referralCode: true }
      });

      if (!user.referralCode) {
        return null;
      }

      return user.referralCode;
    }, 3600); // 1 hour TTL

    if (!referralCode) {
      return res.status(404).json({
        success: false,
        error: 'REFERRAL_CODE_NOT_FOUND',
        message: 'Referral code not found. Generate one first.'
      });
    }

    res.json({
      success: true,
      data: { referralCode }
    });

  } catch (error) {
    console.error('Get referral code error:', error);
    res.status(500).json({
      success: false,
      error: 'REFERRAL_CODE_FETCH_ERROR',
      message: 'Failed to get referral code'
    });
  }
});


// Get referral stats
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const cacheKey = `referral:stats:${userId}`;

    // Write-through cache: Get from cache or fetch and cache (1 hour TTL)
    const stats = await cacheService.getOrSet(cacheKey, async () => {
      // Single optimized query to get all referral data
      const result = await prisma.$queryRaw`
        WITH referral_stats AS (
          SELECT 
            COUNT(DISTINCT ref.id) as referral_count,
            COALESCE(SUM(rr.points_earned), 0) as total_points_earned
          FROM users ref
          LEFT JOIN referral_rewards rr ON ref.referred_by = ${userId} AND rr.referrer_id = ${userId}
          WHERE ref.referred_by = ${userId}
        ),
        recent_referrals AS (
          SELECT 
            ref.id,
            ref.username,
            ref.display_name as "displayName",
            ref.avatar_url as "avatarUrl",
            ref.avatar_data as "avatarData",
            ref.role,
            ref.created_at as "createdAt",
            CASE 
              WHEN ms.started_at >= NOW() - INTERVAL '6 hours' THEN true 
              ELSE false 
            END as is_active
          FROM users ref
          LEFT JOIN mining_sessions ms ON ref.id = ms.user_id 
            AND ms.is_active = true
          WHERE ref.referred_by = ${userId}
          ORDER BY ref.created_at DESC
          LIMIT 5
        )
        SELECT 
          rs.referral_count,
          rs.total_points_earned,
          COALESCE(
            json_agg(
              json_build_object(
                'id', rr.id,
                'username', rr.username,
                'displayName', rr."displayName",
                'avatarUrl', rr."avatarUrl",
                'avatarData', rr."avatarData",
                'role', rr.role,
                'createdAt', rr."createdAt",
                'isActive', rr.is_active
              )
            ) FILTER (WHERE rr.id IS NOT NULL), 
            '[]'::json
          ) as recent_referrals,
          COUNT(CASE WHEN rr.is_active = true THEN 1 END) as active_count,
          COUNT(CASE WHEN rr.is_active = false THEN 1 END) as inactive_count
        FROM referral_stats rs
        CROSS JOIN recent_referrals rr
        GROUP BY rs.referral_count, rs.total_points_earned
      `;

      if (!result || result.length === 0) {
        return {
          referralCount: 0,
          totalPointsEarned: 0,
          recentReferrals: [],
          activeCount: 0,
          inactiveCount: 0
        };
      }

      const data = result[0];
      return {
        referralCount: parseInt(data.referral_count),
        totalPointsEarned: parseInt(data.total_points_earned),
        recentReferrals: data.recent_referrals || [],
        activeCount: parseInt(data.active_count) || 0,
        inactiveCount: parseInt(data.inactive_count) || 0
      };
    }, 3600); // 1 hour TTL

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('Get referral stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch referral stats'
    });
  }
});

// Get referral history
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 100, 100); // Max 100 items per request
    const skip = (page - 1) * limit;
    const cacheKey = `referral:history:${userId}:page:${page}:limit:${limit}`;

    // Write-through cache: Get from cache or fetch and cache (1 hour TTL)
    const historyData = await cacheService.getOrSet(cacheKey, async () => {
      const referrals = await prisma.user.findMany({
        where: { referredBy: userId },
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          avatarData: true,
          points: true,
          role: true,
          createdAt: true,
          miningSessions: {
            where: { isActive: true },
            orderBy: { startedAt: 'desc' },
            take: 1,
            select: {
              startedAt: true,
              duration: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      });

      // Add mining status based on active mining sessions (active if mining started within last 6 hours)
      const now = new Date();
      const sixHoursAgo = new Date(now - 6 * 60 * 60 * 1000);
      
      const referralsWithStatus = referrals.map(referral => {
        const latestMiningSession = referral.miningSessions[0];
        const isActive = latestMiningSession && latestMiningSession.startedAt >= sixHoursAgo;
        
        return {
          ...referral,
          isActive,
          miningSessions: undefined // Remove from response
        };
      });

      const totalCount = await prisma.user.count({
        where: { referredBy: userId }
      });

      // Count active and inactive referrals
      const activeCount = referralsWithStatus.filter(r => r.isActive).length;
      const inactiveCount = referralsWithStatus.filter(r => !r.isActive).length;

      return {
        referrals: referralsWithStatus,
        activeCount,
        inactiveCount,
        pagination: {
          page,
          limit,
          total: totalCount,
          pages: Math.ceil(totalCount / limit)
        }
      };
    }, 3600); // 1 hour TTL

    res.json({
      success: true,
      data: historyData
    });

  } catch (error) {
    console.error('Get referral history error:', error);
    res.status(500).json({
      success: false,
      error: 'REFERRAL_HISTORY_ERROR',
      message: 'Failed to get referral history'
    });
  }
});




// Remind inactive referrals
router.post('/remind-inactive', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const pushNotificationService = require('../services/pushNotificationService');
    
    // Get user to check last reminder timestamp
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        lastInactiveReminderAt: true,
        username: true,
        displayName: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }

    // Check cooldown (12 hours = 12 * 60 * 60 * 1000 milliseconds)
    const twelveHoursInMs = 12 * 60 * 60 * 1000;
    const now = new Date();
    const lastReminderAt = user.lastInactiveReminderAt ? new Date(user.lastInactiveReminderAt) : null;
    
    if (lastReminderAt && (now - lastReminderAt) < twelveHoursInMs) {
      const remainingMs = twelveHoursInMs - (now - lastReminderAt);
      const remainingHours = Math.floor(remainingMs / (60 * 60 * 1000));
      const remainingMinutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
      
      return res.status(429).json({
        success: false,
        error: 'COOLDOWN_ACTIVE',
        message: `You can remind inactive users again in ${remainingHours}h ${remainingMinutes}m`,
        remainingMs,
        remainingHours,
        remainingMinutes,
      });
    }

    // Get all referrals that are currently inactive (not mining)
    const sixHoursAgo = new Date(now - 6 * 60 * 60 * 1000);
    
    const inactiveReferrals = await prisma.user.findMany({
      where: {
        referredBy: userId,
        pushToken: { not: null }, // Only users with push tokens
      },
      select: {
        id: true,
        pushToken: true,
        username: true,
        miningSessions: {
          where: { isActive: true },
          orderBy: { startedAt: 'desc' },
          take: 1,
          select: {
            startedAt: true,
          },
        },
      },
    });

    // Filter to only truly inactive referrals (no active mining session or session older than 6 hours)
    const trulyInactive = inactiveReferrals.filter(referral => {
      const latestSession = referral.miningSessions[0];
      if (!latestSession) return true; // No mining session = inactive
      return latestSession.startedAt < sixHoursAgo; // Session older than 6 hours = inactive
    });

    if (trulyInactive.length === 0) {
      // Update last reminder timestamp even if no inactive users
      await prisma.user.update({
        where: { id: userId },
        data: { lastInactiveReminderAt: now },
      });

      return res.json({
        success: true,
        message: 'No inactive referrals to remind',
        data: {
          notifiedCount: 0,
        },
      });
    }

    // Send notifications to all inactive referrals
    const referrerName = user.displayName || user.username || 'Your referrer';
    let notifiedCount = 0;
    let failedCount = 0;

    for (const referral of trulyInactive) {
      try {
        const notification = {
          title: '⛏️ Time to Mine!',
          body: `${referrerName} just reminded you to start mining! Come back and earn $BUZZ!`,
          data: {
            type: 'remind_mining',
            referrerName,
          },
        };

        const result = await pushNotificationService.sendNotification(referral.pushToken, notification);
        if (result.success) {
          notifiedCount++;
        } else {
          failedCount++;
          console.error(`Failed to notify referral ${referral.id}:`, result.error);
        }
      } catch (error) {
        failedCount++;
        console.error(`Error notifying referral ${referral.id}:`, error);
      }
    }

    // Update last reminder timestamp
    await prisma.user.update({
      where: { id: userId },
      data: { lastInactiveReminderAt: now },
    });

    console.log(`📢 [REMIND INACTIVE] User ${userId} reminded ${notifiedCount} inactive referrals`);

    res.json({
      success: true,
      message: `Reminders sent to ${notifiedCount} inactive referral${notifiedCount !== 1 ? 's' : ''}`,
      data: {
        notifiedCount,
        failedCount,
        totalInactive: trulyInactive.length,
      },
    });

  } catch (error) {
    console.error('Remind inactive referrals error:', error);
    res.status(500).json({
      success: false,
      error: 'REMIND_INACTIVE_ERROR',
      message: 'Failed to send reminders to inactive referrals',
      errorDetails: error.message,
    });
  }
});

// Get reminder cooldown status
router.get('/remind-inactive-status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        lastInactiveReminderAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }

    const twelveHoursInMs = 12 * 60 * 60 * 1000;
    const now = new Date();
    const lastReminderAt = user.lastInactiveReminderAt ? new Date(user.lastInactiveReminderAt) : null;
    
    let canRemind = true;
    let remainingMs = 0;
    let remainingHours = 0;
    let remainingMinutes = 0;

    if (lastReminderAt && (now - lastReminderAt) < twelveHoursInMs) {
      canRemind = false;
      remainingMs = twelveHoursInMs - (now - lastReminderAt);
      remainingHours = Math.floor(remainingMs / (60 * 60 * 1000));
      remainingMinutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
    }

    res.json({
      success: true,
      data: {
        canRemind,
        remainingMs,
        remainingHours,
        remainingMinutes,
        lastReminderAt: lastReminderAt ? lastReminderAt.toISOString() : null,
      },
    });

  } catch (error) {
    console.error('Get remind inactive status error:', error);
    res.status(500).json({
      success: false,
      error: 'REMIND_STATUS_ERROR',
      message: 'Failed to get reminder status',
      errorDetails: error.message,
    });
  }
});

// Use error handler middleware
router.use(errorHandler);

module.exports = router;
