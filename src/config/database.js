const { PrismaClient } = require('@prisma/client');

/**
 * Prisma Client Configuration
 * 
 * For PM2 cluster mode, configure DATABASE_URL with connection pooling:
 * postgresql://user:pass@host:5432/db?connection_limit=5&pool_timeout=10
 * 
 * This prevents prepared statement conflicts when multiple instances run.
 * Recommended: connection_limit=5 per instance
 * Total connections = instances * connection_limit (keep under PostgreSQL max_connections)
 */
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
});


const connectDB = async () => {
  try {
    await prisma.$connect();
    console.log('✅ Database connected successfully');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw error;
  }
};


const disconnectDB = async () => {
  try {
    await prisma.$disconnect();
    console.log('✅ Database disconnected successfully');
  } catch (error) {
    console.error('❌ Database disconnection failed:', error);
    throw error;
  }
};

// Graceful shutdown
process.on('SIGINT', async () => {
  await disconnectDB();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await disconnectDB();
  process.exit(0);
});

module.exports = {
  prisma,
  connectDB,
  disconnectDB
};
