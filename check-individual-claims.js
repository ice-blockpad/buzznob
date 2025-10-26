const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkIndividualClaims() {
  try {
    console.log('Checking individual mining claims for tonwifhat@gmail.com...');
    
    // Find the user
    const user = await prisma.user.findFirst({
      where: { email: 'tonwifhat@gmail.com' }
    });
    
    if (!user) {
      console.log('User not found');
      return;
    }
    
    console.log('User:', user.username, user.email);
    
    // Get all mining claims for this user
    const claims = await prisma.miningClaim.findMany({
      where: { userId: user.id },
      orderBy: { claimedAt: 'desc' }
    });
    
    console.log('Individual claims:');
    claims.forEach((claim, index) => {
      console.log(`${index + 1}. Amount: ${claim.amount}, Claimed: ${claim.claimedAt}`);
    });
    
    const manualTotal = claims.reduce((sum, claim) => sum + claim.amount, 0);
    console.log('Manual total:', manualTotal);
    
    // Check if there are any duplicate claims or other issues
    const claimAmounts = claims.map(c => c.amount);
    console.log('Claim amounts:', claimAmounts);
    
    // Check for any mining sessions that might be affecting the calculation
    const sessions = await prisma.miningSession.findMany({
      where: { userId: user.id },
      orderBy: { startedAt: 'desc' }
    });
    
    console.log('Mining sessions:', sessions.length);
    sessions.forEach((session, index) => {
      console.log(`${index + 1}. Total mined: ${session.totalMined}, Is claimed: ${session.isClaimed}, Is completed: ${session.isCompleted}`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkIndividualClaims();
