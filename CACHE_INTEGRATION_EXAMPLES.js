/**
 * CACHE INTEGRATION EXAMPLES
 * 
 * This file shows HOW cache invalidation works in practice.
 * Copy these patterns into your actual route files.
 */

const cacheService = require('./src/services/cacheService');
const { prisma } = require('./src/config/database');

// ============================================
// EXAMPLE 1: Article Creation with Cache Invalidation
// ============================================

async function createArticleExample() {
  // 1. Create article in database
  const article = await prisma.article.create({
    data: {
      title: "New Article",
      content: "Content here...",
      status: 'published',
      // ... other fields
    }
  });

  // 2. INVALIDATE CACHE - Delete all article list caches
  // This ensures users see the new article immediately
  await cacheService.invalidateArticles(article.id);
  
  // What gets deleted:
  // - "articles:trending:10"
  // - "articles:trending:20"
  // - "articles:featured:10"
  // - "articles:list:page1:limit20"
  // - "article:articleId" (if exists)
  
  return article;
}

// ============================================
// EXAMPLE 2: Article Update with Cache Invalidation
// ============================================

async function updateArticleExample(articleId) {
  // 1. Update article in database
  const article = await prisma.article.update({
    where: { id: articleId },
    data: {
      title: "Updated Title",
      pointsValue: 50, // Changed from 10 to 50
    }
  });

  // 2. INVALIDATE CACHE - Delete all related caches
  await cacheService.invalidateArticles(articleId);
  
  // Why? Because:
  // - Article lists might show this article with old title/points
  // - Article detail page might show old data
  // - Read counts might be affected
  
  return article;
}

// ============================================
// EXAMPLE 3: User Points Change with Cache Invalidation
// ============================================

async function claimDailyRewardExample(userId) {
  await prisma.$transaction(async (tx) => {
    // 1. Update points in database
    await tx.user.update({
      where: { id: userId },
      data: {
        points: { increment: 50 }
      }
    });
    
    // 2. Create daily reward record
    await tx.dailyReward.create({
      data: { userId, pointsEarned: 50 }
    });
  });

  // 3. INVALIDATE CACHE - Delete user profile AND leaderboard
  await Promise.all([
    cacheService.invalidateUser(userId),      // Delete "profile:userId"
    cacheService.invalidateLeaderboard(),      // Delete "leaderboard:weekly", "leaderboard:monthly", etc.
  ]);
  
  // Why both?
  // - User profile shows points (needs update)
  // - Leaderboard shows rank based on points (needs update)
  // - User rank calculation needs fresh data
}

// ============================================
// EXAMPLE 4: Article Read with Cache Invalidation
// ============================================

async function readArticleExample(userId, articleId) {
  await prisma.$transaction(async (tx) => {
    // 1. Create user activity (marks article as read)
    await tx.userActivity.create({
      data: { userId, articleId, pointsEarned: 10 }
    });
    
    // 2. Update user points
    await tx.user.update({
      where: { id: userId },
      data: { points: { increment: 10 } }
    });
  });

  // 3. INVALIDATE CACHE - Delete read count AND article caches
  await Promise.all([
    cacheService.invalidateReadCounts(articleId),  // Delete "readcount:articleId"
    cacheService.invalidateArticles(articleId),     // Delete article detail cache
    cacheService.invalidateUser(userId),            // Delete user profile (points changed)
    cacheService.invalidateLeaderboard(),           // Delete leaderboard (points changed)
  ]);
  
  // Why all of these?
  // - Read count changed (article now has +1 read)
  // - Article detail might show read status
  // - User points changed (affects profile and leaderboard)
}

// ============================================
// EXAMPLE 5: Using Cache in GET Endpoints
// ============================================

async function getTrendingArticlesExample(limit = 10) {
  const cacheKey = `articles:trending:${limit}`;
  
  // Try cache first, if miss, fetch from DB and cache it
  const articles = await cacheService.getOrSet(
    cacheKey,
    async () => {
      // This function only runs if cache is MISS
      console.log('📊 Cache MISS - Fetching from database');
      
      const articles = await prisma.article.findMany({
        where: {
          isFeatured: true,
          status: 'published'
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        // ... select fields
      });
      
      // Get read counts
      const articleIds = articles.map(a => a.id);
      const readCounts = await prisma.userActivity.groupBy({
        by: ['articleId'],
        where: { articleId: { in: articleIds } },
        _count: { articleId: true }
      });
      
      // Combine data
      return articles.map(article => ({
        ...article,
        readCount: readCounts.find(rc => rc.articleId === article.id)?._count.articleId || 0
      }));
    },
    300 // 5 minutes TTL
  );
  
  // If cache HIT, this returns immediately (no DB query!)
  // If cache MISS, fetches from DB, caches it, then returns
  
  return articles;
}

// ============================================
// REAL-WORLD FLOW EXAMPLE
// ============================================

/*
SCENARIO: Admin publishes new article, user views trending articles

TIMELINE:

T=0s:  Admin creates article
       → Database: Article saved ✅
       → Cache: invalidateArticles() called
       → Cache: "articles:trending:10" DELETED ✅

T=1s:  User requests /articles/trending
       → Cache: Check "articles:trending:10" → MISS (was deleted)
       → Database: Fetch articles (includes new one) ✅
       → Cache: Store result with 5min TTL
       → User: Sees new article ✅

T=30s: Another user requests /articles/trending
       → Cache: Check "articles:trending:10" → HIT ✅
       → Cache: Return cached result (fast, no DB query)
       → User: Sees same result (still fresh, only 30s old)

T=5min: Cache expires (TTL reached)
       → Next request: Cache MISS → Fetches fresh from DB
       → Cache: Stores new result

T=6min: Admin updates article title
       → Database: Article updated ✅
       → Cache: invalidateArticles() called
       → Cache: "articles:trending:10" DELETED ✅
       → Next request: Cache MISS → Fetches fresh data ✅
*/

// ============================================
// KEY TAKEAWAYS
// ============================================

/*
1. TTL (Time To Live) = Safety Net
   - Cache expires automatically after X seconds
   - Even if invalidation fails, cache refreshes
   - Use longer TTL for data that changes rarely

2. Invalidation = Immediate Update
   - When data changes, delete related cache immediately
   - Users see fresh data right away
   - Use for data that must be accurate

3. Invalidate Related Caches
   - When points change → invalidate user profile AND leaderboard
   - When article changes → invalidate article lists AND detail
   - Think about what other data depends on this change

4. Fail Gracefully
   - If Redis is down, app continues without cache
   - Cache is a performance optimization, not required
   - Database is always the source of truth
*/

