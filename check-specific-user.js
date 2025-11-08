require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkSpecificUser() {
  const particleUserId = '2696f522-63bc-4aa5-b25a-3ae6ad070a42';
  
  try {
    console.log(`🔍 Checking for user with particleUserId: ${particleUserId}`);
    console.log('='.repeat(60));
    
    // Check by particleUserId
    const userByParticleId = await prisma.user.findFirst({
      where: { particleUserId: particleUserId },
      select: { 
        id: true, 
        username: true, 
        particleUserId: true, 
        email: true, 
        externalId: true,
        createdAt: true,
        updatedAt: true,
        role: true,
        points: true
      }
    });
    
    if (userByParticleId) {
      console.log('✅ User FOUND by particleUserId:');
      console.log(JSON.stringify(userByParticleId, null, 2));
      console.log('\n📊 This means:');
      console.log('   - user-exists endpoint will return exists: true');
      console.log('   - handleParticleAuthSuccess will call finalizeAccount');
      console.log('   - User will be redirected to homepage (existing user flow)');
    } else {
      console.log('❌ User NOT FOUND by particleUserId');
      console.log('   - user-exists endpoint will return exists: false');
      console.log('   - handleParticleAuthSuccess will return isNewUser: true');
      console.log('   - User will be redirected to ProfileCompletion (new user flow)');
    }
    
    // Also check all users with similar particleUserId (partial match)
    console.log('\n' + '='.repeat(60));
    console.log('🔍 Checking for any users with similar particleUserId...');
    const allUsers = await prisma.user.findMany({
      where: {
        particleUserId: {
          contains: '2696f522'
        }
      },
      select: { 
        id: true, 
        username: true, 
        particleUserId: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });
    
    if (allUsers.length > 0) {
      console.log(`Found ${allUsers.length} user(s) with similar particleUserId:`);
      allUsers.forEach((u, idx) => {
        console.log(`   ${idx + 1}. Username: ${u.username}, particleUserId: ${u.particleUserId}, Created: ${u.createdAt}`);
      });
    } else {
      console.log('No users found with similar particleUserId');
    }
    
    // Check recent users (last 10)
    console.log('\n' + '='.repeat(60));
    console.log('🔍 Checking last 10 users created...');
    const recentUsers = await prisma.user.findMany({
      select: { 
        id: true, 
        username: true, 
        particleUserId: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });
    
    if (recentUsers.length > 0) {
      console.log(`Last ${recentUsers.length} users created:`);
      recentUsers.forEach((u, idx) => {
        const match = u.particleUserId === particleUserId ? ' ⭐ MATCH' : '';
        console.log(`   ${idx + 1}. Username: ${u.username}, particleUserId: ${u.particleUserId}, Created: ${u.createdAt}${match}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error checking user:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkSpecificUser();

