/**
 * Test Single Article Image Extraction
 * Fetches one article and shows all image URLs found, including quality details
 */

require('dotenv').config();
const Parser = require('rss-parser');
const axios = require('axios');
const { getProvider } = require('../config/newsProviders');
const newsService = require('../services/newsService');

const rssParser = new Parser({
  customFields: {
    item: ['media:content', 'media:thumbnail', 'enclosure']
  },
  timeout: 10000,
  maxRedirects: 5
});

async function getImageInfo(imageUrl) {
  if (!imageUrl) return null;
  
  try {
    const response = await axios.head(imageUrl, {
      timeout: 5000,
      maxRedirects: 5,
      validateStatus: () => true
    });
    
    return {
      url: imageUrl,
      status: response.status,
      contentType: response.headers['content-type'] || 'unknown',
      contentLength: response.headers['content-length'] ? parseInt(response.headers['content-length']) : null,
      sizeKB: response.headers['content-length'] ? (parseInt(response.headers['content-length']) / 1024).toFixed(2) : 'unknown',
      isThumbnail: imageUrl.toLowerCase().includes('thumb') || imageUrl.toLowerCase().includes('thumbnail'),
    };
  } catch (error) {
    return {
      url: imageUrl,
      error: error.message,
      accessible: false
    };
  }
}

async function inspectRSSItem(item, feedName) {
  console.log('\n' + '='.repeat(80));
  console.log('📰 ARTICLE DETAILS');
  console.log('='.repeat(80));
  console.log(`Title: ${item.title || 'N/A'}`);
  console.log(`Source: ${feedName}`);
  console.log(`Published: ${item.pubDate || 'N/A'}`);
  console.log(`Link: ${item.link || item.guid || 'N/A'}`);
  
  console.log('\n' + '='.repeat(80));
  console.log('🖼️  IMAGE SOURCES FOUND IN RSS ITEM');
  console.log('='.repeat(80));
  
  const imageSources = [];
  
  // Check media:content
  if (item['media:content']) {
    const mediaContent = Array.isArray(item['media:content']) 
      ? item['media:content'][0] 
      : item['media:content'];
    
    if (mediaContent) {
      let url = null;
      if (mediaContent['$'] && mediaContent['$'].url) {
        url = mediaContent['$'].url;
      } else if (mediaContent.url) {
        url = mediaContent.url;
      } else if (typeof mediaContent === 'string') {
        url = mediaContent;
      }
      
      if (url) {
        imageSources.push({
          source: 'media:content',
          url: url,
          priority: 1,
          raw: JSON.stringify(mediaContent, null, 2)
        });
      }
    }
  }
  
  // Check media:thumbnail
  if (item['media:thumbnail']) {
    const thumbnail = Array.isArray(item['media:thumbnail']) 
      ? item['media:thumbnail'][0] 
      : item['media:thumbnail'];
    
    if (thumbnail) {
      let url = null;
      if (thumbnail['$'] && thumbnail['$'].url) {
        url = thumbnail['$'].url;
      } else if (thumbnail.url) {
        url = thumbnail.url;
      }
      
      if (url) {
        imageSources.push({
          source: 'media:thumbnail (THUMBNAIL - LOW QUALITY)',
          url: url,
          priority: 4,
          raw: JSON.stringify(thumbnail, null, 2)
        });
      }
    }
  }
  
  // Check enclosure
  if (item.enclosure) {
    if (item.enclosure.url && item.enclosure.type && item.enclosure.type.startsWith('image/')) {
      imageSources.push({
        source: 'enclosure',
        url: item.enclosure.url,
        priority: 3,
        raw: JSON.stringify(item.enclosure, null, 2)
      });
    }
  }
  
  // Check content HTML
  if (item.content) {
    const imgMatches = item.content.match(/<img[^>]+src="([^"]+)"/gi);
    if (imgMatches) {
      imgMatches.forEach((match, index) => {
        const urlMatch = match.match(/src="([^"]+)"/i);
        if (urlMatch && urlMatch[1]) {
          imageSources.push({
            source: `content HTML (image ${index + 1})`,
            url: urlMatch[1],
            priority: 2,
            raw: match
          });
        }
      });
    }
  }
  
  // Check description HTML
  if (item.description) {
    const descImgMatches = item.description.match(/<img[^>]+src="([^"]+)"/gi);
    if (descImgMatches) {
      descImgMatches.forEach((match, index) => {
        const urlMatch = match.match(/src="([^"]+)"/i);
        if (urlMatch && urlMatch[1]) {
          imageSources.push({
            source: `description HTML (image ${index + 1})`,
            url: urlMatch[1],
            priority: 2,
            raw: match
          });
        }
      });
    }
  }
  
  if (imageSources.length === 0) {
    console.log('❌ No image sources found in RSS item');
    return;
  }
  
  // Sort by priority
  imageSources.sort((a, b) => a.priority - b.priority);
  
  console.log(`\nFound ${imageSources.length} image source(s):\n`);
  
  for (let i = 0; i < imageSources.length; i++) {
    const source = imageSources[i];
    console.log(`\n[${i + 1}] Source: ${source.source}`);
    console.log(`    URL: ${source.url}`);
    
    // Check if it's a thumbnail
    if (source.url.toLowerCase().includes('thumb') || 
        source.url.toLowerCase().includes('thumbnail') ||
        source.url.toLowerCase().includes('_thumb')) {
      console.log(`    ⚠️  WARNING: This appears to be a THUMBNAIL (low quality)`);
    }
    
    // Get image info
    console.log(`    🔍 Fetching image info...`);
    const imageInfo = await getImageInfo(source.url);
    
    if (imageInfo && !imageInfo.error) {
      console.log(`    ✅ Status: ${imageInfo.status}`);
      console.log(`    📄 Content-Type: ${imageInfo.contentType}`);
      if (imageInfo.sizeKB) {
        console.log(`    📦 Size: ${imageInfo.sizeKB} KB`);
        if (parseFloat(imageInfo.sizeKB) < 50) {
          console.log(`    ⚠️  WARNING: Small file size suggests low quality/thumbnail`);
        }
      }
    } else if (imageInfo && imageInfo.error) {
      console.log(`    ❌ Error: ${imageInfo.error}`);
    }
  }
  
  // Show what our extraction function would return
  console.log('\n' + '='.repeat(80));
  console.log('🔧 EXTRACTION FUNCTION RESULT');
  console.log('='.repeat(80));
  const extractedUrl = newsService.extractImageFromRSSItem(item);
  console.log(`Extracted URL: ${extractedUrl || 'null'}`);
  
  if (extractedUrl) {
    const extractedInfo = await getImageInfo(extractedUrl);
    if (extractedInfo && !extractedInfo.error) {
      console.log(`✅ Status: ${extractedInfo.status}`);
      console.log(`📄 Content-Type: ${extractedInfo.contentType}`);
      if (extractedInfo.sizeKB) {
        console.log(`📦 Size: ${extractedInfo.sizeKB} KB`);
      }
    }
  }
  
  return {
    article: {
      title: item.title,
      link: item.link || item.guid,
      pubDate: item.pubDate
    },
    imageSources,
    extractedUrl
  };
}

