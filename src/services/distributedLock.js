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

      // First, clean up expired locks
      await prisma.cronLock.deleteMany({
        where: {
          expiresAt: {
            lt: now
          }
        }
      });

      // Generate a unique ID (CUID-like format for consistency with Prisma)
      const lockId = `cl${crypto.randomBytes(16).toString('hex')}`;

      // Use raw SQL with ON CONFLICT DO NOTHING to atomically acquire lock
      // This prevents Prisma from logging errors for expected constraint violations
      // $executeRaw returns the number of affected rows (0 if conflict, 1 if inserted)
      const affectedRows = await prisma.$executeRaw`
        INSERT INTO cron_locks (id, lock_key, instance_id, locked_at, expires_at)
        VALUES (${lockId}, ${lockKey}, ${this.instanceId}, ${now}, ${expiresAt})
        ON CONFLICT (lock_key) DO NOTHING
      `;

      // If affectedRows > 0, we successfully inserted (lock acquired)
      // If affectedRows === 0, ON CONFLICT was triggered (another instance has the lock)
      return affectedRows > 0;
    } catch (error) {
      // Only log unexpected errors
      if (error.code !== 'P2002') {
        console.error(`Error acquiring lock ${lockKey}:`, error);
      }
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
    try {
      const acquired = await this.acquireLock(lockKey, ttlSeconds);
      
      if (!acquired) {
        console.log(`⏭️  Skipping ${lockKey} - lock held by another instance`);
        return null;
      }

      try {
        console.log(`🔒 Lock acquired for ${lockKey} by instance ${this.instanceId.substring(0, 8)}... (TTL: ${ttlSeconds}s)`);
        const result = await fn();
        return result;
      } catch (error) {
        console.error(`❌ Error executing locked function for ${lockKey}:`, error);
        throw error;
      } finally {
        try {
          await this.releaseLock(lockKey);
          console.log(`🔓 Lock released for ${lockKey}`);
        } catch (releaseError) {
          console.error(`❌ Error releasing lock ${lockKey}:`, releaseError);
        }
      }
    } catch (error) {
      console.error(`❌ Error in withLock for ${lockKey}:`, error);
      return null;
    }
  }
}

const distributedLock = new DistributedLock();
module.exports = distributedLock;

