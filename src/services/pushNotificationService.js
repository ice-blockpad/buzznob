const axios = require('axios');
const { prisma } = require('../config/database');

/**
 * Expo Push Notification Service
 * Sends push notifications using Expo's Push Notification API
 */
class PushNotificationService {
  constructor() {
    // Expo Push Notification API endpoint
    this.expoPushApiUrl = 'https://exp.host/--/api/v2/push/send';
  }

  /**
   * Send push notification to a single device
   * @param {string} pushToken - Expo push token
   * @param {Object} notification - Notification data
   * @returns {Promise<Object>} Response from Expo API
   */
  async sendNotification(pushToken, notification) {
    try {
      console.log('📤 [PUSH NOTIFICATION] Starting to send notification...');
      console.log('📤 [PUSH NOTIFICATION] Push Token:', pushToken ? `${pushToken.substring(0, 20)}...` : 'NULL');
      console.log('📤 [PUSH NOTIFICATION] Notification:', JSON.stringify(notification, null, 2));

      const message = {
        to: pushToken,
        sound: 'default',
        title: notification.title,
        body: notification.body,
        data: notification.data || {},
        priority: 'high',
        channelId: 'default',
      };

      console.log('📤 [PUSH NOTIFICATION] Sending to Expo API:', this.expoPushApiUrl);
      console.log('📤 [PUSH NOTIFICATION] Message payload:', JSON.stringify(message, null, 2));

      const response = await axios.post(this.expoPushApiUrl, message, {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
      });

      console.log('✅ [PUSH NOTIFICATION] Expo API Response Status:', response.status);
      console.log('✅ [PUSH NOTIFICATION] Expo API Response Data:', JSON.stringify(response.data, null, 2));

      // Check Expo response status
      // Expo returns: { data: { status: "ok"|"error", message: "...", ... } } for single notification
      // Or: { data: [{ status: "ok"|"error", ... }, ...] } for multiple notifications
      let expoResponse = null;
      
      if (response.data && response.data.data) {
        if (Array.isArray(response.data.data)) {
          // Multiple notifications
          expoResponse = response.data.data[0];
        } else {
          // Single notification (object, not array)
          expoResponse = response.data.data;
        }
      }

      if (expoResponse) {
        console.log('📊 [PUSH NOTIFICATION] Expo Response Status:', expoResponse.status);
        console.log('📊 [PUSH NOTIFICATION] Expo Response ID:', expoResponse.id || 'N/A');
        
        if (expoResponse.status === 'error') {
          console.error('❌ [PUSH NOTIFICATION] Expo returned error:', expoResponse.message);
          console.error('❌ [PUSH NOTIFICATION] Error details:', JSON.stringify(expoResponse.details, null, 2));
          return {
            success: false,
            error: expoResponse.message || 'Expo API returned error',
            expoError: expoResponse,
            data: response.data,
          };
        } else if (expoResponse.status === 'ok') {
          console.log('✅ [PUSH NOTIFICATION] Expo accepted notification successfully');
          console.log('✅ [PUSH NOTIFICATION] Notification ID:', expoResponse.id);
        }
      } else {
        console.warn('⚠️ [PUSH NOTIFICATION] Unexpected Expo response format');
      }

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      console.error('❌ [PUSH NOTIFICATION] Error sending push notification:', error.message);
      console.error('❌ [PUSH NOTIFICATION] Error details:', error.response?.data || error.message);
      return {
        success: false,
        error: error.message,
        errorDetails: error.response?.data,
      };
    }
  }

