const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testDecimalClaiming() {
  try {
    console.log('🧪 Testing decimal claiming logic...');
    
    // Test the calculation logic
    const testAmount = 13.9826;
    console.log(`Original mined amount: ${testAmount}`);
    
    const finalMinedAmount = parseFloat(testAmount);
    const pointsToAdd = Math.floor(finalMinedAmount);
    
    console.log(`Final mined amount (for mining balance): ${finalMinedAmount}`);
    console.log(`Points to add (floored): ${pointsToAdd}`);
    console.log(`Difference: ${finalMinedAmount - pointsToAdd}`);
    
    // Test with different amounts
    const testCases = [13.9826, 20.0000, 15.1234, 10.9999];
    
    console.log('\n📊 Test cases:');
    testCases.forEach((amount, index) => {
      const final = parseFloat(amount);
      const points = Math.floor(final);
      const difference = final - points;
      
      console.log(`${index + 1}. ${amount} → Mining Balance: ${final}, Points: ${points}, Difference: ${difference}`);
    });
    
    // Check current user balance
    const user = await prisma.user.findFirst({
      where: { email: 'tonwifhat@gmail.com' },
      select: { username: true, miningBalance: true, points: true }
    });
    
    if (user) {
      console.log(`\n👤 Current user balance:`);
      console.log(`Username: ${user.username}`);
      console.log(`Mining Balance: ${user.miningBalance}`);
      console.log(`Points: ${user.points}`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testDecimalClaiming();
