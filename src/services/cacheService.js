const Redis = require('ioredis');

/**
 * Redis Cache Service
 * Handles caching with automatic invalidation
 */
class CacheService {
  constructor() {
    // Initialize Redis client (will use connection string from env or default)
    this.redis = process.env.REDIS_URL 
      ? new Redis(process.env.REDIS_URL)
      : new Redis({
          host: process.env.REDIS_HOST || 'localhost',
          port: process.env.REDIS_PORT || 6379,
          password: process.env.REDIS_PASSWORD,
          retryStrategy: (times) => {
            const delay = Math.min(times * 50, 2000);
            return delay;
          },
          maxRetriesPerRequest: 3,
        });

    // Handle Redis connection errors gracefully
    this.redis.on('error', (err) => {
      console.error('Redis connection error:', err);
      // Continue without cache if Redis fails
    });

    this.redis.on('connect', () => {
      console.log('✅ Redis connected');
    });
  }

  /**
   * Get value from cache
   * @param {string} key - Cache key
   * @returns {Promise<any|null>} - Cached value or null
   */
  async get(key) {
    try {
      const value = await this.redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error(`Cache get error for key ${key}:`, error);
      return null; // Return null on error (fail gracefully)
    }
  }

  /**
   * Set value in cache with TTL
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} ttlSeconds - Time to live in seconds
   * @returns {Promise<void>}
   */
  async set(key, value, ttlSeconds = 300) {
    try {
      await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
    } catch (error) {
      console.error(`Cache set error for key ${key}:`, error);
      // Fail silently - cache is optional
    }
  }

  /**
   * Delete a specific cache key
   * @param {string} key - Cache key to delete
   * @returns {Promise<void>}
   */
  async delete(key) {
    try {
      await this.redis.del(key);
    } catch (error) {
      console.error(`Cache delete error for key ${key}:`, error);
    }
  }

  /**
   * Delete multiple cache keys matching a pattern
   * @param {string} pattern - Pattern to match (e.g., 'articles:trending:*')
   * @returns {Promise<void>}
   */
  async deletePattern(pattern) {
    try {
      const stream = this.redis.scanStream({
        match: pattern,
        count: 100
      });

      const keys = [];
      stream.on('data', (resultKeys) => {
        keys.push(...resultKeys);
      });

      return new Promise((resolve, reject) => {
        stream.on('end', async () => {
          if (keys.length > 0) {
            await this.redis.del(...keys);
            console.log(`🗑️  Deleted ${keys.length} cache keys matching pattern: ${pattern}`);
          }
          resolve();
        });
        stream.on('error', reject);
      });
    } catch (error) {
      console.error(`Cache deletePattern error for pattern ${pattern}:`, error);
    }
  }

  /**
   * Write-through: Update article caches when articles change
   * Instead of invalidating, we refresh the cache with fresh data
   * @param {Function} fetchTrendingFn - Function to fetch fresh trending articles
   * @param {Function} fetchFeaturedFn - Function to fetch fresh featured articles
   * @param {string} articleId - Optional article ID for specific article cache update
   * @returns {Promise<void>}
   */
  async refreshArticleCaches(fetchTrendingFn, fetchFeaturedFn, articleId = null) {
    try {
      // Write-through: Update all article list caches with fresh data
      const [trending10, trending20, featured10, featured20] = await Promise.all([
        this.writeThroughArticleList('articles:trending:10', () => fetchTrendingFn(10), 600),
        this.writeThroughArticleList('articles:trending:20', () => fetchTrendingFn(20), 600),
        this.writeThroughArticleList('articles:featured:10', () => fetchFeaturedFn(10), 600),
        this.writeThroughArticleList('articles:featured:20', () => fetchFeaturedFn(20), 600),
      ]);

      console.log('✅ Refreshed article caches with fresh data (write-through)');
    } catch (error) {
      console.error('Error refreshing article caches:', error);
      // Fallback: Delete caches if refresh fails
      await this.deletePattern('articles:trending:*');
      await this.deletePattern('articles:featured:*');
    }
  }

