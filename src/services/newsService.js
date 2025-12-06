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
  },
  timeout: 10000, // 10 second timeout for RSS feeds
  maxRedirects: 5
});

class NewsService {
  constructor() {
    this.providers = getProvidersByPriority();
  }

  /**
   * Fetch news from a specific provider
   */
  async fetchFromProvider(provider, options = {}) {
    const { category = null, maxArticles = 10, hoursAgo = null } = options;
    
    // Skip provider if date filtering is required but not supported
    if (hoursAgo !== null && hoursAgo > 0 && !provider.supportsDateFilter) {
      throw new Error(`Provider ${provider.name} does not support date filtering`);
    }

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
          articles = await this.fetchFromAPI(provider, category, maxArticles, hoursAgo);
          break;
        case 'rss-aggregator':
          articles = await this.fetchFromRSSAggregator(provider, category, maxArticles, hoursAgo);
          break;
        case 'rss-direct':
          articles = await this.fetchFromRSSFeeds(provider, category, maxArticles, hoursAgo);
          break;
        default:
          throw new Error(`Unknown provider type: ${provider.type}`);
      }

      // Ensure articles is an array
      if (!Array.isArray(articles)) {
        articles = [];
      }

      // Increment usage counter
      if (articles.length > 0 && provider.dailyLimit !== Infinity) {
        await apiUsageTracker.incrementUsage(provider.name, 1);
      }

