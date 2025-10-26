const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testFixedQuery() {
  try {
    console.log('Testing fixed SQL query...');
    
    // Find the user
    const user = await prisma.user.findFirst({
      where: { email: 'tonwifhat@gmail.com' }
    });
    
    if (!user) {
      console.log('User not found');
      return;
    }
    
    // Test the fixed query
    const result = await prisma.$queryRaw`
      WITH user_mining_data AS (
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
      ),
      referral_data AS (
        SELECT 
          u.id as user_id,
          COUNT(DISTINCT ref.id) as total_referrals,
          COUNT(DISTINCT active_ref.id) as active_referrals
        FROM users u
        LEFT JOIN users ref ON ref.referred_by = u.id
        LEFT JOIN users active_ref ON active_ref.referred_by = u.id 
          AND EXISTS (
            SELECT 1 FROM mining_sessions ms_ref 
            WHERE ms_ref.user_id = active_ref.id 
              AND ms_ref.is_active = true 
              AND ms_ref.started_at >= NOW() - INTERVAL '6 hours'
          )
        WHERE u.id = ${user.id}
        GROUP BY u.id
      ),
      current_session AS (
        SELECT 
          ms.id,
          ms.started_at,
          ms.total_mined,
          ms.current_rate,
          ms.last_update,
          ms.is_active,
          ms.is_completed,
          ms.is_claimed
        FROM mining_sessions ms
        WHERE ms.user_id = ${user.id}
          AND (ms.is_active = true OR (ms.is_completed = true AND ms.is_claimed = false))
        ORDER BY ms.started_at DESC
        LIMIT 1
      )
      SELECT 
        umd.user_id,
        umd.points,
        umd.active_sessions,
        umd.completed_sessions,
        umd.total_claims,
        umd.total_earned,
        rd.total_referrals,
        rd.active_referrals,
        cs.id as session_id,
        cs.started_at,
        cs.total_mined,
        cs.current_rate,
        cs.last_update,
        cs.is_active,
        cs.is_completed,
        cs.is_claimed
      FROM user_mining_data umd
      LEFT JOIN referral_data rd ON umd.user_id = rd.user_id
      LEFT JOIN current_session cs ON true
    `;
    
    console.log('Fixed query result:', result);
    
    if (result && result.length > 0) {
      const data = result[0];
      console.log('Total earned (should be 42):', data.total_earned);
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testFixedQuery();
