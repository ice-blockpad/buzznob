/**
 * Base Authentication Service
 * 
 * Handles SIWE (Sign-In With Ethereum) verification for Base smart wallets
 * Implements EIP-4361 standard
 */

const { ethers } = require('ethers');

// Base Mainnet chain ID
const BASE_CHAIN_ID = 8453;

/**
 * Verify SIWE signature
 * @param {string} address - Wallet address
 * @param {string} message - SIWE message
 * @param {string} signature - Signature
 * @returns {Promise<boolean>} - True if signature is valid
 */
async function verifySIWESignature(address, message, signature) {
  try {
    // Recover address from signature
    const recoveredAddress = ethers.verifyMessage(message, signature);
    
    // Normalize addresses for comparison (case-insensitive)
    const normalizedRecovered = recoveredAddress.toLowerCase();
    const normalizedProvided = address.toLowerCase();
    
    return normalizedRecovered === normalizedProvided;
  } catch (error) {
    console.error('SIWE signature verification error:', error);
    return false;
  }
}

/**
 * Parse SIWE message
 * @param {string} message - SIWE message
 * @returns {Object} - Parsed message components
 */
function parseSIWEMessage(message) {
  const lines = message.split('\n');
  const parsed = {
    domain: null,
    address: null,
    uri: null,
    version: null,
    chainId: null,
    nonce: null,
    issuedAt: null,
  };
  
  for (const line of lines) {
    if (line.includes('wants you to sign in')) {
      parsed.domain = line.split(' wants')[0].trim();
    } else if (line.startsWith('0x') && line.length === 42) {
      parsed.address = line.trim();
    } else if (line.startsWith('URI:')) {
      parsed.uri = line.split('URI:')[1].trim();
    } else if (line.startsWith('Version:')) {
      parsed.version = line.split('Version:')[1].trim();
    } else if (line.startsWith('Chain ID:')) {
      parsed.chainId = parseInt(line.split('Chain ID:')[1].trim());
    } else if (line.startsWith('Nonce:')) {
      parsed.nonce = line.split('Nonce:')[1].trim();
    } else if (line.startsWith('Issued At:')) {
      parsed.issuedAt = line.split('Issued At:')[1].trim();
    }
  }
  
  return parsed;
}

/**
 * Validate SIWE message
 * @param {string} message - SIWE message
 * @param {string} address - Wallet address
 * @param {string} nonce - Expected nonce
 * @param {string} domain - Expected domain
 * @returns {boolean} - True if message is valid
 */
function validateSIWEMessage(message, address, nonce, domain) {
  try {
    const parsed = parseSIWEMessage(message);
    
    // Validate address matches
    if (parsed.address?.toLowerCase() !== address.toLowerCase()) {
      return false;
    }
    
    // Validate chain ID (should be Base Mainnet)
    if (parsed.chainId !== BASE_CHAIN_ID) {
      return false;
    }
    
    // Validate nonce
    if (parsed.nonce !== nonce) {
      return false;
    }
    
    // Validate domain (optional - can be flexible)
    if (domain && parsed.domain && !parsed.domain.includes(domain)) {
      // Allow subdomains
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('SIWE message validation error:', error);
    return false;
  }
}

/**
 * Generate nonce for SIWE
 * @returns {string} - Random nonce
 */
function generateNonce() {
  return ethers.hexlify(ethers.randomBytes(16));
}

module.exports = {
  verifySIWESignature,
  parseSIWEMessage,
  validateSIWEMessage,
  generateNonce,
  BASE_CHAIN_ID,
};

