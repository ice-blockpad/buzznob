/**
 * News Providers Configuration
 * Defines all news providers with their configurations, priorities, and category mappings
 */

const providers = [
  // Priority 1: NewsAPI.org (Disabled - Using RSS feeds only)
  {
    name: 'NewsAPI.org',
    type: 'api',
    priority: 1,
    enabled: false, // Disabled - Using RSS feeds only
    apiKey: process.env.NEWSAPI_KEY || '',
    baseUrl: 'https://newsapi.org/v2',
    dailyLimit: parseInt(process.env.NEWSAPI_LIMIT) || 1000,
    requestsPerCall: 100,
    supportsDateFilter: true, // Supports 'from' and 'to' parameters
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

  // Priority 2: NewsData.io (Disabled - Using RSS feeds only)
  {
    name: 'NewsData.io',
    type: 'api',
    priority: 2,
    enabled: false, // Disabled - Using RSS feeds only
    apiKey: process.env.NEWSDATA_KEY || '',
    baseUrl: 'https://newsdata.io/api/1',
    dailyLimit: parseInt(process.env.NEWSDATA_LIMIT) || 200,
    requestsPerCall: 10,
    supportsDateFilter: true, // Supports date filtering
    endpoints: {
      latest: '/latest'
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
      'POLITICS': 'top',
      'SPORT': 'sports',
      'ENTERTAINMENT': 'entertainment',
      'HEALTH': 'health',
      'SCIENCE': 'science',
      'WEATHER': 'top',
      'OTHERS': 'top'
    }
  },

  // Priority 3: Currents API (Disabled - Using RSS feeds only)
  {
    name: 'Currents API',
    type: 'api',
    priority: 3,
    enabled: false, // Disabled - Using RSS feeds only
    apiKey: process.env.CURRENTS_API_KEY || '',
    baseUrl: 'https://api.currentsapi.services/v1',
    dailyLimit: parseInt(process.env.CURRENTS_LIMIT) || 20,
    requestsPerCall: 20,
    supportsDateFilter: false, // Does not support date filtering
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
      'POLITICS': null,
      'SPORT': 'sports',
      'ENTERTAINMENT': 'entertainment',
      'HEALTH': 'health',
      'SCIENCE': 'science',
      'WEATHER': null,
      'OTHERS': null
    }
  },

  // Priority 4: GNews API (Disabled - Using RSS feeds only)
  {
    name: 'GNews API',
    type: 'api',
    priority: 4,
    enabled: false, // Disabled - Using RSS feeds only
    apiKey: process.env.GNEWS_API_KEY || '',
    baseUrl: 'https://gnews.io/api/v4',
    dailyLimit: parseInt(process.env.GNEWS_LIMIT) || 100,
    requestsPerCall: 10,
    supportsDateFilter: false, // Does not support date filtering
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

  // Priority 6: Direct RSS Feeds (Always available, no limits)
  {
    name: 'rssFeeds',
    type: 'rss-direct',
    priority: 6,
    enabled: true,
    dailyLimit: Infinity,
    supportsDateFilter: true, // Can filter by pubDate after fetching
    feeds: [
      // DEFI/Cryptocurrency - Using crypto/cryptocurrency feeds that cover defi topics
      // These feeds will pick up articles about cryptocurrency, bitcoin, defi, blockchain, etc.
      { url: 'https://cointelegraph.com/rss', sourceName: 'CoinTelegraph', category: 'DEFI' },
      { url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', sourceName: 'BBC Technology', category: 'DEFI' },
      { url: 'https://techcrunch.com/feed/', sourceName: 'TechCrunch', category: 'DEFI' },
      { url: 'https://feeds.bbci.co.uk/news/business/rss.xml', sourceName: 'BBC Business', category: 'DEFI' },
      
      // Technology
      { url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', sourceName: 'BBC Technology', category: 'TECHNOLOGY' },
      { url: 'https://techcrunch.com/feed/', sourceName: 'TechCrunch', category: 'TECHNOLOGY' },
      
      // Business/Finance
      { url: 'https://feeds.bbci.co.uk/news/business/rss.xml', sourceName: 'BBC Business', category: 'BUSINESS' },
      { url: 'https://feeds.bbci.co.uk/news/business/rss.xml', sourceName: 'BBC Business', category: 'FINANCE' },
      
      // Politics
      { url: 'https://feeds.bbci.co.uk/news/politics/rss.xml', sourceName: 'BBC Politics', category: 'POLITICS' },
      
      // Sports - ESPN Categories (5 articles each from last 6 hours)
      { url: 'https://www.espn.com/espn/rss/news', sourceName: 'ESPN', category: 'SPORT', sportCategory: 'general' },
      { url: 'https://www.espn.com/espn/rss/nfl/news', sourceName: 'ESPN NFL', category: 'SPORT', sportCategory: 'nfl' },
      { url: 'https://www.espn.com/espn/rss/nba/news', sourceName: 'ESPN NBA', category: 'SPORT', sportCategory: 'nba' },
      { url: 'https://www.espn.com/espn/rss/ncf/news', sourceName: 'ESPN College Football', category: 'SPORT', sportCategory: 'college-football' },
      { url: 'https://www.espn.com/espn/rss/ncb/news', sourceName: 'ESPN College Basketball', category: 'SPORT', sportCategory: 'college-basketball' },
      { url: 'https://www.espn.com/espn/rss/mlb/news', sourceName: 'ESPN MLB', category: 'SPORT', sportCategory: 'mlb' },
      { url: 'https://www.espn.com/espn/rss/nhl/news', sourceName: 'ESPN NHL', category: 'SPORT', sportCategory: 'nhl' },
      { url: 'https://www.espn.com/espn/rss/soccer/news', sourceName: 'ESPN Soccer', category: 'SPORT', sportCategory: 'soccer' },
      { url: 'https://www.espn.com/espn/rss/tennis/news', sourceName: 'ESPN Tennis', category: 'SPORT', sportCategory: 'tennis' },
      { url: 'https://www.espn.com/espn/rss/golf/news', sourceName: 'ESPN Golf', category: 'SPORT', sportCategory: 'golf' },
      
      // Sports - BBC (5 articles from last 6 hours)
      { url: 'https://feeds.bbci.co.uk/sport/rss.xml', sourceName: 'BBC Sport', category: 'SPORT' },
      
      // Entertainment
      { url: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml', sourceName: 'BBC Entertainment', category: 'ENTERTAINMENT' },
      
      // NOTE: HEALTH and SCIENCE categories removed from RSS feeds as requested
      // These categories will not be fetched via RSS feeds
      
      // General/Others
      { url: 'https://feeds.bbci.co.uk/news/rss.xml', sourceName: 'BBC News', category: 'OTHERS' },
      { url: 'https://www.theguardian.com/world/rss', sourceName: 'The Guardian', category: 'OTHERS' }
      
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
