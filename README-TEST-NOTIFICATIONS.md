# Testing Push Notifications

This guide explains how to test push notifications when the app is closed.

## Quick Start

1. **Get your authentication token:**
   - Open your app and log in
   - The token is stored in AsyncStorage as `accessToken`
   - You can find it in React Native Debugger or check app logs

2. **Close your app completely** (important!)

3. **Run the test script:**
   ```bash
   cd backend
   node test-notifications.js YOUR_AUTH_TOKEN
   ```

   Or set it as environment variable:
   ```bash
   AUTH_TOKEN=your-token node test-notifications.js
   ```

## What the Script Does

The script will:
1. Test all 4 notification types sequentially:
   - 🧪 General Test Notification
   - 👥 Referral Notification
   - ⛏️ Mining Notification
   - 🏆 Achievement Notification

2. Wait 10 seconds between each notification (so you can see them separately)

3. Show results for each test

## Getting Your Auth Token

### Method 1: From App Logs
1. Open your app
2. Log in
3. Check console logs for "Token stored successfully"
4. The token is the JWT string

### Method 2: From React Native Debugger
1. Open React Native Debugger
2. Go to AsyncStorage
3. Look for key: `accessToken`
4. Copy the value

### Method 3: From Backend Logs
1. When you log in, backend logs show the token
2. Look for JWT token in login response

### Method 4: Add Temporary Logging
Add this to your app temporarily:
```javascript
// In App.js or authService.js
const token = await AsyncStorage.getItem('accessToken');
console.log('🔑 AUTH TOKEN:', token);
```

## Expected Behavior

When you run the script:
- ✅ You should receive 4 push notifications on your phone
- ✅ Notifications should appear even with the app closed
- ✅ Each notification should have a different message
- ✅ Tapping a notification should open the app

## Troubleshooting

### No notifications received?
1. Check that your push token is registered in the database
2. Verify FCM credentials are uploaded to Expo
3. Check backend logs for errors
4. Ensure your phone has internet connection

### "Unauthorized" error?
- Your auth token might be expired
- Get a fresh token by logging in again

### "No push token" error?
- Make sure you've opened the app at least once after setting up notifications
- Check that push token is registered in database

## Example Output

```
╔══════════════════════════════════════════════════════════╗
║     Push Notification Test Script                        ║
║     Testing notifications with app closed                 ║
╚══════════════════════════════════════════════════════════╝

Configuration:
  API Base URL: https://api.buzznob.xyz/api
  Auth Token: eyJhbGciOiJIUzI1NiIs...
  Delay between notifications: 10 seconds

⚠️  IMPORTANT: Close your app now before we start testing!
   The notifications should appear even with the app closed.

Starting in 5 seconds...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧪 Testing: General Test Notification
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ SUCCESS
   Message: Test notification sent successfully
   Expo Notification ID: 019a77f5-8d1f-7f29-9339-2491c5dc851a

⏳ Waiting 10 seconds before next notification...
```