  /**
   * Write-through: Update user profile cache when profile or points change
   * @param {string} userId - User ID
   * @param {Function} fetchProfileFn - Function to fetch fresh profile from DB
   * @returns {Promise<void>}
   */
  /**
   * Refresh user profile cache with fresh data
   * Optimized: Directly updates cache without delete-then-write pattern
   * This avoids the empty cache window and ensures atomic updates
   * @param {string} userId - User ID
   * @param {Function|Object} fetchProfileFnOrData - Function to fetch fresh profile, or pre-fetched data
   * @returns {Promise<void>}
   */
  async refreshUserProfile(userId, fetchProfileFnOrData) {
    try {
      // Write-through: Update cache directly with fresh data (atomic operation)
      // No need to delete first - Redis SET overwrites existing key
      await this.writeThroughUserProfile(userId, fetchProfileFnOrData, 120);
      console.log(`✅ Refreshed profile cache for user ${userId} (write-through)`);
    } catch (error) {
      console.error(`Error refreshing user profile cache for ${userId}:`, error);
      // Fallback: Delete cache if refresh fails to force fresh fetch on next request
      await this.delete(`profile:${userId}`);
    }
  }

  /**
   * Write-through: Update leaderboard cache when points change
   * @param {string} period - Leaderboard period (weekly, monthly, all)
   * @param {Function} fetchLeaderboardFn - Function to fetch fresh leaderboard from DB
   * @returns {Promise<void>}
   */
  async refreshLeaderboard(period, fetchLeaderboardFn) {
    try {
      // Write-through: Update cache with fresh leaderboard data
      await this.writeThroughLeaderboard(period, fetchLeaderboardFn, 300);
      console.log(`✅ Refreshed leaderboard cache for period ${period} (write-through)`);
    } catch (error) {
      console.error(`Error refreshing leaderboard cache for period ${period}:`, error);
      // Fallback: Delete cache if refresh fails
      await this.delete(`leaderboard:${period}`);
    }
  }

  /**
   * Write-through: Refresh public profile cache when profile data changes
   * @param {string} userId - User ID
   * @param {Function} fetchPublicProfileFn - Function to fetch fresh public profile from DB
   * @returns {Promise<void>}
   */
  async refreshPublicProfile(userId, fetchPublicProfileFn) {
    try {
      const cacheKey = `public:profile:${userId}`;
      // Write-through: Update cache with fresh public profile data
      const data = await fetchPublicProfileFn();
      if (data !== null && data !== undefined) {
        await this.set(cacheKey, data, 600); // 10 minutes TTL
      }
      console.log(`✅ Refreshed public profile cache for user ${userId} (write-through)`);
    } catch (error) {
      console.error(`Error refreshing public profile cache for ${userId}:`, error);
      // Fallback: Delete cache if refresh fails to force fresh fetch on next request
      await this.delete(`public:profile:${userId}`);
    }
  }

  /**
   * Write-through: Refresh all leaderboard caches when points change
   * @param {Function} fetchWeeklyFn - Function to fetch weekly leaderboard
   * @param {Function} fetchMonthlyFn - Function to fetch monthly leaderboard
   * @param {Function} fetchAllFn - Function to fetch all-time leaderboard
   * @returns {Promise<void>}
   */
  async refreshAllLeaderboards(fetchWeeklyFn, fetchMonthlyFn, fetchAllFn) {
    try {
      await Promise.all([
        this.refreshLeaderboard('weekly', fetchWeeklyFn),
        this.refreshLeaderboard('monthly', fetchMonthlyFn),
        this.refreshLeaderboard('all', fetchAllFn),
      ]);
      console.log('✅ Refreshed all leaderboard caches (write-through)');
    } catch (error) {
      console.error('Error refreshing all leaderboards:', error);
      // Fallback: Delete all leaderboard caches
      await this.deletePattern('leaderboard:*');
    }
  }

  /**
   * Write-through: Update read count cache when read count changes
   * @param {string} articleId - Article ID
   * @param {Function} fetchReadCountFn - Function to fetch fresh read count from DB
   * @returns {Promise<void>}
   */
  async refreshReadCount(articleId, fetchReadCountFn) {
    try {
      // Write-through: Update cache with fresh read count
      await this.writeThroughReadCount(articleId, fetchReadCountFn, 600); // 10 minutes TTL
      console.log(`✅ Refreshed read count cache for article ${articleId} (write-through)`);
    } catch (error) {
      console.error(`Error refreshing read count cache for article ${articleId}:`, error);
      // Fallback: Delete cache if refresh fails
      await this.delete(`readcount:${articleId}`);
    }
  }

  /**
   * Write-through cache: Get from cache, or fetch from DB and cache result
   * @param {string} key - Cache key
   * @param {Function} fetchFn - Function to fetch data from DB
   * @param {number} ttlSeconds - Cache TTL in seconds
   * @returns {Promise<any>} - Cached or fresh data
   */
  async getOrSet(key, fetchFn, ttlSeconds = 300) {
    try {
      // Try to get from cache first
      const cached = await this.get(key);
      if (cached !== null) {
        return cached;
      }

      // Cache miss - fetch from database
      const data = await fetchFn();

      // Write-through: Store in cache immediately after fetching
      if (data !== null && data !== undefined) {
        await this.set(key, data, ttlSeconds);
      }

      return data;
    } catch (error) {
      console.error(`Cache getOrSet error for key ${key}:`, error);
      // On error, try to fetch from DB directly (fail gracefully)
      try {
        return await fetchFn();
      } catch (dbError) {
        throw dbError;
      }
    }
  }

