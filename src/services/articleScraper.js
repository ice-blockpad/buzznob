/**
 * Article Scraper Service
 * Fetches full article content from source URLs
 * Falls back to summary if scraping fails
 */

const axios = require('axios');
const cheerio = require('cheerio');

class ArticleScraper {
  constructor() {
    this.timeout = 15000; // 15 second timeout
    this.minContentLength = 1000; // Minimum 1000 characters
  }

  /**
   * Extract author name from article page HTML
   * Tries multiple methods: meta tags, author selectors, byline
   */
  extractAuthorFromHTML(html, url) {
    try {
      const $ = cheerio.load(html);
      
      // Priority 1: Meta tags (most reliable)
      const metaAuthor = $('meta[name="author"]').attr('content') ||
                        $('meta[property="article:author"]').attr('content') ||
                        $('meta[name="article:author"]').attr('content') ||
                        $('meta[property="og:article:author"]').attr('content');
      if (metaAuthor) {
        const trimmed = metaAuthor.trim();
        // Filter out URLs and social media links (BBC often puts Facebook URLs here)
        if (!trimmed.match(/^https?:\/\//) && !trimmed.match(/facebook|twitter|instagram|linkedin/i)) {
          return trimmed;
        }
      }
      
      // Priority 2: JSON-LD structured data
      const jsonLdScripts = $('script[type="application/ld+json"]');
      for (let i = 0; i < jsonLdScripts.length; i++) {
        try {
          const jsonData = JSON.parse($(jsonLdScripts[i]).html());
          
          // Check direct author field
          if (jsonData.author) {
            if (typeof jsonData.author === 'string') {
              return jsonData.author.trim();
            } else if (jsonData.author.name) {
              return jsonData.author.name.trim();
            } else if (Array.isArray(jsonData.author) && jsonData.author.length > 0) {
              const firstAuthor = jsonData.author[0];
              if (typeof firstAuthor === 'string') {
                return firstAuthor.trim();
              } else if (firstAuthor.name) {
                return firstAuthor.name.trim();
              }
            }
          }
          
          // Check for @graph array (common in structured data, especially BBC)
          if (jsonData['@graph']) {
            for (const item of jsonData['@graph']) {
              if (item['@type'] === 'NewsArticle' || item['@type'] === 'Article') {
                if (item.author) {
                  if (typeof item.author === 'string') {
                    return item.author.trim();
                  } else if (item.author.name) {
                    return item.author.name.trim();
                  } else if (Array.isArray(item.author) && item.author.length > 0) {
                    const firstAuthor = item.author[0];
                    if (typeof firstAuthor === 'string') {
                      return firstAuthor.trim();
                    } else if (firstAuthor.name) {
                      return firstAuthor.name.trim();
                    }
                  }
                }
              }
            }
          }
          
          // Also check for Person type in @graph (BBC sometimes uses this)
          if (jsonData['@graph']) {
            for (const item of jsonData['@graph']) {
              if (item['@type'] === 'Person' && item.name) {
                // This might be the author
                return item.name.trim();
              }
            }
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
      
      // Priority 3: Author-specific selectors
      const urlLower = url.toLowerCase();
      
      // ESPN specific
      if (urlLower.includes('espn.com')) {
        const espnAuthor = $('[data-module="Byline"] .author').text() ||
                          $('.author').first().text() ||
                          $('[class*="author"]').first().text();
        if (espnAuthor && espnAuthor.trim().length > 0) {
          return espnAuthor.trim();
        }
      }
      
      // BBC specific - more comprehensive extraction
      if (urlLower.includes('bbc.com') || urlLower.includes('bbc.co.uk')) {
        // Priority 1: BBC uses .byline-link-text for author name (most reliable)
        const bylineLinkText = $('.byline-link-text').first();
        if (bylineLinkText.length > 0) {
          let authorText = bylineLinkText.text().trim();
          if (authorText.length > 2 && authorText.length < 100) {
            return authorText;
          }
        }
        
        // Priority 2: BBC uses [data-component="byline-block"] for full byline
        const bylineBlock = $('[data-component="byline-block"]').first();
        if (bylineBlock.length > 0) {
          let authorText = bylineBlock.text().trim();
          // BBC format: "ByAuthor NameRole/Location" or "By Author Name Role"
          // Extract author name (usually first 2-3 capitalized words after "By")
          authorText = authorText.replace(/^By\s*/i, '');
          // Match capitalized name pattern (2-3 words)
          const nameMatch = authorText.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/);
          if (nameMatch && nameMatch[1]) {
            authorText = nameMatch[1].trim();
            if (authorText.length > 2 && authorText.length < 100) {
              return authorText;
            }
          }
        }
        
        // Priority 3: Try other BBC-specific selectors
        const bbcSelectors = [
          '[data-component="byline"]',
          '[data-component="Byline"]',
          '.byline',
          '[class*="BylineComponentWrapper"]',
          '[class*="byline"]',
          '[class*="Byline"]',
          'article [data-component="byline-block"]',
          'article .byline-link-text',
          '[data-testid="byline"]'
        ];
        
        for (const selector of bbcSelectors) {
          const element = $(selector).first();
          if (element.length > 0) {
            let authorText = element.text().trim();
            // Clean up common BBC byline patterns
            authorText = authorText
              .replace(/^By\s+/i, '')
              .replace(/^BBC\s+News/i, '')
              .replace(/\s*\|.*$/, '') // Remove everything after pipe
              .replace(/\s*,\s*.*$/, '') // Remove location/role after comma
              .trim();
            
            // Extract just the name part (2-3 capitalized words)
            const nameMatch = authorText.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/);
            if (nameMatch && nameMatch[1]) {
              authorText = nameMatch[1].trim();
            }
            
            if (authorText.length > 2 && authorText.length < 100 && !authorText.match(/^(BBC|News|Sport|Technology|Business|Politics|Correspondent|Reporter|Journalist)/i)) {
              return authorText;
            }
          }
        }
        
        // Priority 4: Check for author in article header/meta
        const articleHeader = $('article header, [role="article"] header, .article-header').first();
        if (articleHeader.length > 0) {
          const headerText = articleHeader.text();
          const authorMatch = headerText.match(/By\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/);
          if (authorMatch && authorMatch[1]) {
            const author = authorMatch[1].trim();
            if (author.length > 2 && author.length < 100) {
              return author;
            }
          }
        }
      }
      
      // Generic author selectors
      const authorSelectors = [
        '.author',
        '.byline',
        '.article-author',
        '.post-author',
        '[rel="author"]',
        '[itemprop="author"]',
        '.author-name',
        '.writer',
        '.reporter',
        'article .author',
        'article .byline'
      ];
      
      for (const selector of authorSelectors) {
        const authorElement = $(selector).first();
        if (authorElement.length > 0) {
          let authorText = authorElement.text().trim();
          // Clean up common prefixes
          authorText = authorText.replace(/^(By|Author|Writer|Reporter|Byline)[:\s]+/i, '').trim();
          if (authorText.length > 0 && authorText.length < 100) {
            return authorText;
          }
        }
      }
      
      // Priority 4: Look for author in article content (first paragraph sometimes has "By Author Name")
      const firstParagraph = $('article p, .article p, .content p').first().text();
      if (firstParagraph) {
        const byMatch = firstParagraph.match(/^By\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/);
        if (byMatch && byMatch[1]) {
          const author = byMatch[1].trim();
          if (author.length > 2 && author.length < 100) {
            return author;
          }
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error extracting author from HTML:', error);
      return null;
    }
  }

  /**
   * Extract image URL from article page HTML
   * Tries multiple methods: og:image, article image, first large image
   */
  extractImageFromHTML(html, url) {
    try {
      const $ = cheerio.load(html);
      
      // Priority 1: Open Graph image (most reliable)
      const ogImage = $('meta[property="og:image"]').attr('content') || 
                      $('meta[name="og:image"]').attr('content');
      if (ogImage) {
        // Make absolute URL if relative
        try {
          return new URL(ogImage, url).href;
        } catch {
          return ogImage.startsWith('http') ? ogImage : null;
        }
      }
      
      // Priority 2: Twitter card image
      const twitterImage = $('meta[name="twitter:image"]').attr('content') ||
                          $('meta[property="twitter:image"]').attr('content');
      if (twitterImage) {
        try {
          return new URL(twitterImage, url).href;
        } catch {
          return twitterImage.startsWith('http') ? twitterImage : null;
        }
      }
      
      // Priority 3: Article-specific image selectors
      const urlLower = url.toLowerCase();
      
      // ESPN specific
      if (urlLower.includes('espn.com')) {
        const espnImage = $('meta[name="image"]').attr('content') ||
                         $('img[class*="Image"]').first().attr('src') ||
                         $('img[class*="image"]').first().attr('src');
        if (espnImage) {
          try {
            return new URL(espnImage, url).href;
          } catch {
            return espnImage.startsWith('http') ? espnImage : null;
          }
        }
      }
      
      // Priority 4: First large image in article content
      const articleImages = $('article img, .article img, .content img, main img')
        .filter((i, el) => {
          const src = $(el).attr('src');
          if (!src) return false;
          // Skip small images (likely icons/avatars)
          const width = $(el).attr('width');
          const height = $(el).attr('height');
          if (width && parseInt(width) < 200) return false;
          if (height && parseInt(height) < 200) return false;
          // Skip data URIs and placeholders
          if (src.startsWith('data:') || src.includes('placeholder') || src.includes('logo')) return false;
          return true;
        })
        .map((i, el) => {
          const src = $(el).attr('src');
          try {
            return new URL(src, url).href;
          } catch {
            return src.startsWith('http') ? src : null;
          }
        })
        .get()
        .filter(Boolean);
      
      if (articleImages.length > 0) {
        return articleImages[0];
      }
      
      return null;
    } catch (error) {
      console.error('Error extracting image from HTML:', error);
      return null;
    }
  }

  /**
   * Extract main content from HTML
   */
  extractContent(html, url) {
    try {
      const $ = cheerio.load(html);
      
      // Remove all non-content elements aggressively
      $('script, style, nav, header, footer, aside, .advertisement, .ad, .ads, .advert, .sidebar, .comments, .social-share, .social-media, .share-buttons, .newsletter, .subscribe, .related-articles, .recommended, .trending, .popular, .tags, .categories, .author-bio, .author-info, .byline, .metadata, .breadcrumb, .navigation, .menu, .search, .cookie, .privacy, .terms, .copyright, .footer, .header, iframe, noscript, form, button, input, select, textarea').remove();
      
      // Remove common junk selectors (by class/id patterns)
      $('[class*="ad"], [class*="advert"], [id*="ad"], [id*="advert"], [class*="sponsor"], [class*="promo"], [class*="banner"], [class*="popup"], [class*="modal"], [class*="overlay"], [class*="cookie"], [class*="privacy"], [class*="terms"], [class*="copyright"], [class*="footer"], [class*="header"], [class*="nav"], [class*="menu"], [class*="search"], [class*="subscribe"], [class*="newsletter"]').remove();
      
      // Remove MarketWatch and common news site junk
      $('.site-search, .search-results, .symbols, .authors, .sections, .columns, .back-to-top, .copyright, .terms, .privacy, .cookie, .archive, .customer-center, .contact, .newsroom, .virtual-stock, .guides, .policy, .notifications, .subscription, .company, .code, .corrections, .reprints, .licensing, .digital, .ad-choices, .corporate, .accessibility, .network, .dow-jones, .intraday-data, .historical-data, .real-time, .last-sale, .stock-quotes, .trades, .nasdaq, .delayed, [class*="marketwatch"], [class*="dow-jones"]').remove();
      
      // Remove elements that contain only navigation-like text
      $('*').each((i, el) => {
        const $el = $(el);
        const text = $el.text().trim().toLowerCase();
        // Remove elements that are clearly navigation/footer
        if (text.match(/^(site search|search results|no results found|symbols|authors|sections|columns|back to top|copyright|terms of use|privacy notice|cookie notice|archive|customer center|contact us|newsroom|virtual stock|marketwatch guides|copyright policy|manage notifications|cancel my subscription|company|dow jones|code of conduct|corrections|reprints|licensing|digital self service|your ad choices|corporate subscriptions|accessibility|dow jones network|the wall street journal|barron|investor|financial news|realtor|mansion global|intraday data|historical|real-time|last sale|stock quotes|trades|nasdaq|delayed)/)) {
          $el.remove();
        }
      });
      
      // Try common article content selectors (in order of preference)
      // Site-specific selectors first for better accuracy
      const urlLower = url.toLowerCase();
      let contentSelectors = [];
      
      // Washington Post specific
      if (urlLower.includes('washingtonpost.com')) {
        contentSelectors = [
          'article[itemprop="articleBody"]',
          '.article-body',
          '[data-module="ArticleBody"]',
          '.article-content',
          'article .body',
          'article'
        ];
      }
      // BBC specific
      else if (urlLower.includes('bbc.com') || urlLower.includes('bbc.co.uk')) {
        contentSelectors = [
          'article[data-component="text-block"]',
          '[data-component="text-block"]',
          '.story-body',
          'article',
          '.article-body'
        ];
      }
      // CNN specific
      else if (urlLower.includes('cnn.com')) {
        contentSelectors = [
          '.article__content',
          '.l-container',
          'article',
          '.zn-body__paragraph'
        ];
      }
      // Reuters specific
      else if (urlLower.includes('reuters.com')) {
        contentSelectors = [
          '[class*="ArticleBodyWrapper"]',
          '.article-body',
          'article'
        ];
      }
      // TechCrunch specific
      else if (urlLower.includes('techcrunch.com')) {
        contentSelectors = [
          '.article-content',
          '.entry-content',
          'article'
        ];
      }
      // Generic selectors (fallback)
      else {
        contentSelectors = [
          'article[itemprop="articleBody"]',
          'article',
          '[role="article"]',
          '.article-content',
          '.article-body',
          '.post-content',
          '.entry-content',
          '.content',
          '.story-body',
          '.article-text',
          '.article-main',
          '.article-wrapper',
          '.post-body',
          '.entry-body',
          '.story-content',
          '.article-content-wrapper',
          'main article',
          'main .content',
          '#article-content',
          '#article-body',
          '#main-content',
          '.article',
          '.story',
          '.post'
        ];
      }

      let content = '';
      let bestContent = '';
      let bestLength = 0;
      
      for (const selector of contentSelectors) {
        const element = $(selector).first();
        if (element.length > 0) {
          // Clone to avoid modifying original
          const $clone = element.clone();
          
          // Remove remaining junk from this element
          $clone.find('script, style, nav, header, footer, aside, .ad, .advertisement, .sidebar, .comments, .social-share, .related, .recommended, .trending, .popular, .tags, .author-bio, .byline, .metadata, iframe').remove();
          
          const text = $clone.text();
          const cleaned = this.cleanExtractedText(text);
          
          // Prefer content that's substantial but not too long (likely to be the actual article)
          if (cleaned.length >= this.minContentLength && cleaned.length < 50000) {
            content = cleaned;
            break;
          } else if (cleaned.length > bestLength && cleaned.length >= 500) {
            bestContent = cleaned;
            bestLength = cleaned.length;
          }
        }
      }

      // If we found good content, use it
      if (content.length >= this.minContentLength) {
        return content;
      }
      
      // If we found decent content, use it
      if (bestContent.length >= 500) {
        return bestContent;
      }

      // Last resort: try to extract from main or body, but be very selective
      $('nav, header, footer, aside, .ad, .advertisement, .sidebar, .comments, .social-share, .related, .recommended, .trending, .popular, .tags, .author-bio, .byline, .metadata, iframe, script, style').remove();
      
      // Try to find the largest text block (likely the article)
      // Only extract paragraphs that look like article content
      const paragraphs = $('p').filter((i, el) => {
        const text = $(el).text().trim();
        // Must have substantial text
        if (text.length < 50) return false;
        // Must not be navigation/footer text
        const lowerText = text.toLowerCase();
        if (lowerText.match(/^(site search|search results|no results|symbols|authors|sections|columns|back to top|copyright|terms|privacy|cookie|archive|customer|contact|newsroom|virtual|guides|policy|notifications|subscription|company|dow jones|code|corrections|reprints|licensing|digital|ad choices|corporate|accessibility|network|intraday|historical|real-time|last sale|stock quotes|trades|nasdaq|delayed|marketwatch|wall street|barron|investor|financial news|realtor|mansion|smart money|subscribe|sign up|newsletter|follow us|share this|read more|related articles|you may also like)/)) {
          return false;
        }
        // Must have reasonable word count (not just numbers/symbols)
        const words = text.split(/\s+/).filter(w => w.length > 1);
        if (words.length < 5) return false;
        // Check if it's likely article content (has sentences)
        if (!text.match(/[.!?]/)) return false;
        return true;
      });
      
      if (paragraphs.length > 0) {
        const articleText = paragraphs.map((i, el) => $(el).text().trim()).get().join('\n\n');
        const cleaned = this.cleanExtractedText(articleText);
        if (cleaned.length >= 500) {
          return cleaned;
        }
      }

      return '';
    } catch (error) {
      console.error('Error extracting content from HTML:', error);
      return '';
    }
  }

  /**
   * Clean extracted text to remove junk and format properly
   */
  cleanExtractedText(text) {
    if (!text) return '';
    
    // Remove common junk patterns
    let cleaned = text
      // Remove copyright notices
      .replace(/Copyright\s*©\s*\d{4}.*?$/gmi, '')
      .replace(/©\s*\d{4}.*?$/gmi, '')
      // Remove "Last Updated", "First Published" etc.
      .replace(/Last\s+Updated:.*?$/gmi, '')
      .replace(/First\s+Published:.*?$/gmi, '')
      .replace(/Updated:.*?$/gmi, '')
      .replace(/Published:.*?$/gmi, '')
      // Remove "Share", "Resize", "Listen" etc.
      .replace(/^(Share|Resize|Listen|Print|Email).*?$/gmi, '')
      // Remove "About the Author" sections
      .replace(/About\s+the\s+Author.*?$/gsi, '')
      .replace(/Show\s+Conversation.*?$/gmi, '')
      .replace(/Back\s+To\s+Top.*?$/gmi, '')
      // Remove "Terms of Use", "Privacy Notice" etc.
      .replace(/Terms\s+of\s+Use.*?$/gmi, '')
      .replace(/Privacy\s+Notice.*?$/gmi, '')
      .replace(/Cookie\s+Notice.*?$/gmi, '')
      .replace(/Archive.*?$/gmi, '')
      .replace(/Customer\s+Center.*?$/gmi, '')
      .replace(/Contact\s+Us.*?$/gmi, '')
      .replace(/Newsroom.*?$/gmi, '')
      .replace(/Virtual\s+Stock.*?$/gmi, '')
      .replace(/MarketWatch\s+Guides.*?$/gmi, '')
      .replace(/Copyright\s+Policy.*?$/gmi, '')
      .replace(/Manage\s+Notifications.*?$/gmi, '')
      .replace(/Cancel\s+My\s+Subscription.*?$/gmi, '')
      .replace(/Company.*?$/gmi, '')
      .replace(/Dow\s+Jones.*?$/gmi, '')
      .replace(/Code\s+of\s+Conduct.*?$/gmi, '')
      .replace(/Corrections.*?$/gmi, '')
      .replace(/Reprints.*?$/gmi, '')
      .replace(/Licensing.*?$/gmi, '')
      .replace(/Digital\s+Self\s+Service.*?$/gmi, '')
      .replace(/Your\s+Ad\s+Choices.*?$/gmi, '')
      .replace(/Corporate\s+Subscriptions.*?$/gmi, '')
      .replace(/Accessibility.*?$/gmi, '')
      .replace(/Dow\s+Jones\s+Network.*?$/gmi, '')
      .replace(/The\s+Wall\s+Street\s+Journal.*?$/gmi, '')
      .replace(/Barron's.*?$/gmi, '')
      .replace(/Investor's\s+Business\s+Daily.*?$/gmi, '')
      .replace(/Financial\s+News.*?$/gmi, '')
      .replace(/realtor\.com.*?$/gmi, '')
      .replace(/Mansion\s+Global.*?$/gmi, '')
      .replace(/Dow\s+Jones\s+Smart\s+Money.*?$/gmi, '')
      .replace(/Intraday\s+Data.*?$/gmi, '')
      .replace(/Historical\s+and\s+current.*?$/gmi, '')
      .replace(/Real-time\s+last\s+sale.*?$/gmi, '')
      .replace(/All\s+quotes.*?$/gmi, '')
      .replace(/Intraday\s+data\s+delayed.*?$/gmi, '')
      // Remove "Site Search", "No results found" etc.
      .replace(/Site\s+Search.*?$/gmi, '')
      .replace(/Search\s+Results.*?$/gmi, '')
      .replace(/No\s+results\s+found.*?$/gmi, '')
      .replace(/\d+\s+Results.*?$/gmi, '')
      // Remove email patterns that are likely junk
      .replace(/\b[\w\.-]+@[\w\.-]+\.\w+\b/g, '')
      // Remove URLs
      .replace(/https?:\/\/[^\s]+/g, '')
      // Remove excessive whitespace
      .replace(/\s+/g, ' ')
      // Remove multiple periods/ellipses
      .replace(/\.{3,}/g, '...')
      // Normalize line breaks
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      .trim();

    // Split into sentences and clean up
    const sentences = cleaned.split(/[.!?]+\s+/).filter(s => {
      const sTrimmed = s.trim();
      // Filter out very short sentences (likely junk)
      if (sTrimmed.length < 15) return false;
      // Filter out sentences that are mostly numbers or symbols
      if (sTrimmed.match(/^[\d\s\W]+$/)) return false;
      // Filter out sentences that look like navigation/footer
      const navPatterns = /^(Home|About|Contact|Search|Login|Sign|Subscribe|Follow|Share|Like|Tweet|Site Search|No results|Symbols|Authors|Sections|Columns|Back To Top|Copyright|Terms|Privacy|Cookie|Archive|Customer|Contact|Newsroom|Virtual|Guides|Policy|Notifications|Subscription|Company|Dow Jones|Code|Corrections|Reprints|Licensing|Digital|Ad Choices|Corporate|Accessibility|Network|Intraday|Historical|Real-time|Last sale|Stock quotes|Trades|Nasdaq|Delayed|MarketWatch|Wall Street|Barron|Investor|Financial News|realtor|Mansion|Smart Money)/i;
      if (sTrimmed.match(navPatterns)) return false;
      // Filter out sentences that are mostly links/URLs
      if (sTrimmed.match(/^(http|www\.|\.com|\.org|\.net)/i)) return false;
      // Filter out sentences with too many special characters (likely code/junk)
      const specialCharRatio = (sTrimmed.match(/[^\w\s]/g) || []).length / sTrimmed.length;
      if (specialCharRatio > 0.3) return false;
      return true;
    });

    // Join sentences back with proper punctuation
    cleaned = sentences
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .join('. ')
      .replace(/\.\s*\./g, '.') // Remove double periods
      .trim();

    // Ensure it ends with punctuation
    if (cleaned && !cleaned.match(/[.!?]$/)) {
      cleaned += '.';
    }

    return cleaned;
  }

  /**
   * Fetch image from article page
   */
  async fetchImageFromURL(url) {
    if (!url) return null;

    try {
      const urlObj = new URL(url);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return null;
      }

      const response = await axios.get(url, {
        timeout: this.timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        maxRedirects: 5,
        validateStatus: (status) => status < 500
      });

      if (response.status !== 200) {
        return null;
      }

      return this.extractImageFromHTML(response.data, url);
    } catch (error) {
      console.warn(`⚠️  Error fetching image from ${url.substring(0, 50)}...: ${error.message}`);
      return null;
    }
  }

  /**
   * Fetch author from article page
   */
  async fetchAuthorFromURL(url) {
    if (!url) return null;

    try {
      const urlObj = new URL(url);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return null;
      }

      const response = await axios.get(url, {
        timeout: this.timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        maxRedirects: 5,
        validateStatus: (status) => status < 500
      });

      if (response.status !== 200) {
        return null;
      }

      return this.extractAuthorFromHTML(response.data, url);
    } catch (error) {
      console.warn(`⚠️  Error fetching author from ${url.substring(0, 50)}...: ${error.message}`);
      return null;
    }
  }

  /**
   * Fetch full article content from URL
   */
  async fetchFullContent(url, fallbackContent = '') {
    if (!url) {
      return fallbackContent;
    }

    try {
      // Validate URL
      const urlObj = new URL(url);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return fallbackContent;
      }

      console.log(`📄 Fetching full content from: ${url.substring(0, 80)}...`);

      // Fetch the article page with better headers to avoid blocking
      const response = await axios.get(url, {
        timeout: this.timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Cache-Control': 'max-age=0',
          'Referer': 'https://www.google.com/'
        },
        maxRedirects: 5,
        validateStatus: (status) => status < 500 // Don't throw on 4xx errors
      });

      if (response.status !== 200) {
        console.warn(`⚠️  Failed to fetch ${url}: Status ${response.status}`);
        return fallbackContent;
      }

      // Extract content from HTML
      const fullContent = this.extractContent(response.data, url);

      // If we got good content (at least min length), return it
      if (fullContent.length >= this.minContentLength) {
        console.log(`✅ Extracted ${fullContent.length} characters from ${url.substring(0, 50)}...`);
        return fullContent;
      } else if (fullContent.length > 0) {
        // If we got some content but not enough, combine with fallback
        const combined = `${fullContent}\n\n${fallbackContent}`.trim();
        if (combined.length >= this.minContentLength) {
          console.log(`✅ Combined content: ${combined.length} characters`);
          return combined;
        }
      }

      // If scraping didn't yield enough content, return fallback
      console.warn(`⚠️  Scraped content too short (${fullContent.length} chars), using fallback`);
      return fallbackContent;

    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        console.warn(`⏱️  Timeout fetching ${url.substring(0, 50)}...`);
      } else if (error.response) {
        console.warn(`⚠️  HTTP ${error.response.status} fetching ${url.substring(0, 50)}...`);
      } else {
        console.warn(`⚠️  Error fetching ${url.substring(0, 50)}...: ${error.message}`);
      }
      
      // Return fallback content on any error
      return fallbackContent;
    }
  }

  /**
   * Enhance article content (try to get full content, ensure minimum length)
   */
  async enhanceArticleContent(article) {
    const { url, content: currentContent, description } = article;

    // If we already have enough content, return as is (but clean it)
    if (currentContent && currentContent.length >= this.minContentLength) {
      // Clean up all truncation indicators and notes
      return currentContent
        .replace(/\s*\.\.\.\s*\[\+\d+\s*chars?\]/gi, '')
        .replace(/\s*\[Note:.*?\]/gi, '')
        .replace(/\s*Source:\s*https?:\/\/[^\s]+/gi, '')
        .replace(/\s*Read the full article at:\s*https?:\/\/[^\s]+/gi, '')
        .trim();
    }

    // Prepare fallback content (use description if content is short)
    const fallback = currentContent || description || '';
    const cleanedFallback = fallback
      .replace(/\s*\.\.\.\s*\[\+\d+\s*chars?\]/gi, '')
      .replace(/\s*\[Note:.*?\]/gi, '')
      .replace(/\s*Source:\s*https?:\/\/[^\s]+/gi, '')
      .replace(/\s*Read the full article at:\s*https?:\/\/[^\s]+/gi, '')
      .trim();

    // If fallback is already long enough, return it
    if (cleanedFallback.length >= this.minContentLength) {
      return cleanedFallback;
    }

    // Try to fetch full content from URL
    if (url) {
      const fullContent = await this.fetchFullContent(url, cleanedFallback);
      
      // Ensure we have at least minimum length
      if (fullContent.length >= this.minContentLength) {
        return fullContent;
      } else if (fullContent.length > cleanedFallback.length) {
        // Use the longer content even if it's not quite 1000 chars
        return fullContent;
      }
    }

    // Clean up any remaining truncation indicators and notes
    let finalContent = cleanedFallback;
    
    // Remove all truncation indicators
    finalContent = finalContent
      .replace(/\s*\.\.\.\s*\[\+\d+\s*chars?\]/gi, '')
      .replace(/\s*\[Note:.*?\]/gi, '')
      .replace(/\s*Source:.*?$/gmi, '')
      .replace(/\s*Read the full article at:.*?$/gmi, '')
      .replace(/\s*\[Read more.*?\]/gi, '')
      .trim();
    
    // If we still don't have enough and have a URL, just return what we have
    // Don't add notes - user wants clean content only
    return finalContent || 'No content available.';
  }
}

// Singleton instance
const articleScraper = new ArticleScraper();

module.exports = articleScraper;

