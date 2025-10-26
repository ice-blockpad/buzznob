const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkUserMiningBalance() {
  try {
    console.log('Checking current user mining balance...');
    
    // Get the most recent user (assuming this is the current user)
    const user = await prisma.user.findFirst({
      orderBy: { createdAt: 'desc' }
    });
    
    if (!user) {
      console.log('No user found');
      return;
    }
    
    console.log('User:', user.username, user.email);
    
    // Get this user's mining claims
    const claims = await prisma.miningClaim.findMany({
      where: { userId: user.id },
      orderBy: { claimedAt: 'desc' }
    });
    
    console.log('User mining claims:', claims.length);
    console.log('Claims:', claims.map(c => ({
      id: c.id,
      amount: c.amount,
      claimedAt: c.claimedAt
    })));
    
    // Calculate total earned for this user
    const totalEarned = claims.reduce((sum, claim) => sum + claim.amount, 0);
    console.log('Total earned for this user:', totalEarned);
    
    // Check user's current points
    console.log('User points:', user.points);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkUserMiningBalance();
