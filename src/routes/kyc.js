const express = require('express');
const { prisma } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');

const router = express.Router();

// Submit KYC application
router.post('/submit', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      fullName,
      dateOfBirth,
      address,
      phoneNumber,
      idType,
      idNumber,
      idImageUrl,
      selfieUrl
    } = req.body;

    // Validate required fields
    if (!fullName || !dateOfBirth || !address || !phoneNumber || !idType || !idNumber || !idImageUrl || !selfieUrl) {
      return res.status(400).json({
        success: false,
        error: 'KYC_DATA_REQUIRED',
        message: 'All KYC fields are required'
      });
    }

    // Check if user already has a pending or approved KYC
    const existingKyc = await prisma.kycSubmission.findFirst({
      where: {
        userId,
        status: {
          in: ['pending', 'verified']
        }
      }
    });

    if (existingKyc) {
      return res.status(400).json({
        success: false,
        error: 'KYC_ALREADY_SUBMITTED',
        message: 'You already have a pending or approved KYC submission'
      });
    }

    // Create KYC submission
    const kycSubmission = await prisma.kycSubmission.create({
      data: {
        userId,
        fullName,
        dateOfBirth,
        address,
        phoneNumber,
        idType,
        idNumber,
        idImageUrl,
        selfieUrl,
        status: 'pending'
      }
    });

    // Update user KYC status
    await prisma.user.update({
      where: { id: userId },
      data: {
        kycStatus: 'pending'
      }
    });

    res.json({
      success: true,
      message: 'KYC application submitted successfully',
      data: {
        kycSubmission: {
          id: kycSubmission.id,
          status: kycSubmission.status,
          submittedAt: kycSubmission.createdAt
        }
      }
    });

  } catch (error) {
    console.error('KYC submission error:', error);
    res.status(500).json({
      success: false,
      error: 'KYC_SUBMISSION_ERROR',
      message: 'Failed to submit KYC application'
    });
  }
});

// Get KYC status
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const kycSubmission = await prisma.kycSubmission.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    if (!kycSubmission) {
      return res.json({
        success: true,
        data: {
          status: 'not_submitted',
          message: 'No KYC submission found'
        }
      });
    }

    res.json({
      success: true,
      data: {
        status: kycSubmission.status,
        submittedAt: kycSubmission.createdAt,
        reviewedAt: kycSubmission.reviewedAt,
        rejectionReason: kycSubmission.rejectionReason
      }
    });

  } catch (error) {
    console.error('Get KYC status error:', error);
    res.status(500).json({
      success: false,
      error: 'KYC_STATUS_ERROR',
      message: 'Failed to get KYC status'
    });
  }
});

// Get KYC submission details (for user to view their submission)
router.get('/submission', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const kycSubmission = await prisma.kycSubmission.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    if (!kycSubmission) {
      return res.status(404).json({
        success: false,
        error: 'KYC_NOT_FOUND',
        message: 'No KYC submission found'
      });
    }

    res.json({
      success: true,
      data: {
        kycSubmission: {
          id: kycSubmission.id,
          fullName: kycSubmission.fullName,
          dateOfBirth: kycSubmission.dateOfBirth,
          address: kycSubmission.address,
          phoneNumber: kycSubmission.phoneNumber,
          idType: kycSubmission.idType,
          idNumber: kycSubmission.idNumber,
          idImageUrl: kycSubmission.idImageUrl,
          selfieUrl: kycSubmission.selfieUrl,
          status: kycSubmission.status,
          rejectionReason: kycSubmission.rejectionReason,
          submittedAt: kycSubmission.createdAt,
          reviewedAt: kycSubmission.reviewedAt
        }
      }
    });

  } catch (error) {
    console.error('Get KYC submission error:', error);
    res.status(500).json({
      success: false,
      error: 'KYC_SUBMISSION_FETCH_ERROR',
      message: 'Failed to get KYC submission'
    });
  }
});

// Admin: Get all KYC submissions (for admin review)
router.get('/admin/submissions', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'ACCESS_DENIED',
        message: 'Admin access required'
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status;
    const skip = (page - 1) * limit;

    const where = {};
    if (status) where.status = status;

    const kycSubmissions = await prisma.kycSubmission.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            displayName: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    });

    const totalCount = await prisma.kycSubmission.count({ where });

    res.json({
      success: true,
      data: {
        kycSubmissions,
        pagination: {
          page,
          limit,
          total: totalCount,
          pages: Math.ceil(totalCount / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get admin KYC submissions error:', error);
    res.status(500).json({
      success: false,
      error: 'ADMIN_KYC_FETCH_ERROR',
      message: 'Failed to get KYC submissions'
    });
  }
});

// Admin: Review KYC submission
router.put('/admin/:submissionId/review', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'ACCESS_DENIED',
        message: 'Admin access required'
      });
    }

    const { submissionId } = req.params;
    const { status, rejectionReason } = req.body;

    if (!status || !['verified', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_STATUS',
        message: 'Status must be "verified" or "rejected"'
      });
    }

    if (status === 'rejected' && !rejectionReason) {
      return res.status(400).json({
        success: false,
        error: 'REJECTION_REASON_REQUIRED',
        message: 'Rejection reason is required when rejecting KYC'
      });
    }

    const kycSubmission = await prisma.kycSubmission.findUnique({
      where: { id: submissionId },
      include: { user: true }
    });

    if (!kycSubmission) {
      return res.status(404).json({
        success: false,
        error: 'KYC_SUBMISSION_NOT_FOUND',
        message: 'KYC submission not found'
      });
    }

    // Update KYC submission
    const updatedKyc = await prisma.kycSubmission.update({
      where: { id: submissionId },
      data: {
        status,
        rejectionReason: status === 'rejected' ? rejectionReason : null,
        reviewedBy: req.user.id,
        reviewedAt: new Date()
      }
    });

    // Update user KYC status
    await prisma.user.update({
      where: { id: kycSubmission.userId },
      data: {
        kycStatus: status,
        isVerified: status === 'verified'
      }
    });

    res.json({
      success: true,
      message: `KYC submission ${status} successfully`,
      data: { kycSubmission: updatedKyc }
    });

  } catch (error) {
    console.error('Review KYC submission error:', error);
    res.status(500).json({
      success: false,
      error: 'KYC_REVIEW_ERROR',
      message: 'Failed to review KYC submission'
    });
  }
});

// Use error handler middleware
router.use(errorHandler);

module.exports = router;
