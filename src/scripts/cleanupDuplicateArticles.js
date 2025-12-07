/**
 * Script: Cleanup Duplicate Articles
 * Removes duplicate articles before adding unique constraint on sourceUrl
 * Keeps the oldest article and deletes newer duplicates
 */

require('dotenv').config();
const { connectDB, disconnectDB, prisma } = require('../config/database');

async function cleanupDuplicateArticles() {
  console.log('\n' + '='.repeat(80));
  console.log('🧹 CLEANUP DUPLICATE ARTICLES');
  console.log('='.repeat(80));
  console.log(`Date: ${new Date().toISOString()}\n`);

  try {
    // Connect to database
    await connectDB();
    console.log('✅ Database connected\n');

    // Find all duplicate sourceUrls (excluding nulls)
    console.log('🔍 Finding duplicate articles by sourceUrl...');
    
    // Use raw SQL to find duplicates efficiently
    const duplicates = await prisma.$queryRaw`
      SELECT source_url, COUNT(*) as count
      FROM articles
      WHERE source_url IS NOT NULL
      GROUP BY source_url
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
    `;

    if (duplicates.length === 0) {
      console.log('✅ No duplicate articles found!');
      console.log('   Database is ready for unique constraint.\n');
      return {
        success: true,
        duplicatesRemoved: 0,
        message: 'No duplicates found'
      };
    }

    console.log(`📊 Found ${duplicates.length} sourceUrls with duplicates:\n`);
    
    let totalRemoved = 0;
    let totalKept = 0;

    // Process each duplicate sourceUrl
    for (const dup of duplicates) {
      const sourceUrl = dup.source_url;
      const count = parseInt(dup.count);
      
      console.log(`\n📰 Processing: ${sourceUrl.substring(0, 60)}...`);
      console.log(`   Found ${count} duplicate(s)`);

      // Get all articles with this sourceUrl, ordered by createdAt (oldest first)
      const articles = await prisma.article.findMany({
        where: {
          sourceUrl: sourceUrl
        },
        orderBy: {
          createdAt: 'asc' // Oldest first
        },
        select: {
          id: true,
          title: true,
          createdAt: true,
          status: true
        }
      });

      if (articles.length <= 1) continue; // Shouldn't happen, but safety check

      // Keep the first (oldest) article
      const keepArticle = articles[0];
      const duplicatesToRemove = articles.slice(1);

      console.log(`   ✅ Keeping: ${keepArticle.id} (created: ${keepArticle.createdAt.toISOString()})`);
      console.log(`   🗑️  Removing ${duplicatesToRemove.length} duplicate(s):`);

      // Delete duplicates
      for (const article of duplicatesToRemove) {
        console.log(`      - ${article.id} (${article.title.substring(0, 40)}...)`);
        
        try {
          await prisma.article.delete({
            where: {
              id: article.id
            }
          });
          totalRemoved++;
        } catch (error) {
          console.error(`      ❌ Error deleting ${article.id}:`, error.message);
        }
      }

      totalKept++;
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ CLEANUP COMPLETE!');
    console.log('='.repeat(80));
    console.log(`   Duplicate sourceUrls processed: ${totalKept}`);
    console.log(`   Articles removed: ${totalRemoved}`);
    console.log(`   Articles kept: ${totalKept}`);
    console.log('\n📝 Next step: Run database migration to add unique constraint');
    console.log('   npx prisma migrate dev --name add_unique_sourceurl\n');

    return {
      success: true,
      duplicatesRemoved: totalRemoved,
      duplicatesKept: totalKept,
      message: `Removed ${totalRemoved} duplicate articles`
    };

  } catch (error) {
    console.error('❌ Error:', error);
    console.error('   Stack:', error.stack);
    return {
      success: false,
      duplicatesRemoved: 0,
      error: error.message
    };
  } finally {
    // Disconnect from database
    await disconnectDB();
    console.log('✅ Database disconnected');
  }
}

// Run if called directly
if (require.main === module) {
  cleanupDuplicateArticles()
    .then((result) => {
      if (result.success) {
        console.log('\n✅ Script completed successfully!');
        process.exit(0);
      } else {
        console.log('\n❌ Script failed');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('\n❌ Unhandled error:', error);
      process.exit(1);
    });
}

module.exports = { cleanupDuplicateArticles };

