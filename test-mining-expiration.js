const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testMiningExpiration() {
  try {
    console.log('🧪 Testing mining session expiration...\n');
    
    // Find a user to test with
    const user = await prisma.user.findFirst({
      where: { email: 'tonwifhat@gmail.com' }
    });
    
    if (!user) {
      console.log('User not found!');
      return;
    }
    
    console.log(`Testing with user: ${user.email}`);
    
    // Check current mining status
    const activeSession = await prisma.miningSession.findFirst({
      where: { 
        userId: user.id, 
        isActive: true 
      },
      orderBy: { startedAt: 'desc' }
    });
    
    const completedUnclaimedSession = await prisma.miningSession.findFirst({
      where: { 
        userId: user.id, 
        isCompleted: true, 
        isClaimed: false 
      },
      orderBy: { startedAt: 'desc' }
    });
    
    console.log('\n=== Current Status ===');
    if (activeSession) {
      const now = new Date();
      const sessionEndTime = new Date(activeSession.startedAt.getTime() + 6 * 60 * 60 * 1000);
      const hoursRemaining = (sessionEndTime - now) / (1000 * 60 * 60);
      
      console.log(`Active Session: ${activeSession.id}`);
      console.log(`Started: ${activeSession.startedAt}`);
      console.log(`Hours remaining: ${hoursRemaining.toFixed(2)}`);
      console.log(`Current rate: ${activeSession.currentRate}`);
      console.log(`Total mined: ${activeSession.totalMined}`);
      
      if (hoursRemaining <= 0) {
        console.log('✅ Session should be expired and ready to claim');
      } else {
        console.log('⏰ Session is still active');
      }
    } else if (completedUnclaimedSession) {
      console.log(`Completed Session: ${completedUnclaimedSession.id}`);
      console.log(`Ready to claim: ${completedUnclaimedSession.totalMined} tokens`);
      console.log('✅ Session is ready to claim');
    } else {
      console.log('No active or completed sessions found');
    }
    
    // Test the stats endpoint logic
    console.log('\n=== Testing Stats Endpoint Logic ===');
    
    if (activeSession) {
      const now = new Date();
      const miningCycleDuration = 6 * 60 * 60 * 1000;
      const sessionStartTime = new Date(activeSession.startedAt);
      const sessionEndTime = new Date(sessionStartTime.getTime() + miningCycleDuration);
      
      if (now < sessionEndTime) {
        console.log('Session is still active - should show mining in progress');
        const timeRemaining = sessionEndTime - now;
        console.log(`Time remaining: ${Math.floor(timeRemaining / (1000 * 60 * 60))}h ${Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60))}m`);
      } else {
        console.log('Session has expired - should be marked as completed');
        console.log('This would trigger the expiration logic in the stats endpoint');
      }
    }
    
  } catch (error) {
    console.error('Error testing mining expiration:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testMiningExpiration();
