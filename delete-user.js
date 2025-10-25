const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function deleteUser() {
  const emailToDelete = 'vanillaonton@gmail.com';
  
  try {
    console.log(`🔍 Looking for user with email: ${emailToDelete}`);
    
    // First, find the user to get their details
    const user = await prisma.user.findUnique({
      where: { email: emailToDelete },
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
      console.log(`❌ User with email ${emailToDelete} not found`);
      return;
    }

    console.log(`📋 User found:`);
    console.log(`   ID: ${user.id}`);
    console.log(`   Username: ${user.username}`);
    console.log(`   Display Name: ${user.displayName}`);
    console.log(`   Google ID: ${user.googleId}`);
    console.log(`   Role: ${user.role}`);
    console.log(`   Points: ${user.points}`);
    console.log(`   Created: ${user.createdAt}`);
    
    // Show related data counts
    console.log(`\n📊 Related data counts:`);
    console.log(`   Activities: ${user.activities.length}`);
    console.log(`   Rewards: ${user.rewards.length}`);
    console.log(`   User Badges: ${user.userBadges.length}`);
    console.log(`   Leaderboard entries: ${user.leaderboards.length}`);
    console.log(`   Mining Claims: ${user.miningClaims.length}`);
    console.log(`   Wallet Data: ${user.walletData.length}`);
    console.log(`   KYC Submissions: ${user.kycSubmissions.length}`);
    console.log(`   Refresh Tokens: ${user.refreshTokens.length}`);
    console.log(`   Sessions: ${user.sessions.length}`);
    console.log(`   Referral Rewards (as referrer): ${user.referralRewards.length}`);
    console.log(`   Referral Rewards (as referee): ${user.refereeRewards.length}`);
    console.log(`   Authored Articles: ${user.authoredArticles.length}`);
    console.log(`   Reviewed Articles: ${user.reviewedArticles.length}`);
    console.log(`   Followers: ${user.followers.length}`);
    console.log(`   Following: ${user.following.length}`);
    console.log(`   Daily Rewards: ${user.dailyRewards.length}`);
    console.log(`   Referrals made: ${user.referrals.length}`);
    console.log(`   Referred by: ${user.referredByUser ? user.referredByUser.username : 'None'}`);

    // Confirm deletion
    console.log(`\n⚠️  WARNING: This will permanently delete the user and ALL related data!`);
    console.log(`   This action cannot be undone.`);
    
    // In a real scenario, you might want to add a confirmation prompt here
    // For now, we'll proceed with the deletion
    
    console.log(`\n🗑️  Deleting user and all related data...`);
    
    // Delete the user (cascade delete will handle all related records)
    const deletedUser = await prisma.user.delete({
      where: { email: emailToDelete }
    });

    console.log(`✅ User successfully deleted!`);
    console.log(`   Deleted user ID: ${deletedUser.id}`);
    console.log(`   All related data has been automatically deleted due to cascade relationships.`);

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
