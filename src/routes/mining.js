const express = require('express');
const { prisma } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');
const { deduplicateRequest } = require('../middleware/deduplication');

const router = express.Router();

// Helper function to update mining progress for a session
async function updateMiningProgress(sessionId) {
  try {
    await prisma.$transaction(async (tx) => {
      // Lock the session to prevent concurrent updates
      const session = await tx.miningSession.findUnique({
        where: { id: sessionId }
      });

      if (!session || !session.isActive) {
        return;
      }

      const now = new Date();
      const sessionEndTime = new Date(session.startedAt.getTime() + 6 * 60 * 60 * 1000);
      
      if (now >= sessionEndTime) {
        // Session has expired, mark as completed
        const finalMinedAmount = session.totalMined + (session.currentRate * (now - session.lastUpdate) / (1000 * 60 * 60)) / 6;
        
        await tx.miningSession.update({
          where: { id: sessionId },
          data: {
            isActive: false,
            isCompleted: true,
            completedAt: now,
            totalMined: finalMinedAmount,
            lastUpdate: now
          }
        });
        
        // Update referrer rates since this user is no longer mining
        // Note: This is called outside the transaction to avoid deadlocks
        setImmediate(() => updateReferrerMiningRates(session.userId));
      } else {
        // Session is still active, update progress
        const elapsedTime = now - session.lastUpdate;
        const elapsedHours = elapsedTime / (1000 * 60 * 60);
        const minedSinceLastUpdate = (session.currentRate * elapsedHours) / 6;
        
        await tx.miningSession.update({
          where: { id: sessionId },
          data: {
            totalMined: session.totalMined + minedSinceLastUpdate,
            lastUpdate: now
          }
        });
      }
    });
  } catch (error) {
    console.error('Error updating mining progress:', error);
  }
}

// Helper function to update mining rates for all referrers of a user
async function updateReferrerMiningRates(userId) {
  try {
    // Find the user who just started/stopped mining
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { referredBy: true }
    });

    if (!user || !user.referredBy) {
      return; // No referrer to update
    }

    // Find all active mining sessions for the referrer
    const referrerSessions = await prisma.miningSession.findMany({
      where: {
        userId: user.referredBy,
        isActive: true
      }
    });

    // Update each active session with transaction to prevent race conditions
    for (const session of referrerSessions) {
      await prisma.$transaction(async (tx) => {
        // Lock the session to prevent concurrent updates
        const lockedSession = await tx.miningSession.findUnique({
          where: { id: session.id },
          select: { 
            id: true, 
            currentRate: true, 
            totalMined: true, 
            lastUpdate: true, 
            baseReward: true 
          }
        });

        if (!lockedSession) return;

        // Count current active referrals for the referrer
        const referrer = await tx.user.findUnique({
          where: { id: user.referredBy },
          include: { referrals: true }
        });

        let activeReferrals = 0;
        if (referrer.referrals && referrer.referrals.length > 0) {
          const activeReferredUsers = await tx.user.findMany({
        where: {
              referredBy: user.referredBy,
              miningSessions: {
            some: {
                  isActive: true,
                  startedAt: {
                    gte: new Date(Date.now() - 6 * 60 * 60 * 1000) // 6 hours
              }
            }
          }
        }
      });
          activeReferrals = activeReferredUsers.length;
        }

        // Calculate new mining rate
        const baseReward = lockedSession.baseReward;
        const referralBonus = activeReferrals * 10; // 10% per active referral
        const newRate = baseReward + (baseReward * referralBonus / 100);

        // Calculate tokens mined since last update
        const now = new Date();
        const elapsedTime = now - lockedSession.lastUpdate;
        const elapsedHours = elapsedTime / (1000 * 60 * 60);
        const minedSinceLastUpdate = (lockedSession.currentRate * elapsedHours) / 6;

        // Update the session
        await tx.miningSession.update({
          where: { id: lockedSession.id },
          data: {
            currentRate: newRate,
            totalMined: lockedSession.totalMined + minedSinceLastUpdate,
            lastUpdate: now
          }
        });
      });
    }
  } catch (error) {
    console.error('Error updating referrer mining rates:', error);
  }
}

