const axios = require('axios');

const BASE_URL = 'http://localhost:8001/api';

async function testAPI() {
  console.log('🧪 Testing Buzznob API...\n');

  try {
    // Test health endpoint
    console.log('1. Testing health endpoint...');
    const healthResponse = await axios.get(`${BASE_URL.replace('/api', '')}/health`);
    console.log('✅ Health check:', healthResponse.data.status);

    // Test articles endpoint
    console.log('\n2. Testing articles endpoint...');
    const articlesResponse = await axios.get(`${BASE_URL}/articles?limit=5`);
    console.log('✅ Articles fetched:', articlesResponse.data.data.articles.length, 'articles');

    // Test search endpoint
    console.log('\n3. Testing search endpoint...');
    const searchResponse = await axios.get(`${BASE_URL}/articles/search?q=bitcoin`);
    console.log('✅ Search results:', searchResponse.data.data.articles.length, 'articles found');

    // Test trending endpoint
    console.log('\n4. Testing trending endpoint...');
    const trendingResponse = await axios.get(`${BASE_URL}/articles/trending?limit=3`);
    console.log('✅ Trending articles:', trendingResponse.data.data.articles.length, 'articles');

    // Test rewards endpoint
    console.log('\n5. Testing rewards endpoint...');
    const rewardsResponse = await axios.get(`${BASE_URL}/rewards/available`);
    console.log('✅ Available rewards:', rewardsResponse.data.data.rewards.length, 'rewards');

    // Test badges endpoint
    console.log('\n6. Testing badges endpoint...');
    const badgesResponse = await axios.get(`${BASE_URL}/rewards/badges`);
    console.log('✅ Available badges:', badgesResponse.data.data.badges.length, 'badges');

    // Test leaderboard endpoint
    console.log('\n7. Testing leaderboard endpoint...');
    const leaderboardResponse = await axios.get(`${BASE_URL}/rewards/leaderboard?limit=10`);
    console.log('✅ Leaderboard:', leaderboardResponse.data.data.leaderboard.length, 'users');

    console.log('\n🎉 All API tests passed successfully!');
    console.log('\n📊 API Summary:');
    console.log(`- Health: ${healthResponse.data.status}`);
    console.log(`- Articles: ${articlesResponse.data.data.articles.length} available`);
    console.log(`- Search: ${searchResponse.data.data.articles.length} results for "bitcoin"`);
    console.log(`- Trending: ${trendingResponse.data.data.articles.length} trending articles`);
    console.log(`- Rewards: ${rewardsResponse.data.data.rewards.length} available rewards`);
    console.log(`- Badges: ${badgesResponse.data.data.badges.length} available badges`);
    console.log(`- Leaderboard: ${leaderboardResponse.data.data.leaderboard.length} users`);

  } catch (error) {
    console.error('❌ API test failed:', error.response?.data || error.message);
    process.exit(1);
  }
}

// Run tests
testAPI();
