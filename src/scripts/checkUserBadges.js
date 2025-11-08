const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

async function checkUserBadges() {
  try {
    // Get all badges (including old ones)
    const allBadges = await prisma.badge.findMany({
      where: { category: 'mining' },
      include: {
        userBadges: {
          select: { userId: true }
        }
      }
    });
    
    console.log('Mining badges and their user associations:');
    allBadges.forEach(badge => {
      const userCount = badge.userBadges.length;
      console.log(`  - ${badge.name}: ${userCount} users have this badge`);
    });
    
    // Check for any badges with old names
    const oldNames = ['First Miner', 'Mining Enthusiast', 'Token Prospector', 'Crypto Excavator', 'Mining Expert', 'Mining Master', 'Blockchain Miner'];
    const oldBadges = await prisma.badge.findMany({
      where: {
        name: { in: oldNames }
      }
    });
    
    if (oldBadges.length > 0) {
      console.log('\n⚠️  Found old badges that should be deleted:');
      oldBadges.forEach(b => console.log(`  - ${b.name} (${b.id})`));
    } else {
      console.log('\n✅ No old badges found');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkUserBadges();

