const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * Auto-sync database schema on server startup
 * This ensures the database is always in sync with the Prisma schema
 */
async function autoSyncDatabase() {
  console.log('🔄 Auto-syncing database schema...');



  
  
  try {
    // First, ensure Prisma client is generated
    console.log('🔧 Generating Prisma client...');
    try {
      const { stdout: generateStdout, stderr: generateStderr } = await execPromise('npx prisma generate', {
        cwd: __dirname + '/../..',
        timeout: 30000 // 30 second timeout
      });
      
      if (generateStdout) console.log(generateStdout);
      if (generateStderr && !generateStderr.includes('warnings') && !generateStderr.includes('EPERM')) {
        console.warn('Prisma generate warnings:', generateStderr);
      }
    } catch (generateError) {
      // Handle Windows-specific EPERM errors gracefully
      if (generateError.message.includes('EPERM') || generateError.message.includes('operation not permitted')) {
        console.log('⚠️  Prisma client generation had permission issues (common on Windows)');
        console.log('   This is usually safe to ignore if the client was previously generated');
      } else {
        console.warn('⚠️  Prisma client generation failed:', generateError.message);
      }
    }
    
    // Use db push for development (no migration files needed)
    // This automatically creates missing tables, columns, and updates existing ones
    console.log('📊 Pushing database schema...');
    const { stdout, stderr } = await execPromise('npx prisma db push --accept-data-loss', {
      cwd: __dirname + '/../..',
      timeout: 30000 // 30 second timeout
    });
    
    if (stdout) console.log(stdout);
    if (stderr && !stderr.includes('warnings') && !stderr.includes('EPERM')) {
      console.error(stderr);
    }
    
    console.log('✅ Database schema synced successfully');
    return true;
  } catch (error) {
    console.error('❌ Database sync failed:', error.message);
    
    // Check if it's a Windows permission error
    if (error.message.includes('EPERM') || error.message.includes('operation not permitted')) {
      console.log('⚠️  Windows file permission issue detected');
      console.log('   This is often caused by antivirus software or file locking');
      console.log('   The database schema is likely already in sync');
    }
    
    // If sync fails, try to continue anyway (database might already be synced)
    console.log('⚠️  Continuing with existing database schema...');
    return false;
  }
}

module.exports = { autoSyncDatabase };

