const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function debugStepByStep() {
  try {
    console.log('Debugging step by step...');
    
    // Find the user
    const user = await prisma.user.findFirst({
      where: { email: 'tonwifhat@gmail.com' }
    });
    
    if (!user) {
      console.log('User not found');
      return;
    }
    
    // Test just the mining claims without any other JOINs
    console.log('Step 1: Just mining claims...');
    const step1 = await prisma.$queryRaw`
      SELECT 
        u.id as user_id,
        COUNT(DISTINCT mc.id) as total_claims,
        COALESCE(SUM(mc.amount), 0) as total_earned
      FROM users u
      LEFT JOIN mining_claims mc ON u.id = mc.user_id
      WHERE u.id = ${user.id}
      GROUP BY u.id
    `;
    console.log('Step 1 result:', step1);
    
    // Test with mining sessions
    console.log('Step 2: With mining sessions...');
    const step2 = await prisma.$queryRaw`
      SELECT 
        u.id as user_id,
        COUNT(DISTINCT ms_active.id) as active_sessions,
        COUNT(DISTINCT ms_completed.id) as completed_sessions,
        COUNT(DISTINCT mc.id) as total_claims,
        COALESCE(SUM(mc.amount), 0) as total_earned
      FROM users u
      LEFT JOIN mining_sessions ms_active ON u.id = ms_active.user_id AND ms_active.is_active = true
      LEFT JOIN mining_sessions ms_completed ON u.id = ms_completed.user_id AND ms_completed.is_completed = true AND ms_completed.is_claimed = true
      LEFT JOIN mining_claims mc ON u.id = mc.user_id
      WHERE u.id = ${user.id}
      GROUP BY u.id
    `;
    console.log('Step 2 result:', step2);
    
    // Check if there are duplicate mining claims
    console.log('Step 3: Check for duplicate claims...');
    const step3 = await prisma.$queryRaw`
      SELECT 
        mc.id,
        mc.amount,
        mc.user_id,
        ms.id as session_id,
        ms.is_active,
        ms.is_completed,
        ms.is_claimed
      FROM mining_claims mc
      LEFT JOIN mining_sessions ms ON mc.user_id = ms.user_id
      WHERE mc.user_id = ${user.id}
      ORDER BY mc.claimed_at DESC
    `;
    console.log('Step 3 result:', step3);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debugStepByStep();
