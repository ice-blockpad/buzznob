const express = require('express');
const { prisma } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const achievementsService = require('../services/achievements');

const router = express.Router();

// Get user's achievements
router.get('/my-achievements', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const achievements = await achievementsService.getUserAchievements(userId);

    res.json({
      success: true,
      data: achievements
    });

  } catch (error) {
    console.error('Get user achievements error:', error);
    res.status(500).json({
      success: false,
      error: 'ACHIEVEMENTS_FETCH_ERROR',
      message: 'Failed to fetch achievements'
    });
  }
});

// Check achievements for current user
router.post('/check', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    await achievementsService.checkBadgeEligibility(userId);

    res.json({
      success: true,
      message: 'Achievements checked successfully'
    });

  } catch (error) {
    console.error('Check achievements error:', error);
    res.status(500).json({
      success: false,
      error: 'ACHIEVEMENTS_CHECK_ERROR',
      message: 'Failed to check achievements'
    });
  }
});

// Get all available badges
router.get('/badges', authenticateToken, async (req, res) => {
  try {
    const badges = await prisma.badge.findMany({
      orderBy: { pointsRequired: 'asc' }
    });

    res.json({
      success: true,
      data: { badges }
    });

  } catch (error) {
    console.error('Get badges error:', error);
    res.status(500).json({
      success: false,
      error: 'BADGES_FETCH_ERROR',
      message: 'Failed to fetch achievement badges'
    });
  }
});

// Admin: Check achievements for all users
router.post('/admin/check-all', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'ACCESS_DENIED',
        message: 'Only admins can perform this action'
      });
    }

    await achievementsService.checkAllUsersAchievements();

    res.json({
      success: true,
      message: 'Achievements checked for all users'
    });

  } catch (error) {
    console.error('Admin check all achievements error:', error);
    res.status(500).json({
      success: false,
      error: 'ADMIN_ACHIEVEMENTS_CHECK_ERROR',
      message: 'Failed to check achievements for all users'
    });
  }
});

module.exports = router;
