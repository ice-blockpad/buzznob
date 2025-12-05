const { exec } = require('child_process');
const util = require('util');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const execPromise = util.promisify(exec);

/**
 * Check if a process with the given PID is still running
 */
async function isProcessRunning(pid) {
  try {
    if (os.platform() === 'win32') {
      // Windows: tasklist command
      await execPromise(`tasklist /FI "PID eq ${pid}" 2>nul | find "${pid}"`);
      return true;
    } else {
      // Unix-like: kill -0 to check if process exists
      await execPromise(`kill -0 ${pid} 2>/dev/null`);
      return true;
    }
  } catch {
    return false;
  }
}

/**
 * Try to acquire lock file with stale lock detection
 */
async function acquireLock(lockFile) {
  const MAX_LOCK_AGE = 120000; // 2 minutes
  
  try {
    // Try to create lock file
    await fs.writeFile(lockFile, process.pid.toString(), { flag: 'wx' });
    console.log('🔒 Acquired database sync lock');
    return true;
  } catch (lockError) {
    if (lockError.code !== 'EEXIST') {
      throw lockError; // Unexpected error
    }
    
    // Lock exists - check if it's stale
    try {
      const lockContent = await fs.readFile(lockFile, 'utf8');
      const lockPid = parseInt(lockContent.trim(), 10);
      const lockStats = await fs.stat(lockFile);
      const lockAge = Date.now() - lockStats.mtime.getTime();
      
      // Check if lock is stale (old or process dead)
      const isStale = lockAge > MAX_LOCK_AGE || !(await isProcessRunning(lockPid));
      
      if (isStale) {
        console.log(`⚠️  Stale lock detected (PID: ${lockPid}, age: ${Math.round(lockAge / 1000)}s), removing...`);
        await fs.unlink(lockFile);
        // Retry acquiring lock
        await fs.writeFile(lockFile, process.pid.toString(), { flag: 'wx' });
        console.log('🔒 Acquired database sync lock');
        return true;
      }
      
      // Lock is valid - another process is syncing
      console.log('⏳ Database sync already in progress by another process, skipping...');
      return false;
    } catch (checkError) {
      // Lock file was removed between check and now, or other error
      if (checkError.code === 'ENOENT') {
        // Lock was removed, try again
        try {
          await fs.writeFile(lockFile, process.pid.toString(), { flag: 'wx' });
          console.log('🔒 Acquired database sync lock');
          return true;
        } catch (retryError) {
          if (retryError.code === 'EEXIST') {
            console.log('⏳ Database sync already in progress, skipping...');
            return false;
          }
          throw retryError;
        }
      }
      throw checkError;
    }
  }
}

/**
 * Auto-sync database schema on server startup
 * This ensures the database is always in sync with the Prisma schema
 * 
 * In PM2 cluster mode, only the first instance (instance 0) should run the sync
 * to prevent multiple concurrent prisma db push commands from conflicting
 */
async function autoSyncDatabase() {
  // Check if running in PM2 cluster mode
  // PM2 sets NODE_APP_INSTANCE or instances environment variable
  const pm2InstanceId = process.env.NODE_APP_INSTANCE || process.env.pm_id || process.env.INSTANCE_ID;
  const isClusterMode = process.env.instances || process.env.pm_id !== undefined;
  
  // In cluster mode, only run sync on instance 0 (first instance)
  if (isClusterMode && pm2InstanceId !== undefined && pm2InstanceId !== '0' && pm2InstanceId !== 0) {
    console.log(`⏭️  Skipping database sync on PM2 instance ${pm2InstanceId} (only instance 0 runs sync)`);
    return true; // Return success to allow server to start
  }

  // File lock mechanism to prevent concurrent syncs even if PM2 instance check fails
  const lockFile = path.join(__dirname, '../../.db-sync.lock');
  let lockAcquired = false;

  try {
    // Try to acquire lock
    lockAcquired = await acquireLock(lockFile);
    if (!lockAcquired) {
      return true; // Another process is handling it, exit gracefully
    }

    console.log('🔄 Auto-syncing database schema...');
    
    // prisma db push automatically generates the client, so we don't need a separate generate step
    // This saves ~5-10 seconds on startup
    console.log('📊 Pushing database schema (this will also generate Prisma client)...');
    const { stdout, stderr } = await execPromise('npx prisma db push --accept-data-loss', {
      cwd: path.join(__dirname, '../..'),
      timeout: 60000 // 60 second timeout (increased for large schemas)
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

