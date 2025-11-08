const { prisma } = require('../config/database');
require('dotenv').config();

/**
 * Migration script to update streak counts for existing users
 * 
 * Old system: streakCount = 0 (first claim), 1 (second claim), etc.
 * New system: streakCount = 1 (first claim), 2 (second claim), etc.
 * 
 * This script:
 * 1. Increments all existing streakCount values by 1 (for users who have claimed)
 * 2. Sets streakCount to 1 for users who have claimed but streakCount is 0
 * 3. Updates both users and daily_rewards tables
 */
async function migrateStreakCount() {
  console.log('🔄 Starting streak count migration...\n');

  try {
    // Step 1: Update daily_rewards table first (source of truth)
    console.log('📊 Step 1: Updating daily_rewards table...');
    
    // Get all daily rewards with streakCount > 0
    const rewardsWithStreak = await prisma.dailyReward.findMany({
      where: {
        streakCount: {
          gt: 0
        }
      },
      select: {
        id: true,
        userId: true,
        streakCount: true,
        claimedAt: true
      },
      orderBy: {
        claimedAt: 'desc'
      }
    });

    console.log(`   Found ${rewardsWithStreak.length} daily rewards with existing streak counts`);

    // Increment each reward's streakCount by 1
    let updatedRewards = 0;
    for (const reward of rewardsWithStreak) {
      const newStreakCount = reward.streakCount + 1;
      await prisma.dailyReward.update({
        where: { id: reward.id },
        data: { streakCount: newStreakCount }
      });
      updatedRewards++;
    }

    console.log(`   ✅ Updated ${updatedRewards} daily rewards\n`);

    // Step 2: Fix daily rewards with streakCount = 0 (set to 1)
    console.log('📊 Step 2: Finding daily rewards with streakCount = 0...');
    
    const rewardsWithZero = await prisma.dailyReward.findMany({
      where: {
        streakCount: 0
      },
      select: {
        id: true,
        userId: true,
        claimedAt: true
      }
    });

    console.log(`   Found ${rewardsWithZero.length} daily rewards with streakCount = 0`);

    // Set them to 1 (they represent a claim)
    let fixedRewards = 0;
    for (const reward of rewardsWithZero) {
      await prisma.dailyReward.update({
        where: { id: reward.id },
        data: { streakCount: 1 }
      });
      fixedRewards++;
    }

    console.log(`   ✅ Fixed ${fixedRewards} daily rewards\n`);

    // Step 3: Update users table based on their most recent daily reward
    console.log('📊 Step 3: Updating users table based on most recent daily reward...');
    
    // Get all users who have claimed (have daily rewards)
    const usersWithClaims = await prisma.user.findMany({
      where: {
        dailyRewards: {
          some: {}
        }
      },
      select: {
        id: true,
        username: true,
        streakCount: true,
        dailyRewards: {
          orderBy: {
            claimedAt: 'desc'
          },
          take: 1,
          select: {
            streakCount: true,
            claimedAt: true
          }
        }
      }
    });

    console.log(`   Found ${usersWithClaims.length} users with daily rewards`);

    let updatedUsers = 0;
    let fixedUsers = 0;
    for (const user of usersWithClaims) {
      const mostRecentReward = user.dailyRewards[0];
      if (mostRecentReward) {
        const newStreakCount = mostRecentReward.streakCount; // Already updated in step 1
        const oldStreakCount = user.streakCount;
        
        await prisma.user.update({
          where: { id: user.id },
          data: { streakCount: newStreakCount }
        });
        
        if (oldStreakCount > 0) {
          updatedUsers++;
          console.log(`   ✓ Updated ${user.username}: ${oldStreakCount} → ${newStreakCount}`);
        } else {
          fixedUsers++;
          console.log(`   ✓ Fixed ${user.username}: ${oldStreakCount} → ${newStreakCount} (had claimed but streakCount was 0)`);
        }
      }
    }

    console.log(`\n   ✅ Updated ${updatedUsers} users (incremented existing streaks)`);
    console.log(`   ✅ Fixed ${fixedUsers} users (set 0 → correct value)\n`);


    // Summary
    console.log('===========================================================');
    console.log('Migration Summary:');
    console.log(`   - Updated ${updatedUsers} users (incremented existing streaks)`);
    console.log(`   - Fixed ${fixedUsers} users (set 0 to 1 for users who claimed)`);
    console.log(`   - Updated ${updatedRewards} daily rewards (incremented existing streaks)`);
    console.log(`   - Fixed ${fixedRewards} daily rewards (set 0 to 1)`);
    console.log('===========================================================');
    console.log('\nMigration completed successfully!\n');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration if called directly
if (require.main === module) {
  migrateStreakCount()
    .then(() => {
      console.log('✅ Migration script finished');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateStreakCount };

