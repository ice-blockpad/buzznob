# 📰 News Automation System

This document explains how to use the automated news fetching and posting system.

## 🎯 Overview

The news automation system automatically fetches news from multiple providers (CNN, BBC, Reuters, etc.) and creates articles in your database with **pending status** for admin review.

### Features

- ✅ **Multi-provider support** with automatic fallback
- ✅ **Priority-based provider selection** (paid APIs → free APIs → RSS feeds)
- ✅ **Automatic limit tracking** - switches providers when daily limits are reached
- ✅ **Duplicate detection** - prevents re-posting the same articles
- ✅ **Scheduled automation** - runs automatically via cron jobs
- ✅ **Manual triggering** - can be run manually for testing
- ✅ **Admin review** - all articles created in pending status

## 📋 Supported Providers

### Priority Order (Automatic Fallback)

1. **NewsAPI.org** (Paid) - 100 requests/day free tier
2. **NewsData.io** (Paid) - 200 requests/day free tier
3. **Currents API** (Paid) - 100 requests/day free tier
4. **GNews API** (Paid) - 100 requests/day free tier
5. **RSS2JSON** (Free) - 1,000 requests/month free tier
6. **FeedAPI** (Free) - 1,000 requests/month free tier
7. **Direct RSS Feeds** (Always available, no limits)
   - CNN, BBC, Reuters, TechCrunch, The Guardian, ESPN, etc.

## 🚀 Setup

### 1. Environment Variables

Add API keys to your `.env` file (optional - system works with free RSS feeds):

```env
# NewsAPI.org (Optional)
NEWSAPI_KEY="your-api-key-here"
NEWSAPI_LIMIT=100

# NewsData.io (Optional)
NEWSDATA_KEY="your-api-key-here"
NEWSDATA_LIMIT=200

# Currents API (Optional)
CURRENTS_API_KEY="your-api-key-here"
CURRENTS_LIMIT=100

# GNews API (Optional)
GNEWS_API_KEY="your-api-key-here"
GNEWS_LIMIT=100

# RSS Aggregators (Optional)
RSS2JSON_API_KEY=""
RSS2JSON_LIMIT=1000

FEEDAPI_KEY=""
FEEDAPI_LIMIT=1000

# Schedule (Cron format)
NEWS_FETCH_SCHEDULE="0 */6 * * *"  # Every 6 hours

# Max articles per category per run
NEWS_MAX_ARTICLES_PER_CATEGORY=5
```

### 2. Get API Keys (Optional)

- **NewsAPI.org**: https://newsapi.org (Free tier: 100 requests/day)
- **NewsData.io**: https://newsdata.io (Free tier: 200 requests/day)
- **Currents API**: https://currentsapi.services (Free tier: 100 requests/day)
- **GNews API**: https://gnews.io (Free tier: 100 requests/day)

**Note**: The system works perfectly fine with just free RSS feeds. API keys are optional for better coverage.

## 🎮 Usage

### Automatic (Cron Job)

The system automatically runs on a schedule (default: every 6 hours). It starts when you start the server:

```bash
npm start
```

### Manual Execution

Run manually for testing:

```bash
# Fetch and create articles
npm run news:fetch

# Dry run (test without creating articles)
npm run news:fetch:dry-run

# Fetch specific category
node src/scripts/fetchAndPostNews.js --category=CRYPTO

# Dry run with specific category
node src/scripts/fetchAndPostNews.js --category=CRYPTO --dry-run
```

### Categories

- `GENERAL` - General news
- `CRYPTO` - Cryptocurrency and blockchain news
- `SPORTS` - Sports news
- `ENTERTAINMENT` - Entertainment news

## 📊 How It Works

1. **Fetching**: System tries providers in priority order until one succeeds
2. **Processing**: Articles are cleaned, validated, and checked for duplicates
3. **Creation**: Articles are created with `status: 'pending'` for admin review
4. **Tracking**: API usage is tracked to manage rate limits
5. **Fallback**: Automatically switches to next provider when limits are reached

## 🔍 Admin Review

All automatically created articles appear in the admin panel with:
- Status: `pending`
- Source: `Automated News` (or provider name)
- Ready for admin approval/rejection

Admins can:
- Review articles in the admin panel
- Approve articles (changes status to `published`)
- Reject articles (with optional rejection reason)

## 📈 Monitoring

### Check API Usage

The system tracks API usage automatically. You can check usage in logs or by examining the Redis cache keys:

```
api_usage:{provider_name}:{date}
```

### View Statistics

Check processing stats in the script output or database:

```sql
-- Pending articles from automation
SELECT COUNT(*) FROM articles 
WHERE status = 'pending' 
AND source_name LIKE '%Automated%';

-- Today's created articles
SELECT COUNT(*) FROM articles 
WHERE status = 'pending' 
AND created_at >= CURRENT_DATE
AND source_name LIKE '%Automated%';
```

## ⚙️ Configuration

### Change Schedule

Edit `.env`:

```env
NEWS_FETCH_SCHEDULE="0 */4 * * *"  # Every 4 hours
```

Cron format examples:
- `0 */1 * * *` - Every hour
- `0 */4 * * *` - Every 4 hours
- `0 */6 * * *` - Every 6 hours (default)
- `0 0 * * *` - Daily at midnight
- `0 0,6,12,18 * * *` - 4 times daily

### Change Article Limits

```env
NEWS_MAX_ARTICLES_PER_CATEGORY=10  # Fetch 10 articles per category
```

## 🐛 Troubleshooting

### No Articles Being Created

1. Check logs for errors
2. Verify database connection
3. Check if providers are enabled in `newsProviders.js`
4. Run with `--dry-run` to test fetching

### API Limit Errors

- System automatically switches to next provider
- Check usage stats in logs
- Wait for daily reset (midnight UTC) or manually reset

### Duplicate Articles

- System automatically detects duplicates by `sourceUrl`
- If duplicates appear, check if `sourceUrl` is being set correctly

## 📝 Notes

- Articles are created with `status: 'pending'` - admins must approve
- Duplicate detection prevents re-posting same articles
- System uses free RSS feeds as final fallback (always works)
- API keys are optional but recommended for better coverage
- Daily API usage resets at midnight UTC

## 🔗 Related Files

- `src/config/newsProviders.js` - Provider configurations
- `src/services/newsService.js` - News fetching logic
- `src/services/articleProcessor.js` - Article processing
- `src/services/apiUsageTracker.js` - Usage tracking
- `src/services/newsCron.js` - Cron job scheduler
- `src/scripts/fetchAndPostNews.js` - Main automation script

