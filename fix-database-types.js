require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function fixDatabaseTypes() {
  console.log('🔧 Fixing database column types...');
  
  try {
    // Convert enum columns to text
    console.log('📝 Converting category_type to text...');
    await prisma.$executeRaw`ALTER TABLE articles ALTER COLUMN category TYPE TEXT`;
    
    console.log('📝 Converting reward_type to text...');
    await prisma.$executeRaw`ALTER TABLE rewards ALTER COLUMN reward_type TYPE TEXT`;
    
    console.log('📝 Converting reward_status to text...');
    await prisma.$executeRaw`ALTER TABLE rewards ALTER COLUMN status TYPE TEXT`;
    
    // Drop the enum types
    console.log('🗑️  Dropping enum types...');
    await prisma.$executeRaw`DROP TYPE IF EXISTS category_type CASCADE`;
    await prisma.$executeRaw`DROP TYPE IF EXISTS reward_type CASCADE`;
    await prisma.$executeRaw`DROP TYPE IF EXISTS reward_status CASCADE`;
    
    console.log('✅ Database types fixed successfully!');
    
    // Test the fix
    console.log('🧪 Testing the fix...');
    const articles = await prisma.article.findMany({
      take: 3,
      select: {
        id: true,
        title: true,
        category: true,
        pointsValue: true
      }
    });
    
    console.log('✅ Articles query successful!');
    console.log('📰 Sample articles:', articles);
    
  } catch (error) {
    console.error('❌ Error fixing database types:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

fixDatabaseTypes();
