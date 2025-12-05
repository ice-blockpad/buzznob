/**
 * Test RSS Feed URLs
 * Checks each RSS feed individually to identify which ones are working/failing
 */

const Parser = require('rss-parser');
const axios = require('axios');
const { getProvider } = require('../config/newsProviders');

const rssParser = new Parser({
  customFields: {
    item: ['media:content', 'media:thumbnail', 'enclosure']
  },
  timeout: 10000,
  maxRedirects: 5
});

// Get feeds from config
const rssProvider = getProvider('rssFeeds');
const feeds = rssProvider && rssProvider.feeds ? rssProvider.feeds : [];

async function testFeed(feed) {
  const results = {
    url: feed.url,
    sourceName: feed.sourceName,
    category: feed.category,
    status: 'unknown',
    error: null,
    articleCount: 0,
    testTime: null
  };

  const startTime = Date.now();

  try {
    // First, try a simple HTTP HEAD request to check if URL is reachable
    try {
      const headResponse = await axios.head(feed.url, {
        timeout: 5000,
        maxRedirects: 5,
        validateStatus: (status) => status < 500 // Accept redirects and client errors
      });
      results.httpStatus = headResponse.status;
    } catch (headError) {
      // HEAD might not be supported, that's okay
    }

    // Try parsing the RSS feed
    const feedData = await Promise.race([
      rssParser.parseURL(feed.url),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('RSS feed timeout after 10 seconds')), 10000)
      )
    ]);

    results.status = 'success';
    results.articleCount = feedData.items ? feedData.items.length : 0;
    results.feedTitle = feedData.title || 'N/A';
    
    if (results.articleCount > 0) {
      const latestArticle = feedData.items[0];
      results.latestArticleTitle = latestArticle.title || 'N/A';
      results.latestArticleDate = latestArticle.pubDate || 'N/A';
    }
  } catch (error) {
    results.status = 'failed';
    results.error = error.message;
    
    // Categorize the error
    if (error.message.includes('timeout')) {
      results.errorType = 'timeout';
    } else if (error.message.includes('socket') || error.message.includes('TLS') || error.message.includes('SSL')) {
      results.errorType = 'network/SSL';
    } else if (error.message.includes('404') || error.message.includes('403') || error.message.includes('401')) {
      results.errorType = 'HTTP error';
    } else if (error.message.includes('ENOTFOUND') || error.message.includes('getaddrinfo')) {
      results.errorType = 'DNS error';
    } else {
      results.errorType = 'other';
    }
  }

  results.testTime = Date.now() - startTime;
  return results;
}

async function testAllFeeds() {
  console.log('🔍 Testing RSS Feed URLs...\n');
  console.log('='.repeat(80));
  
  const results = [];
  
  for (let i = 0; i < feeds.length; i++) {
    const feed = feeds[i];
    console.log(`\n[${i + 1}/${feeds.length}] Testing: ${feed.sourceName} (${feed.category})`);
    console.log(`   URL: ${feed.url}`);
    
    const result = await testFeed(feed);
    results.push(result);
    
    if (result.status === 'success') {
      console.log(`   ✅ SUCCESS - Found ${result.articleCount} articles`);
      console.log(`   📰 Feed: ${result.feedTitle}`);
      if (result.latestArticleTitle) {
        console.log(`   📄 Latest: ${result.latestArticleTitle.substring(0, 60)}...`);
      }
    } else {
      console.log(`   ❌ FAILED - ${result.errorType || 'Error'}: ${result.error}`);
    }
    console.log(`   ⏱️  Time: ${result.testTime}ms`);
    
    // Add delay between tests to avoid overwhelming servers
    if (i < feeds.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('\n📊 SUMMARY\n');
  
  const successful = results.filter(r => r.status === 'success');
  const failed = results.filter(r => r.status === 'failed');
  
  console.log(`✅ Successful: ${successful.length}/${results.length}`);
  console.log(`❌ Failed: ${failed.length}/${results.length}\n`);
  
  if (successful.length > 0) {
    console.log('✅ Working Feeds:');
    successful.forEach(r => {
      console.log(`   - ${r.sourceName} (${r.category}): ${r.articleCount} articles`);
    });
  }
  
  if (failed.length > 0) {
    console.log('\n❌ Failed Feeds:');
    const errorTypes = {};
    failed.forEach(r => {
      const errorType = r.errorType || 'unknown';
      if (!errorTypes[errorType]) {
        errorTypes[errorType] = [];
      }
      errorTypes[errorType].push(r);
    });
    
    Object.entries(errorTypes).forEach(([errorType, feeds]) => {
      console.log(`\n   ${errorType.toUpperCase()}:`);
      feeds.forEach(r => {
        console.log(`      - ${r.sourceName} (${r.category})`);
        console.log(`        URL: ${r.url}`);
        console.log(`        Error: ${r.error}`);
      });
    });
  }
  
  return results;
}

// Run if called directly
if (require.main === module) {
  testAllFeeds()
    .then(() => {
      console.log('\n✅ Testing complete');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Test script error:', error);
      process.exit(1);
    });
}

module.exports = { testAllFeeds, testFeed };

