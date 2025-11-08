const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

/**
 * Fix mining badge names - delete old badges and ensure correct ones exist
 */
async function fixMiningBadgeNames() {
  console.log('🔄 Fixing mining badge names...\n');

  try {
    // Correct badge names from achievements.js
    const correctBadges = [
      {
        name: 'Stone Breaker',
        description: 'Complete your first mining session',
        pointsRequired: 50,
        category: 'mining'
      },
      {
        name: 'Gem Addict',
        description: 'Complete 10 mining sessions',
        pointsRequired: 100,
        category: 'mining'
      },
      {
        name: 'Treasue Seeker',
        description: 'Complete 25 mining sessions',
        pointsRequired: 200,
        category: 'mining'
      },
      {
        name: 'Diamond Hunter',
        description: 'Complete 50 mining sessions',
        pointsRequired: 500,
        category: 'mining'
      },
      {
        name: '$BUZZ Digger',
        description: 'Complete 100 mining sessions',
        pointsRequired: 1000,
        category: 'mining'
      }
    ];

    // Old badge names to delete
    const oldBadgeNames = [
      'First Miner',
      'Mining Enthusiast',
      'Token Prospector',
      'Crypto Excavator',
      'Mining Expert',
      'Mining Master',
      'Blockchain Miner',
      'Buzz Digger' // Old name that might conflict
    ];

    console.log('🗑️  Deleting old mining badges...');
    let deletedCount = 0;
    for (const oldName of oldBadgeNames) {
      const deleted = await prisma.badge.deleteMany({
        where: { name: oldName }
      });
      if (deleted.count > 0) {
        console.log(`   ✅ Deleted "${oldName}"`);
        deletedCount += deleted.count;
      }
    }
    console.log(`   Total deleted: ${deletedCount}\n`);

    console.log('✅ Creating/Updating correct mining badges...');
    let createdCount = 0;
    let updatedCount = 0;
    for (const badge of correctBadges) {
      const existing = await prisma.badge.findUnique({
        where: { name: badge.name }
      });

      if (existing) {
        // Update if exists
        await prisma.badge.update({
          where: { id: existing.id },
          data: badge
        });
        console.log(`   ✅ Updated "${badge.name}"`);
        updatedCount++;
      } else {
        // Create if doesn't exist
        await prisma.badge.create({
          data: badge
        });
        console.log(`   ➕ Created "${badge.name}"`);
        createdCount++;
      }
    }

    console.log(`\n✅ Fix completed!`);
    console.log(`   • Created: ${createdCount}`);
    console.log(`   • Updated: ${updatedCount}`);
    console.log(`   • Deleted: ${deletedCount}`);

  } catch (error) {
    console.error('❌ Error fixing badge names:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

fixMiningBadgeNames()
  .catch((e) => {
    console.error('❌ Script failed:', e);
    process.exit(1);
  });