async function testSingleArticle(category = null) {
  console.log('\n🔍 Testing Single Article Image Extraction\n');
  
  const rssProvider = getProvider('rssFeeds');
  if (!rssProvider || !rssProvider.feeds || rssProvider.feeds.length === 0) {
    console.log('❌ No RSS feeds configured');
    return;
  }
  
  const feeds = category 
    ? rssProvider.feeds.filter(f => f.category === category.toUpperCase())
    : rssProvider.feeds;
  
  if (feeds.length === 0) {
    console.log(`❌ No feeds found for category: ${category}`);
    return;
  }
  
  // Try the first feed
  const feed = feeds[0];
  console.log(`📡 Using feed: ${feed.sourceName} (${feed.category})`);
  console.log(`🔗 URL: ${feed.url}\n`);
  
  try {
    const feedData = await Promise.race([
      rssParser.parseURL(feed.url),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('RSS feed timeout')), 10000)
      )
    ]);
    
    if (!feedData.items || feedData.items.length === 0) {
      console.log('❌ No articles found in feed');
      return;
    }
    
    // Get the first article
    const firstArticle = feedData.items[0];
    
    const result = await inspectRSSItem(firstArticle, feed.sourceName);
    
    console.log('\n' + '='.repeat(80));
    console.log('✅ Test Complete');
    console.log('='.repeat(80));
    
    return result;
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    return null;
  }
}

// Run if called directly
if (require.main === module) {
  const category = process.argv[2] || null;
  testSingleArticle(category)
    .then(() => {
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Script error:', error);
      process.exit(1);
    });
}

module.exports = { testSingleArticle, inspectRSSItem };

