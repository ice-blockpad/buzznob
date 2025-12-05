/**
 * News Service
 * Fetches news from multiple providers with automatic fallback
 * Handles API rate limits and switches providers when limits are reached
 */

const axios = require('axios');
const Parser = require('rss-parser');
const { getProvidersByPriority, getProvider } = require('../config/newsProviders');
const apiUsageTracker = require('./apiUsageTracker');

const rssParser = new Parser({
  customFields: {
    item: ['media:content', 'media:thumbnail', 'enclosure']
  }
});

class NewsService {
  constructor() {
    this.providers = getProvidersByPriority();
  }

  /**
   * Fetch news from a specific provider
   */
  async fetchFromProvider(provider, options = {}) {
    const { category = null, maxArticles = 10 } = options;

    try {
      // Check if provider has available requests
      if (provider.dailyLimit !== Infinity) {
        const hasAvailable = await apiUsageTracker.hasAvailableRequests(
          provider.name,
          provider.dailyLimit
        );

        if (!hasAvailable) {
          throw new Error(`Daily limit reached for ${provider.name}`);
        }
      }

      let articles = [];

      switch (provider.type) {
        case 'api':
          articles = await this.fetchFromAPI(provider, category, maxArticles);
          break;
        case 'rss-aggregator':
          articles = await this.fetchFromRSSAggregator(provider, category, maxArticles);
          break;
        case 'rss-direct':
          articles = await this.fetchFromRSSFeeds(provider, category, maxArticles);
          break;
        default:
          throw new Error(`Unknown provider type: ${provider.type}`);
      }

      // Increment usage counter
      if (articles.length > 0 && provider.dailyLimit !== Infinity) {
        await apiUsageTracker.incrementUsage(provider.name, 1);
      }

      return {
        success: true,
        provider: provider.name,
        articles,
        count: articles.length
      };
    } catch (error) {
      console.error(`Error fetching from ${provider.name}:`, error.message);
      return {
        success: false,
        provider: provider.name,
        error: error.message,
        articles: []
      };
    }
  }

