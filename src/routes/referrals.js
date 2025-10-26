const express = require('express');
const { prisma } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');
const { deduplicateRequest } = require('../middleware/deduplication');

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

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true }
    });

    if (!user.referralCode) {
      return res.status(404).json({
        success: false,
        error: 'REFERRAL_CODE_NOT_FOUND',
        message: 'Referral code not found. Generate one first.'
      });
    }

    res.json({
      success: true,
      data: { referralCode: user.referralCode }
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
    const requestKey = `referral:stats:${userId}`;

    const stats = await deduplicateRequest(requestKey, async () => {
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
    });

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
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

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

    res.json({
      success: true,
      data: {
        referrals: referralsWithStatus,
        activeCount,
        inactiveCount,
        pagination: {
          page,
          limit,
          total: totalCount,
          pages: Math.ceil(totalCount / limit)
        }
      }
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

// Use error handler middleware
router.use(errorHandler);

module.exports = router;
