# Test Scripts Documentation

## Main Test Scripts

### `testArticleProcessing.js` ⭐ **RECOMMENDED - Use This One**
**Comprehensive test for article processing with image and author extraction**

```bash
# Test single article (extraction only, no DB)
node src/scripts/testArticleProcessing.js SPORT

# Test and create article in database
node src/scripts/testArticleProcessing.js SPORT --create

# Test all ESPN categories
node src/scripts/testArticleProcessing.js --all
```

**Features:**
- Tests image extraction from RSS and article pages
- Tests author extraction from RSS and article pages
- Can create articles in database
- Tests all ESPN categories
- Shows before/after comparison

---

## Other Test Scripts (Legacy/Utility)

### Image & Author Extraction Tests
- `testAuthorDirect.js` - Direct author extraction test from URL
- `testAuthorExtraction.js` - Author extraction with database
- `testESPNImageExtraction.js` - ESPN image extraction analysis
- `testImageUrlVariations.js` - Test BBC image URL size variations

### ESPN Specific Tests
- `testESPNRecent.js` - Fetch ESPN articles from last 6 hours
- `testESPNAllCategories.js` - Test all ESPN sport categories
- `testESPNCategories.js` - List all ESPN RSS feed categories

### Article Creation Tests
- `testCreateSingleArticle.js` - Create single article in database for testing

### RSS Feed Tests
- `testRSSFeeds.js` - Test all RSS feed URLs
- `testRSSFeedsRecent.js` - Test RSS feeds for recent articles
- `testSingleArticleImage.js` - Test image extraction from single RSS article
- `testSportsFeeds.js` - Test ESPN and Sky Sports feeds
- `testGoalRSS.js` - Test Goal.com RSS feeds (not available)

---

## Quick Reference

### Most Common Tasks

**1. Test article processing (image + author extraction):**
```bash
node src/scripts/testArticleProcessing.js SPORT
```

**2. Create test article in database:**
```bash
node src/scripts/testArticleProcessing.js SPORT --create
```

**3. Test all ESPN categories:**
```bash
node src/scripts/testArticleProcessing.js --all
```

**4. Test specific category:**
```bash
node src/scripts/testArticleProcessing.js TECHNOLOGY --create
```

---

## Notes

- Most test scripts require Redis and Database connection
- Use `testArticleProcessing.js` for comprehensive testing
- Other scripts are for specific debugging purposes
- ESPN articles require article page scraping for images/authors (RSS doesn't include them)