  /**
   * Fetch news from API provider (NewsAPI, NewsData, etc.)
   */
  async fetchFromAPI(provider, category, maxArticles) {
    const articles = [];
    
    // NewsAPI.org: Use /top-headlines for categories, /everything for general search
    let endpoint;
    if (provider.name === 'NewsAPI.org') {
      if (category && category !== 'GENERAL') {
        endpoint = provider.endpoints.topHeadlines;
      } else {
        endpoint = provider.endpoints.everything;
      }
    } else {
      endpoint = provider.endpoints.latest || provider.endpoints.everything || provider.endpoints.topHeadlines;
    }
    
    const url = `${provider.baseUrl}${endpoint}`;

    const params = {
      ...provider.params
    };

    // Set API key based on provider format
    if (provider.name === 'NewsData.io') {
      params.apikey = provider.apiKey; // NewsData uses 'apikey' not 'apiKey'
    } else if (provider.name === 'GNews API') {
      params.token = provider.apiKey; // GNews uses 'token'
    } else {
      params.apiKey = provider.apiKey; // NewsAPI, Currents use 'apiKey'
    }

    // Set page size
    if (provider.name === 'NewsData.io') {
      params.size = Math.min(maxArticles, provider.requestsPerCall || 10);
    } else if (provider.name === 'GNews API') {
      params.max = Math.min(maxArticles, provider.requestsPerCall || 10);
    } else {
      params.pageSize = Math.min(maxArticles, provider.requestsPerCall || 10);
    }

    // Add category if specified
    if (category) {
      if (provider.name === 'NewsAPI.org') {
        // Only add category for top-headlines endpoint
        if (endpoint === provider.endpoints.topHeadlines) {
          // Map our categories to NewsAPI categories
          const categoryMap = {
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
          };
          params.category = categoryMap[category] || 'general';
        } else {
          // For /everything, use q parameter for search
          const searchTerms = {
            'DEFI': 'defi OR decentralized finance OR cryptocurrency OR bitcoin',
            'TECHNOLOGY': 'technology OR tech OR software',
            'FINANCE': 'finance OR financial OR banking',
            'BUSINESS': 'business OR company OR corporate',
            'POLITICS': 'politics OR government OR election',
            'SPORT': 'sports OR football OR basketball',
            'ENTERTAINMENT': 'entertainment OR movie OR music',
            'HEALTH': 'health OR medical OR healthcare',
            'SCIENCE': 'science OR research OR discovery',
            'WEATHER': 'weather OR climate',
            'OTHERS': null
          };
          if (searchTerms[category]) {
            params.q = searchTerms[category];
          }
        }
      } else if (provider.name === 'NewsData.io') {
        // NewsData.io category mapping
        const categoryMap = {
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
        };
        params.category = categoryMap[category] || 'top';
      } else if (provider.name === 'Currents API') {
        // Currents API category mapping
        const categoryMap = {
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
        };
        if (categoryMap[category]) {
          params.category = categoryMap[category];
        }
      } else if (provider.name === 'GNews API') {
        // GNews uses 'q' for search terms
        const searchTerms = {
          'DEFI': 'defi OR cryptocurrency OR bitcoin',
          'TECHNOLOGY': 'technology OR tech',
          'FINANCE': 'finance OR banking',
          'BUSINESS': 'business OR company',
          'POLITICS': 'politics OR government',
          'SPORT': 'sports OR football',
          'ENTERTAINMENT': 'entertainment OR movie',
          'HEALTH': 'health OR medical',
          'SCIENCE': 'science OR research',
          'WEATHER': 'weather OR climate',
          'OTHERS': null
        };
        if (searchTerms[category]) {
          params.q = searchTerms[category];
        }
      }
    }

    // Add sources if available (only for NewsAPI /everything endpoint)
    if (provider.sources && provider.sources.length > 0 && provider.name === 'NewsAPI.org' && endpoint === provider.endpoints.everything) {
      params.sources = provider.sources.join(',');
    }

    try {
      const response = await axios.get(url, {
        params,
        timeout: 30000, // 30 second timeout
        headers: {
          'User-Agent': 'Buzznob-NewsBot/1.0'
        }
      });

      if (response.data && response.data.articles) {
        // NewsAPI format
        articles.push(...response.data.articles.slice(0, maxArticles));
      } else if (response.data && response.data.results) {
        // NewsData.io format
        articles.push(...response.data.results.slice(0, maxArticles));
      } else if (response.data && response.data.news) {
        // Currents API format
        articles.push(...response.data.news.slice(0, maxArticles));
      } else if (response.data && Array.isArray(response.data)) {
        // Direct array format
        articles.push(...response.data.slice(0, maxArticles));
      }

      return this.normalizeAPIArticles(articles, provider.name);
    } catch (error) {
      if (error.response) {
        // API returned an error
        if (error.response.status === 429) {
          throw new Error('Rate limit exceeded');
        } else if (error.response.status === 401) {
          throw new Error('Invalid API key');
        }
        const errorMsg = error.response.data?.message || error.response.data?.detail || error.response.data?.error || error.message;
        throw new Error(`API error: ${error.response.status} - ${errorMsg}`);
      }
      throw error;
    }
  }

  /**
   * Fetch news from RSS aggregator (RSS2JSON, FeedAPI)
   */
  async fetchFromRSSAggregator(provider, category, maxArticles) {
    const articles = [];
    
    // Use direct RSS feeds if aggregator fails
    const rssProvider = getProvider('rssFeeds');
    if (rssProvider && rssProvider.enabled) {
      return this.fetchFromRSSFeeds(rssProvider, category, maxArticles);
    }

    return articles;
  }

