const express = require('express');
const { prisma } = require('../config/database');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');
const cacheService = require('../services/cacheService');
const { refreshUserAndLeaderboardCaches } = require('../services/cacheRefreshHelpers');

const router = express.Router();

// Get all active quests (public endpoint)
router.get('/', optionalAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    
    // Get active quests
    const quests = await prisma.quest.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' }
    });

    // If user is authenticated, get their completion status
    let userCompletions = [];
    if (userId) {
      userCompletions = await prisma.questCompletion.findMany({
        where: { userId },
        select: {
          questId: true,
          status: true,
          completedAt: true,
          verifiedAt: true
        }
      });
    }

    // Create a map of quest completions
    const completionMap = new Map();
    userCompletions.forEach(completion => {
      completionMap.set(completion.questId, completion);
    });

    // Attach completion status to each quest
    const questsWithStatus = quests.map(quest => {
      const completion = completionMap.get(quest.id);
      return {
        ...quest,
        isCompleted: !!completion,
        isVerified: completion?.status === 'verified',
        completedAt: completion?.completedAt || null,
        verifiedAt: completion?.verifiedAt || null
      };
    });

    res.json({
      success: true,
      data: { quests: questsWithStatus }
    });
  } catch (error) {
    console.error('Get quests error:', error);
    res.status(500).json({
      success: false,
      error: 'QUESTS_FETCH_ERROR',
      message: 'Failed to fetch quests'
    });
  }
});

// Complete a quest (user marks as completed)
router.post('/:questId/complete', authenticateToken, async (req, res) => {
  try {
    const { questId } = req.params;
    const userId = req.user.id;

    // Check if quest exists and is active
    const quest = await prisma.quest.findUnique({
      where: { id: questId }
    });

    if (!quest) {
      return res.status(404).json({
        success: false,
        error: 'QUEST_NOT_FOUND',
        message: 'Quest not found'
      });
    }

    if (!quest.isActive) {
      return res.status(400).json({
        success: false,
        error: 'QUEST_INACTIVE',
        message: 'Quest is not active'
      });
    }

    // Use transaction to ensure atomicity
    const completion = await prisma.$transaction(async (tx) => {
      // Check if completion already exists
      const existing = await tx.questCompletion.findUnique({
        where: {
          userId_questId: {
            userId,
            questId
          }
        }
      });

      if (existing) {
        // Update existing completion
        return await tx.questCompletion.update({
          where: {
            userId_questId: {
              userId,
              questId
            }
          },
          data: {
            status: 'completed',
            completedAt: new Date()
          }
        });
      } else {
        // Create new completion
        return await tx.questCompletion.create({
          data: {
            userId,
            questId,
            status: 'completed',
            completedAt: new Date()
          }
        });
      }
    });

    res.json({
      success: true,
      message: 'Quest marked as completed',
      data: { completion }
    });

  } catch (error) {
    console.error('Complete quest error:', error);
    res.status(500).json({
      success: false,
      error: 'QUEST_COMPLETE_ERROR',
      message: 'Failed to complete quest'
    });
  }
});

// Verify a quest (user verifies completion to claim reward)
router.post('/:questId/verify', authenticateToken, async (req, res) => {
  try {
    const { questId } = req.params;
    const userId = req.user.id;

    // Check if quest exists and is active
    const quest = await prisma.quest.findUnique({
      where: { id: questId }
    });

    if (!quest) {
      return res.status(404).json({
        success: false,
        error: 'QUEST_NOT_FOUND',
        message: 'Quest not found'
      });
    }

    if (!quest.isActive) {
      return res.status(400).json({
        success: false,
        error: 'QUEST_INACTIVE',
        message: 'Quest is not active'
      });
    }

    // Use transaction to ensure atomicity (verify quest and award points)
    const result = await prisma.$transaction(async (tx) => {
      // Check if completion exists
      const existing = await tx.questCompletion.findUnique({
        where: {
          userId_questId: {
            userId,
            questId
          }
        }
      });

      if (!existing) {
        throw new Error('QUEST_NOT_COMPLETED');
      }

      if (existing.status === 'verified') {
        throw new Error('QUEST_ALREADY_VERIFIED');
      }

      // Update completion to verified
      const updatedCompletion = await tx.questCompletion.update({
        where: {
          userId_questId: {
            userId,
            questId
          }
        },
        data: {
          status: 'verified',
          verifiedAt: new Date()
        }
      });

      // Award points to user
      await tx.user.update({
        where: { id: userId },
        data: {
          points: { increment: quest.reward }
        }
      });

      // Fetch updated user points after transaction
      const updatedUser = await tx.user.findUnique({
        where: { id: userId },
        select: { points: true }
      });

      return { 
        completion: updatedCompletion, 
        reward: quest.reward,
        totalPoints: updatedUser?.points || 0
      };
    });

    // Write-through cache: Refresh user profile cache SYNCHRONOUSLY after transaction
    // This ensures cache is updated before response is sent, preventing stale data window
    // Note: Leaderboard cache is time-based (10 min TTL) and will update automatically
    try {
      await refreshUserAndLeaderboardCaches(userId);
    } catch (err) {
      // Non-blocking: Log error but don't fail the request
      console.error('Error refreshing caches after quest verification:', err);
    }

    res.json({
      success: true,
      message: `Quest verified! You earned ${quest.reward} BUZZ`,
      data: {
        ...result,
        totalPoints: result.totalPoints
      }
    });

  } catch (error) {
    console.error('Verify quest error:', error);
    
    if (error.message === 'QUEST_NOT_COMPLETED') {
      return res.status(400).json({
        success: false,
        error: 'QUEST_NOT_COMPLETED',
        message: 'Please complete the quest first'
      });
    }

    if (error.message === 'QUEST_ALREADY_VERIFIED') {
      return res.status(400).json({
        success: false,
        error: 'QUEST_ALREADY_VERIFIED',
        message: 'Quest has already been verified'
      });
    }

    res.status(500).json({
      success: false,
      error: 'QUEST_VERIFY_ERROR',
      message: 'Failed to verify quest'
    });
  }
});

// Use error handler middleware
router.use(errorHandler);

module.exports = router;

