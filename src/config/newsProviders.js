/**
 * News Providers Configuration
 * Defines all news providers with their configurations, priorities, and category mappings
 */

const providers = [
  // Priority 1: NewsData.io (LEGAL - Affordable API)
  // Sign up at: https://newsdata.io
  // Free: 200 requests/day | Paid: $10/month for 1000 requests/day
  {
    name: 'NewsData.io',
    type: 'api',
    priority: 1,
    enabled: true, // ENABLED - Legal news API
    apiKey: process.env.NEWSDATA_KEY || '',
    baseUrl: 'https://newsdata.io/api/1',
    dailyLimit: parseInt(process.env.NEWSDATA_LIMIT) || 200,
    requestsPerCall: 10,
    supportsDateFilter: true,
    endpoints: {
      latest: '/news'
    },
    params: {
      apikey: process.env.NEWSDATA_KEY || '',
      language: 'en'
    },
    categoryMap: {
      'DEFI': 'technology',
      'TECHNOLOGY': 'technology',
      'FINANCE': 'business',
      'BUSINESS': 'business',
      'POLITICS': 'politics',
      'SPORT': 'sports',
      'ENTERTAINMENT': 'entertainment',
      'HEALTH': 'health',
      'SCIENCE': 'science',
      'WEATHER': 'environment',
      'OTHERS': 'top'
    }
  },

  // Priority 2: GNews API (LEGAL - Budget-friendly)
  // Sign up at: https://gnews.io
  // Free: 100 requests/day | Paid: $9/month for 10,000 requests/day
  {
    name: 'GNews API',
    type: 'api',
    priority: 2,
    enabled: true, // ENABLED - Legal news API
    apiKey: process.env.GNEWS_API_KEY || '',
    baseUrl: 'https://gnews.io/api/v4',
    dailyLimit: parseInt(process.env.GNEWS_LIMIT) || 100,
    requestsPerCall: 10,
    supportsDateFilter: true,
    endpoints: {
      topHeadlines: '/top-headlines',
      search: '/search'
    },
    params: {
      token: process.env.GNEWS_API_KEY || '',
      lang: 'en',
      country: 'us'
    },
    categoryMap: {
      'DEFI': 'technology',
      'TECHNOLOGY': 'technology',
      'FINANCE': 'business',
      'BUSINESS': 'business',
      'POLITICS': 'nation',
      'SPORT': 'sports',
      'ENTERTAINMENT': 'entertainment',
      'HEALTH': 'health',
      'SCIENCE': 'science',
      'WEATHER': 'world',
      'OTHERS': 'general'
    }
  },

  // Priority 3: Currents API (LEGAL - Good free tier)
  // Sign up at: https://currentsapi.services
  // Free: 600 requests/day | Paid: $12/month for unlimited
  {
    name: 'Currents API',
    type: 'api',
    priority: 3,
    enabled: true, // ENABLED - Legal news API
    apiKey: process.env.CURRENTS_API_KEY || '',
    baseUrl: 'https://api.currentsapi.services/v1',
    dailyLimit: parseInt(process.env.CURRENTS_LIMIT) || 600,
    requestsPerCall: 20,
    supportsDateFilter: false,
    endpoints: {
      latest: '/latest-news'
    },
    params: {
      apiKey: process.env.CURRENTS_API_KEY || '',
      language: 'en'
    },
    categoryMap: {
      'DEFI': 'technology',
      'TECHNOLOGY': 'technology',
      'FINANCE': 'business',
      'BUSINESS': 'business',
      'POLITICS': 'politics',
      'SPORT': 'sports',
      'ENTERTAINMENT': 'entertainment',
      'HEALTH': 'health',
      'SCIENCE': 'science',
      'WEATHER': 'environment',
      'OTHERS': 'general'
    }
  },

  // Priority 4: NewsAPI.org (Disabled - Requires $449/month Business plan)
  // NOTE: Free tier is for DEVELOPMENT ONLY, NOT for production apps
  {
    name: 'NewsAPI.org',
    type: 'api',
    priority: 4,
    enabled: false, // Disabled - Too expensive ($449/month)
    apiKey: process.env.NEWSAPI_KEY || '',
    baseUrl: 'https://newsapi.org/v2',
    dailyLimit: parseInt(process.env.NEWSAPI_LIMIT) || 1000,
    requestsPerCall: 100,
    supportsDateFilter: true,
    endpoints: {
      topHeadlines: '/top-headlines',
      everything: '/everything'
    },
    params: {
      apiKey: process.env.NEWSAPI_KEY || '',
      sortBy: 'publishedAt',
      language: 'en'
    },
    categoryMap: {
      'DEFI': 'technology',
      'TECHNOLOGY': 'technology',
      'FINANCE': 'business',
      'BUSINESS': 'business',
      'POLITICS': 'general',
      'SPORT': 'sports',
      'ENTERTAINMENT': 'entertainment',
      'HEALTH': 'health',
      'SCIENCE': 'science',
      'WEATHER': 'general',
      'OTHERS': 'general'
    }
  },

  // Priority 5: RSS Aggregators (RSS2JSON, FeedAPI) - Disabled, using direct RSS feeds only
  {
    name: 'RSS Aggregators',
    type: 'rss-aggregator',
    priority: 5,
    enabled: false, // Disabled - using direct RSS feeds (rssFeeds) instead
    apiKey: process.env.RSS2JSON_API_KEY || process.env.FEEDAPI_KEY || '',
    baseUrl: process.env.RSS2JSON_API_KEY 
      ? 'https://api.rss2json.com/v1/api.json'
      : 'https://api.feedapi.io/v1',
    dailyLimit: parseInt(process.env.RSS2JSON_LIMIT || process.env.FEEDAPI_LIMIT) || 1000,
    requestsPerCall: 10,
    supportsDateFilter: true // Can filter by pubDate after fetching
  },

  // Priority 6: Direct RSS Feeds (FREE - Fallback when APIs exhausted)
  // LEGAL USAGE: Show PREVIEW ONLY (150 chars max), require click-through to full article
  {
    name: 'rssFeeds',
    type: 'rss-direct',
    priority: 6,
    enabled: true,
    dailyLimit: Infinity,
    supportsDateFilter: true,
    previewOnly: true, // CRITICAL: Only show preview, not full content
    feeds: [
      // Cryptocurrency News (5 articles each from last 6 hours)
      // Covers Bitcoin, Ethereum, DeFi, blockchain, and all cryptocurrency news
      // Note: Category is 'DEFI' to match frontend, but represents all cryptocurrency news
      { url: 'https://cointelegraph.com/rss', sourceName: 'CoinTelegraph', category: 'DEFI', maxArticles: 5 },
      { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', sourceName: 'CoinDesk', category: 'DEFI', maxArticles: 5 },
      { url: 'https://decrypt.co/feed', sourceName: 'Decrypt', category: 'DEFI', maxArticles: 5 },
      { url: 'https://u.today/rss', sourceName: 'U.Today', category: 'DEFI', maxArticles: 5 },
      
      // Technology (AI, Robotics, Tech News) - 5 articles each from last 6 hours
      { url: 'https://techcrunch.com/feed/', sourceName: 'TechCrunch', category: 'TECHNOLOGY', maxArticles: 5 },
      { url: 'https://spectrum.ieee.org/rss', sourceName: 'IEEE Spectrum', category: 'TECHNOLOGY', maxArticles: 5 },
      { url: 'https://www.theguardian.com/technology/rss', sourceName: 'The Guardian', category: 'TECHNOLOGY', maxArticles: 5 },
      { url: 'https://feeds.arstechnica.com/arstechnica/index', sourceName: 'Ars Technica', category: 'TECHNOLOGY', maxArticles: 5 },
      
      // Sports - ESPN Categories (5 articles each from last 6 hours)
      { url: 'https://www.espn.com/espn/rss/nba/news', sourceName: 'ESPN', category: 'SPORT', sportCategory: 'nba' },
      { url: 'https://www.espn.com/espn/rss/soccer/news', sourceName: 'ESPN', category: 'SPORT', sportCategory: 'soccer', maxArticles: 10 },
      { url: 'https://www.espn.com/espn/rss/tennis/news', sourceName: 'ESPN', category: 'SPORT', sportCategory: 'tennis' },
      { url: 'https://www.espn.com/espn/rss/golf/news', sourceName: 'ESPN', category: 'SPORT', sportCategory: 'golf' },
      { url: 'https://www.espn.com/espn/rss/boxing/news', sourceName: 'ESPN', category: 'SPORT', sportCategory: 'boxing' },
      { url: 'https://www.espn.com/espn/rss/rpm/news', sourceName: 'ESPN', category: 'SPORT', sportCategory: 'motorsports' },
      
      // Sports - BBC (10 articles from last 6 hours)
      { url: 'https://feeds.bbci.co.uk/sport/rss.xml', sourceName: 'BBC', category: 'SPORT', maxArticles: 10 },
      
      // Business News (5 articles each from last 6 hours)
      { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', sourceName: 'CNBC', category: 'BUSINESS', maxArticles: 5 },
      { url: 'https://www.theguardian.com/business/rss', sourceName: 'The Guardian', category: 'BUSINESS', maxArticles: 5 },
      { url: 'https://www.ft.com/?format=rss', sourceName: 'Financial Times', category: 'BUSINESS', maxArticles: 5 },
      { url: 'https://finance.yahoo.com/news/rssindex', sourceName: 'Yahoo Finance', category: 'BUSINESS', maxArticles: 5 },
      { url: 'https://www.forbes.com/business/feed/', sourceName: 'Forbes', category: 'BUSINESS', maxArticles: 5 },
      
      // Technology (AI, Robotics, Tech News) - 5 articles each from last 6 hours
      { url: 'https://techcrunch.com/feed/', sourceName: 'TechCrunch', category: 'TECHNOLOGY', maxArticles: 5 },
      { url: 'https://spectrum.ieee.org/rss', sourceName: 'IEEE Spectrum', category: 'TECHNOLOGY', maxArticles: 5 },
      { url: 'https://www.theguardian.com/technology/rss', sourceName: 'The Guardian', category: 'TECHNOLOGY', maxArticles: 5 },
      { url: 'https://feeds.arstechnica.com/arstechnica/index', sourceName: 'Ars Technica', category: 'TECHNOLOGY', maxArticles: 5 },
      
      // Sports - ESPN Categories (5 articles each from last 6 hours)
      { url: 'https://www.espn.com/espn/rss/nba/news', sourceName: 'ESPN', category: 'SPORT', sportCategory: 'nba' },
      { url: 'https://www.espn.com/espn/rss/soccer/news', sourceName: 'ESPN', category: 'SPORT', sportCategory: 'soccer', maxArticles: 10 },
      { url: 'https://www.espn.com/espn/rss/tennis/news', sourceName: 'ESPN', category: 'SPORT', sportCategory: 'tennis' },
      { url: 'https://www.espn.com/espn/rss/golf/news', sourceName: 'ESPN', category: 'SPORT', sportCategory: 'golf' },
      { url: 'https://www.espn.com/espn/rss/boxing/news', sourceName: 'ESPN', category: 'SPORT', sportCategory: 'boxing' },
      { url: 'https://www.espn.com/espn/rss/rpm/news', sourceName: 'ESPN', category: 'SPORT', sportCategory: 'motorsports' },
      
      // Sports - BBC (10 articles from last 6 hours)
      { url: 'https://feeds.bbci.co.uk/sport/rss.xml', sourceName: 'BBC', category: 'SPORT', maxArticles: 10 },
      
      // Business News (5 articles each from last 6 hours)
      { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', sourceName: 'CNBC', category: 'BUSINESS', maxArticles: 5 },
      { url: 'https://www.theguardian.com/business/rss', sourceName: 'The Guardian', category: 'BUSINESS', maxArticles: 5 },
      { url: 'https://www.ft.com/?format=rss', sourceName: 'Financial Times', category: 'BUSINESS', maxArticles: 5 },
      { url: 'https://finance.yahoo.com/news/rssindex', sourceName: 'Yahoo Finance', category: 'BUSINESS', maxArticles: 5 },
      { url: 'https://www.forbes.com/business/feed/', sourceName: 'Forbes', category: 'BUSINESS', maxArticles: 5 },
      
      // General/Others - BBC and Guardian feeds
      // All BBC articles will show "BBC" as source
      // All Guardian articles will show "The Guardian" as source
      { url: 'https://feeds.bbci.co.uk/news/rss.xml', sourceName: 'BBC', category: 'OTHERS' },
      { url: 'https://feeds.bbci.co.uk/news/business/rss.xml', sourceName: 'BBC', category: 'OTHERS' },
      { url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', sourceName: 'BBC', category: 'OTHERS' },
      { url: 'https://feeds.bbci.co.uk/news/politics/rss.xml', sourceName: 'BBC', category: 'OTHERS' },
      { url: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml', sourceName: 'BBC', category: 'OTHERS' },
      { url: 'https://www.theguardian.com/world/rss', sourceName: 'The Guardian', category: 'OTHERS' },
      
      // NOTE: CNN and Reuters feeds removed due to connection issues:
      // - CNN: SSL/TLS connection errors (all feeds failing)
      // - Reuters: DNS errors (feeds.reuters.com not resolving)
      // These can be re-added if the issues are resolved or alternative URLs are found
    ]
  }
];

/**
 * Get all providers sorted by priority
 */
function getProvidersByPriority() {
  return providers
    .filter(p => p.enabled)
    .sort((a, b) => a.priority - b.priority);
}

/**
 * Get a specific provider by name
 */
function getProvider(name) {
  return providers.find(p => p.name === name || p.name.toLowerCase() === name.toLowerCase());
}

/**
 * Get all enabled providers
 */
function getEnabledProviders() {
  return providers.filter(p => p.enabled);
}

module.exports = {
  providers,
  getProvidersByPriority,
  getProvider,
  getEnabledProviders
};