      return {
        success: articles.length > 0,
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
  async fetchFromAPI(provider, category, maxArticles, hoursAgo = null) {
    const articles = [];
    
    // Calculate date range if hoursAgo is specified
    let fromDate = null;
    if (hoursAgo !== null && hoursAgo > 0) {
      fromDate = new Date();
      fromDate.setHours(fromDate.getHours() - hoursAgo);
    }
    
    // NewsAPI.org: Use /top-headlines for categories, /everything for general search
    // BUT: /top-headlines doesn't support date filtering, so use /everything if date filtering is needed
    let endpoint;
    if (provider.name === 'NewsAPI.org') {
      if (fromDate && provider.supportsDateFilter) {
        // Must use /everything endpoint for date filtering (top-headlines doesn't support it)
        endpoint = provider.endpoints.everything;
      } else if (category && category !== 'GENERAL') {
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

    // Add date filtering if supported and hoursAgo is specified
    // Note: NewsAPI free tier may not support real-time date filtering well
    // We'll fetch without date filter and filter after to ensure we get results
    if (fromDate && provider.supportsDateFilter) {
      if (provider.name === 'NewsAPI.org') {
        // NewsAPI free tier works better without strict date filtering
        // We'll fetch recent articles and filter by date after
        // Just set a broad date range (last 7 days) to get recent articles
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        params.from = weekAgo.toISOString().split('T')[0]; // YYYY-MM-DD format
        params.to = new Date().toISOString().split('T')[0];
        console.log(`📅 NewsAPI: Fetching from last 7 days, will filter to last ${hoursAgo} hours`);
      } else if (provider.name === 'NewsData.io') {
        // NewsData.io doesn't have a simple date parameter for recent articles
        // We'll fetch and filter after instead
      }
    }

    // Set API key based on provider format
    if (provider.name === 'NewsData.io') {
      params.apikey = provider.apiKey; // NewsData uses 'apikey' not 'apiKey'
    } else if (provider.name === 'GNews API') {
      params.token = provider.apiKey; // GNews uses 'token'
    } else {
      params.apiKey = provider.apiKey; // NewsAPI, Currents use 'apiKey'
    }

    // Set page size - fetch more articles to account for date filtering
    const fetchLimit = fromDate ? maxArticles * 5 : maxArticles; // Fetch 5x more if filtering by date
    if (provider.name === 'NewsData.io') {
      params.size = Math.min(fetchLimit, provider.requestsPerCall || 10);
    } else if (provider.name === 'GNews API') {
      params.max = Math.min(fetchLimit, provider.requestsPerCall || 10);
    } else {
      params.pageSize = Math.min(fetchLimit, provider.requestsPerCall || 100);
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
          // For /everything, use q parameter for search (REQUIRED for /everything endpoint)
          // NewsAPI supports: keywords, OR operators, quotes for exact phrases
          // Using simple, common keywords for better matching
          const searchTerms = {
            'DEFI': 'bitcoin',
            'TECHNOLOGY': 'technology',
            'FINANCE': 'finance',
            'BUSINESS': 'business',
            'POLITICS': 'politics',
            'SPORT': 'sports',
            'ENTERTAINMENT': 'entertainment',
            'HEALTH': 'health',
            'SCIENCE': 'science',
            'WEATHER': 'weather',
            'OTHERS': 'news'
          };
          // Always set q parameter for /everything endpoint (it's required)
          params.q = searchTerms[category] || 'news';
          console.log(`🔍 NewsAPI query: q="${params.q}"`);
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
        articles.push(...response.data.articles);
      } else if (response.data && response.data.results) {
        // NewsData.io format
        articles.push(...response.data.results);
      } else if (response.data && response.data.news) {
        // Currents API format
        articles.push(...response.data.news);
      } else if (response.data && Array.isArray(response.data)) {
        // Direct array format
        articles.push(...response.data);
      }

      // Debug: Log if no articles found
      if (articles.length === 0) {
        console.log(`⚠️  No articles in response from ${provider.name}. Response keys: ${Object.keys(response.data || {}).join(', ')}`);
        if (provider.name === 'NewsAPI.org' && response.data) {
          console.log(`   NewsAPI status: ${response.data.status}, totalResults: ${response.data.totalResults || 0}`);
        }
      }

      // Normalize articles first
      const normalized = this.normalizeAPIArticles(articles, provider.name);
      
      // Filter by date if hoursAgo is specified (post-fetch filtering)
      // Always do post-fetch filtering to ensure accuracy
      let finalArticles = normalized;
      if (fromDate && this._currentHoursAgo) {
        const now = new Date();
        const hoursAgoValue = this._currentHoursAgo;
        finalArticles = normalized.filter(article => {
          if (!article.publishedAt) return false;
          try {
            const pubDate = new Date(article.publishedAt);
            if (isNaN(pubDate.getTime())) return false;
            // Check if article is within the time window
            const hoursDiff = (now - pubDate) / (1000 * 60 * 60);
            return hoursDiff <= hoursAgoValue && hoursDiff >= 0;
          } catch (error) {
            return false;
          }
        });
        
        if (finalArticles.length === 0 && normalized.length > 0) {
          const oldest = normalized[normalized.length - 1]?.publishedAt;
          const newest = normalized[0]?.publishedAt;
          console.log(`⚠️  All ${normalized.length} articles filtered out (too old).`);
          if (oldest) console.log(`   Oldest article: ${oldest} (${Math.round((now - new Date(oldest)) / (1000 * 60 * 60))} hours ago)`);
          if (newest) console.log(`   Newest article: ${newest} (${Math.round((now - new Date(newest)) / (1000 * 60 * 60))} hours ago)`);
        }
      }

      // Limit to maxArticles after filtering
      return finalArticles.slice(0, maxArticles);
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
  async fetchFromRSSAggregator(provider, category, maxArticles, hoursAgo = null) {
    const articles = [];
    
    // Use direct RSS feeds if aggregator fails
    const rssProvider = getProvider('rssFeeds');
    if (rssProvider && rssProvider.enabled) {
      return this.fetchFromRSSFeeds(rssProvider, category, maxArticles, hoursAgo);
    }

    return articles;
  }

  /**
   * Fetch news from direct RSS feeds
   * Limits to 10 most recent articles per category from the past 6 hours
   */
  async fetchFromRSSFeeds(provider, category, maxArticles, hoursAgo = null) {
    const articles = [];
    const feeds = provider.feeds || [];

    // Default to 6 hours if not specified
    const timeWindowHours = hoursAgo !== null && hoursAgo > 0 ? hoursAgo : 6;
    
    // Calculate date threshold - always filter by 6 hours
    const fromDate = new Date();
    fromDate.setHours(fromDate.getHours() - timeWindowHours);

    // Filter feeds by category if specified
    const relevantFeeds = category
      ? feeds.filter(feed => feed.category === category.toUpperCase())
      : feeds;

    // Limit number of feeds to process
    const feedsToProcess = relevantFeeds.slice(0, 5);

    for (const feed of feedsToProcess) {
      try {
        // Add timeout and retry logic for RSS feeds
        let feedData;
        let retries = 2;
        let lastError;
        
        while (retries > 0) {
          try {
            feedData = await Promise.race([
              rssParser.parseURL(feed.url),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('RSS feed timeout')), 10000)
              )
            ]);
            break; // Success, exit retry loop
          } catch (error) {
            lastError = error;
            retries--;
            if (retries > 0) {
              console.log(`⚠️  Retrying RSS feed ${feed.name || feed.url}... (${retries} retries left)`);
              await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
            }
          }
        }
        
        if (!feedData) {
          throw lastError || new Error('Failed to fetch RSS feed');
        }
        
        let feedArticles = feedData.items || [];

        // Always filter by date (past 6 hours)
        feedArticles = feedArticles.filter(item => {
          if (!item.pubDate) return false;
          try {
            const pubDate = new Date(item.pubDate);
            if (isNaN(pubDate.getTime())) return false;
            return pubDate >= fromDate;
          } catch (error) {
            return false;
          }
        });

        // Collect all articles from all feeds (don't limit per feed)
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
        const feedName = feed.name || feed.url || 'Unknown';
        if (error.message.includes('timeout') || error.message.includes('socket') || error.message.includes('TLS')) {
          console.log(`⚠️  RSS feed ${feedName} connection error (timeout/SSL): ${error.message}`);
        } else {
          console.error(`Error parsing RSS feed ${feedName}:`, error.message);
        }
        // Continue with other feeds
      }
      
      // Add delay between RSS feed requests to avoid overwhelming servers
      if (feedsToProcess.indexOf(feed) < feedsToProcess.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
      }
    }

    // Sort articles by published date (newest first)
    articles.sort((a, b) => {
      const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return dateB - dateA; // Newest first
    });

    // Limit to 10 articles per category maximum
    // If there are less than 10, return whatever is available
    const limit = 10;
    const limitedArticles = articles.slice(0, limit);

    console.log(`📰 RSS Feed: Found ${articles.length} articles from past ${timeWindowHours}h, returning ${limitedArticles.length} most recent for category ${category || 'ALL'}`);

    return limitedArticles;
  }

  /**
   * Upgrade thumbnail URL to larger size if possible
   * Many CDNs (like BBC iChef) support size parameters in URLs
   */
  upgradeThumbnailUrl(thumbnailUrl) {
    if (!thumbnailUrl) return thumbnailUrl;
    
    // BBC iChef CDN: /ace/standard/240/... can be upgraded to larger sizes
    // Try 1024px first (good balance of quality and size)
    if (thumbnailUrl.includes('ichef.bbci.co.uk') && thumbnailUrl.includes('/standard/240/')) {
      return thumbnailUrl.replace('/standard/240/', '/standard/1024/');
    }
    
    // Generic pattern: if URL contains size indicators, try to upgrade
    // Common patterns: /240/, /thumb/, /thumbnail/, _thumb, _small
    const sizePatterns = [
      { pattern: /\/standard\/240\//i, replacement: '/standard/1024/' },
      { pattern: /\/240\//i, replacement: '/1024/' },
      { pattern: /\/thumb\//i, replacement: '/large/' },
      { pattern: /\/thumbnail\//i, replacement: '/large/' },
      { pattern: /_thumb/i, replacement: '_large' },
      { pattern: /_small/i, replacement: '_large' },
    ];
    
    for (const { pattern, replacement } of sizePatterns) {
      if (pattern.test(thumbnailUrl)) {
        return thumbnailUrl.replace(pattern, replacement);
      }
    }
    
    return thumbnailUrl;
  }

  /**
   * Extract image URL from RSS item
   * Prioritizes full-resolution images over thumbnails
   * Automatically upgrades thumbnail URLs to larger sizes when possible
   */
  extractImageFromRSSItem(item) {
    // Priority 1: media:content (full-resolution image)
    if (item['media:content']) {
      // Handle both object format and array format
      const mediaContent = Array.isArray(item['media:content']) 
        ? item['media:content'][0] 
        : item['media:content'];
      
      if (mediaContent) {
        // Try $ property first (common RSS format)
        if (mediaContent['$'] && mediaContent['$'].url) {
          return mediaContent['$'].url;
        }
        // Try direct url property
        if (mediaContent.url) {
          return mediaContent.url;
        }
        // Try as string if it's a simple format
        if (typeof mediaContent === 'string') {
          return mediaContent;
        }
      }
    }
    
    // Priority 2: Extract from HTML content (often full-resolution)
    if (item.content) {
      // Try to extract image from HTML content - look for larger images first
      const imgMatches = item.content.match(/<img[^>]+src="([^"]+)"/gi);
      if (imgMatches && imgMatches.length > 0) {
        // Get the first image (usually the main article image)
        const firstMatch = imgMatches[0].match(/src="([^"]+)"/i);
        if (firstMatch && firstMatch[1]) {
          // Prefer full URLs, avoid thumbnail URLs
          const imgUrl = firstMatch[1];
          // Skip obvious thumbnail indicators
          if (!imgUrl.toLowerCase().includes('thumb') && 
              !imgUrl.toLowerCase().includes('thumbnail') &&
              !imgUrl.toLowerCase().includes('_thumb')) {
            return imgUrl;
          }
        }
      }
    }
    
    // Priority 3: enclosure (usually full image)
    if (item.enclosure && item.enclosure.url && item.enclosure.type && item.enclosure.type.startsWith('image/')) {
      return item.enclosure.url;
    }
    
    // Priority 4: description field (sometimes contains image HTML)
    if (item.description) {
      const descImgMatch = item.description.match(/<img[^>]+src="([^"]+)"/i);
      if (descImgMatch && descImgMatch[1]) {
        const imgUrl = descImgMatch[1];
        // Skip thumbnails
        if (!imgUrl.toLowerCase().includes('thumb') && 
            !imgUrl.toLowerCase().includes('thumbnail')) {
          return imgUrl;
        }
      }
    }
    
    // Last resort: media:thumbnail (only if no other option)
    // This is intentionally last because thumbnails are low quality
    // BUT: We'll try to upgrade it to a larger size
    if (item['media:thumbnail']) {
      const thumbnail = Array.isArray(item['media:thumbnail']) 
        ? item['media:thumbnail'][0] 
        : item['media:thumbnail'];
      
      if (thumbnail) {
        let thumbnailUrl = null;
        if (thumbnail['$'] && thumbnail['$'].url) {
          thumbnailUrl = thumbnail['$'].url;
        } else if (thumbnail.url) {
          thumbnailUrl = thumbnail.url;
        }
        
        if (thumbnailUrl) {
          // Try to upgrade thumbnail to larger size
          return this.upgradeThumbnailUrl(thumbnailUrl);
        }
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
      let author = article.author || article.byline || article.creator || article.writer || null;
      
      // Handle author if it's an object (some APIs return author as {name: "...", ...})
      if (author && typeof author === 'object') {
        author = author.name || author.author || author.byline || null;
      }
      
      // Clean author string
      if (author && typeof author === 'string') {
        author = author.trim();
      } else {
        author = null;
      }
      
      const normalized = {
        title: article.title || article.headline || '',
        description: description,
        content: cleanedContent,
        url: url,
        imageUrl: article.urlToImage || article.image || article.thumbnail || null,
        publishedAt: article.publishedAt ? new Date(article.publishedAt) : (article.pubDate ? new Date(article.pubDate) : new Date()),
        author: author,
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
    const { category = null, maxArticles = 10, articlesPerProvider = null, hoursAgo = 6 } = options;
    const providers = getProvidersByPriority();

    // If articlesPerProvider is specified (or null for unlimited), fetch from ALL providers
    if (articlesPerProvider === null || articlesPerProvider > 0) {
      const allArticles = [];
      const successfulProviders = [];
      const skippedProviders = [];

      for (const provider of providers) {
        console.log(`🔄 Trying provider: ${provider.name}...`);

        try {
          // Skip providers that don't support date filtering if hoursAgo is specified
          if (hoursAgo && hoursAgo > 0 && !provider.supportsDateFilter) {
            console.log(`⏭️  Skipping ${provider.name} (does not support date filtering)`);
            skippedProviders.push(provider.name);
            continue;
          }

          // If articlesPerProvider is null, use a high limit to fetch all articles
          const providerMaxArticles = articlesPerProvider === null ? 1000 : articlesPerProvider;
          
          const result = await this.fetchFromProvider(provider, { 
            category, 
            maxArticles: providerMaxArticles,
            hoursAgo: hoursAgo
          });

          if (result.success && result.articles.length > 0) {
            console.log(`✅ Successfully fetched ${result.articles.length} articles from ${provider.name}`);
            allArticles.push(...result.articles);
            successfulProviders.push(provider.name);
          } else {
            console.log(`❌ Failed to fetch from ${provider.name}: ${result.error || 'No articles returned'}`);
          }
        } catch (error) {
          if (error.message.includes('does not support date filtering')) {
            console.log(`⏭️  Skipping ${provider.name} (does not support date filtering)`);
            skippedProviders.push(provider.name);
          } else {
            console.log(`❌ Error fetching from ${provider.name}: ${error.message}`);
          }
        }

        // Small delay between providers
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      if (allArticles.length > 0) {
        return {
          success: true,
          provider: successfulProviders.join(', '),
          articles: allArticles,
          count: allArticles.length,
          skippedProviders: skippedProviders
        };
      } else {
        return {
          success: false,
          provider: 'all',
          error: 'All providers failed',
          articles: [],
          skippedProviders: skippedProviders
        };
      }
    }

    // Original behavior: try providers in priority order until one succeeds
    for (const provider of providers) {
      // Skip providers that don't support date filtering if hoursAgo is specified
      if (hoursAgo && hoursAgo > 0 && !provider.supportsDateFilter) {
        console.log(`⏭️  Skipping ${provider.name} (does not support date filtering)`);
        continue;
      }

      console.log(`🔄 Trying provider: ${provider.name}...`);

      try {
        const result = await this.fetchFromProvider(provider, { 
          category, 
          maxArticles,
          hoursAgo: hoursAgo
        });

        if (result.success && result.articles.length > 0) {
          console.log(`✅ Successfully fetched ${result.articles.length} articles from ${provider.name}`);
          return result;
        } else {
          console.log(`❌ Failed to fetch from ${provider.name}: ${result.error || 'No articles returned'}`);
          // Continue to next provider
        }
      } catch (error) {
        if (error.message.includes('does not support date filtering')) {
          console.log(`⏭️  Skipping ${provider.name} (does not support date filtering)`);
          continue;
        } else {
          console.log(`❌ Error fetching from ${provider.name}: ${error.message}`);
        }
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

