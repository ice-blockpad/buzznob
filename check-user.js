require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkUser() {
  const particleUserId = '2696f522-63bc-4aa5-b25a-3ae6ad070a42';
  
  try {
    console.log(`🔍 Checking for user with particleUserId: ${particleUserId}`);
    
    const user = await prisma.user.findFirst({
      where: { particleUserId: particleUserId },
      select: { 
        id: true, 
        username: true, 
        particleUserId: true, 
        email: true, 
        createdAt: true,
        updatedAt: true
      }
    });
    
    if (!user) {
      console.log('✅ User does NOT exist - deletion was successful');
      console.log('   The user-exists endpoint should return exists: false');
    } else {
      console.log('❌ User STILL EXISTS after deletion!');
      console.log('   User details:', JSON.stringify(user, null, 2));
      console.log('\n   Possible reasons:');
      console.log('   1. User was recreated between deletion and check');
      console.log('   2. Deletion failed silently (transaction rolled back)');
      console.log('   3. Database connection issue (checking wrong DB)');
      console.log('   4. User was created by another process');
      
      // Check if there are multiple users with same particleUserId (shouldn't happen)
      const allUsers = await prisma.user.findMany({
        where: { particleUserId: particleUserId },
        select: { id: true, username: true, createdAt: true }
      });
      
      if (allUsers.length > 1) {
        console.log(`\n⚠️  WARNING: Found ${allUsers.length} users with same particleUserId!`);
        console.log('   This indicates a database integrity issue.');
      }
    }
    
    // Also check by username
    const username = 'just2williamz';
    const userByUsername = await prisma.user.findUnique({
      where: { username: username },
      select: { id: true, username: true, particleUserId: true }
    });
    
    if (userByUsername) {
      console.log(`\n⚠️  User with username "${username}" still exists!`);
      console.log('   particleUserId:', userByUsername.particleUserId);
    } else {
      console.log(`\n✅ User with username "${username}" does NOT exist`);
    }
    
  } catch (error) {
    console.error('❌ Error checking user:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkUser();