  /**
   * Write-through cache: Write to both database and cache
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} ttlSeconds - Cache TTL in seconds
   * @returns {Promise<void>}
   */
  async writeThrough(key, value, ttlSeconds = 300) {
    try {
      // Write to cache immediately (database write happens separately)
      await this.set(key, value, ttlSeconds);
    } catch (error) {
      console.error(`Cache writeThrough error for key ${key}:`, error);
      // Fail silently - cache is optional
    }
  }

  /**
   * Write-through for article lists: Update cache when article changes
   * @param {string} cacheKey - Cache key (e.g., 'articles:trending:10')
   * @param {Function} fetchFn - Function to fetch fresh data from DB
   * @param {number} ttlSeconds - Cache TTL in seconds
   * @returns {Promise<any>} - Fresh data (also cached)
   */
  async writeThroughArticleList(cacheKey, fetchFn, ttlSeconds = 600) {
    try {
      // Fetch fresh data from database
      const data = await fetchFn();
      
      // Write-through: Update cache with fresh data
      if (data !== null && data !== undefined) {
        await this.set(cacheKey, data, ttlSeconds);
      }
      
      return data;
    } catch (error) {
      console.error(`Cache writeThroughArticleList error for key ${cacheKey}:`, error);
      throw error;
    }
  }

  /**
   * Write-through for user profile: Update cache when profile changes
   * @param {string} userId - User ID
   * @param {Function|Object} fetchFnOrData - Function to fetch fresh profile from DB, or pre-fetched data object
   * @param {number} ttlSeconds - Cache TTL in seconds
   * @returns {Promise<any>} - Fresh profile (also cached)
   */
  async writeThroughUserProfile(userId, fetchFnOrData, ttlSeconds = 120) {
    try {
      const cacheKey = `profile:${userId}`;
      
      // If fetchFnOrData is a function, call it; otherwise use it directly
      const data = typeof fetchFnOrData === 'function' 
        ? await fetchFnOrData() 
        : fetchFnOrData;
      
      // Write-through: Update cache with fresh data (atomic: SET overwrites existing key)
      if (data !== null && data !== undefined) {
        await this.set(cacheKey, data, ttlSeconds);
      }
      
      return data;
    } catch (error) {
      console.error(`Cache writeThroughUserProfile error for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Write-through for leaderboard: Update cache when points change
   * @param {string} period - Leaderboard period (weekly, monthly, all)
   * @param {Function} fetchFn - Function to fetch fresh leaderboard from DB
   * @param {number} ttlSeconds - Cache TTL in seconds
   * @returns {Promise<any>} - Fresh leaderboard (also cached)
   */
  async writeThroughLeaderboard(period, fetchFn, ttlSeconds = 300) {
    try {
      const cacheKey = `leaderboard:${period}`;
      
      // Fetch fresh data from database
      const data = await fetchFn();
      
      // Write-through: Update cache with fresh data
      if (data !== null && data !== undefined) {
        await this.set(cacheKey, data, ttlSeconds);
      }
      
      return data;
    } catch (error) {
      console.error(`Cache writeThroughLeaderboard error for period ${period}:`, error);
      throw error;
    }
  }

  /**
   * Write-through for read counts: Update cache when read count changes
   * @param {string} articleId - Article ID
   * @param {Function} fetchFn - Function to fetch fresh read count from DB
   * @param {number} ttlSeconds - Cache TTL in seconds
   * @returns {Promise<any>} - Fresh read count (also cached)
   */
  async writeThroughReadCount(articleId, fetchFn, ttlSeconds = 600) {
    try {
      const cacheKey = `readcount:${articleId}`;
      
      // Fetch fresh data from database
      const data = await fetchFn();
      
      // Write-through: Update cache with fresh data
      if (data !== null && data !== undefined) {
        await this.set(cacheKey, data, ttlSeconds);
      }
      
      return data;
    } catch (error) {
      console.error(`Cache writeThroughReadCount error for article ${articleId}:`, error);
      throw error;
    }
  }

  /**
   * Close Redis connection
   */
  async disconnect() {
    await this.redis.quit();
  }
}

// Export singleton instance
const cacheService = new CacheService();
module.exports = cacheService;

