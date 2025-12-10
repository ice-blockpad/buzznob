require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkCount() {
  try {
    const articleCount = await prisma.article.count();
    const readArticleCount = await prisma.readArticle.count();
    const activityCount = await prisma.userActivity.count();
    
    console.log('\n📊 Current Database Status:');
    console.log('   - Articles:', articleCount);
    console.log('   - Read Articles:', readArticleCount);
    console.log('   - User Activities:', activityCount);
    console.log('');
    
    if (articleCount === 0) {
      console.log('⚠️  Articles have been deleted!\n');
    } else {
      console.log('✅ Articles are still in the database\n');
    }
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkCount();

