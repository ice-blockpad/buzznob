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
      
      // STEP 1: Remove navigation sections at HTML level before extraction
      // This is more effective than cleaning text after extraction
      
      // Remove all structural navigation elements
      $('nav, header, footer, aside').remove();
      
      // Remove navigation by semantic HTML5 elements
      $('nav, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"]').remove();
      
      // Remove navigation by common class/id patterns (comprehensive list)
      $('[class*="nav"], [id*="nav"], [class*="menu"], [id*="menu"], [class*="header"], [id*="header"], [class*="footer"], [id*="footer"], [class*="sidebar"], [id*="sidebar"]').remove();
      
      // Remove navigation by specific navigation-related classes
      $('.navigation, .main-nav, .primary-nav, .secondary-nav, .top-nav, .bottom-nav, .site-nav, .page-nav, .breadcrumb, .breadcrumbs, .pagination, .pager, .nav-menu, .nav-bar, .nav-list, .nav-links, .nav-items, .main-menu, .primary-menu, .secondary-menu, .footer-menu, .header-menu, .top-menu, .bottom-menu, .site-menu, .page-menu').remove();
      
      // Remove Guardian-specific navigation elements (known issue with navigation links in content)
      if (url.toLowerCase().includes('theguardian.com')) {
        // Remove Guardian's explore/navigation links that appear in article content
        $('[data-link-name*="explore"], [data-link-name*="nav"], [class*="explore"], [class*="subnav"], [data-component="subnav"], [data-component="explore"], .subnav, .explore, [data-gu-name="explore"]').remove();
        
        // Remove Guardian's topic/category navigation sections
        $('[data-component="topic-list"], [data-component="tag-list"], .topics, .tags, [class*="topic"], [class*="tag"]').remove();
        
        // Remove Guardian's "Reuse this content" and sharing sections
        $('[data-component="share"], [data-component="social"], .share, .social-share, [class*="share"], [class*="social"]').remove();
      }
      
      // Remove BBC-specific navigation
      if (url.toLowerCase().includes('bbc.com') || url.toLowerCase().includes('bbc.co.uk')) {
        $('[data-component="navigation"], [data-component="nav"], [data-component="subnav"], [class*="navigation"], [class*="nav-bar"]').remove();
      }
      
      // Remove all non-content elements aggressively
      $('script, style, .advertisement, .ad, .ads, .advert, .sidebar, .comments, .social-share, .social-media, .share-buttons, .newsletter, .subscribe, .related-articles, .recommended, .trending, .popular, .tags, .categories, .author-bio, .author-info, .byline, .metadata, .cookie, .privacy, .terms, .copyright, iframe, noscript, form, button, input, select, textarea').remove();
      
      // Remove common junk selectors (by class/id patterns)
      $('[class*="ad"], [class*="advert"], [id*="ad"], [id*="advert"], [class*="sponsor"], [class*="promo"], [class*="banner"], [class*="popup"], [class*="modal"], [class*="overlay"], [class*="cookie"], [class*="privacy"], [class*="terms"], [class*="copyright"], [class*="subscribe"], [class*="newsletter"]').remove();
      
      // Remove MarketWatch and common news site junk
      $('.site-search, .search-results, .symbols, .authors, .sections, .columns, .back-to-top, .copyright, .terms, .privacy, .cookie, .archive, .customer-center, .contact, .newsroom, .virtual-stock, .guides, .policy, .notifications, .subscription, .company, .code, .corrections, .reprints, .licensing, .digital, .ad-choices, .corporate, .accessibility, .network, .dow-jones, .intraday-data, .historical-data, .real-time, .last-sale, .stock-quotes, .trades, .nasdaq, .delayed, [class*="marketwatch"], [class*="dow-jones"]').remove();
      
      // Remove elements that contain only navigation-like text (HTML level check)
      $('*').each((i, el) => {
        const $el = $(el);
        const text = $el.text().trim().toLowerCase();
        const tagName = el.tagName?.toLowerCase();
        
        // Skip if it's a structural element that might contain article content
        if (['article', 'main', 'section', 'div', 'p'].includes(tagName)) {
          // Only remove if it's clearly navigation and doesn't contain substantial content
          if (text.length < 200 && text.match(/^(site search|search results|no results found|symbols|authors|sections|columns|back to top|copyright|terms of use|privacy notice|cookie notice|archive|customer center|contact us|newsroom|virtual stock|marketwatch guides|copyright policy|manage notifications|cancel my subscription|company|dow jones|code of conduct|corrections|reprints|licensing|digital self service|your ad choices|corporate subscriptions|accessibility|dow jones network|the wall street journal|barron|investor|financial news|realtor|mansion global|intraday data|historical|real-time|last sale|stock quotes|trades|nasdaq|delayed|home|about|contact|login|sign up|subscribe|follow|share|like|tweet|youtube|social media|digital media|internet|fitness|midlake|middle age|features|reuse this content)/)) {
          $el.remove();
          }
        } else {
          // For other elements, be more aggressive
          if (text.match(/^(site search|search results|no results found|symbols|authors|sections|columns|back to top|copyright|terms of use|privacy notice|cookie notice|archive|customer center|contact us|newsroom|virtual stock|marketwatch guides|copyright policy|manage notifications|cancel my subscription|company|dow jones|code of conduct|corrections|reprints|licensing|digital self service|your ad choices|corporate subscriptions|accessibility|dow jones network|the wall street journal|barron|investor|financial news|realtor|mansion global|intraday data|historical|real-time|last sale|stock quotes|trades|nasdaq|delayed|home|about|contact|login|sign up|subscribe|follow|share|like|tweet|youtube|social media|digital media|internet|fitness|midlake|middle age|features|reuse this content)/)) {
            $el.remove();
          }
        }
      });
      
      // Remove links that are clearly navigation (not article content links)
      $('a').each((i, el) => {
        const $el = $(el);
        const text = $el.text().trim().toLowerCase();
        const href = $el.attr('href') || '';
        
        // Remove navigation links
        if (text.match(/^(home|about|contact|search|login|sign|subscribe|follow|share|like|tweet|more|read more|related|recommended|trending|popular|topics|categories|tags|archive|newsletter|rss|feed)$/i) ||
            href.match(/\/(home|about|contact|search|login|sign|subscribe|follow|share|archive|newsletter|rss|feed)(\/|$)/i) ||
            text.match(/^(youtube|social media|digital media|internet|fitness|midlake|middle age|features|reuse this content)$/i)) {
          // Only remove if it's a standalone link or in a navigation context
          const parent = $el.parent();
          const parentText = parent.text().trim().toLowerCase();
          // If parent is mostly navigation links, remove the parent
          if (parent.find('a').length > 3 && parentText.length < 500) {
            parent.remove();
          } else {
            $el.remove();
          }
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
      // Guardian specific
      else if (urlLower.includes('theguardian.com')) {
        contentSelectors = [
          '[data-gu-name="body"]',
          '.article-body-commercial-selector',
          '.content__article-body',
          'article .content__body',
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
          
          // Remove remaining navigation and junk from cloned element (HTML level)
          $clone.find('nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"]').remove();
          $clone.find('[class*="nav"], [id*="nav"], [class*="menu"], [id*="menu"], [class*="header"], [id*="header"], [class*="footer"], [id*="footer"]').remove();
          $clone.find('.navigation, .main-nav, .primary-nav, .breadcrumb, .breadcrumbs, .pagination, .nav-menu, .nav-bar, .nav-list, .nav-links').remove();
          
          // Guardian-specific: Remove navigation links from cloned content
          if (url.toLowerCase().includes('theguardian.com')) {
            $clone.find('[data-link-name*="explore"], [data-link-name*="nav"], [class*="explore"], [class*="subnav"], [data-component="subnav"], [data-component="explore"], .subnav, .explore, [data-gu-name="explore"]').remove();
            $clone.find('[data-component="topic-list"], [data-component="tag-list"], .topics, .tags').remove();
            $clone.find('[data-component="share"], [data-component="social"], .share, .social-share').remove();
          }
          
          // Remove remaining junk from this element
          $clone.find('script, style, .ad, .advertisement, .sidebar, .comments, .social-share, .related, .recommended, .trending, .popular, .tags, .author-bio, .byline, .metadata, iframe').remove();
          
          // Remove navigation links from cloned content
          $clone.find('a').each((i, el) => {
            const $el = $clone.find(el);
            const text = $el.text().trim().toLowerCase();
            const href = $el.attr('href') || '';
            
            // Remove navigation links
            if (text.match(/^(home|about|contact|search|login|sign|subscribe|follow|share|like|tweet|more|read more|related|recommended|trending|popular|topics|categories|tags|archive|newsletter|rss|feed|youtube|social media|digital media|internet|fitness|midlake|middle age|features|reuse this content)$/i) ||
                href.match(/\/(home|about|contact|search|login|sign|subscribe|follow|share|archive|newsletter|rss|feed)(\/|$)/i)) {
              $el.remove();
            }
          });
          
          const text = $clone.text();
          const cleaned = this.cleanExtractedText(text, url);
          
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
      // Remove navigation elements again (in case they weren't caught earlier)
      $('nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"]').remove();
      $('[class*="nav"], [id*="nav"], [class*="menu"], [id*="menu"], [class*="header"], [id*="header"], [class*="footer"], [id*="footer"]').remove();
      $('.navigation, .main-nav, .primary-nav, .breadcrumb, .breadcrumbs, .pagination, .nav-menu, .nav-bar, .nav-list, .nav-links').remove();
      
      // Guardian-specific navigation removal
      if (url.toLowerCase().includes('theguardian.com')) {
        $('[data-link-name*="explore"], [data-link-name*="nav"], [class*="explore"], [class*="subnav"], [data-component="subnav"], [data-component="explore"], .subnav, .explore, [data-gu-name="explore"]').remove();
        $('[data-component="topic-list"], [data-component="tag-list"], .topics, .tags').remove();
        $('[data-component="share"], [data-component="social"], .share, .social-share').remove();
      }
      
      $('.ad, .advertisement, .sidebar, .comments, .social-share, .related, .recommended, .trending, .popular, .tags, .author-bio, .byline, .metadata, iframe, script, style').remove();
      
      // Remove navigation links before filtering paragraphs
      $('a').each((i, el) => {
        const $el = $(el);
        const text = $el.text().trim().toLowerCase();
        const href = $el.attr('href') || '';
        
        if (text.match(/^(home|about|contact|search|login|sign|subscribe|follow|share|like|tweet|more|read more|related|recommended|trending|popular|topics|categories|tags|archive|newsletter|rss|feed|youtube|social media|digital media|internet|fitness|midlake|middle age|features|reuse this content)$/i) ||
            href.match(/\/(home|about|contact|search|login|sign|subscribe|follow|share|archive|newsletter|rss|feed)(\/|$)/i)) {
          $el.remove();
        }
      });
      
      // Try to find the largest text block (likely the article)
      // Only extract paragraphs that look like article content
      const paragraphs = $('p').filter((i, el) => {
        const text = $(el).text().trim();
        // Must have substantial text
        if (text.length < 50) return false;
        // Must not be navigation/footer text
        const lowerText = text.toLowerCase();
        if (lowerText.match(/^(site search|search results|no results|symbols|authors|sections|columns|back to top|copyright|terms|privacy|cookie|archive|customer|contact|newsroom|virtual|guides|policy|notifications|subscription|company|dow jones|code|corrections|reprints|licensing|digital|ad choices|corporate|accessibility|network|intraday|historical|real-time|last sale|stock quotes|trades|nasdaq|delayed|marketwatch|wall street|barron|investor|financial news|realtor|mansion|smart money|subscribe|sign up|newsletter|follow us|share this|read more|related articles|you may also like|home|about|contact|login|sign|subscribe|follow|share|like|tweet|youtube|social media|digital media|internet|fitness|midlake|middle age|features|reuse this content)/)) {
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
        const cleaned = this.cleanExtractedText(articleText, url);
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
  cleanExtractedText(text, url = '') {
    if (!text) return '';
    
    const urlLower = url.toLowerCase();
    
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
      // Remove image captions/photograph credits (Guardian, BBC, etc.)
      .replace(/^[^.!?]*?Photograph:.*?$/gmi, '')
      .replace(/^[^.!?]*?Photo:.*?$/gmi, '')
      .replace(/^[^.!?]*?Image:.*?$/gmi, '')
      .replace(/^[^.!?]*?Credit:.*?$/gmi, '')
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

    // BBC-specific: Remove metadata at the beginning (time ago, author, role, image source)
    // Pattern: "5 hours agoLaura CressTechnology reporterGetty Images" -> should be removed
    // The article should start from the actual content (e.g., "X has blocked...")
    if (urlLower.includes('bbc.com') || urlLower.includes('bbc.co.uk')) {
      // Find the first proper sentence that looks like article content
      // It should: start with capital letter, have substantial length (40+ chars), end with punctuation
      const firstSentenceMatch = cleaned.match(/([A-Z][^.!?]{40,}[.!?])/);
      
      if (firstSentenceMatch) {
        const firstSentence = firstSentenceMatch[1];
        const sentenceStartIndex = cleaned.indexOf(firstSentence);
        
        // Check what's before the first sentence
        if (sentenceStartIndex > 0) {
          const beforeSentence = cleaned.substring(0, sentenceStartIndex);
          
          // Metadata indicators: time words, roles, image sources, author names (capitalized words)
          const hasMetadata = /(?:hours?|days?|minutes?|weeks?|ago|reporter|correspondent|journalist|editor|writer|staff|Getty|Reuters|AP|AFP|PA|BBC|EPA|Shutterstock|Alamy|Technology|Business|Science|Sports|News|Health|Entertainment|Politics)/i.test(beforeSentence);
          
          // Metadata is usually short (under 150 chars) and doesn't form a proper sentence
          const isShort = beforeSentence.length < 150;
          const notProperSentence = !beforeSentence.match(/[.!?]\s*$/);
          
          // If it looks like metadata, remove it and start from the actual article
          if (hasMetadata && isShort && notProperSentence) {
            cleaned = cleaned.substring(sentenceStartIndex).trim();
          }
        }
      }
      
      // Additional cleanup: Remove any remaining metadata patterns at the very start
      // Pattern: time ago + author + role + image source (all concatenated or with minimal spaces)
      cleaned = cleaned.replace(/^\d+\s+(hours?|days?|minutes?|weeks?)\s+ago\s*/i, '');
      // Common image sources: Getty Images, Reuters, AP, AFP, PA Media, EPA, Shutterstock, Alamy, PA, BBC, etc.
      cleaned = cleaned.replace(/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\s*(?:(?:Technology|Business|Science|Sports|News|Health|Entertainment|Politics)?\s*(?:reporter|correspondent|journalist|editor|writer|staff))?\s*(?:Getty\s*Images|Reuters|AP|AFP|PA\s*Media|PA|BBC|EPA|Shutterstock|Alamy|iStock|Dreamstime|Corbis|WireImage|Splash|Barcroft|Rex\s*Features|Press\s*Association|Press\s*Association\s*Images)?\s*/i, '');
      
      // Remove "via" + image source patterns (e.g., "via Getty Images", "via Shutterstock")
      cleaned = cleaned.replace(/^via\s+(?:Getty\s*Images|Reuters|AP|AFP|PA\s*Media|PA|BBC|EPA|Shutterstock|Alamy|iStock|Dreamstime|Corbis|WireImage|Splash|Barcroft|Rex\s*Features|Press\s*Association|Press\s*Association\s*Images|Images|Image)\s*/i, '');
      
      // Remove standalone image source names at the start (e.g., "Images", "Getty Images", "Shutterstock", "Media", etc.)
      cleaned = cleaned.replace(/^(?:Getty\s*Images|Reuters|AP|AFP|PA\s*Media|PA|BBC|EPA|Shutterstock|Alamy|iStock|Dreamstime|Corbis|WireImage|Splash|Barcroft|Rex\s*Features|Press\s*Association|Press\s*Association\s*Images|Images|Image|Media)\s*/i, '');
      
      // Remove image sources with "/" prefix (e.g., "/Shutterstock", "/Getty Images")
      cleaned = cleaned.replace(/^\/\s*(?:Shutterstock|Getty\s*Images|Reuters|AP|AFP|PA\s*Media|PA|BBC|EPA|Alamy|iStock|Dreamstime|Corbis|WireImage|Splash|Barcroft|Rex\s*Features|Press\s*Association|Press\s*Association\s*Images|Images|Image)\s*/i, '');
      
      // Remove location names that might appear at the start (common BBC pattern: "LocationBBC" or ", LocationBBC")
      // But be careful - only remove if it's clearly metadata (short, followed by BBC or article content)
      cleaned = cleaned.replace(/^,\s*[A-Z][a-z]+\s*BBC/i, '');
      cleaned = cleaned.replace(/^[A-Z][a-z]+\s*BBC/i, '');
      
      // Final pass: If text still starts with metadata-like words, find the first proper sentence
      const firstFewWords = cleaned.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/);
      if (firstFewWords) {
        const firstWordsText = firstFewWords[1];
        // Common metadata words/phrases that shouldn't start an article
        const metadataPatterns = [
          /^(Images|Image|Getty|Reuters|AP|AFP|PA|BBC|EPA|Shutterstock|Alamy|iStock|Dreamstime|Corbis|WireImage|Splash|Barcroft|Rex|Hours|Days|Minutes|Weeks|Ago|Reporter|Correspondent|Journalist|Editor|Writer|Staff|Media|via|Tokyo|London|New York|Washington|Paris|Berlin|Beijing)$/i,
          /^(via\s+Getty|via\s+Reuters|via\s+AP|via\s+AFP|via\s+Shutterstock|via\s+Alamy|via\s+Images)$/i
        ];
        
        let isMetadata = false;
        for (const pattern of metadataPatterns) {
          if (pattern.test(firstWordsText)) {
            isMetadata = true;
            break;
          }
        }
        
        if (isMetadata) {
          // Find the first proper sentence and start from there
          const properSentence = cleaned.match(/([A-Z][^.!?]{40,}[.!?])/);
          if (properSentence) {
            const properStart = cleaned.indexOf(properSentence[1]);
            if (properStart > 0 && properStart < 150) {
              cleaned = cleaned.substring(properStart).trim();
            }
          }
        }
      }
      
      // One more pass: Remove any leading punctuation or short metadata fragments
      cleaned = cleaned.replace(/^[,\s]+/, ''); // Remove leading commas and spaces
      
      // Handle word fragments at the start (e.g., "BrosThe" should become "The")
      // Pattern: Capital letter + lowercase letters + Capital letter (word fragment without space)
      // Examples: "BrosThe", "FilmThe", "NewsThe"
      cleaned = cleaned.replace(/^[A-Z][a-z]+([A-Z][a-z]+)/, '$1');
      
      // Also handle lowercase fragments: lowercase letter(s) followed immediately by capital letter
      cleaned = cleaned.replace(/^[a-z]+([A-Z][a-z]+)/, '$1');
      
      // Fix missing spaces between words (e.g., "anotherLeonardo" -> "another. Leonardo")
      // Pattern: lowercase letter(s) followed immediately by capital letter (missing space/period)
      cleaned = cleaned.replace(/([a-z]{3,})([A-Z][a-z]+)/g, (match, p1, p2) => {
        // Don't fix if it's a known compound word or abbreviation
        if (/^(iPhone|iPad|iPod|eBay|YouTube|PayPal|FedEx|McDonald|O'Brien|D'Angelo|L'Occitane)$/i.test(p2)) {
          return match;
        }
        // Add period and space if the first part looks like end of sentence (common words that end sentences)
        if (/^(year|film|movie|show|series|award|globe|nominee|winner|rival|rivals|love|another|other|this|that|these|those|boost|awards|globes|television)$/i.test(p1)) {
          return p1 + '. ' + p2;
        }
        // If first part is longer and doesn't end with punctuation, add period and space
        if (p1.length > 4 && !/[.!?]$/.test(p1)) {
          return p1 + '. ' + p2;
        }
        // Otherwise just add space
        return p1 + ' ' + p2;
      });
      
      // Fix missing spaces in metadata patterns (e.g., "reporterand" -> "reporter and")
      cleaned = cleaned.replace(/(reporter|correspondent|journalist|editor|writer|staff)(and|or|the|a|an|of|in|on|at|for|with|by)/gi, '$1 $2');
      
      // Fix extra periods after "and" in metadata (e.g., "reporter and. Chi" -> "reporter and Chi")
      cleaned = cleaned.replace(/(reporter|correspondent|journalist|editor|writer|staff)\s+and\.\s+/gi, '$1 and ');
      
      // Fix missing spaces after image credits (e.g., "/ShutterstockTom" -> "/Shutterstock Tom")
      cleaned = cleaned.replace(/(\/Shutterstock|Getty\s*Images|Reuters|AP|AFP|PA\s*Media|PA|BBC|EPA|Shutterstock|Alamy|iStock|Dreamstime|Corbis|WireImage|Splash|Barcroft|Rex\s*Features|Press\s*Association|Press\s*Association\s*Images)([A-Z][a-z]+)/g, '$1 $2');
      
      // Remove image credit fragments at the start (e.g., "üterAFP" -> remove "üter", keep "AFP via Getty Images")
      cleaned = cleaned.replace(/^[a-züäö]{1,5}(AFP|Getty|Reuters|AP|AFP|Shutterstock|Alamy|iStock|Dreamstime|Corbis|WireImage|Splash|Barcroft|Rex|PA\s*Media|PA|BBC|EPA)/i, '$1');
      
      // Remove image sources anywhere in the text (not just at start) - common BBC pattern
      // Pattern: "Image Source Name" or "via Image Source" followed by article content
      cleaned = cleaned.replace(/\s+(?:Getty\s*Images|Reuters|AP|AFP|PA\s*Media|PA|BBC|EPA|Shutterstock|Alamy|iStock|Dreamstime|Corbis|WireImage|Splash|Barcroft|Rex\s*Features|Press\s*Association|Press\s*Association\s*Images)\s+([A-Z][a-z]+)/g, ' $1');
      cleaned = cleaned.replace(/\s+via\s+(?:Getty\s*Images|Reuters|AP|AFP|PA\s*Media|PA|BBC|EPA|Shutterstock|Alamy|iStock|Dreamstime|Corbis|WireImage|Splash|Barcroft|Rex\s*Features|Press\s*Association|Press\s*Association\s*Images)\s+([A-Z][a-z]+)/g, ' $1');
      
      // Remove caption fragments at the start (e.g., "to right:", "from left:", "Left to right:")
      cleaned = cleaned.replace(/^(left\s+to\s+right|right\s+to\s+left|from\s+left|from\s+right|to\s+left|to\s+right|top|bottom|above|below):\s*/i, '');
      
      // Remove articles that start mid-sentence (e.g., "made another offer")
      // If article starts with lowercase or common mid-sentence words, find the first proper sentence
      const firstWords = cleaned.substring(0, 50).trim().split(/\s+/).slice(0, 3).join(' ').toLowerCase();
      const midSentenceStarters = ['made', 'said', 'told', 'added', 'noted', 'explained', 'according', 'following', 'after', 'during', 'while', 'when', 'where', 'which', 'that', 'this', 'these', 'those'];
      if (midSentenceStarters.some(word => firstWords.startsWith(word))) {
        const properSentence = cleaned.match(/([A-Z][^.!?]{40,}[.!?])/);
        if (properSentence) {
          const properStart = cleaned.indexOf(properSentence[1]);
          if (properStart > 0 && properStart < 200) {
            cleaned = cleaned.substring(properStart).trim();
          }
        }
      }
      
      // Fix fragments at the end (e.g., "iven jail" should be removed or fixed)
      // If text ends with a lowercase word followed by capital, it's likely a fragment
      const endFragment = cleaned.match(/([a-z]+)([A-Z][a-z]+)$/);
      if (endFragment && endFragment[1].length <= 5) {
        // Remove the fragment
        cleaned = cleaned.substring(0, cleaned.length - endFragment[0].length).trim();
      }
      
      // If still starts with a very short fragment that looks like metadata, find first substantial sentence
      const first50 = cleaned.substring(0, 50);
      if (first50.length < 30 && /(?:via|Getty|Reuters|AP|AFP|BBC|Shutterstock|Alamy|iStock|Dreamstime|Corbis|WireImage|Splash|Barcroft|Rex|Images|Media|Tokyo|London)/i.test(first50)) {
        const substantialSentence = cleaned.match(/([A-Z][^.!?]{50,}[.!?])/);
        if (substantialSentence) {
          const substantialStart = cleaned.indexOf(substantialSentence[1]);
          if (substantialStart > 0 && substantialStart < 200) {
            cleaned = cleaned.substring(substantialStart).trim();
          }
        }
      }
      
      // Final check: If starts with a word fragment pattern (capital+lowercase+capital without space), fix it
      const fragmentMatch = cleaned.match(/^([A-Z][a-z]+)([A-Z][a-z]+)/);
      if (fragmentMatch && fragmentMatch[1].length <= 10) {
        // If first word is short (likely a fragment), remove it and start from second word
        // But only if the second word is a common article start word
        const secondWord = fragmentMatch[2];
        if (/^(The|A|An|This|That|These|Those|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Leonardo|DiCaprio|Film|Movie|Actor|Actress|Director|Producer|Writer|Show|Series|Episode|Season|Character|Story|Plot|Scene|Script|Screenplay|Award|Oscar|Golden|Globe|Emmy|Grammy|Tony|Bafta|Cannes|Sundance|Festival|Premiere|Release|Box|Office|Studio|Network|Channel|Streaming|Platform|Service|Subscription|Viewer|Audience|Fan|Critic|Review|Rating|Score|Rotten|Tomatoes|Metacritic|IMDb)$/i.test(secondWord)) {
          cleaned = cleaned.substring(fragmentMatch[1].length).trim();
        }
      }
    }
    
    // Cointelegraph-specific: Remove metadata at the beginning and hashtags at the end
    // Pattern: "Author Name Article Title COINTELEGRAPH IN YOUR SOCIAL FEED" -> should be "Article Title"
    // Also remove hashtags at the end like "#Blockchain #Stablecoin"
    if (urlLower.includes('cointelegraph.com')) {
      // Remove "COINTELEGRAPH IN YOUR SOCIAL FEED" pattern (can appear anywhere)
      cleaned = cleaned.replace(/\s*COINTELEGRAPH\s+IN\s+YOUR\s+SOCIAL\s+FEED\s*/gi, ' ');
      cleaned = cleaned.replace(/\s*COINTELEGRAPH\s+IN\s+YOUR\s+FEED\s*/gi, ' ');
      cleaned = cleaned.replace(/\s*IN\s+YOUR\s+SOCIAL\s+FEED\s*/gi, ' ');
      cleaned = cleaned.replace(/\s*IN\s+YOUR\s+FEED\s*/gi, ' ');
      
      // Remove "COINTELEGRAPH" brand name (can appear anywhere)
      cleaned = cleaned.replace(/\s*COINTELEGRAPH\s*/gi, ' ');
      cleaned = cleaned.replace(/^COINTELEGRAPH\s*/i, '');
      cleaned = cleaned.replace(/\s*COINTELEGRAPH$/i, '');
      
      // Remove author name at the start (pattern: "FirstName LastName" followed by article title)
      // Author names are typically 2-3 capitalized words followed by article title (also capitalized)
      // Examples: "Turner Wright Watchdog asks..." -> "Watchdog asks..."
      //           "Liza Savenko XRP needs..." -> "XRP needs..."
      //           "William Suberg Bitcoin gives..." -> "Bitcoin gives..."
      
      // Pattern: 2-3 capitalized words at the start, followed by another capitalized word (article title)
      const authorPattern = /^([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+([A-Z][a-z]+)/;
      const authorMatch = cleaned.match(authorPattern);
      
      if (authorMatch) {
        const potentialAuthor = authorMatch[1]; // e.g., "Turner Wright"
        const nextWord = authorMatch[2]; // e.g., "Watchdog" or "XRP"
        
        // Check if it looks like author name + article title
        // Author names are typically 2-3 words, and the next word should be part of the article
        const authorWords = potentialAuthor.split(/\s+/);
        const isLikelyAuthor = authorWords.length >= 2 && authorWords.length <= 3;
        
        // The next word should be capitalized (article title/start)
        const isArticleStart = nextWord && nextWord[0] === nextWord[0].toUpperCase();
        
        if (isLikelyAuthor && isArticleStart) {
          // Remove the author name, keep the article content
          cleaned = cleaned.substring(potentialAuthor.length).trim();
        }
      }
      
      // Fallback: More aggressive pattern if the above didn't catch it
      // Look for pattern: "Word Word Word " at start where the next part is clearly article content
      const fallbackPattern = /^([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(.+)/;
      const fallbackMatch = cleaned.match(fallbackPattern);
      if (fallbackMatch) {
        const potentialAuthor = fallbackMatch[1];
        const restOfText = fallbackMatch[2];
        
        // If the rest of text starts with a capitalized word and is substantial, likely author name
        if (restOfText.length > 30 && /^[A-Z]/.test(restOfText)) {
          // Check if potential author is short (2-3 words) and doesn't look like article title
          const authorWords = potentialAuthor.split(/\s+/);
          if (authorWords.length >= 2 && authorWords.length <= 3) {
            // Additional check: author names typically don't contain common article words
            const commonArticleWords = ['The', 'A', 'An', 'This', 'That', 'These', 'Those', 'Bitcoin', 'Ethereum', 'Crypto', 'Blockchain'];
            const isNotArticleTitle = !commonArticleWords.some(word => potentialAuthor.includes(word));
            
            if (isNotArticleTitle) {
              cleaned = restOfText.trim();
            }
          }
        }
      }
      
      // Remove hashtags at the end (pattern: #Word #Word or #Word#Word)
      // Look for hashtags in the last 300 characters (increased from 200)
      const last300 = cleaned.substring(Math.max(0, cleaned.length - 300));
      
      // Pattern to match hashtags at the end: one or more #Word patterns, possibly with spaces
      // Examples: "#Blockchain #Cryptocurrency", "#Blockchain#Cryptocurrency", "#How to"
      const hashtagMatch = last300.match(/(?:[,\s]*#[\w\-\s]+[\s#]*)+\.?\s*$/);
      
      if (hashtagMatch) {
        const hashtagStart = cleaned.lastIndexOf(hashtagMatch[0]);
        if (hashtagStart > 0) {
          const beforeHashtags = cleaned.substring(0, hashtagStart).trim();
          // Only remove if what's before looks like proper article content
          // Be more lenient - if beforeHashtags is substantial, remove hashtags
          if (beforeHashtags.length > 50) {
            cleaned = beforeHashtags;
          }
        }
      }
      
      // Additional pass: Remove any remaining hashtag patterns at the very end
      // This catches cases where hashtags might be mixed with other text
      cleaned = cleaned.replace(/\s*#[\w\-\s]+(?:\s+#[\w\-\s]+)*\.?\s*$/g, '');
      
      // Final aggressive pass: Find any # in the last 200 chars and remove everything from there if it's all hashtags
      const last200 = cleaned.substring(Math.max(0, cleaned.length - 200));
      const lastHashIndex = last200.lastIndexOf('#');
      if (lastHashIndex >= 0) {
        const globalHashIndex = cleaned.length - 200 + lastHashIndex;
        const fromHashToEnd = cleaned.substring(globalHashIndex);
        // Check if from # to end is mostly hashtags
        const hashtagCount = (fromHashToEnd.match(/#[\w\-\s]+/g) || []).length;
        const wordCount = fromHashToEnd.split(/\s+/).length;
        // If more than 50% are hashtags, remove them
        if (hashtagCount > 0 && hashtagCount >= wordCount * 0.5) {
          const beforeHash = cleaned.substring(0, globalHashIndex).trim();
          if (beforeHash.length > 50) {
            cleaned = beforeHash;
          }
        }
      }
      
      // Clean up any double spaces created by removals
      cleaned = cleaned.replace(/\s+/g, ' ').trim();
    }
    
    // Guardian-specific: Remove any remaining navigation/related content links at the end
    // (Most navigation should already be removed at HTML level, but catch any remaining)
    if (urlLower.includes('theguardian.com')) {
      // Remove Guardian's navigation/explore links at the end
      // Pattern: "YouTubeSocial mediaDigital mediaInternetFitnessMidlakeMiddle agefeaturesShareReuse this content."
      // These are links to explore more articles, not part of the article content
      
      // Look for concatenated navigation words pattern at the end
      const navPattern1 = /([A-Z][a-z]+)+(Social\s+media|Digital\s+media|Internet|Fitness|Midlake|Middle\s+age|features|Share|Reuse\s+this\s+content)\.?\s*$/i;
      if (navPattern1.test(cleaned)) {
        cleaned = cleaned.replace(navPattern1, '').trim();
      }
      
      // Remove any remaining navigation text patterns
      cleaned = cleaned
        .replace(/\s*YouTube\s*\.?\s*$/i, '')
        .replace(/\s*Social\s+media\s*\.?\s*$/i, '')
        .replace(/\s*Digital\s+media\s*\.?\s*$/i, '')
        .replace(/\s*Internet\s*\.?\s*$/i, '')
        .replace(/\s*Fitness\s*\.?\s*$/i, '')
        .replace(/\s*Midlake\s*\.?\s*$/i, '')
        .replace(/\s*Middle\s+age\s*\.?\s*$/i, '')
        .replace(/\s*features\s*\.?\s*$/i, '')
        .replace(/\s*Share\s*\.?\s*$/i, '')
        .replace(/\s*Reuse\s+this\s+content\s*\.?\s*$/i, '')
        .replace(/\s*Share\s+on\s+(Facebook|Twitter|LinkedIn|WhatsApp|Email)\s*\.?\s*$/gi, '');
      
      // Remove topics/categories navigation section
      cleaned = cleaned.replace(/\s*(Topics?|Categories?|Tags?):\s*[^.!?]+\.?\s*$/i, '');
      
      // If the last part contains "YouTube" followed by other navigation words, remove everything from "YouTube" onwards
      const youtubeNavPattern = /YouTube[^.!?]*(Social\s+media|Digital\s+media|Internet|Fitness|Midlake|Middle\s+age|features|Share|Reuse\s+this\s+content)\.?\s*$/i;
      if (youtubeNavPattern.test(cleaned)) {
          const youtubeIndex = cleaned.lastIndexOf('YouTube');
          if (youtubeIndex > cleaned.length - 200) {
            // Only remove if it's near the end (within last 200 chars)
            cleaned = cleaned.substring(0, youtubeIndex).trim();
          }
        }
      }
    
    // Fox News-specific: Remove metadata at the beginning
    // Pattern: "NEWYou can now listen to Fox News articles" -> should be removed
    if (urlLower.includes('foxnews.com') || urlLower.includes('foxnews')) {
      // Remove "NEWYou can now listen to Fox News articles" pattern
      cleaned = cleaned.replace(/NEWYou\s+can\s+now\s+listen\s+to\s+Fox\s+News\s+articles\.?\s*/gi, '');
      cleaned = cleaned.replace(/NEW\s*You\s+can\s+now\s+listen\s+to\s+Fox\s+News\s+articles\.?\s*/gi, '');
      cleaned = cleaned.replace(/You\s+can\s+now\s+listen\s+to\s+Fox\s+News\s+articles\.?\s*/gi, '');
      
      // Remove "NEW" prefix if it appears at the start (common Fox News pattern)
      cleaned = cleaned.replace(/^NEW\s*/i, '');
      
      // Remove any remaining Fox News branding/metadata patterns
      cleaned = cleaned.replace(/\s*Fox\s+News\s+articles?\.?\s*/gi, ' ');
      
      // Clean up any double spaces created by removals
      cleaned = cleaned.replace(/\s+/g, ' ').trim();
    }
    
    // ESPN-specific: Remove metadata at the beginning
    // Pattern: Video descriptions, timestamps like "(1:09)", image credits, dates, and other ESPN metadata
    if (urlLower.includes('espn.com') || urlLower.includes('espn')) {
      // Remove video timestamps like "(1:09)", "(2:30)", etc.
      cleaned = cleaned.replace(/\(\d+:\d+\)/g, '');
      
      // Remove image credits and dates at the start
      // Pattern: "Name/Getty ImagesNov 24, 2025, 12:11 PM ET" -> should be removed
      // Also handles: "Name Name/Getty Images" or "Name/Name/Getty Images"
      cleaned = cleaned.replace(/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\/[A-Z][a-z]+)+\s*(?:Getty\s*Images|Reuters|AP|AFP|USA\s*Today|ESPN|The)/i, '');
      cleaned = cleaned.replace(/(?:Getty\s*Images|Reuters|AP|AFP|USA\s*Today|ESPN|The)\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+,\s+\d+,\s+\d+:\d+\s+(?:AM|PM)\s+ET/i, '');
      cleaned = cleaned.replace(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+,\s+\d+,\s+\d+:\d+\s+(?:AM|PM)\s+ET/i, '');
      
      // Remove image credit patterns like "Name/Name" or "Name/Getty Images" anywhere at the start
      // Pattern: "Clive Brunskill/The" or "Clive Brunskill/Getty Images"
      // Handle case where image credit is followed by article start (e.g., "Name/The Article...")
      cleaned = cleaned.replace(/^[A-Z][a-z]+\s+[A-Z][a-z]+\/(?:Getty\s*Images|Reuters|AP|AFP|USA\s*Today|ESPN)/i, '');
      // Handle pattern: "Name Name/The" where "The" is start of next sentence
      cleaned = cleaned.replace(/^[A-Z][a-z]+\s+[A-Z][a-z]+\/The\s+([A-Z])/i, '$1');
      // Handle pattern: "Name/Name" (photographer name)
      cleaned = cleaned.replace(/^[A-Z][a-z]+\s+[A-Z][a-z]+\/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+/i, '');
      
      // Remove video descriptions that might appear at the start
      // Pattern: "playPlayer Name does something..." -> should start from actual article
      // Look for pattern where text starts with lowercase "play" followed by capitalized name
      if (cleaned.match(/^play[A-Z]/)) {
        // Find where the actual article starts (usually after a period and capital letter)
        const articleStart = cleaned.match(/\.([A-Z][^.!?]{30,}[.!?])/);
        if (articleStart) {
          const startIndex = cleaned.indexOf(articleStart[1]);
          if (startIndex > 0 && startIndex < 200) {
            cleaned = cleaned.substring(startIndex).trim();
          }
        }
      }
      
      // Remove common ESPN metadata patterns
      cleaned = cleaned.replace(/^play\s*/i, '');
      
      // Remove ESPN branding if it appears at the start
      cleaned = cleaned.replace(/^ESPN\s*/i, '');
      
      // Remove image credit patterns embedded in text (e.g., "Name/Getty Images" or "Name/The")
      // Pattern: "text. Name/Getty ImagesDateThe Article..." -> should become "text. The Article..."
      // Handle case: "No. 1. Name/Getty ImagesDateThe" -> should become "No. 1. The"
      // First, remove the full pattern: Name/Getty Images + Date + "The"
      // Special handling for "No. X." pattern - preserve it
      cleaned = cleaned.replace(/(No\.\s+\d+\.)\s+[A-Z][a-z]+\s+[A-Z][a-z]+\/(?:Getty\s*Images|Reuters|AP|AFP|USA\s*Today|ESPN)\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+,\s+\d+,\s+\d+:\d+\s+(?:AM|PM)\s+ET\s*The\s+/gi, '$1 The ');
      cleaned = cleaned.replace(/([.!?])\s+[A-Z][a-z]+\s+[A-Z][a-z]+\/(?:Getty\s*Images|Reuters|AP|AFP|USA\s*Today|ESPN)\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+,\s+\d+,\s+\d+:\d+\s+(?:AM|PM)\s+ET\s*The\s+/gi, '$1 The ');
      // Then remove just image credit + date (without "The" after)
      cleaned = cleaned.replace(/(No\.\s+\d+\.)\s+[A-Z][a-z]+\s+[A-Z][a-z]+\/(?:Getty\s*Images|Reuters|AP|AFP|USA\s*Today|ESPN)\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+,\s+\d+,\s+\d+:\d+\s+(?:AM|PM)\s+ET/gi, '$1 ');
      cleaned = cleaned.replace(/([.!?])\s+[A-Z][a-z]+\s+[A-Z][a-z]+\/(?:Getty\s*Images|Reuters|AP|AFP|USA\s*Today|ESPN)\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+,\s+\d+,\s+\d+:\d+\s+(?:AM|PM)\s+ET/gi, '$1 ');
      // Remove image credit without date
      cleaned = cleaned.replace(/(No\.\s+\d+\.)\s+[A-Z][a-z]+\s+[A-Z][a-z]+\/(?:Getty\s*Images|Reuters|AP|AFP|USA\s*Today|ESPN)/gi, '$1 ');
      cleaned = cleaned.replace(/([.!?])\s+[A-Z][a-z]+\s+[A-Z][a-z]+\/(?:Getty\s*Images|Reuters|AP|AFP|USA\s*Today|ESPN)/gi, '$1 ');
      // Handle "Name/The" pattern - keep "The" if it starts the next sentence
      cleaned = cleaned.replace(/(No\.\s+\d+\.)\s+[A-Z][a-z]+\s+[A-Z][a-z]+\/The\s+([A-Z][a-z]+)/gi, '$1 The $2');
      cleaned = cleaned.replace(/([.!?])\s+[A-Z][a-z]+\s+[A-Z][a-z]+\/The\s+([A-Z][a-z]+)/gi, '$1 The $2');
      // Handle "Name/Name" pattern (photographer name) - remove it but preserve what comes after
      cleaned = cleaned.replace(/(No\.\s+\d+\.)\s+[A-Z][a-z]+\s+[A-Z][a-z]+\/([A-Z][a-z]+)\s+/gi, '$1 $2 ');
      cleaned = cleaned.replace(/([.!?])\s+[A-Z][a-z]+\s+[A-Z][a-z]+\/([A-Z][a-z]+)\s+/gi, '$1 $2 ');
      
      // Find the first proper sentence and remove everything before it if it looks like metadata
      const firstSentenceMatch = cleaned.match(/([A-Z][^.!?]{40,}[.!?])/);
      if (firstSentenceMatch) {
        const firstSentence = firstSentenceMatch[1];
        const sentenceStartIndex = cleaned.indexOf(firstSentence);
        
        if (sentenceStartIndex > 0) {
          const beforeSentence = cleaned.substring(0, sentenceStartIndex);
          
          // Check if what's before looks like metadata (image credits, dates, etc.)
          const hasMetadata = /(?:Getty|Reuters|AP|AFP|USA\s*Today|ESPN|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|AM|PM|ET|\/[A-Z])/i.test(beforeSentence);
          const isShort = beforeSentence.length < 200;
          
          if (hasMetadata && isShort) {
            cleaned = cleaned.substring(sentenceStartIndex).trim();
          }
        }
      }
      
      // Clean up any double spaces created by removals
      cleaned = cleaned.replace(/\s+/g, ' ').trim();
    }
    
    // Remove duplicate text at the beginning (common issue with image captions)
    // Check if first 200 chars are repeated
    const first200 = cleaned.substring(0, 200).trim();
    if (first200.length > 50) {
      const first100 = first200.substring(0, 100);
      const next100 = cleaned.substring(100, 200);
      // If first 100 chars appear again in next 100 chars, likely duplicate
      if (next100.includes(first100.substring(0, 50))) {
        // Find where the duplicate ends
        const duplicateEnd = cleaned.indexOf(first100.substring(0, 50), 50);
        if (duplicateEnd > 50 && duplicateEnd < 300) {
          cleaned = cleaned.substring(duplicateEnd).trim();
        }
      }
    }
    
    // Remove repeated image captions at the start
    // Pattern: "Text. Photograph: NameText. Photograph: Name" -> "Text. Photograph: Name"
    cleaned = cleaned.replace(/^([^.!?]+(?:Photograph|Photo|Image|Credit):[^.!?]+?)(\1)/i, '$1');
    
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

