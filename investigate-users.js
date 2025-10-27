const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function investigateUsers() {
  try {
    console.log('🔍 Investigating users: tonwifhat@gmail.com vs thebasemilitia@gmail.com\n');
    
    // Get both users
    const [affectedUser, unaffectedUser] = await Promise.all([
      prisma.user.findFirst({
        where: { email: 'tonwifhat@gmail.com' },
        include: {
          miningSessions: {
            orderBy: { startedAt: 'desc' },
            take: 10
          },
          miningClaims: {
            orderBy: { claimedAt: 'desc' },
            take: 10
          },
          referrals: true,
          referredByUser: true
        }
      }),
      prisma.user.findFirst({
        where: { email: 'thebasemilitia@gmail.com' },
        include: {
          miningSessions: {
            orderBy: { startedAt: 'desc' },
            take: 10
          },
          miningClaims: {
            orderBy: { claimedAt: 'desc' },
            take: 10
          },
          referrals: true,
          referredByUser: true
        }
      })
    ]);

    console.log('=== AFFECTED USER (tonwifhat@gmail.com) ===');
    if (affectedUser) {
      console.log('User ID:', affectedUser.id);
      console.log('Created:', affectedUser.createdAt);
      console.log('Last Login:', affectedUser.lastLogin);
      console.log('Points:', affectedUser.points);
      console.log('Mining Balance:', affectedUser.miningBalance);
      console.log('Role:', affectedUser.role);
      console.log('Is Active:', affectedUser.isActive);
      console.log('Is Verified:', affectedUser.isVerified);
      console.log('Referral Code:', affectedUser.referralCode);
      console.log('Referred By:', affectedUser.referredByUser?.email || 'None');
      console.log('Referrals Count:', affectedUser.referrals?.length || 0);
      
      console.log('\n--- Mining Sessions ---');
      affectedUser.miningSessions.forEach((session, index) => {
        console.log(`Session ${index + 1}:`);
        console.log(`  ID: ${session.id}`);
        console.log(`  Started: ${session.startedAt}`);
        console.log(`  Is Active: ${session.isActive}`);
        console.log(`  Is Completed: ${session.isCompleted}`);
        console.log(`  Is Claimed: ${session.isClaimed}`);
        console.log(`  Current Rate: ${session.currentRate}`);
        console.log(`  Total Mined: ${session.totalMined}`);
        console.log(`  Last Update: ${session.lastUpdate}`);
        console.log('');
      });
      
      console.log('--- Mining Claims ---');
      affectedUser.miningClaims.forEach((claim, index) => {
        console.log(`Claim ${index + 1}:`);
        console.log(`  Amount: ${claim.amount}`);
        console.log(`  Claimed At: ${claim.claimedAt}`);
        console.log(`  Mining Rate: ${claim.miningRate}`);
        console.log('');
      });
    } else {
      console.log('User not found!');
    }

    console.log('\n=== UNAFFECTED USER (thebasemilitia@gmail.com) ===');
    if (unaffectedUser) {
      console.log('User ID:', unaffectedUser.id);
      console.log('Created:', unaffectedUser.createdAt);
      console.log('Last Login:', unaffectedUser.lastLogin);
      console.log('Points:', unaffectedUser.points);
      console.log('Mining Balance:', unaffectedUser.miningBalance);
      console.log('Role:', unaffectedUser.role);
      console.log('Is Active:', unaffectedUser.isActive);
      console.log('Is Verified:', unaffectedUser.isVerified);
      console.log('Referral Code:', unaffectedUser.referralCode);
      console.log('Referred By:', unaffectedUser.referredByUser?.email || 'None');
      console.log('Referrals Count:', unaffectedUser.referrals?.length || 0);
      
      console.log('\n--- Mining Sessions ---');
      unaffectedUser.miningSessions.forEach((session, index) => {
        console.log(`Session ${index + 1}:`);
        console.log(`  ID: ${session.id}`);
        console.log(`  Started: ${session.startedAt}`);
        console.log(`  Is Active: ${session.isActive}`);
        console.log(`  Is Completed: ${session.isCompleted}`);
        console.log(`  Is Claimed: ${session.isClaimed}`);
        console.log(`  Current Rate: ${session.currentRate}`);
        console.log(`  Total Mined: ${session.totalMined}`);
        console.log(`  Last Update: ${session.lastUpdate}`);
        console.log('');
      });
      
      console.log('--- Mining Claims ---');
      unaffectedUser.miningClaims.forEach((claim, index) => {
        console.log(`Claim ${index + 1}:`);
        console.log(`  Amount: ${claim.amount}`);
        console.log(`  Claimed At: ${claim.claimedAt}`);
        console.log(`  Mining Rate: ${claim.miningRate}`);
        console.log('');
      });
    } else {
      console.log('User not found!');
    }

    // Check for any active sessions that might be causing issues
    console.log('\n=== ACTIVE MINING SESSIONS CHECK ===');
    const activeSessions = await prisma.miningSession.findMany({
      where: { isActive: true },
      include: { user: { select: { email: true } } },
      orderBy: { startedAt: 'desc' }
    });

    console.log(`Total active sessions: ${activeSessions.length}`);
    activeSessions.forEach((session, index) => {
      console.log(`Active Session ${index + 1}:`);
      console.log(`  User: ${session.user.email}`);
      console.log(`  Started: ${session.startedAt}`);
      console.log(`  Current Rate: ${session.currentRate}`);
      console.log(`  Total Mined: ${session.totalMined}`);
      console.log(`  Last Update: ${session.lastUpdate}`);
      console.log('');
    });

    // Check for any sessions that might be stuck or have issues
    console.log('\n=== POTENTIAL ISSUE SESSIONS ===');
    const now = new Date();
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    
    const stuckSessions = await prisma.miningSession.findMany({
      where: {
        isActive: true,
        startedAt: {
          lte: sixHoursAgo
        }
      },
      include: { user: { select: { email: true } } }
    });

    console.log(`Sessions that should have expired: ${stuckSessions.length}`);
    stuckSessions.forEach((session, index) => {
      console.log(`Stuck Session ${index + 1}:`);
      console.log(`  User: ${session.user.email}`);
      console.log(`  Started: ${session.startedAt}`);
      console.log(`  Should have expired: ${sixHoursAgo}`);
      console.log(`  Hours overdue: ${(now - session.startedAt) / (1000 * 60 * 60)}`);
      console.log('');
    });

  } catch (error) {
    console.error('Error investigating users:', error);
  } finally {
    await prisma.$disconnect();
  }
}

investigateUsers();