  /**
   * Fetch news from direct RSS feeds
   */
  async fetchFromRSSFeeds(provider, category, maxArticles) {
    const articles = [];
    const feeds = provider.feeds || [];

    // Filter feeds by category if specified
    const relevantFeeds = category
      ? feeds.filter(feed => feed.category === category.toUpperCase())
      : feeds;

    // Limit number of feeds to process
    const feedsToProcess = relevantFeeds.slice(0, 5);

    for (const feed of feedsToProcess) {
      try {
        const feedData = await rssParser.parseURL(feed.url);
        const feedArticles = feedData.items.slice(0, Math.ceil(maxArticles / feedsToProcess.length));

        for (const item of feedArticles) {
          const description = item.contentSnippet || item.description || '';
          let content = item.content || item.contentSnippet || item.description || '';
          const url = item.link || item.guid || '';
          
          // Clean up truncated content indicators like "... [+6712 chars]"
          content = content.replace(/\s*\.\.\.\s*\[\+\d+\s*chars?\]/gi, '').trim();
          
          // If content is short and we have a URL, add a note
          if (content.length < 200 && url) {
            content = content + (content ? '\n\n' : '') + `Read the full article at: ${url}`;
          } else if (url && !content.includes(url)) {
            content = content + '\n\n' + `Source: ${url}`;
          }
          
          // Extract author from RSS item (can be in various fields)
          const author = item['dc:creator'] || item.creator || item.author || item['dc:author'] || null;
          
          articles.push({
            title: item.title || '',
            description: description,
            content: content,
            url: url,
            imageUrl: this.extractImageFromRSSItem(item),
            publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
            author: author ? (typeof author === 'string' ? author.trim() : author.name || author) : null,
            sourceName: feed.sourceName || feed.name,
            sourceUrl: feed.url,
            category: feed.category || 'GENERAL'
          });
        }
      } catch (error) {
        console.error(`Error parsing RSS feed ${feed.name}:`, error.message);
        // Continue with other feeds
      }
    }

    return articles.slice(0, maxArticles);
  }

