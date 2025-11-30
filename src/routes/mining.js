const express = require('express');
const { prisma } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');
const { deduplicateRequest } = require('../middleware/deduplication');
const pushNotificationService = require('../services/pushNotificationService');
const { refreshUserAndLeaderboardCaches } = require('../services/cacheRefreshHelpers');
const { parsePaginationParams, buildCursorQuery, buildOffsetQuery, buildPaginationResponse, buildPaginationResponseWithTotal } = require('../utils/pagination');

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
        // Accrue only up to the scheduled end time to avoid overcounting
        const accrueUntil = sessionEndTime;
        const elapsedTime = Math.max(0, accrueUntil - session.lastUpdate);
        const elapsedHours = elapsedTime / (1000 * 60 * 60);
        const minedSinceLastUpdate = (session.currentRate * elapsedHours) / 6;
        const finalMinedAmount = session.totalMined + minedSinceLastUpdate;
        
        await tx.miningSession.update({
          where: { id: sessionId },
          data: {
            isActive: false,
            isCompleted: true,
            completedAt: sessionEndTime,
            totalMined: finalMinedAmount,
            lastUpdate: sessionEndTime
          }
        });
        
        // Update referrer rates since this user is no longer mining
        // Note: This is called outside the transaction to avoid deadlocks
        setImmediate(() => updateReferrerMiningRates(session.userId));
        
        // Send push notification when mining session completes
        setImmediate(() => {
          pushNotificationService.sendMiningCompleteNotification(session.userId)
            .catch(err => console.error('Failed to send mining complete notification:', err));
        });
      } else {
        // Session is still active, update progress
        // Calculate session end time to cap accrual at 6 hours
        const sessionEndTime = new Date(session.startedAt.getTime() + 6 * 60 * 60 * 1000);
        
        // Cap elapsed time to not exceed the 6-hour session duration
        const maxElapsedTime = Math.min(
          now - session.lastUpdate,
          sessionEndTime - session.lastUpdate
        );
        const elapsedHours = maxElapsedTime / (1000 * 60 * 60);
        const minedSinceLastUpdate = (session.currentRate * elapsedHours) / 6;
        
        // Don't update lastUpdate beyond the session end time
        const newLastUpdate = new Date(Math.min(now.getTime(), sessionEndTime.getTime()));
        
        await tx.miningSession.update({
          where: { id: sessionId },
          data: {
            totalMined: session.totalMined + minedSinceLastUpdate,
            lastUpdate: newLastUpdate
          }
        });
      }
    });
  } catch (error) {
    console.error('Error updating mining progress:', error);
  }
}

