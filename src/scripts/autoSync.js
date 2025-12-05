const { exec } = require('child_process');
const util = require('util');
const fs = require('fs').promises;
const path = require('path');
const execPromise = util.promisify(exec);

/**
 * Auto-sync database schema on server startup
 * This ensures the database is always in sync with the Prisma schema
 * 
 * Uses a file lock mechanism to prevent concurrent syncs across instances
 */
async function autoSyncDatabase() {
  // File lock mechanism to prevent concurrent syncs
  const lockFile = path.join(__dirname, '../../.db-sync.lock');
  let lockAcquired = false;

  try {
    // Try to acquire lock file (non-blocking)
    try {
      await fs.writeFile(lockFile, process.pid.toString(), { flag: 'wx' });
      lockAcquired = true;
      console.log('🔒 Acquired database sync lock');
    } catch (lockError) {
      if (lockError.code === 'EEXIST') {
        // Lock file exists - another process is syncing
        console.log('⏳ Database sync already in progress by another process, skipping...');
        // Wait a bit and check if lock is stale (older than 2 minutes)
        try {
          const lockStats = await fs.stat(lockFile);
          const lockAge = Date.now() - lockStats.mtime.getTime();
          if (lockAge > 120000) { // 2 minutes
            console.log('⚠️  Stale lock detected, removing and retrying...');
            await fs.unlink(lockFile);
            await fs.writeFile(lockFile, process.pid.toString(), { flag: 'wx' });
            lockAcquired = true;
          } else {
            return true; // Another process is handling it, exit gracefully
          }
        } catch (checkError) {
          // Lock was removed between check and now, try again
          try {
            await fs.writeFile(lockFile, process.pid.toString(), { flag: 'wx' });
            lockAcquired = true;
          } catch (retryError) {
            console.log('⏳ Database sync already in progress, skipping...');
            return true;
          }
        }
      } else {
        throw lockError;
      }
    }

    console.log('🔄 Auto-syncing database schema...');

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
    
    // Check if it's a prepared statement error (common in cluster mode)
    if (error.message.includes('prepared statement') || error.message.includes('P2002')) {
      console.log('⚠️  Database connection conflict detected (common in cluster mode)');
      console.log('   This usually means another instance is syncing. The database is likely already in sync.');
    }
    
    // Check if it's a Windows permission error
    if (error.message.includes('EPERM') || error.message.includes('operation not permitted')) {
      console.log('⚠️  Windows file permission issue detected');
      console.log('   This is often caused by antivirus software or file locking');
      console.log('   The database schema is likely already in sync');
    }
    
    // If sync fails, try to continue anyway (database might already be synced)
    console.log('⚠️  Continuing with existing database schema...');
    return false;
  } finally {
    // Release lock file
    if (lockAcquired) {
      try {
        await fs.unlink(lockFile);
        console.log('🔓 Released database sync lock');
      } catch (unlinkError) {
        // Ignore errors when removing lock file
        console.warn('⚠️  Could not remove lock file:', unlinkError.message);
      }
    }
  }
}

module.exports = { autoSyncDatabase };

