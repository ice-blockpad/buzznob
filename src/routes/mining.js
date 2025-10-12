const express = require('express');
const { prisma } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');

const router = express.Router();

// Get mining stats for user
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get user's mining stats
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        referrals: true,
        miningClaims: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Calculate mining stats
    const baseRate = 10; // 10 tokens per hour
    const miningCycleDuration = parseInt(process.env.MINING_CYCLE_DURATION) || (6 * 60 * 60 * 1000); // 6 hours in milliseconds
    
    // Calculate active referral bonus (10% per active referred user who is also mining)
    let activeReferralBonus = 0;
    if (user.referrals && user.referrals.length > 0) {
      // Check which referred users are currently mining
      const activeReferredUsers = await prisma.user.findMany({
        where: {
          referredBy: userId,
          miningClaims: {
            some: {
              claimedAt: {
                gte: new Date(Date.now() - miningCycleDuration)
              }
            }
          }
        }
      });
      
      // Only count active referred users for bonus
      activeReferralBonus = activeReferredUsers.length * 10; // 10% per active referral
    }
    
    const totalMiningRate = baseRate + (baseRate * activeReferralBonus / 100);
    
    // Calculate ready to claim (6-hour mining cycle)
    const lastClaim = user.miningClaims[0];
    const now = new Date();
    
    let readyToClaim = 0;
    let nextClaimTime = null;
    let isMining = false;
    
    if (lastClaim) {
      const timeSinceLastClaim = now - new Date(lastClaim.claimedAt);
      
      if (timeSinceLastClaim < miningCycleDuration) {
        // Still within mining cycle
        const hoursSinceLastClaim = timeSinceLastClaim / (1000 * 60 * 60);
        readyToClaim = Math.floor(hoursSinceLastClaim * totalMiningRate);
        nextClaimTime = new Date(lastClaim.claimedAt.getTime() + miningCycleDuration);
        isMining = true; // Still mining
      } else {
        // Mining cycle completed, mining has stopped
        const cycleHours = miningCycleDuration / (1000 * 60 * 60);
        readyToClaim = Math.floor(cycleHours * totalMiningRate); // Max tokens from full cycle
        nextClaimTime = null; // Can claim anytime
        isMining = false; // Mining stopped
      }
    } else {
      // No previous claims, can start mining
      readyToClaim = 0;
      nextClaimTime = new Date(now.getTime() + miningCycleDuration);
      isMining = false; // Not started yet
    }
    
    // Calculate total earned
    const totalEarned = user.miningClaims?.reduce((sum, claim) => sum + claim.amount, 0) || 0;

    res.json({
      success: true,
      data: {
        miningRate: totalMiningRate,
        baseRate: baseRate,
        activeReferralBonus: activeReferralBonus,
        activeReferralCount: user.referrals ? user.referrals.length : 0,
        totalMiningRate,
        readyToClaim,
        totalEarned,
        nextClaimTime: nextClaimTime ? nextClaimTime.toISOString() : null,
        isMining
      }
    });
  } catch (error) {
    console.error('Error fetching mining stats:', error);
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
    const lastClaim = await prisma.miningClaim.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });
    
    const now = new Date();
    const miningCycleDuration = parseInt(process.env.MINING_CYCLE_DURATION) || (6 * 60 * 60 * 1000); // 6 hours
    
    if (lastClaim) {
      const timeSinceLastClaim = now - new Date(lastClaim.claimedAt);
      
      // If still within mining cycle, mining is already active
      if (timeSinceLastClaim < miningCycleDuration) {
        return res.status(400).json({
          success: false,
          message: 'Mining is already active. Please wait for the current cycle to complete or claim your rewards.'
        });
      }
    }
    
    // Start new mining cycle by creating a claim record (even with 0 amount)
    await prisma.miningClaim.create({
      data: {
        userId,
        amount: 0, // Start with 0, will accumulate over mining cycle
        claimedAt: now
      }
    });
    
    const cycleHours = miningCycleDuration / (1000 * 60 * 60);
    res.json({
      success: true,
      data: {
        message: `Mining started successfully. You can claim rewards after ${cycleHours} hours.`,
        isMining: true,
        nextClaimTime: new Date(now.getTime() + miningCycleDuration)
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
    
    // Get current mining stats
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        referrals: true,
        miningClaims: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Calculate claimable amount
    const baseRate = 10;
    const miningCycleDuration = parseInt(process.env.MINING_CYCLE_DURATION) || (6 * 60 * 60 * 1000); // 6 hours
    
    // Calculate active referral bonus (10% per active referred user who is also mining)
    let activeReferralBonus = 0;
    if (user.referrals && user.referrals.length > 0) {
      // Check which referred users are currently mining
      const activeReferredUsers = await prisma.user.findMany({
        where: {
          referredBy: userId,
          miningClaims: {
            some: {
              claimedAt: {
                gte: new Date(Date.now() - miningCycleDuration)
              }
            }
          }
        }
      });
      
      // Only count active referred users for bonus
      activeReferralBonus = activeReferredUsers.length * 10; // 10% per active referral
    }
    
    const totalMiningRate = baseRate + (baseRate * activeReferralBonus / 100);
    
    const lastClaim = user.miningClaims[0];
    const now = new Date();
    
    if (!lastClaim) {
      return res.status(400).json({
        success: false,
        message: 'No mining session found. Please start mining first.'
      });
    }
    
    const timeSinceLastClaim = now - new Date(lastClaim.claimedAt);
    const hoursSinceLastClaim = timeSinceLastClaim / (1000 * 60 * 60);
    const cycleHours = miningCycleDuration / (1000 * 60 * 60);
    
    // Calculate claimable amount based on mining cycle
    let claimableAmount;
    if (hoursSinceLastClaim < cycleHours) {
      // Still within mining cycle, calculate partial amount
      claimableAmount = Math.floor(hoursSinceLastClaim * totalMiningRate);
    } else {
      // Mining cycle completed, claim full cycle amount
      claimableAmount = Math.floor(cycleHours * totalMiningRate);
    }

    if (claimableAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'No tokens ready to claim'
      });
    }

    // Create mining claim record
    const claim = await prisma.miningClaim.create({
      data: {
        userId,
        amount: claimableAmount,
        miningRate: totalMiningRate,
        referralBonus: activeReferralBonus,
        claimedAt: now
      }
    });

    res.json({
      success: true,
      data: {
        amount: claimableAmount,
        miningRate: totalMiningRate,
        referralBonus,
        nextClaimTime: nextClaimTime.toISOString(),
        claimId: claim.id
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

// Use error handler middleware
router.use(errorHandler);

module.exports = router;
