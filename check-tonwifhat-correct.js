const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkTonwifhatBalance() {
  try {
    console.log('Checking mining balance for tonwifhat@gmail.com...');
    
    // Find the specific user
    const user = await prisma.user.findFirst({
      where: { email: 'tonwifhat@gmail.com' }
    });
    
    if (!user) {
      console.log('User tonwifhat@gmail.com not found');
      return;
    }
    
    console.log('User found:', user.username, user.email);
    
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
    console.log('Total earned for tonwifhat@gmail.com:', totalEarned);
    
    // Check user's current points
    console.log('User points:', user.points);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkTonwifhatBalance();
