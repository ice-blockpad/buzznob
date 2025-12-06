/**
 * Article Processor Service
 * Processes news articles and creates them in the database with pending status
 * Handles duplicate detection, image processing, and content formatting
 */

const { prisma } = require('../config/database');
const axios = require('axios');
const articleScraper = require('./articleScraper');

class ArticleProcessor {
  /**
   * Check if article already exists (duplicate detection)
   */
  async isDuplicate(sourceUrl) {
    if (!sourceUrl) return false;

    try {
      const existing = await prisma.article.findFirst({
        where: {
          sourceUrl: sourceUrl
        },
        select: {
          id: true
        }
      });

      return !!existing;
    } catch (error) {
      console.error('Error checking duplicate:', error);
      return false; // On error, assume not duplicate (fail open)
    }
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
   * Clean and format article content
   */
  cleanContent(content) {
    if (!content) return '';

    // Remove HTML tags but preserve line breaks
    let cleaned = content
      .replace(/<[^>]+>/g, ' ') // Remove HTML tags
      .replace(/\s*\.\.\.\s*\[\+\d+\s*chars?\]/gi, '') // Remove truncated indicators like "... [+6712 chars]"
      .replace(/\s*\[Note:.*?\]/gi, '') // Remove notes like "[Note: This is a summary...]"
      .replace(/\s*Source:\s*https?:\/\/[^\s]+/gi, '') // Remove source URLs
      .replace(/\s*Read the full article at:\s*https?:\/\/[^\s]+/gi, '') // Remove "Read the full article" notes
      .replace(/\s*\[Read more.*?\]/gi, '') // Remove "[Read more...]" links
      .replace(/\s*\[Article truncated.*?\]/gi, '') // Remove truncation notes
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();

    // If content is very short, it might be just a summary
    // We'll keep it as is since news APIs typically only provide summaries
    // The sourceUrl will allow users to read the full article

    // Limit content length (optional - adjust as needed)
    // Increased to 50000 to allow full articles
    const maxLength = 50000;
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
   */
  async processArticle(newsArticle) {
    try {
      // Validate required fields
      if (!newsArticle.title || !newsArticle.content) {
        throw new Error('Article missing required fields (title or content)');
      }

      // Check for duplicates
      if (newsArticle.url) {
        const isDup = await this.isDuplicate(newsArticle.url);
        if (isDup) {
          console.log(`⏭️  Skipping duplicate article: ${newsArticle.title.substring(0, 50)}...`);
          return {
            success: false,
            reason: 'duplicate',
            article: null
          };
        }
      }

      // Get enhanced content (try to fetch full content, ensure minimum 1000 chars)
      console.log(`📄 Enhancing content for: ${newsArticle.title.substring(0, 50)}...`);
      const enhancedContent = await articleScraper.enhanceArticleContent({
        url: newsArticle.url,
        content: newsArticle.content,
        description: newsArticle.description
      });

      // Clean and format content
      const cleanedContent = this.cleanContent(enhancedContent);
      
      // Check minimum length (at least 1000 characters preferred, but allow shorter if that's all we have)
      if (cleanedContent.length < 200) {
        // Content too short, skip
        console.log(`⏭️  Skipping article with insufficient content: ${newsArticle.title.substring(0, 50)}... (${cleanedContent.length} chars)`);
        return {
          success: false,
          reason: 'insufficient_content',
          article: null
        };
      }

      // Log if content is less than preferred minimum
      if (cleanedContent.length < 1000) {
        console.log(`⚠️  Content shorter than preferred (${cleanedContent.length} chars, preferred: 1000+): ${newsArticle.title.substring(0, 50)}...`);
      }

      // Process image
      let imageUrl = await this.processImage(newsArticle.imageUrl);
      
      // Get author (from RSS or article page)
      let author = newsArticle.author;
      
      // SKIP ARTICLES WITHOUT IMAGES (as per requirement)
      // First try to get image from article page if not in RSS
      if (!imageUrl && newsArticle.url) {
        const articleScraper = require('./articleScraper');
        console.log(`🖼️  No image in RSS, fetching from article page: ${newsArticle.url.substring(0, 60)}...`);
        const fetchedImageUrl = await articleScraper.fetchImageFromURL(newsArticle.url);
        if (fetchedImageUrl) {
          imageUrl = fetchedImageUrl;
          console.log(`✅ Found image: ${imageUrl}`);
        }
      }
      
      // Skip article if still no image
      if (!imageUrl) {
        console.log(`⏭️  Skipping article without image: ${newsArticle.title.substring(0, 50)}...`);
        return {
          success: false,
          reason: 'no_image',
          article: null
        };
      }
      
      // Fetch author from article page if not in RSS
      if (!author && newsArticle.url) {
        const articleScraper = require('./articleScraper');
        console.log(`👤 Fetching author from article page: ${newsArticle.url.substring(0, 60)}...`);
        const fetchedAuthor = await articleScraper.fetchAuthorFromURL(newsArticle.url);
        if (fetchedAuthor) {
          author = fetchedAuthor;
          console.log(`✅ Found author: ${author}`);
        } else {
          console.log(`⚠️  No author found on article page`);
        }
      }

      // Get system admin ID (optional - can be null)
      const authorId = await this.getSystemAdminId();

      // Determine category
      const category = newsArticle.category || 'GENERAL';
      
      // Use extracted author or fallback to original author from RSS
      const finalAuthor = author || newsArticle.author || null;

      // Create article with pending status
      const article = await prisma.article.create({
        data: {
          title: newsArticle.title.trim(),
          content: cleanedContent,
          category: category.toUpperCase(),
          sourceUrl: newsArticle.url || null,
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

      console.log(`✅ Created article: ${article.title.substring(0, 50)}... (ID: ${article.id})`);

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

    // For SPORT category, track articles created per source to limit to 5 per ESPN category
    const createdBySource = {};
    
    for (const newsArticle of newsArticles) {
      const sourceName = newsArticle.sourceName || 'Unknown';
      
      // For SPORT category: Check if we've already reached limit for this source
      if (category === 'SPORT') {
        if (sourceName.includes('ESPN')) {
          const count = createdBySource[sourceName] || 0;
          if (count >= 5) {
            // Already have 5 articles with images from this ESPN category, skip
            results.skipped++;
            continue;
          }
        } else if (sourceName.includes('BBC')) {
          const count = createdBySource[sourceName] || 0;
          if (count >= 5) {
            // Already have 5 articles with images from BBC Sport, skip
            results.skipped++;
            continue;
          }
        }
      }

      // Process article (this will check for image and skip if no image)
      const result = await this.processArticle(newsArticle);

      if (result.success) {
        results.created++;
        results.articles.push(result.article);
        
        // Track successful articles per source (only count created articles, not skipped)
        if (category === 'SPORT') {
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