  /**
   * Send push notification to multiple devices
   * @param {string[]} pushTokens - Array of Expo push tokens
   * @param {Object} notification - Notification data
   * @returns {Promise<Object>} Response from Expo API
   */
  async sendBulkNotifications(pushTokens, notification) {
    try {
      const messages = pushTokens.map((token) => ({
        to: token,
        sound: 'default',
        title: notification.title,
        body: notification.body,
        data: notification.data || {},
        priority: 'high',
        channelId: 'default',
      }));

      const response = await axios.post(this.expoPushApiUrl, messages, {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
      });

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      console.error('Error sending bulk push notifications:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Send mining completion notification to user
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Result
   */
  async sendMiningCompleteNotification(userId) {
    try {
      console.log('⛏️ [MINING NOTIFICATION] Starting for user:', userId);
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { pushToken: true, username: true },
      });

      console.log('⛏️ [MINING NOTIFICATION] User found:', user ? `Yes (${user.username})` : 'No');
      console.log('⛏️ [MINING NOTIFICATION] Push token exists:', user?.pushToken ? 'Yes' : 'No');

      if (!user || !user.pushToken) {
        console.warn('⚠️ [MINING NOTIFICATION] User not found or no push token registered');
        return {
          success: false,
          message: 'User not found or no push token registered',
        };
      }

      const notification = {
        title: '⛏️ Mining Complete!',
        body: 'Your mining session has ended. Claim your rewards now!',
        data: {
          type: 'mining_complete',
        },
      };

      console.log('⛏️ [MINING NOTIFICATION] Calling sendNotification...');
      const result = await this.sendNotification(user.pushToken, notification);
      console.log('⛏️ [MINING NOTIFICATION] Result:', result.success ? '✅ Success' : '❌ Failed');
      return result;
    } catch (error) {
      console.error('❌ [MINING NOTIFICATION] Error sending mining complete notification:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Send daily claim notification to user
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Result
   */
  async sendDailyClaimNotification(userId) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { pushToken: true, username: true },
      });

      if (!user || !user.pushToken) {
        return {
          success: false,
          message: 'User not found or no push token registered',
        };
      }

      const notification = {
        title: '🎁 Daily Reward Available!',
        body: 'Your daily reward is ready to claim!',
        data: {
          type: 'daily_claim',
        },
      };

      return await this.sendNotification(user.pushToken, notification);
    } catch (error) {
      console.error('Error sending daily claim notification:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Send new referral notification to referrer
   * @param {string} referrerId - Referrer user ID
   * @param {string} referralName - Name of the new referral
   * @returns {Promise<Object>} Result
   */
  async sendNewReferralNotification(referrerId, referralName) {
    try {
      console.log('👥 [REFERRAL NOTIFICATION] Starting for referrer:', referrerId);
      console.log('👥 [REFERRAL NOTIFICATION] Referral name:', referralName);
      
      const referrer = await prisma.user.findUnique({
        where: { id: referrerId },
        select: { pushToken: true, username: true },
      });

      console.log('👥 [REFERRAL NOTIFICATION] Referrer found:', referrer ? `Yes (${referrer.username})` : 'No');
      console.log('👥 [REFERRAL NOTIFICATION] Push token exists:', referrer?.pushToken ? 'Yes' : 'No');

      if (!referrer || !referrer.pushToken) {
        console.warn('⚠️ [REFERRAL NOTIFICATION] Referrer not found or no push token registered');
        return {
          success: false,
          message: 'Referrer not found or no push token registered',
        };
      }

      const notification = {
        title: '👥 New Referral!',
        body: `${referralName} joined using your referral code!`,
        data: {
          type: 'new_referral',
          referralName,
        },
      };

      console.log('👥 [REFERRAL NOTIFICATION] Calling sendNotification...');
      const result = await this.sendNotification(referrer.pushToken, notification);
      console.log('👥 [REFERRAL NOTIFICATION] Result:', result.success ? '✅ Success' : '❌ Failed');
      return result;
    } catch (error) {
      console.error('❌ [REFERRAL NOTIFICATION] Error sending new referral notification:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Send achievement unlocked notification to user
   * @param {string} userId - User ID
   * @param {string} achievementName - Name of the achievement
   * @param {number} points - Points earned
   * @returns {Promise<Object>} Result
   */
  async sendAchievementUnlockedNotification(userId, achievementName, points) {
    try {
      console.log('🏆 [ACHIEVEMENT NOTIFICATION] Starting for user:', userId);
      console.log('🏆 [ACHIEVEMENT NOTIFICATION] Achievement name:', achievementName);
      console.log('🏆 [ACHIEVEMENT NOTIFICATION] Points earned:', points);
      
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { pushToken: true, username: true },
      });

      console.log('🏆 [ACHIEVEMENT NOTIFICATION] User found:', user ? `Yes (${user.username})` : 'No');
      console.log('🏆 [ACHIEVEMENT NOTIFICATION] Push token exists:', user?.pushToken ? 'Yes' : 'No');

      if (!user || !user.pushToken) {
        console.warn('⚠️ [ACHIEVEMENT NOTIFICATION] User not found or no push token registered');
        return {
          success: false,
          message: 'User not found or no push token registered',
        };
      }

      const notification = {
        title: '🏆 Achievement Unlocked!',
        body: `You unlocked "${achievementName}" and earned ${points} $BUZZ!`,
        data: {
          type: 'achievement_unlocked',
          achievementName,
          points,
        },
      };

      console.log('🏆 [ACHIEVEMENT NOTIFICATION] Calling sendNotification...');
      const result = await this.sendNotification(user.pushToken, notification);
      console.log('🏆 [ACHIEVEMENT NOTIFICATION] Result:', result.success ? '✅ Success' : '❌ Failed');
      return result;
    } catch (error) {
      console.error('❌ [ACHIEVEMENT NOTIFICATION] Error sending achievement unlocked notification:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Send notification to all users with push tokens
   * @param {Object} notification - Notification data
   * @returns {Promise<Object>} Result
   */
  async sendBroadcastNotification(notification) {
    try {
      const users = await prisma.user.findMany({
        where: {
          pushToken: { not: null },
          isActive: true,
        },
        select: { pushToken: true },
      });

      if (users.length === 0) {
        return {
          success: false,
          message: 'No users with push tokens found',
        };
      }

      const pushTokens = users.map((user) => user.pushToken).filter(Boolean);

      return await this.sendBulkNotifications(pushTokens, notification);
    } catch (error) {
      console.error('Error sending broadcast notification:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

const pushNotificationService = new PushNotificationService();
module.exports = pushNotificationService;



