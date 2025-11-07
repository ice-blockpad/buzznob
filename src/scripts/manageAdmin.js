const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

async function manageRole(username, role, action) {
  const validRoles = ['admin', 'creator', 'user'];
  if (!validRoles.includes(role)) {
    console.log(`❌ Invalid role. Use one of: ${validRoles.join(', ')}`);
    return;
  }
  try {
    console.log(`🔍 Looking for user with username: ${username}`);
    
    // Find user by username (unique field)
    const user = await prisma.user.findUnique({
      where: { username: username }
    });

    if (!user) {
      console.log(`❌ User with username ${username} not found.`);
      return;
    }

    console.log(`👤 Found user: ${user.displayName || user.username} (${user.username})`);
    console.log(`📊 Current role: ${user.role}`);
    console.log(`✅ Current verification status: ${user.isVerified}`);

    let updatedUser;
    
    if (action === 'set') {
      if (user.role === role) {
        console.log(`⚠️  User already has role: ${role}`);
        return;
      }
      
      updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: {
          role: role,
          isVerified: role === 'admin' ? true : user.isVerified
        }
      });
      
      console.log(`🎉 Successfully set user as ${role}!`);
      
    } else if (action === 'unset') {
      if (user.role !== role) {
        console.log(`⚠️  User is not currently a ${role}. Current role: ${user.role}`);
        return;
      }
      
      updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: {
          role: 'user',
          isVerified: role === 'admin' ? false : user.isVerified
        }
      });
      
      console.log(`🎉 Successfully removed ${role} privileges!`);
      
    } else {
      console.log(`❌ Invalid action. Use 'set' or 'unset'.`);
      return;
    }

    console.log(`📊 New role: ${updatedUser.role}`);
    console.log(`✅ New verification status: ${updatedUser.isVerified}`);
    
  } catch (error) {
    console.error('❌ Error managing admin role:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Get arguments from command line
const action = process.argv[2]; // 'set' or 'unset'
const role = process.argv[3]; // 'admin' or 'creator'
const username = process.argv[4];

// Quick command to set creator role for specific username
if (process.argv[2] === 'setcreator' && process.argv[3]) {
  const quickUsername = process.argv[3];
  console.log(`🚀 Setting creator role for ${quickUsername}...\n`);
  manageRole(quickUsername, 'creator', 'set');
  return;
}

if (!action || !['set', 'unset'].includes(action) || !role || !['admin', 'creator'].includes(role) || !username) {
  console.log('❌ Usage: node manageAdmin.js <set|unset> <admin|creator> <username>');
  console.log('📝 Examples:');
  console.log('   node manageAdmin.js set admin just2williamz');
  console.log('   node manageAdmin.js set creator username123');
  console.log('   node manageAdmin.js unset creator username123');
  console.log('\nQuick command for setting creator role:');
  console.log('   node manageAdmin.js setcreator <username>');
  process.exit(1);
}

console.log(`🚀 ${action === 'set' ? 'Setting' : 'Removing'} ${role} privileges...\n`);
manageRole(username, role, action);
