/**
 * Article Processor Service
 * Processes news articles and creates them in the database with pending status
 * Handles duplicate detection, image processing, and content formatting
 */

const { prisma } = require('../config/database');
const axios = require('axios');
// articleScraper removed - no more web scraping

class ArticleProcessor {
  /**
   * Normalize URL to handle variations (query params, trailing slashes, etc.)
   * This helps catch duplicates even when URLs have slight differences
   */
  normalizeUrl(url) {
    if (!url) return null;
    
    try {
      const urlObj = new URL(url);
      // Remove common tracking/analytics query parameters
      const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 
                              'ref', 'source', 'fbclid', 'gclid', 'twclid', 'mc_cid', 'mc_eid',
                              '_ga', '_gid', 'campaign_id', 'share', 'from', 'rss'];
      
      trackingParams.forEach(param => {
        urlObj.searchParams.delete(param);
      });
      
      // Normalize pathname (remove trailing slash)
      urlObj.pathname = urlObj.pathname.replace(/\/$/, '');
      
      // Return normalized URL
      return urlObj.toString();
    } catch (error) {
      // If URL parsing fails, return original
      return url;
    }
  }

  /**
   * Check if article already exists (duplicate detection)
   * Uses URL normalization and title-based fallback for null URLs
   */
  async isDuplicate(sourceUrl, title = null) {
    // If we have a URL, normalize it and check
    if (sourceUrl) {
      const normalizedUrl = this.normalizeUrl(sourceUrl);
      
      try {
        // Check for exact match first
        const exactMatch = await prisma.article.findFirst({
          where: {
            sourceUrl: normalizedUrl
          },
          select: {
            id: true
          }
        });
        
        if (exactMatch) return true;
        
        // Also check for original URL (in case normalization changed it)
        if (normalizedUrl !== sourceUrl) {
          const originalMatch = await prisma.article.findFirst({
            where: {
              sourceUrl: sourceUrl
            },
            select: {
              id: true
            }
          });
          
          if (originalMatch) return true;
        }
      } catch (error) {
        // If unique constraint violation, it's a duplicate
        if (error.code === 'P2002') {
          return true;
        }
        console.error('Error checking duplicate by URL:', error);
      }
    }
    
    // Fallback: Check by title if URL is null/undefined
    // Only check title for articles created in the last 24 hours to avoid false positives
    if (!sourceUrl && title) {
      try {
        const oneDayAgo = new Date();
        oneDayAgo.setHours(oneDayAgo.getHours() - 24);
        
        const titleMatch = await prisma.article.findFirst({
          where: {
            title: {
              equals: title.trim(),
              mode: 'insensitive' // Case-insensitive match
            },
            createdAt: {
              gte: oneDayAgo
            },
            status: 'pending' // Only check pending articles
          },
          select: {
            id: true
          }
        });
        
        if (titleMatch) {
          console.log(`⚠️  Potential duplicate detected by title: ${title.substring(0, 50)}...`);
          return true;
        }
      } catch (error) {
        console.error('Error checking duplicate by title:', error);
      }
    }
    
    return false;
  }

  /**
   * Extract and validate image URL from article
   */
  async processImage(imageUrl) {
    if (!imageUrl) return null;

    try {
      // Validate image URL
      const url = new URL(imageUrl);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return null;
      }

      // Check if image is accessible (optional - can be slow)
      // For now, just return the URL if it looks valid
      return imageUrl;
    } catch (error) {
      // Invalid URL
      return null;
    }
  }

  /**
   * Clean and format article content - PREVIEW ONLY (Google Play Compliant)
   * CRITICAL: Limits content to 150 characters to comply with copyright laws
   */
  cleanContent(content) {
    if (!content) return '';

    // Remove HTML tags but preserve line breaks
    let cleaned = content
      .replace(/<[^>]+>/g, ' ') // Remove HTML tags
      .replace(/\s*\.\.\.\s*\[\+\d+\s*chars?\]/gi, '') // Remove truncated indicators
      .replace(/\s*\[Note:.*?\]/gi, '') // Remove notes
      .replace(/\s*Source:\s*https?:\/\/[^\s]+/gi, '') // Remove source URLs
      .replace(/\s*Read the full article at:\s*https?:\/\/[^\s]+/gi, '') // Remove "Read the full article" notes
      .replace(/\s*\[Read more.*?\]/gi, '') // Remove "[Read more...]" links
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();

    // CRITICAL: Limit to 150 characters (Google Play compliant preview)
    // Users MUST click through to publisher site to read full article
    const maxLength = 150;
    if (cleaned.length > maxLength) {
      cleaned = cleaned.substring(0, maxLength) + '...';
    }

    return cleaned;
  }

  /**
   * Get or create system admin user for automation articles
   * Returns null if no admin exists (articles will be created without authorId)
   */
  async getSystemAdminId() {
    try {
      // Try to find an admin user
      const admin = await prisma.user.findFirst({
        where: {
          role: 'admin',
          isActive: true
        },
        select: {
          id: true
        },
        orderBy: {
          createdAt: 'asc' // Get the first admin
        }
      });

      return admin?.id || null;
    } catch (error) {
      console.error('Error getting system admin:', error);
      return null;
    }
  }

  /**
   * Process a single news article and create it in database
   * Uses transaction to prevent race conditions
   */
  async processArticle(newsArticle) {
    try {
      // Validate required fields
      if (!newsArticle.title || !newsArticle.content) {
        throw new Error('Article missing required fields (title or content)');
      }

      // Normalize URL for duplicate checking
      const normalizedUrl = newsArticle.url ? this.normalizeUrl(newsArticle.url) : null;

      // Check for duplicates (with title fallback for null URLs)
      const isDup = await this.isDuplicate(normalizedUrl || newsArticle.url, newsArticle.title);
      if (isDup) {
        console.log(`⏭️  Skipping duplicate article: ${newsArticle.title.substring(0, 50)}...`);
        return {
          success: false,
          reason: 'duplicate',
          article: null
        };
      }

      // Clean and format content - PREVIEW ONLY (150 chars max)
      // NO web scraping - use only what's provided by RSS/API
      const rawContent = newsArticle.content || newsArticle.description || '';
      const cleanedContent = this.cleanContent(rawContent);
      
      // Check minimum length (at least 30 characters for a meaningful preview)
      if (cleanedContent.length < 30) {
        // Content too short for a preview, skip
        console.log(`⏭️  Skipping article with insufficient preview: ${newsArticle.title.substring(0, 50)}... (${cleanedContent.length} chars)`);
        return {
          success: false,
          reason: 'insufficient_content',
          article: null
        };
      }

      console.log(`✅ Preview ready (${cleanedContent.length} chars): ${newsArticle.title.substring(0, 50)}...`)

      // Process image - ONLY use RSS/API provided images (NO scraping)
      let imageUrl = await this.processImage(newsArticle.imageUrl);
      
      // Get author - ONLY from RSS/API (NO scraping)
      let author = newsArticle.author;
      
      // Get source name for categorization
      const sourceName = newsArticle.sourceName || '';
      
      // Skip article if no image in RSS/API
      // CRITICAL: We do NOT scrape images from article pages (copyright infringement)
      if (!imageUrl) {
        console.log(`⏭️  Skipping article without RSS image: ${newsArticle.title.substring(0, 50)}...`);
        return {
          success: false,
          reason: 'no_image',
          article: null
        };
      }
      
      console.log(`✅ Using RSS/API image: ${imageUrl.substring(0, 60)}...`)

      // Get system admin ID (optional - can be null)
      const authorId = await this.getSystemAdminId();

      // Determine category
      // Auto-categorize based on source name if it's more specific than feed category
      let category = newsArticle.category || 'GENERAL';
      
      // Override category based on source name for better accuracy
      if (sourceName.includes('BBC Business')) {
        category = 'BUSINESS';
      } else if (sourceName.includes('BBC Technology')) {
        category = 'TECHNOLOGY';
      } else if (sourceName.includes('BBC Politics')) {
        category = 'POLITICS';
      } else if (sourceName.includes('BBC Sport')) {
        category = 'SPORT';
      } else if (sourceName.includes('BBC Entertainment')) {
        category = 'ENTERTAINMENT';
      }
      
      // Use extracted author or fallback to original author from RSS
      const finalAuthor = author || newsArticle.author || null;

      // Use normalized URL for storage (prevents duplicates with URL variations)
      const urlToStore = normalizedUrl || newsArticle.url || null;

      // Create article with pending status using transaction to prevent race conditions
      // If another process creates the same article between our duplicate check and create,
      // the unique constraint will catch it
      let article;
      try {
        article = await prisma.$transaction(async (tx) => {
          // Double-check for duplicates within transaction (prevents race condition)
          if (urlToStore) {
            const existingInTx = await tx.article.findFirst({
              where: {
                sourceUrl: urlToStore
              },
              select: {
                id: true
              }
            });
            
            if (existingInTx) {
              throw new Error('DUPLICATE_DETECTED_IN_TX');
            }
          }
          
          // Create article
          return await tx.article.create({
            data: {
              title: newsArticle.title.trim(),
              content: cleanedContent,
              category: category.toUpperCase(),
              sourceUrl: urlToStore, // Use normalized URL
              sourceName: newsArticle.sourceName || 'Automated News',
              pointsValue: 10, // Default points value
              isFeatured: false,
              imageUrl: imageUrl,
              imageData: null, // We use imageUrl instead of base64
              imageType: imageUrl ? 'url' : null,
              status: 'pending', // Always pending for admin review
              authorId: authorId, // Can be null if no admin exists
              publishedAt: null, // Will be set when admin approves
              originalAuthor: finalAuthor, // Author from RSS or article page
              originalPublishedAt: newsArticle.publishedAt || null // Original publication date from source
            }
          });
        }, {
          maxWait: 10000, // 10 seconds max wait to acquire transaction
          timeout: 20000, // 20 seconds timeout for transaction execution
        });
        
        console.log(`✅ Created article: ${article.title.substring(0, 50)}... (ID: ${article.id})`);
      } catch (error) {
        // Handle duplicate detected in transaction or unique constraint violation
        if (error.message === 'DUPLICATE_DETECTED_IN_TX' || error.code === 'P2002') {
          console.log(`⏭️  Skipping duplicate article (race condition caught): ${newsArticle.title.substring(0, 50)}...`);
          return {
            success: false,
            reason: 'duplicate',
            article: null
          };
        }
        // Handle transaction timeout - treat as potential duplicate or retry
        if (error.code === 'P2028') {
          console.log(`⏭️  Transaction timeout (likely duplicate or database busy): ${newsArticle.title.substring(0, 50)}...`);
          // Check one more time if it's a duplicate
          const isDup = await this.isDuplicate(normalizedUrl || newsArticle.url, newsArticle.title);
          if (isDup) {
            return {
              success: false,
              reason: 'duplicate',
              article: null
            };
          }
          // If not duplicate, return error (database might be busy)
          return {
            success: false,
            reason: 'error',
            error: 'Transaction timeout - database may be busy',
            article: null
          };
        }
        throw error; // Re-throw other errors
      }

      return {
        success: true,
        article: article,
        reason: 'created'
      };
    } catch (error) {
      console.error('Error processing article:', error);
      return {
        success: false,
        reason: 'error',
        error: error.message,
        article: null
      };
    }
  }

  /**
   * Process multiple articles
   * For SPORT category: Limits to 5 articles WITH IMAGES per ESPN category
   * Flow: Fetch more articles → Filter by image → Limit to 5 per category
   */
  async processArticles(newsArticles, category = null) {
    const results = {
      total: newsArticles.length,
      created: 0,
      duplicates: 0,
      errors: 0,
      skipped: 0,
      articles: []
    };

    // Track articles created per source for categories with per-source limits (SPORT, BUSINESS, WEATHER, TECHNOLOGY, SCIENCE, ENTERTAINMENT, DEFI, POLITICS, FINANCE, HEALTH)
    const createdBySource = {};
    
    for (const newsArticle of newsArticles) {
      const sourceName = newsArticle.sourceName || 'Unknown';
      
      // For SPORT category: Check if we've already reached limit for this source
      if (category === 'SPORT') {
        // Get custom limit from article if specified, otherwise use default (5)
        const customLimit = newsArticle.maxArticles || null;
        const limit = customLimit || 5;
        
        if (sourceName.includes('ESPN')) {
          const count = createdBySource[sourceName] || 0;
          if (count >= limit) {
            // Already have enough articles with images from this ESPN category, skip
            results.skipped++;
            continue;
          }
        } else if (sourceName.includes('BBC')) {
          const count = createdBySource[sourceName] || 0;
          if (count >= limit) {
            // Already have enough articles with images from BBC Sport, skip
            results.skipped++;
            continue;
          }
        }
      }
      
      // For BUSINESS category: Check if we've already reached limit for this source
      if (category === 'BUSINESS') {
        // Get custom limit from article if specified, otherwise use default (5)
        const customLimit = newsArticle.maxArticles || null;
        const limit = customLimit || 5;
        
        const count = createdBySource[sourceName] || 0;
        if (count >= limit) {
          // Already have enough articles with images from this business source, skip
          results.skipped++;
          continue;
        }
      }
      
      // For WEATHER category: Check if we've already reached limit for this source
      if (category === 'WEATHER') {
        // Get custom limit from article if specified, otherwise use default (5)
        const customLimit = newsArticle.maxArticles || null;
        const limit = customLimit || 5;
        
        const count = createdBySource[sourceName] || 0;
        if (count >= limit) {
          // Already have enough articles with images from this weather source, skip
          results.skipped++;
          continue;
        }
      }
      
      // For TECHNOLOGY category: Check if we've already reached limit for this source
      if (category === 'TECHNOLOGY') {
        // Get custom limit from article if specified, otherwise use default (5)
        const customLimit = newsArticle.maxArticles || null;
        const limit = customLimit || 5;
        
        const count = createdBySource[sourceName] || 0;
        if (count >= limit) {
          // Already have enough articles with images from this technology source, skip
          results.skipped++;
          continue;
        }
      }
      
      // For SCIENCE category: Check if we've already reached limit for this source
      if (category === 'SCIENCE') {
        // Get custom limit from article if specified, otherwise use default (5)
        const customLimit = newsArticle.maxArticles || null;
        const limit = customLimit || 5;
        
        const count = createdBySource[sourceName] || 0;
        if (count >= limit) {
          // Already have enough articles with images from this science source, skip
          results.skipped++;
          continue;
        }
      }
      
      // For ENTERTAINMENT category: Check if we've already reached limit for this source
      if (category === 'ENTERTAINMENT') {
        // Get custom limit from article if specified, otherwise use default (5)
        const customLimit = newsArticle.maxArticles || null;
        const limit = customLimit || 5;
        
        const count = createdBySource[sourceName] || 0;
        if (count >= limit) {
          // Already have enough articles with images from this entertainment source, skip
          results.skipped++;
          continue;
        }
      }
      
      // For DEFI category: Check if we've already reached limit for this source
      if (category === 'DEFI') {
        // Get custom limit from article if specified, otherwise use default (5)
        const customLimit = newsArticle.maxArticles || null;
        const limit = customLimit || 5;
        
        const count = createdBySource[sourceName] || 0;
        if (count >= limit) {
          // Already have enough articles with images from this crypto source, skip
          results.skipped++;
          continue;
        }
      }
      
      // For POLITICS category: Check if we've already reached limit for this source
      if (category === 'POLITICS') {
        // Get custom limit from article if specified, otherwise use default (5)
        const customLimit = newsArticle.maxArticles || null;
        const limit = customLimit || 5;
        
        const count = createdBySource[sourceName] || 0;
        if (count >= limit) {
          // Already have enough articles with images from this politics source, skip
          results.skipped++;
          continue;
        }
      }
      
      // For FINANCE category: Check if we've already reached limit for this source
      if (category === 'FINANCE') {
        // Get custom limit from article if specified, otherwise use default (5)
        const customLimit = newsArticle.maxArticles || null;
        const limit = customLimit || 5;
        
        const count = createdBySource[sourceName] || 0;
        if (count >= limit) {
          // Already have enough articles with images from this finance source, skip
          results.skipped++;
          continue;
        }
      }
      
      // For HEALTH category: Check if we've already reached limit for this source
      if (category === 'HEALTH') {
        // Get custom limit from article if specified, otherwise use default (5)
        const customLimit = newsArticle.maxArticles || null;
        const limit = customLimit || 5;
        
        const count = createdBySource[sourceName] || 0;
        if (count >= limit) {
          // Already have enough articles with images from this health source, skip
          results.skipped++;
          continue;
        }
      }

      // Process article (this will check for image and skip if no image)
      const result = await this.processArticle(newsArticle);

      if (result.success) {
        results.created++;
        results.articles.push(result.article);
        
        // Track successful articles per source (only count created articles, not skipped)
        if (category === 'SPORT' || category === 'BUSINESS' || category === 'WEATHER' || category === 'TECHNOLOGY' || category === 'SCIENCE' || category === 'ENTERTAINMENT' || category === 'DEFI' || category === 'POLITICS' || category === 'FINANCE' || category === 'HEALTH') {
          createdBySource[sourceName] = (createdBySource[sourceName] || 0) + 1;
        }
      } else if (result.reason === 'duplicate') {
        results.duplicates++;
      } else if (result.reason === 'insufficient_content') {
        results.skipped++;
      } else if (result.reason === 'no_image') {
        results.skipped++;
        // Note: no_image articles don't count toward the 5-per-category limit
        // We continue processing to find articles WITH images
      } else {
        results.errors++;
      }

      // Delay to avoid overwhelming database and web servers
      // Longer delay when scraping (2 seconds) to be respectful
      const delay = newsArticle.url ? 2000 : 100;
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Log summary for SPORT category
    if (category === 'SPORT') {
      console.log(`\n📊 SPORT Category Summary:`);
      Object.entries(createdBySource).forEach(([source, count]) => {
        console.log(`   ${source}: ${count} articles created`);
      });
    }

    return results;
  }

  /**
   * Get statistics about processed articles
   */
  async getProcessingStats() {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const stats = {
        totalPending: await prisma.article.count({
          where: {
            status: 'pending',
            sourceName: {
              contains: 'Automated'
            }
          }
        }),
        todayCreated: await prisma.article.count({
          where: {
            status: 'pending',
            createdAt: {
              gte: today
            },
            sourceName: {
              contains: 'Automated'
            }
          }
        }),
        totalPublished: await prisma.article.count({
          where: {
            status: 'published',
            sourceName: {
              contains: 'Automated'
            }
          }
        })
      };

      return stats;
    } catch (error) {
      console.error('Error getting processing stats:', error);
      return {
        totalPending: 0,
        todayCreated: 0,
        totalPublished: 0
      };
    }
  }
}

// Singleton instance
const articleProcessor = new ArticleProcessor();

module.exports = articleProcessor;

