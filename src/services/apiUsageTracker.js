/**
 * API Usage Tracker Service
 * Tracks daily API request counts and manages provider availability
 * Uses Redis for fast tracking, falls back to in-memory if Redis unavailable
 */

const cacheService = require('./cacheService');

class ApiUsageTracker {
  constructor() {
    this.memoryCache = new Map(); // Fallback if Redis unavailable
    this.resetTime = null; // Track when to reset counters
  }

  /**
   * Get usage key for a provider
   */
  getUsageKey(providerName, date = null) {
    const today = date || new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return `api_usage:${providerName}:${today}`;
  }

  /**
   * Check if provider has available requests
   */
  async hasAvailableRequests(providerName, dailyLimit) {
    try {
      const usageKey = this.getUsageKey(providerName);
      const currentUsage = await this.getUsage(providerName);
      
      return currentUsage < dailyLimit;
    } catch (error) {
      console.error(`Error checking availability for ${providerName}:`, error);
      // On error, assume available (fail open)
      return true;
    }
  }

  /**
   * Get current usage count for a provider
   */
  async getUsage(providerName) {
    try {
      const usageKey = this.getUsageKey(providerName);
      
      // Try Redis first
      try {
        const cached = await cacheService.get(usageKey);
        if (cached !== null) {
          return parseInt(cached) || 0;
        }
      } catch (redisError) {
        // Redis unavailable, use memory cache
        console.warn(`Redis unavailable, using memory cache for ${providerName}`);
      }

      // Fallback to memory cache
      const memoryKey = usageKey;
      return this.memoryCache.get(memoryKey) || 0;
    } catch (error) {
      console.error(`Error getting usage for ${providerName}:`, error);
      return 0;
    }
  }

  /**
   * Increment usage count for a provider
   */
  async incrementUsage(providerName, count = 1) {
    try {
      const usageKey = this.getUsageKey(providerName);
      const currentUsage = await this.getUsage(providerName);
      const newUsage = currentUsage + count;

      // Try Redis first
      try {
        await cacheService.set(usageKey, newUsage.toString(), 86400); // 24 hours TTL
      } catch (redisError) {
        // Redis unavailable, use memory cache
        console.warn(`Redis unavailable, using memory cache for ${providerName}`);
        this.memoryCache.set(usageKey, newUsage);
      }

      return newUsage;
    } catch (error) {
      console.error(`Error incrementing usage for ${providerName}:`, error);
      return 0;
    }
  }

  /**
   * Reset usage for a provider (called daily)
   */
  async resetUsage(providerName) {
    try {
      const usageKey = this.getUsageKey(providerName);
      
      // Try Redis first
      try {
        await cacheService.delete(usageKey);
      } catch (redisError) {
        // Redis unavailable, clear memory cache
        this.memoryCache.delete(usageKey);
      }

      console.log(`✅ Reset usage for ${providerName}`);
    } catch (error) {
      console.error(`Error resetting usage for ${providerName}:`, error);
    }
  }

  /**
   * Reset all provider usages (called daily at midnight)
   */
  async resetAllUsages() {
    try {
      const providerNames = [
        'newsapi',
        'newsdata',
        'currents',
        'gnews',
        'rss2json',
        'feedapi',
        'rssFeeds'
      ];

      for (const providerName of providerNames) {
        await this.resetUsage(providerName);
      }

      console.log('✅ Reset all API usage counters');
    } catch (error) {
      console.error('Error resetting all usages:', error);
    }
  }

  /**
   * Get usage statistics for all providers
   */
  async getUsageStats() {
    try {
      const providers = [
        { name: 'newsapi', limit: 1000 },
        { name: 'newsdata', limit: 200 },
        { name: 'currents', limit: 20 },
        { name: 'gnews', limit: 100 },
        { name: 'rss2json', limit: 1000 },
        { name: 'feedapi', limit: 1000 },
        { name: 'rssFeeds', limit: Infinity }
      ];

      const stats = {};
      for (const provider of providers) {
        const usage = await this.getUsage(provider.name);
        stats[provider.name] = {
          usage,
          limit: provider.limit,
          available: usage < provider.limit,
          percentage: provider.limit === Infinity ? 0 : (usage / provider.limit * 100).toFixed(2)
        };
      }

      return stats;
    } catch (error) {
      console.error('Error getting usage stats:', error);
      return {};
    }
  }
}

// Singleton instance
const apiUsageTracker = new ApiUsageTracker();

module.exports = apiUsageTracker;

