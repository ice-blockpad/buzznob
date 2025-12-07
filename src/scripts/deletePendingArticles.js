/**
 * Delete All Pending Articles
 * Removes all articles with 'pending' status from the database
 */

require('dotenv').config();
const { connectDB, disconnectDB } = require('../config/database');
const { prisma } = require('../config/database');

async function deletePendingArticles() {
  console.log('🗑️  Deleting all pending articles...\n');

  try {
    // Connect to database
    await connectDB();

    // Count pending articles first
    const count = await prisma.article.count({
      where: {
        status: 'pending'
      }
    });

    console.log(`📊 Found ${count} pending articles`);

    if (count === 0) {
      console.log('✅ No pending articles to delete');
      await disconnectDB();
      return;
    }

    // Delete all pending articles
    const result = await prisma.article.deleteMany({
      where: {
        status: 'pending'
      }
    });

    console.log(`✅ Successfully deleted ${result.count} pending articles`);
    console.log('\n✅ Cleanup complete');

  } catch (error) {
    console.error('❌ Error deleting pending articles:', error);
    throw error;
  } finally {
    // Disconnect from database
    await disconnectDB();
  }
}

// Run if called directly
if (require.main === module) {
  deletePendingArticles()
    .then(() => {
      console.log('\n✅ Script completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = deletePendingArticles;


