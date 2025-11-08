require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function deleteUser() {
  // You can delete by username OR particleUserId
  const usernameToDelete = 'just2williamz';
  const particleUserIdToDelete = null; // Set this if you want to delete by particleUserId instead
  
  try {
    let user;
    
    if (particleUserIdToDelete) {
      console.log(`🔍 Looking for user with particleUserId: ${particleUserIdToDelete}`);
      user = await prisma.user.findFirst({
        where: { particleUserId: particleUserIdToDelete },
        include: {
          activities: true,
          rewards: true,
          userBadges: true,
          leaderboards: true,
          miningClaims: true,
          walletData: true,
          kycSubmissions: true,
          refreshTokens: true,
          sessions: true,
          referralRewards: true,
          refereeRewards: true,
          authoredArticles: true,
          reviewedArticles: true,
          followers: true,
          following: true,
          dailyRewards: true,
          referrals: true,
          referredByUser: true
        }
      });
    } else {
      console.log(`🔍 Looking for user with username: ${usernameToDelete}`);
      // First, find the user to get their details
      // Username is unique, so we can use findUnique
      user = await prisma.user.findUnique({
        where: { username: usernameToDelete },
        include: {
          activities: true,
          rewards: true,
          userBadges: true,
          leaderboards: true,
          miningClaims: true,
          walletData: true,
          kycSubmissions: true,
          refreshTokens: true,
          sessions: true,
          referralRewards: true,
          refereeRewards: true,
          authoredArticles: true,
          reviewedArticles: true,
          followers: true,
          following: true,
          dailyRewards: true,
          referrals: true,
          referredByUser: true
        }
      });
    }

    if (!user) {
      const searchTerm = particleUserIdToDelete || usernameToDelete;
      console.log(`❌ User not found: ${searchTerm}`);
      return;
    }

    console.log(`📋 User found: ${user.username} (${user.email})`);
    console.log(`   User ID: ${user.id}`);
    console.log(`   Particle User ID: ${user.particleUserId || 'N/A'}`);
    console.log(`   Role: ${user.role} | Points: ${user.points} | Referred by: ${user.referredByUser ? user.referredByUser.username : 'None'}`);
    
    console.log(`\n🗑️  Deleting user and all related data...`);
    
    // Delete in transaction to ensure all data is deleted
    const deletedUser = await prisma.$transaction(async (tx) => {
      // Delete referral rewards first (they have foreign key constraints)
      if (user.referralRewards.length > 0) {
        await tx.referralReward.deleteMany({
          where: { referrerId: user.id }
        });
        console.log(`   Deleted ${user.referralRewards.length} referral rewards (as referrer)`);
      }
      
      if (user.refereeRewards.length > 0) {
        await tx.referralReward.deleteMany({
          where: { refereeId: user.id }
        });
        console.log(`   Deleted ${user.refereeRewards.length} referral rewards (as referee)`);
      }
      
      // Delete mining sessions (they might have foreign key constraints)
      const miningSessionsCount = await tx.miningSession.deleteMany({
        where: { userId: user.id }
      });
      if (miningSessionsCount.count > 0) {
        console.log(`   Deleted ${miningSessionsCount.count} mining sessions`);
      }
      
      // Delete the user (cascade delete will handle all other related records)
      // Delete by ID to ensure we delete the exact user we found
      const deleted = await tx.user.delete({
        where: { id: user.id }
      });
      
      return deleted;
    });

    console.log(`✅ User successfully deleted!`);
    console.log(`   Deleted user ID: ${deletedUser.id}`);
    console.log(`   Deleted particleUserId: ${deletedUser.particleUserId || 'N/A'}`);
    
    // Verify deletion by checking both username and particleUserId
    const verifyByUsername = await prisma.user.findUnique({
      where: { username: usernameToDelete }
    });
    
    const verifyByParticleId = deletedUser.particleUserId 
      ? await prisma.user.findFirst({
          where: { particleUserId: deletedUser.particleUserId }
        })
      : null;
    
    if (verifyByUsername) {
      console.error(`❌ VERIFICATION FAILED: User still exists by username!`);
    } else {
      console.log(`✅ Verified: User deleted by username`);
    }
    
    if (verifyByParticleId) {
      console.error(`❌ VERIFICATION FAILED: User still exists by particleUserId: ${deletedUser.particleUserId}`);
    } else if (deletedUser.particleUserId) {
      console.log(`✅ Verified: User deleted by particleUserId`);
    }

  } catch (error) {
    console.error('❌ Error deleting user:', error);
    
    if (error.code === 'P2002') {
      console.error('   This might be a unique constraint violation.');
    } else if (error.code === 'P2025') {
      console.error('   User not found or already deleted.');
    } else {
      console.error('   Full error details:', error.message);
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Run the deletion
deleteUser();