// Helper function to notify inactive referrals when referrer claims mining
// Helper function to notify inactive referrals when referrer claims mining
// Uses the same logic as the remind-inactive endpoint
async function notifyInactiveReferralsOfClaim(referrerId, referrerName) {
  try {
    const now = new Date();
    const sixHoursAgo = new Date(now - 6 * 60 * 60 * 1000);
    
    // Get all referrals that are currently inactive (not mining)
    // Same query structure as remind-inactive endpoint
    const inactiveReferrals = await prisma.user.findMany({
      where: {
        referredBy: referrerId,
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
    // Same filtering logic as remind-inactive endpoint
    const trulyInactive = inactiveReferrals.filter(referral => {
      const latestSession = referral.miningSessions[0];
      if (!latestSession) return true; // No mining session = inactive
      return latestSession.startedAt < sixHoursAgo; // Session older than 6 hours = inactive
    });

    if (trulyInactive.length === 0) {
      console.log(`📢 [MINING CLAIM NOTIFICATION] No inactive referrals to notify for user ${referrerId}`);
      return;
    }

    // Send notifications to all inactive referrals
    // Same notification sending pattern as remind-inactive endpoint
    let notifiedCount = 0;
    let failedCount = 0;

    for (const referral of trulyInactive) {
      try {
        const notification = {
          title: '⛏️ Your Referrer Just Claimed!',
          body: `${referrerName} just claimed their mining rewards! Go claim yours too!`,
          data: {
            type: 'referrer_claimed_mining',
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

    console.log(`📢 [MINING CLAIM NOTIFICATION] User ${referrerId} claimed mining - notified ${notifiedCount} inactive referrals`);
  } catch (error) {
    console.error('Error notifying inactive referrals of mining claim:', error);
    // Don't throw - this is a non-critical notification
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
        // Get the original session to find startedAt
        const fullSession = await tx.miningSession.findUnique({
          where: { id: lockedSession.id },
          select: { startedAt: true }
        });
        
        if (!fullSession) return;
        
        // Calculate session end time to cap accrual at 6 hours
        const sessionEndTime = new Date(fullSession.startedAt.getTime() + 6 * 60 * 60 * 1000);
        
        // Cap elapsed time to not exceed the 6-hour session duration
        const maxElapsedTime = Math.min(
          now - lockedSession.lastUpdate,
          sessionEndTime - lockedSession.lastUpdate
        );
        const elapsedHours = maxElapsedTime / (1000 * 60 * 60);
        const minedSinceLastUpdate = (lockedSession.currentRate * elapsedHours) / 6;

        // Don't update lastUpdate beyond the session end time
        const newLastUpdate = new Date(Math.min(now.getTime(), sessionEndTime.getTime()));

        // Update the session
        await tx.miningSession.update({
          where: { id: lockedSession.id },
          data: {
            currentRate: newRate,
            totalMined: lockedSession.totalMined + minedSinceLastUpdate,
            lastUpdate: newLastUpdate
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
      // First, finalize any expired sessions so totalMined is accurate when exposed as readyToClaim
      const nowTs = new Date();
      const expiredActiveSessions = await prisma.miningSession.findMany({
        where: {
          isActive: true,
          endsAt: {
            lte: nowTs
          }
        },
        select: { id: true }
      });

      for (const s of expiredActiveSessions) {
        await updateMiningProgress(s.id);
      }

      // Simple queries - just fetch what we need
      const [user, activeSession, completedUnclaimedSession, referrals, completedSessionsCount] = await Promise.all([
        // Get user points and mining balance
        prisma.user.findUnique({
          where: { id: userId },
          select: { points: true, miningBalance: true }
        }),
        
        // Get active mining session (only if it hasn't expired based on endsAt)
        prisma.miningSession.findFirst({
          where: { 
            userId, 
            isActive: true,
            endsAt: {
              gt: new Date() // Only get sessions that haven't reached their end time
            }
          },
          orderBy: { startedAt: 'desc' }
        }),
        
        // Get completed but unclaimed session
        prisma.miningSession.findFirst({
          where: { 
            userId, 
            isCompleted: true, 
            isClaimed: false 
          },
          orderBy: { startedAt: 'desc' }
        }),
        
        // Get referral count
        prisma.user.count({
          where: { referredBy: userId }
        }),
        
        // Get completed sessions count
        prisma.miningSession.count({
          where: {
            userId,
            isCompleted: true
          }
        })
      ]);

      // Get total earned from user's mining balance
      const totalEarned = user?.miningBalance || 0;
      
      // Calculate time remaining and current rate
      let timeRemaining = 0;
      let currentMiningRate = 0;
      let readyToClaim = 0;
      let sessionStartTime = null;
      let isMining = false;
      const baseRate = 20;
      const miningCycleDuration = 6 * 60 * 60 * 1000;
      const now = new Date();

      if (activeSession) {
        // Recalculate timeRemaining using the same 'now' timestamp to avoid race conditions
        // The query filtered by endsAt > new Date(), but time has passed since then
        timeRemaining = activeSession.endsAt.getTime() - now.getTime();
        
        // CRITICAL FIX: If timeRemaining is <= 0, the session has expired
        // Finalize it immediately and don't treat it as active
        if (timeRemaining <= 0) {
          // Session expired between query and calculation - finalize it now
          await updateMiningProgress(activeSession.id);
          // Don't set isMining = true, treat as expired
          // Will fall through to check for completedUnclaimedSession
        } else {
          // Session is still active with positive time remaining
          isMining = true;
          currentMiningRate = activeSession.currentRate;
          sessionStartTime = activeSession.startedAt;
        }
      }
      
      // Check for completed unclaimed session (either from query or just finalized)
      if (!isMining) {
        // Re-query for completed unclaimed session in case we just finalized one
        const completedUnclaimedSessionCheck = await prisma.miningSession.findFirst({
          where: { 
            userId, 
            isCompleted: true, 
            isClaimed: false 
          },
          orderBy: { startedAt: 'desc' }
        });
        
        if (completedUnclaimedSessionCheck) {
          // Ensure a rounded numeric value so UI properly shows the claim state
          readyToClaim = parseFloat((completedUnclaimedSessionCheck.totalMined || 0).toFixed(4));
          currentMiningRate = completedUnclaimedSessionCheck.currentRate;
        } else if (completedUnclaimedSession) {
          // Fallback to original query result
          readyToClaim = parseFloat((completedUnclaimedSession.totalMined || 0).toFixed(4));
          currentMiningRate = completedUnclaimedSession.currentRate;
        }
      } else if (completedUnclaimedSession) {
        // If mining is active, we still might have a completed unclaimed session from before
        // (shouldn't happen, but handle it gracefully)
        readyToClaim = parseFloat((completedUnclaimedSession.totalMined || 0).toFixed(4));
      }

      return {
        isMining,
        currentMiningRate,
        totalMiningRate: baseRate, // Simplified - no referral bonus calculation
        readyToClaim,
        nextClaimTime: activeSession ? new Date(new Date(activeSession.startedAt).getTime() + miningCycleDuration) : null,
        timeRemaining,
        sessionStartTime,
        totalEarned,
        completedSessions: completedSessionsCount,
        totalReferrals: referrals,
        activeReferrals: 0, // Simplified - we can calculate this if needed
        activeReferralBonus: 0
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
    
    // First, finalize amounts on expired sessions BEFORE marking them as inactive
    // This ensures tokens are accrued correctly before the session is marked complete
    const expiredActiveSessions = await prisma.miningSession.findMany({
      where: {
        userId,
        isActive: true,
        endsAt: {
          lte: new Date() // Sessions that have reached their end time
        }
      },
      select: { id: true }
    });
    
    // Finalize amounts for each expired session (this will mark them as inactive)
    for (const s of expiredActiveSessions) {
      await updateMiningProgress(s.id);
    }
    
    // Check if mining is already active (after cleanup)
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
    
    const now = new Date();
    const duration = 21600; // 6 hours in seconds (from schema default)
    const endsAt = new Date(now.getTime() + duration * 1000); // Calculate end time
    
    const miningSession = await prisma.miningSession.create({
      data: {
        userId,
        baseReward,
        currentRate: initialRate,
        totalMined: 0,
        lastUpdate: now,
        startedAt: now,
        endsAt: endsAt,
        duration: duration,
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
        nextClaimTime: miningSession.endsAt,
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

    // Calculate final mined amount - round to 4 decimal places for both
    const finalMinedAmount = parseFloat(completedSession.totalMined.toFixed(4));
    const pointsToAdd = finalMinedAmount; // Both get the same rounded amount

    const claimTime = new Date(); // Use claim time as start time for next session
    const duration = 21600; // 6 hours in seconds
    const endsAt = new Date(claimTime.getTime() + duration * 1000);

    // Calculate initial mining rate based on active referrals (same logic as start endpoint)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { referrals: true }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

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

    const baseReward = 20; // 20 tokens per 6-hour session (same as start endpoint)
    const referralBonus = activeReferrals * 10; // 10% per active referral
    const initialRate = baseReward + (baseReward * referralBonus / 100);

    // Mark session as claimed, claim rewards, and start next session atomically
    const result = await prisma.$transaction(async (tx) => {
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
          amount: finalMinedAmount, // Keep full decimal amount
          miningRate: completedSession.currentRate,
          referralBonus: Math.max(0, finalMinedAmount - completedSession.baseReward)
        }
      });

      // Update user's points, mining balance, and session count
      await tx.user.update({
        where: { id: userId },
        data: {
          points: {
            increment: pointsToAdd // Only integer points
          },
          miningBalance: {
            increment: finalMinedAmount // Full decimal amount
          },
          totalMiningSessionsCount: {
            increment: 1 // Increment completed sessions count
          }
        }
      });

      // Automatically start next mining session with claim time as start time
      const nextSession = await tx.miningSession.create({
        data: {
          userId,
          baseReward,
          currentRate: initialRate,
          totalMined: 0,
          lastUpdate: claimTime,
          startedAt: claimTime, // Use claim time as start time
          endsAt: endsAt,
          duration: duration,
          isActive: true
        }
      });

      // Fetch updated user points after transaction
      const updatedUser = await tx.user.findUnique({
        where: { id: userId },
        select: { points: true }
      });

      return { 
        session: nextSession,
        totalPoints: updatedUser?.points || 0
      };
    });

    // Update mining rates for all users who referred this user
    await updateReferrerMiningRates(userId);

    // Notify inactive referrals that their referrer just claimed mining rewards
    setImmediate(() => {
      notifyInactiveReferralsOfClaim(userId, user.displayName || user.username || 'Your referrer')
        .catch(err => {
          console.error('Failed to notify inactive referrals of mining claim:', err);
        });
    });

    // Check for mining achievements
    const achievementsService = require('../services/achievements');
    setImmediate(() => {
      achievementsService.checkBadgeEligibility(userId).catch(err => {
        console.error('Failed to check mining achievements:', err);
      });
    });

    // Write-through cache: Refresh user profile cache SYNCHRONOUSLY after transaction
    // This ensures cache is updated before response is sent, preventing stale data window
    // Note: Leaderboard cache is time-based (10 min TTL) and will update automatically
    try {
      await refreshUserAndLeaderboardCaches(userId);
    } catch (err) {
      // Non-blocking: Log error but don't fail the request
      console.error('Error refreshing caches after mining claim:', err);
    }

    res.json({
      success: true,
      data: {
        amount: finalMinedAmount,
        totalPoints: result.totalPoints,
        message: `Successfully claimed ${finalMinedAmount} $BUZZ tokens!`,
        nextSession: {
          sessionId: result.session.id,
          startedAt: result.session.startedAt,
          endsAt: result.session.endsAt,
          nextClaimTime: result.session.endsAt
        }
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

// Get claim history (with aggregation)
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const pagination = parsePaginationParams(req, { defaultLimit: 20, maxLimit: 100 });

    // Use data aggregation service to get mixed individual + summary records
    const { getAggregatedHistory } = require('../services/dataAggregation');
    const result = await getAggregatedHistory(
      userId,
      pagination.limit,
      pagination.cursor || null
    );

    // Determine next cursor (ID of last item in current page)
    const nextCursor = result.claims.length > 0 && result.hasMore
      ? result.claims[result.claims.length - 1].id
      : null;

    res.json({
      success: true,
      data: {
        claims: result.claims,
        hasMore: result.hasMore,
        nextCursor
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
    const pagination = parsePaginationParams(req, { defaultLimit: 20, maxLimit: 100 });
    
    // Get top miners by total earned
    // Note: For leaderboards, we typically want offset-based pagination to show ranks
    const offsetQuery = buildOffsetQuery(pagination, 'id', 'asc');
    
    const topMiners = await prisma.user.findMany({
      include: {
        miningClaims: {
          select: {
            amount: true
          }
        },
        _count: {
          select: {
            referrals: true
          }
        }
      },
      orderBy: offsetQuery.orderBy,
      skip: offsetQuery.skip,
      take: offsetQuery.take
    });

    // Calculate total earned for each user and sort
    const leaderboard = topMiners
      .map(user => ({
        id: user.id,
        name: user.displayName || user.email,
        avatar: user.avatarUrl,
        totalEarned: user.miningClaims.reduce((sum, claim) => sum + claim.amount, 0),
        referralCount: user._count?.referrals || 0
      }))
      .sort((a, b) => b.totalEarned - a.totalEarned)
      .map((user, index) => ({
        ...user,
        rank: pagination.offset + index + 1
      }));

    const totalCount = await prisma.user.count();
    const paginationResponse = buildPaginationResponseWithTotal(leaderboard, pagination, totalCount);

    res.json({
      success: true,
      data: {
        leaderboard: paginationResponse.data,
        ...paginationResponse
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
    // Calculate session end time to cap accrual at 6 hours
    const sessionEndTime = new Date(activeSession.startedAt.getTime() + 6 * 60 * 60 * 1000);
    
    // Cap elapsed time to not exceed the 6-hour session duration
    const maxElapsedTime = Math.min(
      now - activeSession.lastUpdate,
      sessionEndTime - activeSession.lastUpdate
    );
    const elapsedHours = maxElapsedTime / (1000 * 60 * 60);
    const minedSinceLastUpdate = (activeSession.currentRate * elapsedHours) / 6;

    // Don't update lastUpdate beyond the session end time
    const newLastUpdate = new Date(Math.min(now.getTime(), sessionEndTime.getTime()));

    // Update mining session with new rate and accumulated tokens
    const updatedSession = await prisma.miningSession.update({
      where: { id: activeSession.id },
      data: {
        currentRate: newRate,
        totalMined: activeSession.totalMined + minedSinceLastUpdate,
        lastUpdate: newLastUpdate
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