// Get mining stats for user
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const requestKey = `mining:stats:${userId}`;
    
    const stats = await deduplicateRequest(requestKey, async () => {
      // Single optimized query to get all mining data
      const result = await prisma.$queryRaw`
        WITH user_mining_data AS (
          SELECT 
            u.id as user_id,
            u.points,
            COUNT(DISTINCT ms_active.id) as active_sessions,
            COUNT(DISTINCT ms_completed.id) as completed_sessions
          FROM users u
          LEFT JOIN mining_sessions ms_active ON u.id = ms_active.user_id AND ms_active.is_active = true
          LEFT JOIN mining_sessions ms_completed ON u.id = ms_completed.user_id AND ms_completed.is_completed = true AND ms_completed.is_claimed = true
          WHERE u.id = ${userId}
          GROUP BY u.id, u.points
        ),
        mining_claims_data AS (
          SELECT 
            u.id as user_id,
            COUNT(DISTINCT mc.id) as total_claims,
            COALESCE(SUM(mc.amount), 0) as total_earned
          FROM users u
          LEFT JOIN mining_claims mc ON u.id = mc.user_id
          WHERE u.id = ${userId}
          GROUP BY u.id
        ),
        referral_data AS (
          SELECT 
            u.id as user_id,
            COUNT(DISTINCT ref.id) as total_referrals,
            COUNT(DISTINCT active_ref.id) as active_referrals
          FROM users u
          LEFT JOIN users ref ON ref.referred_by = u.id
          LEFT JOIN users active_ref ON active_ref.referred_by = u.id 
            AND EXISTS (
              SELECT 1 FROM mining_sessions ms_ref 
              WHERE ms_ref.user_id = active_ref.id 
                AND ms_ref.is_active = true 
                AND ms_ref.started_at >= NOW() - INTERVAL '6 hours'
            )
          WHERE u.id = ${userId}
          GROUP BY u.id
        ),
        current_session AS (
          SELECT 
            ms.id,
            ms.started_at,
            ms.total_mined,
            ms.current_rate,
            ms.last_update,
            ms.is_active,
            ms.is_completed,
            ms.is_claimed
          FROM mining_sessions ms
          WHERE ms.user_id = ${userId}
            AND (ms.is_active = true OR (ms.is_completed = true AND ms.is_claimed = false))
          ORDER BY ms.started_at DESC
          LIMIT 1
        )
        SELECT 
          umd.user_id,
          umd.points,
          umd.active_sessions,
          umd.completed_sessions,
          mcd.total_claims,
          mcd.total_earned,
          rd.total_referrals,
          rd.active_referrals,
          cs.id as session_id,
          cs.started_at,
          cs.total_mined,
          cs.current_rate,
          cs.last_update,
          cs.is_active,
          cs.is_completed,
          cs.is_claimed
        FROM user_mining_data umd
        LEFT JOIN mining_claims_data mcd ON umd.user_id = mcd.user_id
        LEFT JOIN referral_data rd ON umd.user_id = rd.user_id
        LEFT JOIN current_session cs ON true
      `;

      if (!result || result.length === 0) {
        throw new Error('USER_NOT_FOUND');
      }

      const data = result[0];
      const baseRate = 20;
      const miningCycleDuration = 6 * 60 * 60 * 1000;
    const now = new Date();
      
      // Calculate active referral bonus
      const activeReferralBonus = parseInt(data.active_referrals) * 10;
      const totalMiningRate = baseRate + (baseRate * activeReferralBonus / 100);
    
    let readyToClaim = 0;
    let nextClaimTime = null;
    let isMining = false;
      let timeRemaining = 0;
      let currentMiningRate = 0;
      
      if (data.session_id) {
        const sessionStartTime = new Date(data.started_at);
        const sessionEndTime = new Date(sessionStartTime.getTime() + miningCycleDuration);
        
        if (data.is_completed && !data.is_claimed) {
          // Completed session ready to claim
          readyToClaim = parseFloat(data.total_mined);
          isMining = false;
          currentMiningRate = parseInt(data.current_rate);
        } else if (data.is_active && now < sessionEndTime) {
          // Active session
          isMining = true;
          timeRemaining = sessionEndTime - now;
          nextClaimTime = sessionEndTime;
          currentMiningRate = parseInt(data.current_rate);
          
          // Calculate current mined amount
          const elapsedTime = now - new Date(data.last_update);
          const elapsedHours = elapsedTime / (1000 * 60 * 60);
          const minedSinceLastUpdate = (currentMiningRate * elapsedHours) / 6;
          readyToClaim = parseFloat(data.total_mined) + minedSinceLastUpdate;
        }
      }
      
      return {
        isMining,
        currentMiningRate,
        totalMiningRate,
        readyToClaim,
        nextClaimTime,
        timeRemaining,
        sessionStartTime: data.started_at,
        totalEarned: parseFloat(data.total_earned),
        completedSessions: parseInt(data.completed_sessions),
        totalReferrals: parseInt(data.total_referrals),
        activeReferrals: parseInt(data.active_referrals),
        activeReferralBonus
      };
    });

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    if (error.message === 'USER_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    console.error('Get mining stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch mining stats'
    });
  }
});

