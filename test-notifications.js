#!/usr/bin/env node

/**
 * Test Script for Push Notifications
 * 
 * This script tests all notification endpoints to verify push notifications
 * work when the app is closed.
 * 
 * Usage:
 *   node test-notifications.js <auth-token>
 * 
 * Or set AUTH_TOKEN environment variable:
 *   AUTH_TOKEN=your-token node test-notifications.js
 */

require('dotenv').config();
const axios = require('axios');

// Configuration
const API_BASE_URL = process.env.API_BASE_URL || 'https://api.buzznob.xyz/api';
const AUTH_TOKEN = process.argv[2] || process.env.AUTH_TOKEN;
const DELAY_BETWEEN_NOTIFICATIONS = 10000; // 10 seconds between notifications

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

// Test endpoints
const testEndpoints = [
  {
    name: 'General Test Notification',
    endpoint: '/users/test-notification',
    emoji: '🧪',
    description: 'Basic test notification',
  },
  {
    name: 'Daily Claim Notification',
    endpoint: '/users/test-daily-claim-notification',
    emoji: '🎁',
    description: 'Daily reward ready notification',
  },
  {
    name: 'Referral Notification',
    endpoint: '/users/test-referral-notification',
    emoji: '👥',
    description: 'New referral joined notification',
  },
  {
    name: 'Mining Notification',
    endpoint: '/users/test-mining-notification',
    emoji: '⛏️',
    description: 'Mining session completed notification',
  },
  {
    name: 'Achievement Notification',
    endpoint: '/users/test-achievement-notification',
    emoji: '🏆',
    description: 'Achievement unlocked notification',
  },
  {
    name: 'Remind Inactive Notification',
    endpoint: '/referrals/test-remind-inactive',
    emoji: '📢',
    description: 'Remind inactive referrals to mine',
  },
];

// Helper function to sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to make API request
async function testNotification(endpoint, name, emoji) {
  try {
    console.log(`\n${colors.cyan}${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
    console.log(`${colors.bright}${emoji} Testing: ${name}${colors.reset}`);
    console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);

    const response = await axios.post(
      `${API_BASE_URL}${endpoint}`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${AUTH_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000, // 30 second timeout
      }
    );

    if (response.data.success) {
      console.log(`${colors.green}✅ SUCCESS${colors.reset}`);
      console.log(`   Message: ${response.data.message}`);
      
      if (response.data.expoResponse?.data?.id) {
        console.log(`   Expo Notification ID: ${response.data.expoResponse.data.id}`);
      }
      
      return { success: true, data: response.data };
    } else {
      console.log(`${colors.red}❌ FAILED${colors.reset}`);
      console.log(`   Error: ${response.data.error || response.data.message}`);
      
      if (response.data.expoError) {
        console.log(`   Expo Error: ${JSON.stringify(response.data.expoError, null, 2)}`);
      }
      
      return { success: false, error: response.data.error || response.data.message };
    }
  } catch (error) {
    console.log(`${colors.red}❌ ERROR${colors.reset}`);
    
    if (error.response) {
      // Server responded with error status
      console.log(`   Status: ${error.response.status}`);
      console.log(`   Error: ${error.response.data?.error || error.response.data?.message || 'Unknown error'}`);
    } else if (error.request) {
      // Request made but no response
      console.log(`   Network Error: No response from server`);
      console.log(`   URL: ${API_BASE_URL}${endpoint}`);
    } else {
      // Error setting up request
      console.log(`   Error: ${error.message}`);
    }
    
    return { success: false, error: error.message };
  }
}

// Main function
async function runTests() {
  console.log(`${colors.bright}${colors.magenta}`);
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║     Push Notification Test Script                        ║');
  console.log('║     Testing notifications with app closed                 ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`${colors.reset}\n`);

  // Check if auth token is provided
  if (!AUTH_TOKEN) {
    console.log(`${colors.red}❌ Error: Authentication token required!${colors.reset}\n`);
    console.log(`Usage:`);
    console.log(`  node test-notifications.js <auth-token>`);
    console.log(`\nOr set environment variable:`);
    console.log(`  AUTH_TOKEN=your-token node test-notifications.js\n`);
    console.log(`To get your auth token:`);
    console.log(`  1. Open your app and log in`);
    console.log(`  2. Check the app logs for "Token stored successfully"`);
    console.log(`  3. Or check AsyncStorage in React Native Debugger\n`);
    process.exit(1);
  }

  console.log(`${colors.blue}Configuration:${colors.reset}`);
  console.log(`  API Base URL: ${API_BASE_URL}`);
  console.log(`  Auth Token: ${AUTH_TOKEN.substring(0, 20)}...`);
  console.log(`  Delay between notifications: ${DELAY_BETWEEN_NOTIFICATIONS / 1000} seconds\n`);

  console.log(`${colors.yellow}⚠️  IMPORTANT: Close your app now before we start testing!${colors.reset}`);
  console.log(`${colors.yellow}   The notifications should appear even with the app closed.${colors.reset}\n`);

  // Wait 5 seconds for user to close app
  console.log(`${colors.cyan}Starting in 5 seconds...${colors.reset}`);
  await sleep(5000);

  const results = [];
  let successCount = 0;
  let failCount = 0;

  // Test each notification endpoint
  for (let i = 0; i < testEndpoints.length; i++) {
    const test = testEndpoints[i];
    
    const result = await testNotification(test.endpoint, test.name, test.emoji);
    results.push({ ...test, result });

    if (result.success) {
      successCount++;
    } else {
      failCount++;
    }

    // Wait before next notification (except for the last one)
    if (i < testEndpoints.length - 1) {
      console.log(`\n${colors.yellow}⏳ Waiting ${DELAY_BETWEEN_NOTIFICATIONS / 1000} seconds before next notification...${colors.reset}`);
      await sleep(DELAY_BETWEEN_NOTIFICATIONS);
    }
  }

  // Summary
  console.log(`\n${colors.bright}${colors.magenta}`);
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║                    Test Summary                           ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`${colors.reset}\n`);

  results.forEach((test, index) => {
    const status = test.result.success 
      ? `${colors.green}✅${colors.reset}` 
      : `${colors.red}❌${colors.reset}`;
    console.log(`${status} ${test.emoji} ${test.name}`);
    if (!test.result.success) {
      console.log(`   ${colors.red}Error: ${test.result.error}${colors.reset}`);
    }
  });

  console.log(`\n${colors.bright}Results:${colors.reset}`);
  console.log(`  ${colors.green}✅ Successful: ${successCount}${colors.reset}`);
  console.log(`  ${colors.red}❌ Failed: ${failCount}${colors.reset}`);
  console.log(`  📊 Total: ${results.length}\n`);

  if (successCount === results.length) {
    console.log(`${colors.green}${colors.bright}🎉 All notifications sent successfully!${colors.reset}`);
    console.log(`${colors.cyan}Check your phone - you should see ${results.length} notifications!${colors.reset}\n`);
  } else {
    console.log(`${colors.yellow}⚠️  Some notifications failed. Check the errors above.${colors.reset}\n`);
  }

  process.exit(failCount > 0 ? 1 : 0);
}

// Run the tests
runTests().catch(error => {
  console.error(`${colors.red}❌ Fatal error:${colors.reset}`, error);
  process.exit(1);
});


