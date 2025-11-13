const { prisma } = require('../config/database');
const crypto = require('crypto');

/**
 * Distributed Lock Service
 * Prevents duplicate cron job execution in PM2 cluster mode
 * Uses database-based locking mechanism
 */
class DistributedLock {
  constructor() {
    // Generate unique instance ID for this process
    this.instanceId = crypto.randomBytes(16).toString('hex');
  }

  /**
   * Acquire a distributed lock
   * @param {string} lockKey - Unique key for the lock (e.g., 'daily_claim_notification')
   * @param {number} ttlSeconds - Time to live in seconds (default: 300 = 5 minutes)
   * @returns {Promise<boolean>} - True if lock acquired, false otherwise
   */
  async acquireLock(lockKey, ttlSeconds = 300) {
    try {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

      // Try to acquire lock
      // First, clean up expired locks
      await prisma.cronLock.deleteMany({
        where: {
          expiresAt: {
            lt: now
          }
        }
      });

      // Try to create a new lock
      try {
        await prisma.cronLock.create({
          data: {
            lockKey,
            instanceId: this.instanceId,
            lockedAt: now,
            expiresAt
          }
        });
        return true; // Lock acquired successfully
      } catch (error) {
        // Lock already exists (unique constraint violation)
        if (error.code === 'P2002') {
          return false; // Another instance already has the lock
        }
        throw error; // Re-throw other errors
      }
    } catch (error) {
      console.error(`Error acquiring lock ${lockKey}:`, error);
      return false;
    }
  }

  /**
   * Release a distributed lock
   * @param {string} lockKey - Unique key for the lock
   * @returns {Promise<void>}
   */
  async releaseLock(lockKey) {
    try {
      await prisma.cronLock.deleteMany({
        where: {
          lockKey,
          instanceId: this.instanceId
        }
      });
    } catch (error) {
      console.error(`Error releasing lock ${lockKey}:`, error);
    }
  }

  /**
   * Execute a function with a distributed lock
   * @param {string} lockKey - Unique key for the lock
   * @param {Function} fn - Function to execute
   * @param {number} ttlSeconds - Time to live in seconds
   * @returns {Promise<any>} - Result of the function or null if lock not acquired
   */
  async withLock(lockKey, fn, ttlSeconds = 300) {
    const acquired = await this.acquireLock(lockKey, ttlSeconds);
    
    if (!acquired) {
      console.log(`⏭️  Skipping ${lockKey} - lock held by another instance`);
      return null;
    }

    try {
      console.log(`🔒 Lock acquired for ${lockKey} by instance ${this.instanceId.substring(0, 8)}...`);
      const result = await fn();
      return result;
    } finally {
      await this.releaseLock(lockKey);
      console.log(`🔓 Lock released for ${lockKey}`);
    }
  }
}

const distributedLock = new DistributedLock();
module.exports = distributedLock;

