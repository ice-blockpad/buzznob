const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkSQLIssue() {
  try {
    console.log('Checking SQL query issue...');
    
    // Find the user
    const user = await prisma.user.findFirst({
      where: { email: 'tonwifhat@gmail.com' }
    });
    
    if (!user) {
      console.log('User not found');
      return;
    }
    
    // Test the exact SUM query from the SQL
    const sumResult = await prisma.$queryRaw`
      SELECT COALESCE(SUM(mc.amount), 0) as total_earned
      FROM mining_claims mc
      WHERE mc.user_id = ${user.id}
    `;
    
    console.log('Direct SUM of mining_claims.amount:', sumResult[0].total_earned);
    
    // Check if there are any duplicate records
    const allClaims = await prisma.$queryRaw`
      SELECT mc.id, mc.amount, mc.user_id, mc.claimed_at
      FROM mining_claims mc
      WHERE mc.user_id = ${user.id}
      ORDER BY mc.claimed_at DESC
    `;
    
    console.log('All claims records:', allClaims);
    
    // Check if the issue is in the JOIN
    const joinResult = await prisma.$queryRaw`
      SELECT 
        u.id as user_id,
        mc.id as claim_id,
        mc.amount,
        mc.user_id as claim_user_id
      FROM users u
      LEFT JOIN mining_claims mc ON u.id = mc.user_id
      WHERE u.id = ${user.id}
    `;
    
    console.log('JOIN result:', joinResult);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkSQLIssue();
