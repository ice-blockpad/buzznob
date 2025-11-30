const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Migration script to populate User count fields from existing records
 * Run this BEFORE enabling cleanup to ensure counts are accurate
 */
async function migrateUserCounts() {
  console.log('🔄 Starting user counts migration...');
  
  try {
    const users = await prisma.user.findMany({
      select: { id: true, username: true }
    });

    console.log(`📊 Found ${users.length} users to process`);

    let processed = 0;
    let errors = 0;

    for (const user of users) {
      try {
        // Count UserActivity records
        const activityCount = await prisma.userActivity.count({
          where: { userId: user.id }
        });

        // Count completed+claimed MiningSession records
        const sessionCount = await prisma.miningSession.count({
          where: {
            userId: user.id,
            isCompleted: true,
            isClaimed: true
          }
        });

        // Update user counts
        await prisma.user.update({
          where: { id: user.id },
          data: {
            totalArticlesReadCount: activityCount,
            totalMiningSessionsCount: sessionCount
          }
        });

        processed++;
        if (processed % 100 === 0) {
          console.log(`✅ Processed ${processed}/${users.length} users...`);
        }
      } catch (error) {
        console.error(`❌ Error processing user ${user.id} (${user.username}):`, error);
        errors++;
      }
    }

    console.log(`\n✅ Migration completed!`);
    console.log(`   Processed: ${processed}`);
    console.log(`   Errors: ${errors}`);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration if called directly
if (require.main === module) {
  migrateUserCounts()
    .then(() => {
      console.log('✅ Migration script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateUserCounts };

