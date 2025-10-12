require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testSimpleDB() {
  console.log('🔍 Testing simple database operations...');
  console.log('📍 Database URL:', process.env.DATABASE_URL);
  
  try {
    // Test connection
    await prisma.$connect();
    console.log('✅ Connected to database');
    
    // Check if articles table exists and has data
    const articleCount = await prisma.$queryRaw`SELECT COUNT(*) as count FROM articles`;
    console.log('📊 Articles count:', articleCount[0].count);
    
    // Check if users table exists and has data
    const userCount = await prisma.$queryRaw`SELECT COUNT(*) as count FROM users`;
    console.log('👥 Users count:', userCount[0].count);
    
    // Check if badges table exists and has data
    const badgeCount = await prisma.$queryRaw`SELECT COUNT(*) as count FROM badges`;
    console.log('🏆 Badges count:', badgeCount[0].count);
    
    // If no data, let's insert some sample data
    if (articleCount[0].count === '0') {
      console.log('🌱 No articles found, inserting sample data...');
      
      // Insert sample articles
      await prisma.$executeRaw`
        INSERT INTO articles (title, content, category, source_name, points_value, read_time_estimate, is_featured, image_url) VALUES
        ('Bitcoin Reaches New All-Time High', 'Bitcoin has reached a new all-time high of $100,000, marking a significant milestone in cryptocurrency adoption. This surge comes after months of institutional adoption and regulatory clarity...', 'crypto', 'CoinDesk', 15, 3, true, 'https://images.coindesk.com/bitcoin-chart.jpg'),
        ('Lakers Win Championship Game', 'The Los Angeles Lakers secured their 18th NBA championship with a thrilling victory over the Boston Celtics. LeBron James led the team with 35 points and 12 assists...', 'sports', 'ESPN', 12, 4, true, 'https://images.espn.com/lakers-celebration.jpg'),
        ('New Marvel Movie Breaks Box Office Records', 'The latest Marvel Cinematic Universe film has shattered box office records, grossing over $1 billion worldwide. The film features an all-star cast...', 'entertainment', 'Variety', 10, 3, false, 'https://images.variety.com/marvel-poster.jpg')
        ON CONFLICT (title) DO NOTHING;
      `;
      
      console.log('✅ Sample articles inserted');
    }
    
    // Check articles again
    const newArticleCount = await prisma.$queryRaw`SELECT COUNT(*) as count FROM articles`;
    console.log('📊 New articles count:', newArticleCount[0].count);
    
    // Get first few articles
    const articles = await prisma.$queryRaw`SELECT id, title, category, points_value FROM articles LIMIT 5`;
    console.log('📰 Sample articles:', articles);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

testSimpleDB();
