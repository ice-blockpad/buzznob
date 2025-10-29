const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function deleteUserWallet() {
  try {
    const email = 'wilsonadeniji@gmail.com';
    
    console.log(`🔍 Looking for user with email: ${email}`);
    
    // Find the user
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        walletData: true
      }
    });
    
    if (!user) {
      console.log('❌ User not found');
      return;
    }
    
    console.log(`✅ Found user: ${user.username} (ID: ${user.id})`);
    console.log(`📊 Wallet data records: ${user.walletData.length}`);
    
    // Delete ONLY wallet data
    if (user.walletData.length > 0) {
      await prisma.walletData.deleteMany({
        where: { userId: user.id }
      });
      console.log('🗑️ Deleted wallet data');
    } else {
      console.log('ℹ️ No wallet data found to delete');
    }
    
    console.log('✅ Wallet deletion completed successfully!');
    console.log('🔄 User can now create a new wallet');
    
  } catch (error) {
    console.error('❌ Error deleting wallet:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
deleteUserWallet();
