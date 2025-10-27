const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function cleanupStuckSessions() {
  try {
    console.log('🧹 Cleaning up stuck mining sessions...\n');
    
    const now = new Date();
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    
    // Find all active sessions that should have expired
    const stuckSessions = await prisma.miningSession.findMany({
      where: {
        isActive: true,
        startedAt: {
          lte: sixHoursAgo
        }
      },
      include: { user: { select: { email: true } } }
    });

    console.log(`Found ${stuckSessions.length} stuck sessions to clean up:\n`);

    for (const session of stuckSessions) {
      const hoursOverdue = (now - session.startedAt) / (1000 * 60 * 60);
      console.log(`Cleaning up session for ${session.user.email}:`);
      console.log(`  Started: ${session.startedAt}`);
      console.log(`  Hours overdue: ${hoursOverdue.toFixed(2)}`);
      console.log(`  Current rate: ${session.currentRate}`);
      console.log(`  Total mined: ${session.totalMined}`);
      
      // Calculate final mined amount
      const sessionEndTime = new Date(session.startedAt.getTime() + 6 * 60 * 60 * 1000);
      const finalMinedAmount = session.totalMined + (session.currentRate * (sessionEndTime - session.lastUpdate) / (1000 * 60 * 60)) / 6;
      
      console.log(`  Final mined amount: ${finalMinedAmount.toFixed(4)}`);
      
      // Update the session to mark it as completed
      await prisma.miningSession.update({
        where: { id: session.id },
        data: {
          isActive: false,
          isCompleted: true,
          completedAt: sessionEndTime,
          totalMined: finalMinedAmount,
          lastUpdate: sessionEndTime
        }
      });
      
      console.log(`  ✅ Session marked as completed\n`);
    }

    console.log(`🎉 Cleanup complete! Fixed ${stuckSessions.length} stuck sessions.`);
    
    // Verify the cleanup
    const remainingActiveSessions = await prisma.miningSession.findMany({
      where: { isActive: true },
      include: { user: { select: { email: true } } }
    });
    
    console.log(`\nRemaining active sessions: ${remainingActiveSessions.length}`);
    remainingActiveSessions.forEach((session, index) => {
      const hoursRunning = (now - session.startedAt) / (1000 * 60 * 60);
      console.log(`  ${index + 1}. ${session.user.email} - Running for ${hoursRunning.toFixed(2)} hours`);
    });

  } catch (error) {
    console.error('Error cleaning up stuck sessions:', error);
  } finally {
    await prisma.$disconnect();
  }
}

cleanupStuckSessions();
