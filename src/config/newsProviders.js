/**
 * News Provider Configuration
 * Defines all news APIs and RSS feeds with priorities, rate limits, and fallback order
 */

const newsProviders = {
  // Priority 1: Paid APIs (highest priority)
  newsapi: {
    name: 'NewsAPI.org',
    type: 'api',
    priority: 1,
    enabled: process.env.NEWSAPI_KEY ? true : false,
    apiKey: process.env.NEWSAPI_KEY || null,
    baseUrl: 'https://newsapi.org/v2',
    dailyLimit: process.env.NEWSAPI_LIMIT ? parseInt(process.env.NEWSAPI_LIMIT) : 100,
    requestsPerCall: 100, // Max articles per request
    endpoints: {
      everything: '/everything',
      topHeadlines: '/top-headlines',
      sources: '/sources'
    },
    params: {
      language: 'en',
      sortBy: 'publishedAt',
      pageSize: 100
    },
    sources: ['cnn', 'bbc-news', 'reuters', 'techcrunch', 'the-guardian-uk', 'the-verge'],
    category: 'general'
  },

  newsdata: {
    name: 'NewsData.io',
    type: 'api',
    priority: 2,
    enabled: process.env.NEWSDATA_KEY ? true : false,
    apiKey: process.env.NEWSDATA_KEY || null,
    baseUrl: 'https://newsdata.io/api/1',
    dailyLimit: process.env.NEWSDATA_LIMIT ? parseInt(process.env.NEWSDATA_LIMIT) : 200,
    requestsPerCall: 10, // Max articles per request
    endpoints: {
      news: '/news',
      latest: '/latest',
      archive: '/archive'
    },
    params: {
      language: 'en',
      category: 'technology,entertainment,sports,business'
    },
    category: 'general'
  },

  currents: {
    name: 'Currents API',
    type: 'api',
    priority: 3,
    enabled: process.env.CURRENTS_API_KEY ? true : false,
    apiKey: process.env.CURRENTS_API_KEY || null,
    baseUrl: 'https://api.currentsapi.services/v1',
    dailyLimit: process.env.CURRENTS_LIMIT ? parseInt(process.env.CURRENTS_LIMIT) : 20,
    requestsPerCall: 50,
    endpoints: {
      latest: '/latest-news',
      search: '/search',
      categories: '/available/categories'
    },
    params: {
      language: 'en',
      apiKey: null // Will be set from apiKey
    },
    category: 'general'
  },

  gnews: {
    name: 'GNews API',
    type: 'api',
    priority: 4,
    enabled: process.env.GNEWS_API_KEY ? true : false,
    apiKey: process.env.GNEWS_API_KEY || null,
    baseUrl: 'https://gnews.io/api/v4',
    dailyLimit: process.env.GNEWS_LIMIT ? parseInt(process.env.GNEWS_LIMIT) : 100,
    requestsPerCall: 10,
    endpoints: {
      topHeadlines: '/top-headlines',
      search: '/search'
    },
    params: {
      lang: 'en',
      max: 10,
      token: null // Will be set from apiKey
    },
    category: 'general'
  },

  // Priority 5: Free API Aggregators
  rss2json: {
    name: 'RSS2JSON',
    type: 'rss-aggregator',
    priority: 5,
    enabled: true, // Always enabled (free tier)
    apiKey: process.env.RSS2JSON_API_KEY || null, // Optional for paid tier
    baseUrl: 'https://api.rss2json.com/v1/api.json',
    dailyLimit: process.env.RSS2JSON_LIMIT ? parseInt(process.env.RSS2JSON_LIMIT) : 1000,
    requestsPerCall: 10,
    params: {
      api_key: process.env.RSS2JSON_API_KEY || null,
      count: 10
    },
    category: 'general'
  },

  feedapi: {
    name: 'FeedAPI',
    type: 'rss-aggregator',
    priority: 6,
    enabled: true, // Always enabled (free tier)
    apiKey: process.env.FEEDAPI_KEY || null, // Optional for paid tier
    baseUrl: 'https://api.feedapi.org/v1',
    dailyLimit: process.env.FEEDAPI_LIMIT ? parseInt(process.env.FEEDAPI_LIMIT) : 1000,
    requestsPerCall: 10,
    endpoints: {
      parse: '/parse'
    },
    params: {
      api_key: process.env.FEEDAPI_KEY || null
    },
    category: 'general'
  },

  // Priority 7: Direct RSS Feeds (always available, no limits)
  rssFeeds: {
    name: 'Direct RSS Feeds',
    type: 'rss-direct',
    priority: 7,
    enabled: true, // Always enabled
    dailyLimit: Infinity, // No limits
    requestsPerCall: 50,
    feeds: [
      {
        name: 'CNN',
        url: 'https://www.cnn.com/rss/edition.rss',
        category: 'GENERAL',
        sourceName: 'CNN'
      },
      {
        name: 'CNN Top Stories',
        url: 'https://www.cnn.com/rss/edition.rss',
        category: 'OTHERS',
        sourceName: 'CNN'
      },
      {
        name: 'BBC News',
        url: 'https://feeds.bbci.co.uk/news/rss.xml',
        category: 'OTHERS',
        sourceName: 'BBC'
      },
      {
        name: 'BBC Technology',
        url: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
        category: 'TECHNOLOGY', // Technology news
        sourceName: 'BBC'
      },
      {
        name: 'Reuters',
        url: 'https://www.reuters.com/rssFeed/worldNews',
        category: 'OTHERS',
        sourceName: 'Reuters'
      },
      {
        name: 'Reuters Technology',
        url: 'https://www.reuters.com/rssFeed/technologyNews',
        category: 'TECHNOLOGY',
        sourceName: 'Reuters'
      },
      {
        name: 'TechCrunch',
        url: 'https://techcrunch.com/feed/',
        category: 'TECHNOLOGY',
        sourceName: 'TechCrunch'
      },
      {
        name: 'The Guardian',
        url: 'https://www.theguardian.com/world/rss',
        category: 'OTHERS',
        sourceName: 'The Guardian'
      },
      {
        name: 'The Verge',
        url: 'https://www.theverge.com/rss/index.xml',
        category: 'TECHNOLOGY',
        sourceName: 'The Verge'
      },
      {
        name: 'ESPN',
        url: 'https://www.espn.com/espn/rss/news',
        category: 'SPORTS',
        sourceName: 'ESPN'
      },
      {
        name: 'Entertainment Weekly',
        url: 'https://ew.com/feed/',
        category: 'ENTERTAINMENT',
        sourceName: 'Entertainment Weekly'
      }
    ],
    category: 'general'
  }
};

/**
 * Get providers sorted by priority (lowest number = highest priority)
 */
function getProvidersByPriority() {
  return Object.values(newsProviders)
    .filter(provider => provider.enabled)
    .sort((a, b) => a.priority - b.priority);
}

/**
 * Get a specific provider by name
 */
function getProvider(name) {
  return newsProviders[name];
}

/**
 * Get all enabled providers
 */
function getEnabledProviders() {
  return Object.values(newsProviders).filter(provider => provider.enabled);
}

module.exports = {
  newsProviders,
  getProvidersByPriority,
  getProvider,
  getEnabledProviders
};