// Start mining (if not already started)
router.post('/start', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Check if mining is already active
    const activeSession = await prisma.miningSession.findFirst({
      where: { 
        userId,
        isActive: true
      },
      orderBy: { startedAt: 'desc' }
    });
    
    if (activeSession) {
        return res.status(400).json({
          success: false,
        message: 'Mining is already active. Please wait for the current session to complete.'
      });
    }
    
    // Calculate initial mining rate based on active referrals
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { referrals: true }
    });
    
    let activeReferrals = 0;
    if (user.referrals && user.referrals.length > 0) {
      // Check which referred users are currently mining
      const activeReferredUsers = await prisma.user.findMany({
        where: {
          referredBy: userId,
          miningSessions: {
            some: {
              isActive: true,
              startedAt: {
                gte: new Date(Date.now() - 6 * 60 * 60 * 1000) // 6 hours
              }
            }
          }
        }
      });
      
      activeReferrals = activeReferredUsers.length;
    }

    const baseReward = 20; // 20 tokens per 6-hour session
    const referralBonus = activeReferrals * 10; // 10% per active referral
    const initialRate = baseReward + (baseReward * referralBonus / 100);
    
    const miningSession = await prisma.miningSession.create({
      data: {
        userId,
        baseReward,
        currentRate: initialRate,
        totalMined: 0,
        lastUpdate: new Date(),
        startedAt: new Date(),
        isActive: true
      }
    });

    // Update mining rates for all users who referred this user
    await updateReferrerMiningRates(userId);
    
    res.json({
      success: true,
      data: {
        message: 'Mining started successfully. You can claim rewards after 6 hours.',
        isMining: true,
        nextClaimTime: new Date(miningSession.startedAt.getTime() + 6 * 60 * 60 * 1000),
        sessionId: miningSession.id
      }
    });
  } catch (error) {
    console.error('Error starting mining:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start mining'
    });
  }
});

// Claim mining rewards
router.post('/claim', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Find completed mining session that hasn't been claimed yet
    const completedSession = await prisma.miningSession.findFirst({
      where: { 
        userId,
        isCompleted: true,
        isClaimed: false
      },
      orderBy: { startedAt: 'desc' }
    });

    if (!completedSession) {
      return res.status(400).json({
        success: false,
        message: 'No completed mining session found. Please start mining first.'
      });
    }

    // Calculate final mined amount
    const finalMinedAmount = Math.floor(completedSession.totalMined);

    // Mark session as claimed and claim rewards
    await prisma.$transaction(async (tx) => {
      // Mark session as claimed
      await tx.miningSession.update({
        where: { id: completedSession.id },
        data: {
          isClaimed: true
        }
      });

    // Create mining claim record
      await tx.miningClaim.create({
      data: {
        userId,
          amount: finalMinedAmount,
          miningRate: completedSession.currentRate,
          referralBonus: Math.max(0, finalMinedAmount - completedSession.baseReward)
        }
      });

      // Update user's points
      await tx.user.update({
        where: { id: userId },
        data: {
          points: {
            increment: finalMinedAmount
          }
        }
      });
    });

    // Update mining rates for all users who referred this user (since they're no longer mining)
    await updateReferrerMiningRates(userId);

    res.json({
      success: true,
      data: {
        amount: finalMinedAmount,
        message: `Successfully claimed ${finalMinedAmount} $BUZZ tokens!`
      }
    });
  } catch (error) {
    console.error('Error claiming mining rewards:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to claim mining rewards'
    });
  }
});

