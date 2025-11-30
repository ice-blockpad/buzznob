const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { aggregateAllUsersClaims } = require('../services/dataAggregation');

/**
 * Migration script to aggregate existing MiningClaim records older than 30 days
 * Run this to compress historical data before enabling cleanup
 */
async function aggregateExistingClaims() {
  console.log('🔄 Starting mining claims aggregation...');
  
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    console.log(`📅 Aggregating claims older than: ${thirtyDaysAgo.toISOString()}`);
    
    const result = await aggregateAllUsersClaims(thirtyDaysAgo);
    
    console.log(`\n✅ Aggregation completed!`);
    console.log(`   Users processed: ${result.usersProcessed}`);
    console.log(`   Summaries created: ${result.summariesCreated}`);
    console.log(`   Claims deleted: ${result.claimsDeleted}`);
    console.log(`   Errors: ${result.errors}`);
  } catch (error) {
    console.error('❌ Aggregation failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration if called directly
if (require.main === module) {
  aggregateExistingClaims()
    .then(() => {
      console.log('✅ Aggregation script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Aggregation script failed:', error);
      process.exit(1);
    });
}

module.exports = { aggregateExistingClaims };

