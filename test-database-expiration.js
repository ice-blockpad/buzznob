const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testDatabaseLevelExpiration() {
  try {
    console.log('🧪 Testing Database-Level Mining Session Expiration...\n');
    
    // Test 1: Create a session that should be active
    console.log('=== Test 1: Creating Active Session ===');
    const now = new Date();
    const endsAt = new Date(now.getTime() + 6 * 60 * 60 * 1000); // 6 hours from now
    
    console.log(`Current time: ${now}`);
    console.log(`Session will end at: ${endsAt}`);
    console.log(`Session should be active: ${now < endsAt ? 'YES' : 'NO'}`);
    
    // Test 2: Query for active sessions using database-level filtering
    console.log('\n=== Test 2: Database Query for Active Sessions ===');
    
    const activeSessions = await prisma.miningSession.findMany({
      where: {
        isActive: true,
        endsAt: {
          gt: new Date() // Only sessions that haven't reached their end time
        }
      },
      include: { user: { select: { email: true } } },
      orderBy: { startedAt: 'desc' }
    });
    
    console.log(`Found ${activeSessions.length} active sessions (not expired):`);
    activeSessions.forEach(session => {
      const timeRemaining = session.endsAt - new Date();
      const hoursRemaining = timeRemaining / (1000 * 60 * 60);
      console.log(`  - ${session.user.email}: Ends at ${session.endsAt}, ${hoursRemaining.toFixed(2)} hours remaining`);
    });
    
    // Test 3: Query for expired sessions
    console.log('\n=== Test 3: Database Query for Expired Sessions ===');
    
    const expiredSessions = await prisma.miningSession.findMany({
      where: {
        isActive: true,
        endsAt: {
          lte: new Date() // Sessions that have reached their end time
        }
      },
      include: { user: { select: { email: true } } },
      orderBy: { startedAt: 'desc' }
    });
    
    console.log(`Found ${expiredSessions.length} expired sessions (should be marked as completed):`);
    expiredSessions.forEach(session => {
      const hoursOverdue = (new Date() - session.endsAt) / (1000 * 60 * 60);
      console.log(`  - ${session.user.email}: Ended at ${session.endsAt}, ${hoursOverdue.toFixed(2)} hours overdue`);
    });
    
    console.log('\n=== Summary ===');
    console.log('✅ Database-level expiration logic:');
    console.log('1. Sessions store both startedAt and endsAt (calculated)');
    console.log('2. Active sessions query: WHERE isActive=true AND endsAt > NOW()');
    console.log('3. Expired sessions query: WHERE isActive=true AND endsAt <= NOW()');
    console.log('4. No background jobs needed - database handles expiration');
    console.log('5. Sessions automatically "expire" in queries when endsAt is reached');
    
    if (expiredSessions.length > 0) {
      console.log(`\n⚠️  Found ${expiredSessions.length} sessions that should be marked as completed`);
      console.log('These sessions have reached their end time but are still marked as active');
    } else {
      console.log('\n✅ All sessions are properly managed - no expired sessions found');
    }
    
  } catch (error) {
    console.error('Error testing database-level expiration:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testDatabaseLevelExpiration();
