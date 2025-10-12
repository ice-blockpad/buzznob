const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || "postgresql://postgres:IamWilliamz@69.30.204.110:6432/buzznob"
    }
  }
});

async function testConnection() {
  console.log('🔍 Testing database connection...');
  console.log('📍 Database URL:', process.env.DATABASE_URL || "postgresql://postgres:IamWilliamz@69.30.204.110:6432/buzznob");
  
  try {
    // Test basic connection
    await prisma.$connect();
    console.log('✅ Database connection successful!');
    
    // Test if we can query the database
    const result = await prisma.$queryRaw`SELECT version() as version`;
    console.log('✅ Database version:', result[0].version);
    
    // Test if we can create a simple table
    await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS test_connection (id SERIAL PRIMARY KEY, created_at TIMESTAMP DEFAULT NOW())`;
    console.log('✅ Database write access confirmed');
    
    // Clean up test table
    await prisma.$executeRaw`DROP TABLE IF EXISTS test_connection`;
    console.log('✅ Database cleanup completed');
    
  } catch (error) {
    console.error('❌ Database connection failed:');
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    
    if (error.code === 'P1001') {
      console.log('\n🔧 Troubleshooting suggestions:');
      console.log('1. Check if PostgreSQL server is running on 69.30.204.110:6432');
      console.log('2. Verify firewall settings allow connections on port 6432');
      console.log('3. Check if the database "buzznob" exists');
      console.log('4. Verify username "postgres" and password "IamWilliamz" are correct');
      console.log('5. Try connecting from your psql client first');
    }
  } finally {
    await prisma.$disconnect();
  }
}

testConnection();
