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
      const message = {
        to: pushToken,
        sound: 'default',
        title: notification.title,
        body: notification.body,
        data: notification.data || {},
        priority: 'high',
        channelId: 'default',
      };

      const response = await axios.post(this.expoPushApiUrl, message, {
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
      console.error('Error sending push notification:', error);
      return {
        success: false,
        error: error.message,
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
        title: '⛏️ Mining Complete!',
        body: 'Your mining session has ended. Claim your rewards now!',
        data: {
          type: 'mining_complete',
        },
      };

      return await this.sendNotification(user.pushToken, notification);
    } catch (error) {
      console.error('Error sending mining complete notification:', error);
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
      const referrer = await prisma.user.findUnique({
        where: { id: referrerId },
        select: { pushToken: true, username: true },
      });

      if (!referrer || !referrer.pushToken) {
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

      return await this.sendNotification(referrer.pushToken, notification);
    } catch (error) {
      console.error('Error sending new referral notification:', error);
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
        title: '🏆 Achievement Unlocked!',
        body: `You unlocked "${achievementName}" and earned ${points} $BUZZ!`,
        data: {
          type: 'achievement_unlocked',
          achievementName,
          points,
        },
      };

      return await this.sendNotification(user.pushToken, notification);
    } catch (error) {
      console.error('Error sending achievement unlocked notification:', error);
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



