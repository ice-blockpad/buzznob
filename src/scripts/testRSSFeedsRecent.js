/**
 * Test RSS Feed URLs for Recent Articles (Last 6 Hours)
 * Checks each RSS feed to see if it can provide articles from the last 6 hours
 */

const Parser = require('rss-parser');
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

// All categories in the app
const categories = ['DEFI', 'FINANCE', 'POLITICS', 'SPORT', 'ENTERTAINMENT', 'WEATHER', 'TECHNOLOGY', 'BUSINESS', 'HEALTH', 'SCIENCE', 'OTHERS'];

async function testFeedForRecentArticles(feed, hoursAgo = 6) {
  const results = {
    url: feed.url,
    sourceName: feed.sourceName,
    category: feed.category,
    status: 'unknown',
    error: null,
    totalArticles: 0,
    recentArticles: 0,
    oldestArticle: null,
    newestArticle: null,
    testTime: null
  };

  const startTime = Date.now();
  const fromDate = new Date();
  fromDate.setHours(fromDate.getHours() - hoursAgo);

  try {
    // Try parsing the RSS feed
    const feedData = await Promise.race([
      rssParser.parseURL(feed.url),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('RSS feed timeout after 10 seconds')), 10000)
      )
    ]);

    results.status = 'success';
    results.totalArticles = feedData.items ? feedData.items.length : 0;
    
    if (results.totalArticles > 0) {
      // Filter articles by date
      const recentArticles = feedData.items.filter(item => {
        if (!item.pubDate) return false;
        const pubDate = new Date(item.pubDate);
        return pubDate >= fromDate;
      });

      results.recentArticles = recentArticles.length;
      
      // Get oldest and newest article dates
      const articlesWithDates = feedData.items
        .filter(item => item.pubDate)
        .map(item => ({
          date: new Date(item.pubDate),
          title: item.title || 'N/A'
        }))
        .sort((a, b) => b.date - a.date); // Sort newest first

      if (articlesWithDates.length > 0) {
        results.newestArticle = {
          date: articlesWithDates[0].date,
          title: articlesWithDates[0].title.substring(0, 60),
          hoursAgo: Math.round((Date.now() - articlesWithDates[0].date.getTime()) / (1000 * 60 * 60) * 10) / 10
        };
        results.oldestArticle = {
          date: articlesWithDates[articlesWithDates.length - 1].date,
          title: articlesWithDates[articlesWithDates.length - 1].title.substring(0, 60),
          hoursAgo: Math.round((Date.now() - articlesWithDates[articlesWithDates.length - 1].date.getTime()) / (1000 * 60 * 60) * 10) / 10
        };
      }
    }
  } catch (error) {
    results.status = 'failed';
    results.error = error.message;
    
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

async function testCategoryForRecentArticles(category, hoursAgo = 6) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📰 Testing Category: ${category}`);
  console.log(`⏰ Looking for articles from the last ${hoursAgo} hours`);
  console.log('='.repeat(80));

  // Filter feeds by category
  const categoryFeeds = feeds.filter(feed => feed.category === category.toUpperCase());
  
  if (categoryFeeds.length === 0) {
    console.log(`⚠️  No RSS feeds configured for category: ${category}`);
    return {
      category,
      feedsTested: 0,
      successfulFeeds: 0,
      failedFeeds: 0,
      totalArticles: 0,
      recentArticles: 0,
      hasRecentArticles: false
    };
  }

  console.log(`\n🔍 Found ${categoryFeeds.length} feed(s) for ${category}:\n`);

  const results = [];
  let totalRecentArticles = 0;
  let totalArticles = 0;

  for (let i = 0; i < categoryFeeds.length; i++) {
    const feed = categoryFeeds[i];
    console.log(`[${i + 1}/${categoryFeeds.length}] Testing: ${feed.sourceName}`);
    console.log(`   URL: ${feed.url}`);

    const result = await testFeedForRecentArticles(feed, hoursAgo);
    results.push(result);
    totalArticles += result.totalArticles;
    totalRecentArticles += result.recentArticles;

    if (result.status === 'success') {
      console.log(`   ✅ SUCCESS`);
      console.log(`   📊 Total articles: ${result.totalArticles}`);
      console.log(`   ⏰ Recent articles (last ${hoursAgo}h): ${result.recentArticles}`);
      
      if (result.newestArticle) {
        console.log(`   🆕 Newest: ${result.newestArticle.hoursAgo}h ago - "${result.newestArticle.title}..."`);
      }
      if (result.oldestArticle && result.oldestArticle.date !== result.newestArticle?.date) {
        console.log(`   📅 Oldest: ${result.oldestArticle.hoursAgo}h ago - "${result.oldestArticle.title}..."`);
      }
      
      if (result.recentArticles === 0 && result.totalArticles > 0) {
        console.log(`   ⚠️  WARNING: No articles in the last ${hoursAgo} hours`);
      }
    } else {
      console.log(`   ❌ FAILED - ${result.errorType || 'Error'}: ${result.error}`);
    }
    console.log(`   ⏱️  Time: ${result.testTime}ms\n`);

    // Add delay between tests
    if (i < categoryFeeds.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  const successfulFeeds = results.filter(r => r.status === 'success').length;
  const failedFeeds = results.filter(r => r.status === 'failed').length;
  const hasRecentArticles = totalRecentArticles > 0;

  return {
    category,
    feedsTested: categoryFeeds.length,
    successfulFeeds,
    failedFeeds,
    totalArticles,
    recentArticles: totalRecentArticles,
    hasRecentArticles,
    results
  };
}

async function testAllCategories() {
  console.log('🔍 Testing RSS Feeds for Recent Articles (Last 6 Hours)');
  console.log(`📅 Test Date: ${new Date().toISOString()}`);
  console.log(`⏰ Time Window: Last 6 hours (from ${new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()})`);
  
  const categoryResults = [];

  for (const category of categories) {
    const result = await testCategoryForRecentArticles(category, 6);
    categoryResults.push(result);
    
    // Add delay between categories
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 SUMMARY - RSS Feeds Recent Articles Test (Last 6 Hours)');
  console.log('='.repeat(80));

  const categoriesWithFeeds = categoryResults.filter(r => r.feedsTested > 0);
  const categoriesWithoutFeeds = categoryResults.filter(r => r.feedsTested === 0);
  const categoriesWithRecentArticles = categoryResults.filter(r => r.hasRecentArticles);
  const categoriesWithoutRecentArticles = categoryResults.filter(r => r.feedsTested > 0 && !r.hasRecentArticles);

  console.log(`\n✅ Categories with RSS feeds: ${categoriesWithFeeds.length}/${categories.length}`);
  console.log(`📰 Categories with recent articles (last 6h): ${categoriesWithRecentArticles.length}/${categoriesWithFeeds.length}`);
  console.log(`⚠️  Categories without recent articles: ${categoriesWithoutRecentArticles.length}/${categoriesWithFeeds.length}`);
  console.log(`❌ Categories without RSS feeds: ${categoriesWithoutFeeds.length}/${categories.length}`);

  console.log('\n📋 Detailed Results by Category:\n');
  
  categoryResults.forEach(result => {
    if (result.feedsTested === 0) {
      console.log(`❌ ${result.category}: No RSS feeds configured`);
    } else if (result.hasRecentArticles) {
      console.log(`✅ ${result.category}: ${result.recentArticles} recent articles from ${result.successfulFeeds}/${result.feedsTested} feeds`);
    } else {
      console.log(`⚠️  ${result.category}: 0 recent articles (${result.totalArticles} total articles, but none in last 6h)`);
    }
  });

  console.log('\n' + '='.repeat(80));
  console.log('📈 Category Breakdown:\n');

  categoriesWithRecentArticles.forEach(result => {
    console.log(`✅ ${result.category}:`);
    result.results.forEach(r => {
      if (r.status === 'success' && r.recentArticles > 0) {
        console.log(`   - ${r.sourceName}: ${r.recentArticles} recent articles`);
      }
    });
  });

  if (categoriesWithoutRecentArticles.length > 0) {
    console.log(`\n⚠️  Categories without recent articles:`);
    categoriesWithoutRecentArticles.forEach(result => {
      console.log(`   ${result.category}: ${result.totalArticles} total articles, but none in last 6 hours`);
    });
  }

  if (categoriesWithoutFeeds.length > 0) {
    console.log(`\n❌ Categories without RSS feeds:`);
    categoriesWithoutFeeds.forEach(result => {
      console.log(`   ${result.category}`);
    });
  }

  return categoryResults;
}

// Run if called directly
if (require.main === module) {
  testAllCategories()
    .then(() => {
      console.log('\n✅ Testing complete');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Test script error:', error);
      process.exit(1);
    });
}

module.exports = { testAllCategories, testCategoryForRecentArticles, testFeedForRecentArticles };

