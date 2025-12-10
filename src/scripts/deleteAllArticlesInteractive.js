/**
 * Delete All Articles and News Content (Interactive Version)
 * This version asks for confirmation before deleting
 * 
 * Removes ALL articles and related data from the database:
 * - All articles (all statuses: pending, published, rejected)
 * - All user reading history (ReadArticle)
 * - All article-related activities (UserActivity)
 */

require('dotenv').config();
const readline = require('readline');
const { connectDB, disconnectDB } = require('../config/database');
const { prisma } = require('../config/database');

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

async function deleteAllArticlesInteractive() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('   🗑️  DELETE ALL ARTICLES AND NEWS CONTENT');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('⚠️  WARNING: This will PERMANENTLY delete ALL articles and related data!\n');

  try {
    // Connect to database
    await connectDB();

    // Get statistics before deletion
    console.log('📊 Current Database Statistics:\n');
    
    const totalArticles = await prisma.article.count();
    const publishedArticles = await prisma.article.count({ where: { status: 'published' } });
    const pendingArticles = await prisma.article.count({ where: { status: 'pending' } });
    const rejectedArticles = await prisma.article.count({ where: { status: 'rejected' } });
    const totalReadArticles = await prisma.readArticle.count();
    const totalUserActivities = await prisma.userActivity.count();

    console.log(`   Articles:`);
    console.log(`   - Total: ${totalArticles}`);
    console.log(`   - Published: ${publishedArticles}`);
    console.log(`   - Pending: ${pendingArticles}`);
    console.log(`   - Rejected: ${rejectedArticles}`);
    console.log(`\n   Related Data:`);
    console.log(`   - Read Articles: ${totalReadArticles}`);
    console.log(`   - User Activities: ${totalUserActivities}`);
    console.log('');

    if (totalArticles === 0) {
      console.log('✅ No articles to delete\n');
      rl.close();
      await disconnectDB();
      return;
    }

    // Ask for confirmation
    console.log('⚠️  This action CANNOT be undone!\n');
    const answer = await askQuestion('Are you sure you want to delete ALL articles? (yes/no): ');

    if (answer.toLowerCase() !== 'yes') {
      console.log('\n❌ Deletion cancelled by user');
      rl.close();
      await disconnectDB();
      return;
    }

    // Second confirmation for safety
    const finalAnswer = await askQuestion('\n⚠️  FINAL CONFIRMATION: Type "DELETE ALL" to proceed: ');

    if (finalAnswer !== 'DELETE ALL') {
      console.log('\n❌ Deletion cancelled - confirmation text did not match');
      rl.close();
      await disconnectDB();
      return;
    }

    console.log('\n⏳ Starting deletion process...\n');

    // Delete all read articles (reading history)
    console.log('🗑️  Deleting read articles...');
    const deletedReadArticles = await prisma.readArticle.deleteMany({});
    console.log(`   ✅ Deleted ${deletedReadArticles.count} read article records`);

    // Delete all user activities related to articles
    console.log('🗑️  Deleting user activities...');
    const deletedActivities = await prisma.userActivity.deleteMany({});
    console.log(`   ✅ Deleted ${deletedActivities.count} user activity records`);

    // Delete all articles (this will cascade delete any remaining related data)
    console.log('🗑️  Deleting all articles...');
    const deletedArticles = await prisma.article.deleteMany({});
    console.log(`   ✅ Deleted ${deletedArticles.count} articles`);

    // Verify deletion
    console.log('\n📊 Verification:\n');
    const remainingArticles = await prisma.article.count();
    const remainingReadArticles = await prisma.readArticle.count();
    const remainingActivities = await prisma.userActivity.count();

    console.log(`   - Remaining Articles: ${remainingArticles}`);
    console.log(`   - Remaining Read Articles: ${remainingReadArticles}`);
    console.log(`   - Remaining User Activities: ${remainingActivities}`);

    if (remainingArticles === 0 && remainingReadArticles === 0 && remainingActivities === 0) {
      console.log('\n✅ ALL articles and related data successfully deleted!');
    } else {
      console.log('\n⚠️  Warning: Some records may remain');
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('   📋 DELETION SUMMARY');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`   - Total Articles Deleted: ${deletedArticles.count}`);
    console.log(`   - Read Articles Deleted: ${deletedReadArticles.count}`);
    console.log(`   - User Activities Deleted: ${deletedActivities.count}`);
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log('✅ Cleanup complete!');

  } catch (error) {
    console.error('\n❌ Error deleting articles:', error);
    throw error;
  } finally {
    // Close readline interface
    rl.close();
    // Disconnect from database
    await disconnectDB();
  }
}

// Run if called directly
if (require.main === module) {
  deleteAllArticlesInteractive()
    .then(() => {
      console.log('\n✅ Script completed successfully\n');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Script failed:', error);
      console.log('');
      process.exit(1);
    });
}

module.exports = deleteAllArticlesInteractive;

