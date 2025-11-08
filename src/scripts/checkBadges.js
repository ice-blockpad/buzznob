const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

async function checkBadges() {
  try {
    const badges = await prisma.badge.findMany({
      where: { category: 'mining' },
      select: { name: true, id: true }
    });
    
    console.log('Mining badges in database:');
    badges.forEach(b => console.log(`  - ${b.name} (${b.id})`));
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkBadges();

