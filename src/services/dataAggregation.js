const { prisma } = require('../config/database');

/**
 * Data Aggregation Service
 * Handles aggregation of historical data into summaries
 */

/**
 * Aggregate mining claims from previous complete months into monthly summaries
 * @param {string} userId - User ID
 * @param {Date} cutoffDate - Date before which to aggregate (start of current month)
 * @returns {Promise<number>} Number of summaries created
 */
async function aggregateMiningClaims(userId, cutoffDate) {
  try {
    // Get all claims from previous complete months (before current month)
    const oldClaims = await prisma.miningClaim.findMany({
      where: {
        userId,
        claimedAt: {
          lt: cutoffDate
        }
      },
      orderBy: {
        claimedAt: 'asc'
      }
    });

    if (oldClaims.length === 0) {
      return 0;
    }

    // Group claims by month
    const claimsByMonth = {};
    
    for (const claim of oldClaims) {
      const claimDate = new Date(claim.claimedAt);
      const year = claimDate.getUTCFullYear();
      const month = claimDate.getUTCMonth() + 1; // 1-12
      const period = `${year}-${String(month).padStart(2, '0')}`; // "2024-01"
      
      if (!claimsByMonth[period]) {
        claimsByMonth[period] = {
          claims: [],
          startDate: new Date(Date.UTC(year, month - 1, 1)),
          endDate: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))
        };
      }
      
      claimsByMonth[period].claims.push(claim);
    }

    // Create summaries for each month
    let summariesCreated = 0;
    
    for (const [period, data] of Object.entries(claimsByMonth)) {
      const count = data.claims.length;
      const totalAmount = data.claims.reduce((sum, claim) => sum + claim.amount, 0);
      
      // Check if summary already exists
      const existingSummary = await prisma.miningClaimSummary.findUnique({
        where: {
          userId_period_periodType: {
            userId,
            period,
            periodType: 'month'
          }
        }
      });

      if (!existingSummary) {
        await prisma.miningClaimSummary.create({
          data: {
            userId,
            period,
            periodType: 'month',
            count,
            totalAmount,
            startDate: data.startDate,
            endDate: data.endDate
          }
        });
        summariesCreated++;
      } else {
        // Update existing summary (in case of partial aggregation)
        await prisma.miningClaimSummary.update({
          where: {
            userId_period_periodType: {
              userId,
              period,
              periodType: 'month'
            }
          },
          data: {
            count: existingSummary.count + count,
            totalAmount: existingSummary.totalAmount + totalAmount
          }
        });
      }
    }

    return summariesCreated;
  } catch (error) {
    console.error(`Error aggregating mining claims for user ${userId}:`, error);
    throw error;
  }
}

/**
 * Get aggregated mining history (individual records + summaries)
 * Option B: Current month = individual, Previous complete months = summaries
 * @param {string} userId - User ID
 * @param {number} limit - Number of records to return
 * @param {string|null} cursor - Cursor for pagination (ID of last returned item)
 * @returns {Promise<Object>} Mixed array of individual and summary records
 */
async function getAggregatedHistory(userId, limit = 20, cursor = null) {
  try {
    const now = new Date();
    
    // Calculate current month boundaries (UTC)
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth();
    const currentMonthStart = new Date(Date.UTC(currentYear, currentMonth, 1, 0, 0, 0, 0));
    const currentMonthEnd = new Date(Date.UTC(currentYear, currentMonth + 1, 0, 23, 59, 59, 999));
    
    // Calculate 12 months ago (for summaries)
    const oneYearAgo = new Date(Date.UTC(currentYear, currentMonth - 11, 1, 0, 0, 0, 0));

    // Get ALL individual claims from current month only
    const allIndividualClaims = await prisma.miningClaim.findMany({
      where: {
        userId,
        claimedAt: {
          gte: currentMonthStart,
          lte: currentMonthEnd
        }
      },
      orderBy: {
        claimedAt: 'desc'
      }
    });

    // Get ALL monthly summaries for previous complete months (last 12 months, excluding current month)
    const allSummaries = await prisma.miningClaimSummary.findMany({
      where: {
        userId,
        startDate: {
          gte: oneYearAgo,
          lt: currentMonthStart // Only summaries before current month
        }
      },
      orderBy: {
        period: 'desc'
      }
    });

    // Format individual claims
    const formattedIndividual = allIndividualClaims.map(claim => ({
      id: claim.id,
      type: 'individual',
      amount: claim.amount,
      miningRate: claim.miningRate,
      referralBonus: claim.referralBonus,
      claimedAt: claim.claimedAt.toISOString()
    }));

    // Format summaries
    const formattedSummaries = allSummaries.map(summary => {
      // Format period as "January 2024"
      const [year, month] = summary.period.split('-');
      const date = new Date(parseInt(year), parseInt(month) - 1, 1);
      const periodLabel = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      
      return {
        id: summary.id,
        type: 'summary',
        period: periodLabel,
        periodRaw: summary.period,
        count: summary.count,
        totalAmount: summary.totalAmount,
        startDate: summary.startDate.toISOString(),
        endDate: summary.endDate.toISOString()
      };
    });

    // Combine and sort by date (most recent first)
    const combined = [...formattedIndividual, ...formattedSummaries].sort((a, b) => {
      const dateA = a.type === 'individual' 
        ? new Date(a.claimedAt) 
        : new Date(a.endDate);
      const dateB = b.type === 'individual'
        ? new Date(b.claimedAt)
        : new Date(b.endDate);
      return dateB - dateA; // Descending
    });

    // Handle cursor-based pagination
    let startIndex = 0;
    if (cursor) {
      const cursorIndex = combined.findIndex(item => item.id === cursor);
      if (cursorIndex !== -1) {
        startIndex = cursorIndex + 1; // Start after the cursor item
      }
    }

    // Get the requested page
    const paginated = combined.slice(startIndex, startIndex + limit);
    
    // Determine if there's more data
    const hasMore = startIndex + limit < combined.length;

    return {
      claims: paginated,
      hasMore
    };
  } catch (error) {
    console.error(`Error getting aggregated history for user ${userId}:`, error);
    throw error;
  }
}

/**
 * Aggregate claims for all users (batch operation)
 * @param {Date} cutoffDate - Date before which to aggregate
 * @returns {Promise<Object>} Aggregation results
 */
async function aggregateAllUsersClaims(cutoffDate) {
  try {
    const users = await prisma.user.findMany({
      select: { id: true }
    });

    let totalSummaries = 0;
    let totalDeleted = 0;
    let errors = 0;

    for (const user of users) {
      try {
        const summariesCreated = await aggregateMiningClaims(user.id, cutoffDate);
        
        if (summariesCreated > 0) {
          // Delete the aggregated individual claims
          const deleteResult = await prisma.miningClaim.deleteMany({
            where: {
              userId: user.id,
              claimedAt: {
                lt: cutoffDate
              }
            }
          });
          
          totalSummaries += summariesCreated;
          totalDeleted += deleteResult.count;
        }
      } catch (error) {
        console.error(`Error aggregating claims for user ${user.id}:`, error);
        errors++;
      }
    }

    return {
      usersProcessed: users.length,
      summariesCreated: totalSummaries,
      claimsDeleted: totalDeleted,
      errors
    };
  } catch (error) {
    console.error('Error in batch aggregation:', error);
    throw error;
  }
}

module.exports = {
  aggregateMiningClaims,
  getAggregatedHistory,
  aggregateAllUsersClaims
};

