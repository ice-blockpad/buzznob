require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function deleteUser() {
  const usernameToDelete = 'just2williamz';
  
  try {
    console.log(`🔍 Looking for user with username: ${usernameToDelete}`);
    
    // First, find the user to get their details
    // Username is unique, so we can use findUnique
    const user = await prisma.user.findUnique({
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

    if (!user) {
      console.log(`❌ User with username ${usernameToDelete} not found`);
      return;
    }

    console.log(`📋 User found: ${user.username} (${user.email})`);
    console.log(`   Role: ${user.role} | Points: ${user.points} | Referred by: ${user.referredByUser ? user.referredByUser.username : 'None'}`);
    
    console.log(`\n🗑️  Deleting user and all related data...`);
    
    // Delete referral rewards first (they have foreign key constraints)
    if (user.referralRewards.length > 0) {
      await prisma.referralReward.deleteMany({
        where: { referrerId: user.id }
      });
    }
    
    if (user.refereeRewards.length > 0) {
      await prisma.referralReward.deleteMany({
        where: { refereeId: user.id }
      });
    }
    
    // Delete the user (cascade delete will handle all other related records)
    // Username is unique, so we can delete directly by username
    const deletedUser = await prisma.user.delete({
      where: { username: usernameToDelete }
    });

    console.log(`✅ User successfully deleted!`);

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