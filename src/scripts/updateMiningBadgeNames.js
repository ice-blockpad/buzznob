const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

/**
 * Update mining badge names in the database
 * This script updates existing badges by their old names to new names
 */
async function updateMiningBadgeNames() {
  console.log('🔄 Updating mining badge names...\n');

  try {
    // Map of old names to new badge data
    // Based on current names in achievements.js:
    // 1 session: 'Buzz Digger'
    // 10 sessions: 'Gem Addict'
    // 25 sessions: 'Treasue Seeker'
    // 50 sessions: 'Diamond Hunter'
    // 100 sessions: 'Buzz Digger'
    const badgeUpdates = [
      {
        oldName: 'First Miner',
        newData: {
          name: 'Buzz Digger',
          description: 'Complete your first mining session',
          pointsRequired: 50,
          category: 'mining'
        }
      },
      {
        oldName: 'Stone Breaker',
        newData: {
          name: 'Buzz Digger',
          description: 'Complete your first mining session',
          pointsRequired: 50,
          category: 'mining'
        }
      },
      {
        oldName: 'Mining Enthusiast',
        newData: {
          name: 'Gem Addict',
          description: 'Complete 10 mining sessions',
          pointsRequired: 100,
          category: 'mining'
        }
      },
      {
        oldName: 'Token Prospector',
        newData: {
          name: 'Gem Addict',
          description: 'Complete 10 mining sessions',
          pointsRequired: 100,
          category: 'mining'
        }
      },
      {
        oldName: 'Crypto Excavator',
        newData: {
          name: 'Treasue Seeker',
          description: 'Complete 25 mining sessions',
          pointsRequired: 200,
          category: 'mining'
        }
      },
      {
        oldName: 'Mining Expert',
        newData: {
          name: 'Treasue Seeker',
          description: 'Complete 25 mining sessions',
          pointsRequired: 200,
          category: 'mining'
        }
      },
      {
        oldName: 'Mining Master',
        newData: {
          name: 'Diamond Hunter',
          description: 'Complete 50 mining sessions',
          pointsRequired: 500,
          category: 'mining'
        }
      },
      {
        oldName: 'Blockchain Miner',
        newData: {
          name: 'Diamond Hunter',
          description: 'Complete 50 mining sessions',
          pointsRequired: 500,
          category: 'mining'
        }
      },
      {
        oldName: '$BUZZ Digger',
        newData: {
          name: 'Buzz Digger',
          description: 'Complete 100 mining sessions',
          pointsRequired: 1000,
          category: 'mining'
        }
      }
    ];

    let updatedCount = 0;
    let notFoundCount = 0;

    for (const update of badgeUpdates) {
      // Check if old badge exists
      const oldBadge = await prisma.badge.findUnique({
        where: { name: update.oldName }
      });

      if (oldBadge) {
        // Check if new name already exists (to avoid duplicates)
        const existingNewBadge = await prisma.badge.findUnique({
          where: { name: update.newData.name }
        });

        if (existingNewBadge && existingNewBadge.id !== oldBadge.id) {
          // New badge already exists, delete the old one
          console.log(`   ⚠️  Badge "${update.newData.name}" already exists. Deleting old "${update.oldName}"...`);
          await prisma.badge.delete({
            where: { id: oldBadge.id }
          });
          notFoundCount++;
        } else {
          // Update the badge
          await prisma.badge.update({
            where: { id: oldBadge.id },
            data: update.newData
          });
          console.log(`   ✅ Updated "${update.oldName}" → "${update.newData.name}"`);
          updatedCount++;
        }
      } else {
        // Old badge doesn't exist, check if we need to create the new one
        const existingNewBadge = await prisma.badge.findUnique({
          where: { name: update.newData.name }
        });

        if (!existingNewBadge) {
          // Create the new badge
          await prisma.badge.create({
            data: update.newData
          });
          console.log(`   ➕ Created new badge "${update.newData.name}"`);
          updatedCount++;
        } else {
          console.log(`   ℹ️  Badge "${update.newData.name}" already exists, skipping...`);
        }
      }
    }

    console.log(`\n✅ Update completed!`);
    console.log(`   • Updated/Created: ${updatedCount}`);
    console.log(`   • Deleted duplicates: ${notFoundCount}`);

  } catch (error) {
    console.error('❌ Error updating badge names:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

updateMiningBadgeNames()
  .catch((e) => {
    console.error('❌ Script failed:', e);
    process.exit(1);
  });

