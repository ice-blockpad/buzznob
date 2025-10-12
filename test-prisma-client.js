require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testPrismaClient() {
  console.log('🔍 Testing Prisma Client...');
  
  try {
    // Test connection
    await prisma.$connect();
    console.log('✅ Prisma client connected');
    
    // Test articles query
    console.log('📰 Testing articles query...');
    const articles = await prisma.article.findMany({
      take: 5,
      select: {
        id: true,
        title: true,
        category: true,
        pointsValue: true
      }
    });
    
    console.log('✅ Articles found:', articles.length);
    console.log('📰 Sample articles:', articles);
    
    // Test users query
    console.log('👥 Testing users query...');
    const users = await prisma.user.findMany({
      take: 3,
      select: {
        id: true,
        username: true,
        points: true
      }
    });
    
    console.log('✅ Users found:', users.length);
    console.log('👥 Sample users:', users);
    
  } catch (error) {
    console.error('❌ Prisma client error:', error.message);
    console.error('Error details:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testPrismaClient();
