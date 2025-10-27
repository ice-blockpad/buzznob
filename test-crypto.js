const { encryptPrivateKey, decryptPrivateKey, hashPassword, verifyPassword } = require('./src/utils/crypto');

console.log('Testing crypto functions...');

// Test data
const testPrivateKey = JSON.stringify([1, 2, 3, 4, 5]);
const testPassword = '123456';

try {
  // Test encryption/decryption
  console.log('1. Testing encryption/decryption...');
  const encrypted = encryptPrivateKey(testPrivateKey, testPassword);
  console.log('✅ Encryption successful');
  
  const decrypted = decryptPrivateKey(encrypted, testPassword);
  console.log('✅ Decryption successful');
  console.log('Decrypted matches original:', decrypted === testPrivateKey);
  
  // Test password hashing/verification
  console.log('\n2. Testing password hashing/verification...');
  const hash = hashPassword(testPassword);
  console.log('✅ Password hashing successful');
  
  const isValid = verifyPassword(testPassword, hash);
  console.log('✅ Password verification successful');
  console.log('Password verification result:', isValid);
  
  // Test with wrong password
  const wrongPassword = '654321';
  const isInvalid = verifyPassword(wrongPassword, hash);
  console.log('Wrong password verification result:', isInvalid);
  
  console.log('\n✅ All crypto functions working correctly!');
  
} catch (error) {
  console.error('❌ Crypto test failed:', error);
}
