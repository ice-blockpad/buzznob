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
      { url: 'https://www.theguardian.com/technology/rss', sourceName: 'The Guardian Technology', category: 'TECHNOLOGY', maxArticles: 5 },
      { url: 'https://feeds.arstechnica.com/arstechnica/index', sourceName: 'Ars Technica', category: 'TECHNOLOGY', maxArticles: 5 },
      
      // Sports - ESPN Categories (5 articles each from last 6 hours)
      { url: 'https://www.espn.com/espn/rss/nba/news', sourceName: 'ESPN NBA', category: 'SPORT', sportCategory: 'nba' },
      { url: 'https://www.espn.com/espn/rss/soccer/news', sourceName: 'ESPN Soccer', category: 'SPORT', sportCategory: 'soccer', maxArticles: 10 },
      { url: 'https://www.espn.com/espn/rss/tennis/news', sourceName: 'ESPN Tennis', category: 'SPORT', sportCategory: 'tennis' },
      { url: 'https://www.espn.com/espn/rss/golf/news', sourceName: 'ESPN Golf', category: 'SPORT', sportCategory: 'golf' },
      { url: 'https://www.espn.com/espn/rss/boxing/news', sourceName: 'ESPN Boxing', category: 'SPORT', sportCategory: 'boxing' },
      { url: 'https://www.espn.com/espn/rss/rpm/news', sourceName: 'ESPN Motorsports', category: 'SPORT', sportCategory: 'motorsports' },
      
      // Sports - BBC (10 articles from last 6 hours)
      { url: 'https://feeds.bbci.co.uk/sport/rss.xml', sourceName: 'BBC Sport', category: 'SPORT', maxArticles: 10 },
      
      // Business News (5 articles each from last 6 hours)
      { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', sourceName: 'CNBC Business', category: 'BUSINESS', maxArticles: 5 },
      { url: 'https://www.theguardian.com/business/rss', sourceName: 'The Guardian Business', category: 'BUSINESS', maxArticles: 5 },
      { url: 'https://www.ft.com/?format=rss', sourceName: 'Financial Times', category: 'BUSINESS', maxArticles: 5 },
      { url: 'https://finance.yahoo.com/news/rssindex', sourceName: 'Yahoo Finance', category: 'BUSINESS', maxArticles: 5 },
      { url: 'https://www.forbes.com/business/feed/', sourceName: 'Forbes Business', category: 'BUSINESS', maxArticles: 5 },
      
      // Finance News (5 articles each from last 6 hours)
      // Covers banking, stocks, FX, money, and economy
      { url: 'https://www.ft.com/?format=rss', sourceName: 'Financial Times', category: 'FINANCE', maxArticles: 5 },
      { url: 'https://feeds.marketwatch.com/marketwatch/topstories/', sourceName: 'MarketWatch', category: 'FINANCE', maxArticles: 5 },
      { url: 'https://www.cnbc.com/id/100727362/device/rss/rss.html', sourceName: 'CNBC Finance', category: 'FINANCE', maxArticles: 5 },
      { url: 'https://finance.yahoo.com/news/rssindex', sourceName: 'Yahoo Finance', category: 'FINANCE', maxArticles: 5 },
      { url: 'https://feeds.bbci.co.uk/news/business/rss.xml', sourceName: 'BBC Business', category: 'FINANCE', maxArticles: 5 },
      
      // Weather News (5 articles each from last 6 hours)
      // Covers weather forecasts, climate conditions, climate incidents, and hazard occurrences
      { url: 'https://www.theguardian.com/uk/weather/rss', sourceName: 'The Guardian Weather', category: 'WEATHER', maxArticles: 5 },
      { url: 'https://www.theguardian.com/environment/rss', sourceName: 'The Guardian Environment', category: 'WEATHER', maxArticles: 5 },
      { url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', sourceName: 'BBC Science & Environment', category: 'WEATHER', maxArticles: 5 },
      
      // Science News (5 articles each from last 6 hours)
      // Covers scientific discoveries, NASA, space exploration, research, and scientific breakthroughs (excluding technology)
      { url: 'https://www.nasa.gov/rss/dyn/breaking_news.rss', sourceName: 'NASA Breaking News', category: 'SCIENCE', maxArticles: 5 },
      { url: 'https://www.sciencedaily.com/rss/all.xml', sourceName: 'Science Daily', category: 'SCIENCE', maxArticles: 5 },
      { url: 'https://www.theguardian.com/science/rss', sourceName: 'The Guardian Science', category: 'SCIENCE', maxArticles: 5 },
      { url: 'https://www.newscientist.com/feed/home/', sourceName: 'New Scientist', category: 'SCIENCE', maxArticles: 5 },
      { url: 'https://www.livescience.com/feeds/all', sourceName: 'Live Science', category: 'SCIENCE', maxArticles: 5 },
      { url: 'https://phys.org/rss-feed/', sourceName: 'Phys.org', category: 'SCIENCE', maxArticles: 5 },
      
      // Entertainment News (5 articles each from last 6 hours)
      // Covers movies, TV shows, celebrities, music, and pop culture
      { url: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml', sourceName: 'BBC Entertainment', category: 'ENTERTAINMENT', maxArticles: 5 },
      { url: 'https://www.theguardian.com/film/rss', sourceName: 'The Guardian Film', category: 'ENTERTAINMENT', maxArticles: 5 },
      { url: 'https://www.theguardian.com/music/rss', sourceName: 'The Guardian Music', category: 'ENTERTAINMENT', maxArticles: 5 },
      { url: 'https://www.theguardian.com/tv-and-radio/rss', sourceName: 'The Guardian TV & Radio', category: 'ENTERTAINMENT', maxArticles: 5 },
      { url: 'https://www.hollywoodreporter.com/feed/', sourceName: 'The Hollywood Reporter', category: 'ENTERTAINMENT', maxArticles: 5 },
      { url: 'https://deadline.com/feed/', sourceName: 'Deadline', category: 'ENTERTAINMENT', maxArticles: 5 },
      
      // Politics News (5 articles each from last 6 hours)
      // Covers elections, government, policy, and political news
      { url: 'https://feeds.bbci.co.uk/news/politics/rss.xml', sourceName: 'BBC Politics', category: 'POLITICS', maxArticles: 5 },
      { url: 'https://www.theguardian.com/politics/rss', sourceName: 'The Guardian Politics', category: 'POLITICS', maxArticles: 5 },
      { url: 'https://www.politico.com/rss/politicopicks.xml', sourceName: 'Politico', category: 'POLITICS', maxArticles: 5 },
      { url: 'https://feeds.foxnews.com/foxnews/politics', sourceName: 'Fox News Politics', category: 'POLITICS', maxArticles: 5 },
      { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml', sourceName: 'NYT Politics', category: 'POLITICS', maxArticles: 5 },
      
      // Health News (5 articles each from last 6 hours)
      // Covers food, hygiene, drugs, medical effects, and health news
      { url: 'https://feeds.bbci.co.uk/news/health/rss.xml', sourceName: 'BBC Health', category: 'HEALTH', maxArticles: 5 },
      { url: 'https://www.theguardian.com/society/health/rss', sourceName: 'The Guardian Health', category: 'HEALTH', maxArticles: 5 },
      { url: 'https://feeds.npr.org/1128/rss.xml', sourceName: 'NPR Health', category: 'HEALTH', maxArticles: 5 },
      { url: 'https://www.who.int/rss-feeds/news-english.xml', sourceName: 'WHO News', category: 'HEALTH', maxArticles: 5 },
      
      // General/Others - BBC feeds (auto-categorized by source name)
      // Articles will be automatically categorized based on source name:
      // - BBC Business → BUSINESS
      // - BBC Technology → TECHNOLOGY
      // - BBC Politics → POLITICS
      // - BBC Sport → SPORT (handled separately above)
      // - BBC Entertainment → ENTERTAINMENT
      // - BBC News → OTHERS
      { url: 'https://feeds.bbci.co.uk/news/rss.xml', sourceName: 'BBC News', category: 'OTHERS' },
      { url: 'https://feeds.bbci.co.uk/news/business/rss.xml', sourceName: 'BBC Business', category: 'OTHERS' },
      { url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', sourceName: 'BBC Technology', category: 'OTHERS' },
      { url: 'https://feeds.bbci.co.uk/news/politics/rss.xml', sourceName: 'BBC Politics', category: 'OTHERS' },
      { url: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml', sourceName: 'BBC Entertainment', category: 'OTHERS' },
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
