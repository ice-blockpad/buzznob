const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Migration script to create ReadArticle records from existing UserActivity records
 * This ensures duplicate prevention works even after UserActivity records are deleted
 */
async function migrateReadArticles() {
  console.log('🔄 Starting ReadArticle migration...');
  
  try {
    // Get all UserActivity records
    const activities = await prisma.userActivity.findMany({
      select: {
        userId: true,
        articleId: true
      },
      distinct: ['userId', 'articleId'] // Get unique combinations
    });

    console.log(`📊 Found ${activities.length} unique user-article combinations`);

    let created = 0;
    let skipped = 0;
    let errors = 0;

    // Process in batches to avoid memory issues
    const batchSize = 1000;
    for (let i = 0; i < activities.length; i += batchSize) {
      const batch = activities.slice(i, i + batchSize);
      
      for (const activity of batch) {
        try {
          // Check if ReadArticle already exists
          const existing = await prisma.readArticle.findFirst({
            where: {
              userId: activity.userId,
              articleId: activity.articleId
            }
          });

          if (!existing) {
            await prisma.readArticle.create({
              data: {
                userId: activity.userId,
                articleId: activity.articleId
              }
            });
            created++;
          } else {
            skipped++;
          }

          if ((created + skipped) % 1000 === 0) {
            console.log(`✅ Processed ${created + skipped}/${activities.length}... (${created} created, ${skipped} skipped)`);
          }
        } catch (error) {
          // Handle unique constraint violations (duplicates)
          if (error.code === 'P2002') {
            skipped++;
          } else {
            console.error(`❌ Error creating ReadArticle for user ${activity.userId}, article ${activity.articleId}:`, error);
            errors++;
          }
        }
      }
    }

    console.log(`\n✅ Migration completed!`);
    console.log(`   Created: ${created}`);
    console.log(`   Skipped (already exists): ${skipped}`);
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
  migrateReadArticles()
    .then(() => {
      console.log('✅ Migration script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateReadArticles };

