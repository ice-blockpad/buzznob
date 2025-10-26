const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function debugComplexQuery() {
  try {
    console.log('Debugging complex SQL query...');
    
    // Find the user
    const user = await prisma.user.findFirst({
      where: { email: 'tonwifhat@gmail.com' }
    });
    
    if (!user) {
      console.log('User not found');
      return;
    }
    
    // Test the user_mining_data CTE step by step
    console.log('Step 1: Testing user_mining_data CTE...');
    
    const step1 = await prisma.$queryRaw`
      SELECT 
        u.id as user_id,
        u.points,
        COUNT(DISTINCT ms_active.id) as active_sessions,
        COUNT(DISTINCT ms_completed.id) as completed_sessions,
        COUNT(DISTINCT mc.id) as total_claims,
        COALESCE(SUM(mc.amount), 0) as total_earned,
        COUNT(DISTINCT ref.id) as total_referrals,
        COUNT(DISTINCT active_ref.id) as active_referrals
      FROM users u
      LEFT JOIN mining_sessions ms_active ON u.id = ms_active.user_id AND ms_active.is_active = true
      LEFT JOIN mining_sessions ms_completed ON u.id = ms_completed.user_id AND ms_completed.is_completed = true AND ms_completed.is_claimed = true
      LEFT JOIN mining_claims mc ON u.id = mc.user_id
      LEFT JOIN users ref ON ref.referred_by = u.id
      LEFT JOIN users active_ref ON active_ref.referred_by = u.id 
        AND EXISTS (
          SELECT 1 FROM mining_sessions ms_ref 
          WHERE ms_ref.user_id = active_ref.id 
            AND ms_ref.is_active = true 
            AND ms_ref.started_at >= NOW() - INTERVAL '6 hours'
        )
      WHERE u.id = ${user.id}
      GROUP BY u.id, u.points
    `;
    
    console.log('Step 1 result:', step1);
    
    // Test without the referral JOINs
    console.log('Step 2: Testing without referral JOINs...');
    
    const step2 = await prisma.$queryRaw`
      SELECT 
        u.id as user_id,
        u.points,
        COUNT(DISTINCT ms_active.id) as active_sessions,
        COUNT(DISTINCT ms_completed.id) as completed_sessions,
        COUNT(DISTINCT mc.id) as total_claims,
        COALESCE(SUM(mc.amount), 0) as total_earned
      FROM users u
      LEFT JOIN mining_sessions ms_active ON u.id = ms_active.user_id AND ms_active.is_active = true
      LEFT JOIN mining_sessions ms_completed ON u.id = ms_completed.user_id AND ms_completed.is_completed = true AND ms_completed.is_claimed = true
      LEFT JOIN mining_claims mc ON u.id = mc.user_id
      WHERE u.id = ${user.id}
      GROUP BY u.id, u.points
    `;
    
    console.log('Step 2 result:', step2);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debugComplexQuery();
