const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkSessions() {
  try {
    console.log('Checking mining sessions...');
    
    // Find the user
    const user = await prisma.user.findFirst({
      where: { email: 'tonwifhat@gmail.com' }
    });
    
    if (!user) {
      console.log('User not found');
      return;
    }
    
    // Get all mining sessions
    const sessions = await prisma.miningSession.findMany({
      where: { userId: user.id },
      orderBy: { startedAt: 'desc' }
    });
    
    console.log('All mining sessions:', sessions.length);
    sessions.forEach((session, index) => {
      console.log(`${index + 1}. ID: ${session.id}, Active: ${session.isActive}, Completed: ${session.isCompleted}, Claimed: ${session.isClaimed}`);
    });
    
    // Check which sessions match the JOIN conditions
    console.log('\nSessions matching JOIN conditions:');
    
    const activeSessions = sessions.filter(s => s.isActive);
    console.log('Active sessions:', activeSessions.length);
    
    const completedSessions = sessions.filter(s => s.isCompleted && s.isClaimed);
    console.log('Completed sessions:', completedSessions.length);
    
    // Test the exact JOIN logic
    const joinTest = await prisma.$queryRaw`
      SELECT 
        ms.id as session_id,
        ms.is_active,
        ms.is_completed,
        ms.is_claimed,
        mc.id as claim_id,
        mc.amount
      FROM mining_sessions ms
      LEFT JOIN mining_claims mc ON ms.user_id = mc.user_id
      WHERE ms.user_id = ${user.id}
      ORDER BY ms.started_at DESC, mc.claimed_at DESC
    `;
    
    console.log('\nJOIN test result:');
    joinTest.forEach((row, index) => {
      console.log(`${index + 1}. Session: ${row.session_id}, Claim: ${row.claim_id}, Amount: ${row.amount}`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkSessions();
