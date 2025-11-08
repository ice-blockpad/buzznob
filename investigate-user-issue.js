require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function investigateUserIssue() {
  const particleUserId = '2696f522-63bc-4aa5-b25a-3ae6ad070a42';
  
  console.log('🔍 COMPREHENSIVE USER INVESTIGATION');
  console.log('='.repeat(80));
  console.log(`Target particleUserId: ${particleUserId}`);
  console.log('='.repeat(80));
  
  try {
    // 1. Check by particleUserId (what user-exists endpoint does)
    console.log('\n📋 1. Checking by particleUserId (user-exists endpoint logic):');
    const userByParticleId = await prisma.user.findUnique({
      where: { particleUserId: particleUserId },
      select: { 
        id: true, 
        username: true, 
        email: true,
        particleUserId: true,
        externalId: true,
        createdAt: true,
        updatedAt: true
      }
    });
    
    if (userByParticleId) {
      console.log('   ✅ USER FOUND by particleUserId:');
      console.log(JSON.stringify(userByParticleId, null, 2));
      console.log(`   → This is why user-exists returns exists: true`);
    } else {
      console.log('   ❌ NO USER found by particleUserId');
      console.log('   → user-exists should return exists: false');
    }
    
    // 2. Check if there are multiple users with the same email
    if (userByParticleId?.email) {
      console.log(`\n📋 2. Checking for other users with same email: ${userByParticleId.email}`);
      const usersWithSameEmail = await prisma.user.findMany({
        where: { email: userByParticleId.email },
        select: { 
          id: true, 
          username: true, 
          email: true,
          particleUserId: true,
          externalId: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' }
      });
      
      if (usersWithSameEmail.length > 1) {
        console.log(`   ⚠️  FOUND ${usersWithSameEmail.length} users with same email:`);
        usersWithSameEmail.forEach((u, idx) => {
          const isTarget = u.particleUserId === particleUserId ? ' ⭐ TARGET' : '';
          console.log(`   ${idx + 1}. Username: ${u.username}, particleUserId: ${u.particleUserId}, externalId: ${u.externalId || 'N/A'}, Created: ${u.createdAt}${isTarget}`);
        });
        console.log(`   → Email is NOT unique - multiple accounts can have same email`);
      } else if (usersWithSameEmail.length === 1) {
        console.log(`   ✅ Only 1 user with this email (the target user)`);
      } else {
        console.log(`   ❌ No users found with this email`);
      }
    }
    
    // 3. Check all users with similar particleUserId (partial match)
    console.log(`\n📋 3. Checking for users with similar particleUserId (first 8 chars):`);
    const similarUsers = await prisma.user.findMany({
      where: {
        particleUserId: {
          startsWith: particleUserId.substring(0, 8)
        }
      },
      select: { 
        id: true, 
        username: true, 
        email: true,
        particleUserId: true,
        externalId: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });
    
    if (similarUsers.length > 0) {
      console.log(`   Found ${similarUsers.length} user(s) with similar particleUserId:`);
      similarUsers.forEach((u, idx) => {
        const isExact = u.particleUserId === particleUserId ? ' ⭐ EXACT MATCH' : '';
        console.log(`   ${idx + 1}. particleUserId: ${u.particleUserId}, username: ${u.username}, email: ${u.email || 'N/A'}, Created: ${u.createdAt}${isExact}`);
      });
    } else {
      console.log('   No users found with similar particleUserId');
    }
    
    // 4. Check recent users (last 20)
    console.log(`\n📋 4. Checking last 20 users created:`);
    const recentUsers = await prisma.user.findMany({
      select: { 
        id: true, 
        username: true, 
        email: true,
        particleUserId: true,
        externalId: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' },
      take: 20
    });
    
    if (recentUsers.length > 0) {
      console.log(`   Last ${recentUsers.length} users:`);
      recentUsers.forEach((u, idx) => {
        const isTarget = u.particleUserId === particleUserId ? ' ⭐ TARGET' : '';
        const hasEmail = u.email ? `email: ${u.email}` : 'no email';
        const hasExternalId = u.externalId ? `externalId: ${u.externalId}` : 'no externalId';
        console.log(`   ${idx + 1}. ${u.username} (${u.particleUserId}) - ${hasEmail}, ${hasExternalId}, Created: ${u.createdAt}${isTarget}`);
      });
    }
    
    // 5. Check if there's a user with same email but different particleUserId
    if (userByParticleId?.email) {
      console.log(`\n📋 5. Checking for users with same email but DIFFERENT particleUserId:`);
      const usersWithSameEmailDifferentParticleId = await prisma.user.findMany({
        where: { 
          email: userByParticleId.email,
          NOT: { particleUserId: particleUserId }
        },
        select: { 
          id: true, 
          username: true, 
          email: true,
          particleUserId: true,
          externalId: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' }
      });
      
      if (usersWithSameEmailDifferentParticleId.length > 0) {
        console.log(`   ⚠️  FOUND ${usersWithSameEmailDifferentParticleId.length} user(s) with same email but different particleUserId:`);
        usersWithSameEmailDifferentParticleId.forEach((u, idx) => {
          console.log(`   ${idx + 1}. Username: ${u.username}, particleUserId: ${u.particleUserId}, externalId: ${u.externalId || 'N/A'}, Created: ${u.createdAt}`);
        });
        console.log(`   → This confirms: Email is NOT unique, multiple accounts can exist with same email`);
      } else {
        console.log(`   ✅ No other users with same email`);
      }
    }
    
    // 6. Summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 SUMMARY:');
    console.log('='.repeat(80));
    
    if (userByParticleId) {
      console.log('✅ User EXISTS in database with particleUserId:', particleUserId);
      console.log(`   Username: ${userByParticleId.username}`);
      console.log(`   Email: ${userByParticleId.email || 'N/A'}`);
      console.log(`   ExternalId: ${userByParticleId.externalId || 'N/A'}`);
      console.log(`   Created: ${userByParticleId.createdAt}`);
      console.log(`   Updated: ${userByParticleId.updatedAt}`);
      console.log('\n   → This explains why user-exists returns exists: true');
      console.log('   → The user was NOT actually deleted, or was recreated');
    } else {
      console.log('❌ User does NOT exist in database with particleUserId:', particleUserId);
      console.log('   → user-exists should return exists: false');
      console.log('   → If it returns true, there is a bug in the backend');
    }
    
    console.log('\n📝 KEY FINDINGS:');
    console.log('   - Email is NOT unique (schema line 12: email String? // Not unique)');
    console.log('   - Multiple users can have the same email');
    console.log('   - user-exists endpoint checks by particleUserId ONLY (not email)');
    console.log('   - If user-exists returns true, it means a user with that particleUserId exists');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

investigateUserIssue();