  /**
   * Extract image URL from RSS item
   */
  extractImageFromRSSItem(item) {
    // Try different image sources
    if (item['media:content'] && item['media:content']['$'] && item['media:content']['$'].url) {
      return item['media:content']['$'].url;
    }
    if (item['media:thumbnail'] && item['media:thumbnail']['$'] && item['media:thumbnail']['$'].url) {
      return item['media:thumbnail']['$'].url;
    }
    if (item.enclosure && item.enclosure.url && item.enclosure.type && item.enclosure.type.startsWith('image/')) {
      return item.enclosure.url;
    }
    if (item.content) {
      // Try to extract image from HTML content
      const imgMatch = item.content.match(/<img[^>]+src="([^"]+)"/i);
      if (imgMatch && imgMatch[1]) {
        return imgMatch[1];
      }
    }
    return null;
  }

  /**
   * Normalize API articles to common format
   */
  normalizeAPIArticles(articles, providerName) {
    return articles.map(article => {
      // Handle different API response formats
      const description = article.description || article.summary || '';
      const content = article.content || description;
      const url = article.url || article.link || article.webUrl || '';
      
      // Clean up truncated content indicators like "... [+6712 chars]"
      let cleanedContent = content.replace(/\s*\.\.\.\s*\[\+\d+\s*chars?\]/gi, '').trim();
      
      // If content is still very short or looks truncated, enhance it
      if (cleanedContent.length < 200 && url) {
        // Add a note about reading the full article
        cleanedContent = cleanedContent + (cleanedContent ? '\n\n' : '') + 
          `Read the full article at: ${url}`;
      } else if (url && !cleanedContent.includes(url)) {
        // Append source URL if not already included
        cleanedContent = cleanedContent + '\n\n' + `Source: ${url}`;
      }

      // Extract author from various possible fields
      const author = article.author || article.byline || article.creator || article.writer || null;
      
      const normalized = {
        title: article.title || article.headline || '',
        description: description,
        content: cleanedContent,
        url: url,
        imageUrl: article.urlToImage || article.image || article.thumbnail || null,
        publishedAt: article.publishedAt ? new Date(article.publishedAt) : (article.pubDate ? new Date(article.pubDate) : new Date()),
        author: author ? author.trim() : null,
        sourceName: article.source?.name || article.source || providerName,
        sourceUrl: url,
        category: this.detectCategory(article.title || '', description)
      };

      return normalized;
    });
  }

  /**
   * Detect article category from title and description
   */
  detectCategory(title, description) {
    const text = `${title} ${description}`.toLowerCase();

    // DeFi/Crypto keywords
    if (text.match(/\b(defi|decentralized finance|bitcoin|crypto|cryptocurrency|blockchain|ethereum|btc|eth|nft|web3|solana|cardano|dogecoin|token|wallet|exchange)\b/i)) {
      return 'DEFI';
    }

    // Technology keywords
    if (text.match(/\b(technology|tech|software|hardware|computer|ai|artificial intelligence|machine learning|app|digital|internet|cyber|startup|innovation)\b/i)) {
      return 'TECHNOLOGY';
    }

    // Finance keywords
    if (text.match(/\b(finance|financial|bank|banking|stock|market|trading|investment|economy|economic|dollar|currency|money|wealth|business finance)\b/i)) {
      return 'FINANCE';
    }

    // Business keywords
    if (text.match(/\b(business|company|corporate|enterprise|industry|commerce|trade|merger|acquisition|revenue|profit|ceo|executive)\b/i)) {
      return 'BUSINESS';
    }

    // Politics keywords
    if (text.match(/\b(politics|political|government|president|election|vote|senate|congress|parliament|policy|law|legislation|democrat|republican)\b/i)) {
      return 'POLITICS';
    }

    // Sport keywords (note: app uses 'SPORT' not 'SPORTS')
    if (text.match(/\b(football|soccer|basketball|nba|nfl|sport|sports|game|match|player|team|championship|tournament|olympics|athlete)\b/i)) {
      return 'SPORT';
    }

    // Entertainment keywords
    if (text.match(/\b(movie|film|actor|actress|celebrity|music|album|song|tv|show|entertainment|hollywood|netflix|streaming)\b/i)) {
      return 'ENTERTAINMENT';
    }

    // Health keywords
    if (text.match(/\b(health|medical|medicine|doctor|hospital|disease|treatment|healthcare|wellness|fitness|nutrition|therapy)\b/i)) {
      return 'HEALTH';
    }

    // Science keywords
    if (text.match(/\b(science|scientific|research|study|experiment|discovery|scientist|laboratory|lab|physics|chemistry|biology|space|nasa)\b/i)) {
      return 'SCIENCE';
    }

    // Weather keywords
    if (text.match(/\b(weather|climate|temperature|rain|snow|storm|hurricane|forecast|meteorology|drought|flood)\b/i)) {
      return 'WEATHER';
    }

    // Default to OTHERS
    return 'OTHERS';
  }

  /**
   * Fetch news with automatic fallback
   * Tries providers in priority order until one succeeds
   */
  async fetchNews(options = {}) {
    const { category = null, maxArticles = 10 } = options;
    const providers = getProvidersByPriority();

    for (const provider of providers) {
      console.log(`🔄 Trying provider: ${provider.name}...`);

      const result = await this.fetchFromProvider(provider, { category, maxArticles });

      if (result.success && result.articles.length > 0) {
        console.log(`✅ Successfully fetched ${result.articles.length} articles from ${provider.name}`);
        return result;
      } else {
        console.log(`❌ Failed to fetch from ${provider.name}: ${result.error || 'No articles returned'}`);
        // Continue to next provider
      }
    }

    // All providers failed
    console.error('❌ All news providers failed');
    return {
      success: false,
      provider: 'all',
      error: 'All providers failed',
      articles: []
    };
  }

  /**
   * Fetch news from multiple categories
   */
  async fetchNewsByCategories(categories = ['GENERAL', 'CRYPTO', 'SPORTS', 'ENTERTAINMENT'], maxArticlesPerCategory = 5) {
    const allArticles = [];

    for (const category of categories) {
      try {
        const result = await this.fetchNews({
          category,
          maxArticles: maxArticlesPerCategory
        });

        if (result.success && result.articles.length > 0) {
          allArticles.push(...result.articles);
        }
      } catch (error) {
        console.error(`Error fetching ${category} news:`, error);
        // Continue with other categories
      }
    }

    return {
      success: allArticles.length > 0,
      articles: allArticles,
      count: allArticles.length
    };
  }
}

// Singleton instance
const newsService = new NewsService();

module.exports = newsService;