// Get claim history
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 10;
    
    const claims = await prisma.miningClaim.findMany({
      where: { userId },
      orderBy: { claimedAt: 'desc' },
      take: limit
    });

    res.json({
      success: true,
      data: {
        claims: claims.map(claim => ({
          id: claim.id,
          amount: claim.amount,
          miningRate: claim.miningRate,
          referralBonus: claim.referralBonus,
          claimedAt: claim.claimedAt.toISOString()
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching claim history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch claim history'
    });
  }
});

// Get mining leaderboard
router.get('/leaderboard', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    
    // Get top miners by total earned
    const topMiners = await prisma.user.findMany({
      include: {
        miningClaims: {
          select: {
            amount: true
          }
        }
      },
      take: limit
    });

    // Calculate total earned for each user
    const leaderboard = topMiners
      .map(user => ({
        id: user.id,
        name: user.displayName || user.email,
        avatar: user.avatarUrl,
        totalEarned: user.miningClaims.reduce((sum, claim) => sum + claim.amount, 0),
        referralCount: user.referrals?.length || 0
      }))
      .sort((a, b) => b.totalEarned - a.totalEarned)
      .map((user, index) => ({
        ...user,
        rank: index + 1
      }));

    res.json({
      success: true,
      data: {
        leaderboard
      }
    });
  } catch (error) {
    console.error('Error fetching mining leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch mining leaderboard'
    });
  }
});

// Update mining rate when referral activity changes
router.post('/update-rate', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Find active mining session
    const activeSession = await prisma.miningSession.findFirst({
      where: { 
        userId,
        isActive: true
      },
      orderBy: { startedAt: 'desc' }
    });

    if (!activeSession) {
      return res.status(400).json({
        success: false,
        message: 'No active mining session found'
      });
    }

    // Count current active referrals
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { referrals: true }
    });
    
    let currentActiveReferrals = 0;
    if (user.referrals && user.referrals.length > 0) {
      const activeReferredUsers = await prisma.user.findMany({
        where: {
          referredBy: userId,
          miningSessions: {
            some: {
              isActive: true,
              startedAt: {
                gte: new Date(Date.now() - 6 * 60 * 60 * 1000) // 6 hours
              }
            }
          }
        }
      });
      
      currentActiveReferrals = activeReferredUsers.length;
    }

    // Calculate new mining rate
    const baseReward = activeSession.baseReward;
    const referralBonus = currentActiveReferrals * 10; // 10% per active referral
    const newRate = baseReward + (baseReward * referralBonus / 100);

    // Calculate tokens mined since last update
    const now = new Date();
    const elapsedTime = now - activeSession.lastUpdate;
    const elapsedHours = elapsedTime / (1000 * 60 * 60);
    const minedSinceLastUpdate = (activeSession.currentRate * elapsedHours) / 6;

    // Update mining session with new rate and accumulated tokens
    const updatedSession = await prisma.miningSession.update({
      where: { id: activeSession.id },
      data: {
        currentRate: newRate,
        totalMined: activeSession.totalMined + minedSinceLastUpdate,
        lastUpdate: now
      }
    });

    res.json({
      success: true,
      data: {
        newRate: newRate,
        activeReferralCount: currentActiveReferrals,
        totalMined: updatedSession.totalMined,
        message: `Mining rate updated to ${newRate.toFixed(1)} tokens/6hrs (${currentActiveReferrals} active referrals)`
      }
    });
  } catch (error) {
    console.error('Error updating mining rate:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update mining rate'
    });
  }
});

// Background cleanup job to handle expired sessions
router.post('/cleanup-expired', async (req, res) => {
  try {
    const now = new Date();
    const sixHoursAgo = new Date(now - 6 * 60 * 60 * 1000);
    
    // Find all active sessions that should have expired
    const expiredSessions = await prisma.miningSession.findMany({
      where: {
        isActive: true,
        startedAt: {
          lte: sixHoursAgo
        }
      }
    });

    let processedCount = 0;
    
    for (const session of expiredSessions) {
      await updateMiningProgress(session.id);
      processedCount++;
    }

    res.json({
      success: true,
      data: {
        processedSessions: processedCount,
        message: `Processed ${processedCount} expired mining sessions`
      }
    });
  } catch (error) {
    console.error('Error in cleanup job:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup expired sessions'
    });
  }
});

// Use error handler middleware
router.use(errorHandler);

module.exports = router;
