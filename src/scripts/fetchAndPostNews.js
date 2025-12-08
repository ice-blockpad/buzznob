/**
 * Main News Automation Script
 * Fetches news from all providers and creates articles in pending status
 * Can be run manually or via cron job
 */

require('dotenv').config();
const { connectDB, disconnectDB } = require('../config/database');
const newsService = require('../services/newsService');
const articleProcessor = require('../services/articleProcessor');
const apiUsageTracker = require('../services/apiUsageTracker');

/**
 * Main function to fetch and post news
 */
async function fetchAndPostNews(options = {}) {
  const {
    categories = ['DEFI', 'FINANCE', 'POLITICS', 'SPORT', 'ENTERTAINMENT', 'WEATHER', 'TECHNOLOGY', 'BUSINESS', 'OTHERS'], // HEALTH and SCIENCE removed - not using RSS for these
    maxArticlesPerCategory = 10, // Maximum 10 articles per category from past 6 hours
    articlesPerProvider = null, // No limit - fetch all articles from each provider
    dryRun = false
  } = options;

  console.log('\n🚀 Starting news automation...');
  console.log(`📋 Categories: ${categories.join(', ')}`);
  console.log(`📊 Max articles per category: ${maxArticlesPerCategory} (all within time window)`);
  console.log(`📰 Articles per provider: Unlimited (all within time window)`);
  console.log(`⏰ Time filter: Last 6 hours only`);
  console.log(`🔍 Dry run: ${dryRun ? 'YES' : 'NO'}\n`);

  try {
    // Connect to database
    await connectDB();

    let totalFetched = 0;
    let totalCreated = 0;
    let totalDuplicates = 0;
    let totalErrors = 0;

    // Fetch news for each category
    for (const category of categories) {
      console.log(`\n📰 Fetching ${category} news...`);

      try {
        // Special handling for SPORT and OTHERS categories
        let fetchOptions = {
          category,
          maxArticles: maxArticlesPerCategory,
          articlesPerProvider: articlesPerProvider,
          hoursAgo: 6 // Only get articles from last 6 hours
        };
        
        // For SPORT: ESPN gets 5 per category, BBC Sport gets 10
        if (category === 'SPORT') {
          fetchOptions.maxArticles = 1000; // High limit to get all ESPN categories
          console.log(`   📋 SPORT category: ESPN (5 per category) + BBC Sport (10)`);
        }
        
        // For OTHERS: Fetch 20 articles
        if (category === 'OTHERS') {
          fetchOptions.maxArticles = 20;
          console.log(`   📋 OTHERS category: 20 articles (BBC feeds will be auto-categorized)`);
        }
        
        // Fetch news from ALL RSS providers (all articles within last 6 hours)
        const fetchResult = await newsService.fetchNews(fetchOptions);

        if (fetchResult.success && fetchResult.articles.length > 0) {
          console.log(`✅ Fetched ${fetchResult.articles.length} articles from ${fetchResult.provider} (${articlesPerProvider} per provider)`);
          if (fetchResult.skippedProviders && fetchResult.skippedProviders.length > 0) {
            console.log(`⏭️  Skipped providers (no date filter support): ${fetchResult.skippedProviders.join(', ')}`);
          }

          if (!dryRun) {
            // Process and create articles (pass category for SPORT filtering)
            const processResult = await articleProcessor.processArticles(fetchResult.articles, category);

            totalFetched += processResult.total;
            totalCreated += processResult.created;
            totalDuplicates += processResult.duplicates;
            totalErrors += processResult.errors;

            console.log(`📊 Results for ${category}:`);
            console.log(`   ✅ Created: ${processResult.created}`);
            console.log(`   ⏭️  Duplicates: ${processResult.duplicates}`);
            console.log(`   ⚠️  Errors: ${processResult.errors}`);
            console.log(`   ⏭️  Skipped: ${processResult.skipped}`);
          } else {
            console.log(`🔍 Dry run: Would process ${fetchResult.articles.length} articles`);
            totalFetched += fetchResult.articles.length;
          }
        } else {
          console.log(`❌ Failed to fetch ${category} news: ${fetchResult.error || 'No articles returned'}`);
        }
      } catch (error) {
        console.error(`❌ Error fetching ${category} news:`, error);
        totalErrors++;
      }

      // Small delay between categories
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Get processing statistics
    const stats = await articleProcessor.getProcessingStats();
    const usageStats = await apiUsageTracker.getUsageStats();

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    console.log(`📰 Total fetched: ${totalFetched}`);
    if (!dryRun) {
      console.log(`✅ Total created: ${totalCreated}`);
      console.log(`⏭️  Total duplicates: ${totalDuplicates}`);
      console.log(`⚠️  Total errors: ${totalErrors}`);
      console.log(`\n📈 Database Stats:`);
      console.log(`   Pending articles: ${stats.totalPending}`);
      console.log(`   Created today: ${stats.todayCreated}`);
      console.log(`   Total published: ${stats.totalPublished}`);
    }
    console.log(`\n📊 API Usage Stats:`);
    for (const [provider, stat] of Object.entries(usageStats)) {
      if (stat.limit !== Infinity) {
        console.log(`   ${provider}: ${stat.usage}/${stat.limit} (${stat.percentage}%) ${stat.available ? '✅' : '❌'}`);
      } else {
        console.log(`   ${provider}: Unlimited ✅`);
      }
    }
    console.log('='.repeat(60) + '\n');

    return {
      success: true,
      totalFetched,
      totalCreated,
      totalDuplicates,
      totalErrors,
      stats,
      usageStats
    };
  } catch (error) {
    console.error('❌ Fatal error in news automation:', error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    // Disconnect from database
    await disconnectDB();
  }
}

// Run if called directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-d');
  const categoryArg = args.find(arg => arg.startsWith('--category='));
  const categories = categoryArg
    ? [categoryArg.split('=')[1].toUpperCase()]
    : ['DEFI', 'FINANCE', 'POLITICS', 'SPORT', 'ENTERTAINMENT', 'WEATHER', 'TECHNOLOGY', 'BUSINESS', 'OTHERS']; // HEALTH and SCIENCE removed - not using RSS for these

  fetchAndPostNews({
    categories,
    maxArticlesPerCategory: 10,
    dryRun
  })
    .then(result => {
      if (result.success) {
        console.log('✅ News automation completed successfully');
        process.exit(0);
      } else {
        console.error('❌ News automation failed');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('❌ Unhandled error:', error);
      process.exit(1);
    });
}

module.exports = fetchAndPostNews;

