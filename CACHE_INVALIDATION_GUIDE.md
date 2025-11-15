# Cache Invalidation Guide

## The Problem You Identified ✅

**You're absolutely right!** If we cache data and it changes in the database, the cache will show stale (old) values unless we invalidate it.

## How Cache Invalidation Works

### Example Flow:

```
1. User requests trending articles
   → Cache: "articles:trending:10" = [Article 1, Article 2, Article 3]
   → Returns cached data ✅

2. Admin publishes new article (Article 4)
   → Database: Now has 4 articles
   → Cache: Still has old data (3 articles) ❌

3. WITHOUT invalidation:
   → User requests trending articles again
   → Cache returns: [Article 1, Article 2, Article 3] ❌ WRONG!

4. WITH invalidation:
   → Admin publishes article
   → Code calls: cacheService.invalidateArticles()
   → Cache: "articles:trending:10" is DELETED
   → User requests trending articles
   → Cache miss → Fetches from DB → Returns [Article 1, 2, 3, 4] ✅ CORRECT!
   → Cache stores new result for next request
```

## Solution: Two-Layer Protection

### 1. **TTL (Time To Live)** - Automatic Expiration
- Cache expires after X seconds (e.g., 5 minutes)
- Even if we forget to invalidate, cache refreshes automatically
- **Use for:** Data that changes infrequently

### 2. **Manual Invalidation** - Immediate Update
- When data changes, immediately delete related cache
- **Use for:** Data that must be fresh immediately

## Implementation Examples

### Example 1: Article Lists (Trending/Featured)

**Cache with TTL:**
```javascript
// GET /articles/trending
const cacheKey = `articles:trending:${limit}`;
const articles = await cacheService.getOrSet(
  cacheKey,
  async () => {
    // Fetch from database
    return await prisma.article.findMany({...});
  },
  300 // 5 minutes TTL
);
```

**Invalidate when article changes:**
```javascript
// POST /admin/articles (create)
await prisma.article.create({...});
await cacheService.invalidateArticles(); // Delete all article caches ✅

// PUT /admin/articles/:id (update)
await prisma.article.update({...});
await cacheService.invalidateArticles(articleId); // Delete caches ✅

// DELETE /admin/articles/:id
await prisma.article.delete({...});
await cacheService.invalidateArticles(articleId); // Delete caches ✅
```

### Example 2: User Profiles

**Cache with short TTL:**
```javascript
// GET /users/profile
const cacheKey = `profile:${userId}`;
const profile = await cacheService.getOrSet(
  cacheKey,
  async () => {
    return await fetchUserProfile(userId);
  },
  120 // 2 minutes TTL (short because points change frequently)
);
```

**Invalidate when user data changes:**
```javascript
// POST /rewards/daily/claim (points change)
await prisma.user.update({ points: { increment: 50 } });
await cacheService.invalidateUser(userId); // Delete user cache ✅
await cacheService.invalidateLeaderboard(); // Delete leaderboard too ✅

// PUT /users/profile (profile update)
await prisma.user.update({ displayName: "New Name" });
await cacheService.invalidateUser(userId); // Delete user cache ✅
```

### Example 3: Leaderboards

**Cache with TTL:**
```javascript
// GET /rewards/leaderboard
const cacheKey = `leaderboard:${period}`;
const leaderboard = await cacheService.getOrSet(
  cacheKey,
  async () => {
    return await fetchLeaderboard(period);
  },
  300 // 5 minutes TTL
);
```

**Invalidate when points change:**
```javascript
// Any endpoint that changes user points:
await prisma.user.update({ points: { increment: 100 } });
await cacheService.invalidateLeaderboard(); // Delete leaderboard cache ✅
await cacheService.invalidateUser(userId); // Delete user cache too ✅
```

### Example 4: Read Counts

**Cache with very short TTL:**
```javascript
// GET /articles (read count)
const cacheKey = `readcount:${articleId}`;
const readCount = await cacheService.getOrSet(
  cacheKey,
  async () => {
    return await calculateReadCount(articleId);
  },
  30 // 30 seconds TTL (very short because counts change frequently)
);
```

**Invalidate when read count changes:**
```javascript
// POST /articles/:id/read (user reads article)
await prisma.userActivity.create({...});
await cacheService.invalidateReadCounts(articleId); // Delete read count cache ✅
await cacheService.invalidateArticles(articleId); // Delete article cache too ✅

// PATCH /admin/articles/:id/read-count (admin updates manually)
await prisma.article.update({ manualReadCount: 1000 });
await cacheService.invalidateReadCounts(articleId); // Delete read count cache ✅
```

## Cache Invalidation Strategy Summary

| Data Type | TTL | Invalidate On |
|-----------|-----|---------------|
| **Article Lists** | 5-10 min | Create, Update, Delete, Status Change |
| **User Profiles** | 1-2 min | Profile Update, Points Change |
| **Leaderboards** | 5 min | Any Points Change |
| **Read Counts** | 30 sec | Article Read, Manual Update |

## Key Points

1. **TTL is a safety net** - Even if invalidation fails, cache refreshes automatically
2. **Invalidation is immediate** - Users see fresh data right away
3. **Invalidate related caches** - When points change, invalidate both user profile AND leaderboard
4. **Fail gracefully** - If Redis is down, app continues without cache (no errors)

## What Happens in Practice

### Scenario: Admin publishes new article

```
1. Admin creates article
   → Database: Article saved ✅
   → Cache: invalidateArticles() called ✅
   → Cache: All article list caches deleted ✅

2. User requests trending articles (1 second later)
   → Cache: Check "articles:trending:10" → MISS (was deleted)
   → Database: Fetch fresh articles (includes new one) ✅
   → Cache: Store new result with 5min TTL ✅
   → User: Sees new article immediately ✅

3. User requests trending articles again (30 seconds later)
   → Cache: Check "articles:trending:10" → HIT ✅
   → Cache: Return cached result (fast, no DB query) ✅
   → User: Sees same result (still fresh, only 30 seconds old)
```

### Scenario: User claims daily reward (points change)

```
1. User claims daily reward
   → Database: Points updated (100 → 150) ✅
   → Cache: invalidateUser(userId) called ✅
   → Cache: invalidateLeaderboard() called ✅
   → Cache: User profile cache deleted ✅
   → Cache: Leaderboard cache deleted ✅

2. User views their profile (immediately)
   → Cache: Check "profile:userId" → MISS (was deleted)
   → Database: Fetch fresh profile (150 points) ✅
   → Cache: Store new result with 2min TTL ✅
   → User: Sees updated points immediately ✅

3. User views leaderboard (immediately)
   → Cache: Check "leaderboard:weekly" → MISS (was deleted)
   → Database: Fetch fresh leaderboard (user's new rank) ✅
   → Cache: Store new result with 5min TTL ✅
   → User: Sees updated rank immediately ✅
```

## Benefits

✅ **Performance**: 90%+ of requests served from cache (fast)  
✅ **Fresh Data**: Invalidated immediately when data changes  
✅ **Safety Net**: TTL ensures cache refreshes even if invalidation fails  
✅ **Scalability**: Database load reduced by 90%+  
✅ **User Experience**: Fast responses + always fresh data

