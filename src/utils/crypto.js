const crypto = require('crypto');

// Use consistent salt for all operations
const SALT = 'buzznob-wallet-salt';

/**
 * Encrypt private key with user's password
 */
function encryptPrivateKey(privateKey, password) {
  const algorithm = 'aes-256-cbc';
  const key = crypto.scryptSync(password, SALT, 32);
  const iv = crypto.randomBytes(16);
  
  const cipher = crypto.createCipher(algorithm, key);
  
  let encrypted = cipher.update(privateKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return {
    encrypted,
    iv: iv.toString('hex'),
    algorithm
  };
}

/**
 * Decrypt private key with user's password
 */
function decryptPrivateKey(encryptedData, password) {
  const algorithm = 'aes-256-cbc';
  const key = crypto.scryptSync(password, SALT, 32);
  const iv = Buffer.from(encryptedData.iv, 'hex');
  
  const decipher = crypto.createDecipher(algorithm, key);
  
  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Hash password for storage
 */
function hashPassword(password) {
  return crypto.scryptSync(password, SALT, 64).toString('hex');
}

/**
 * Verify password
 */
function verifyPassword(password, hash) {
  const testHash = crypto.scryptSync(password, SALT, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(testHash));
}

module.exports = {
  encryptPrivateKey,
  decryptPrivateKey,
  hashPassword,
  verifyPassword
};
