const express = require('express');
const { prisma } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');
const { Keypair, PublicKey, Connection, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { getAssociatedTokenAddress, getAccount } = require('@solana/spl-token');
const { encryptPrivateKey, decryptPrivateKey, hashPassword, verifyPassword } = require('../utils/crypto');

const router = express.Router();

// Initialize Solana connection
const connection = new Connection('https://api.mainnet-beta.solana.com');

// Create new wallet
router.post('/create', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { password } = req.body;

    if (!password || password.length !== 6) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_PASSWORD',
        message: 'Password must be exactly 6 digits'
      });
    }

    // Check if user already has a wallet
    const existingWallet = await prisma.walletData.findFirst({
      where: { userId, isActive: true }
    });

    if (existingWallet) {
      return res.status(400).json({
        success: false,
        error: 'WALLET_ALREADY_EXISTS',
        message: 'User already has an active wallet'
      });
    }

    // Generate new Solana keypair
    const keypair = Keypair.generate();
    const publicKey = keypair.publicKey.toString();
    const privateKey = Array.from(keypair.secretKey);

    // Encrypt private key with user's PIN
    const encryptedPrivateKey = encryptPrivateKey(JSON.stringify(privateKey), password);
    const passwordHash = hashPassword(password);

    // Store encrypted wallet data in database
    const walletData = await prisma.walletData.create({
      data: {
        userId,
        publicKey,
        encryptedPrivateKey: JSON.stringify(encryptedPrivateKey),
        passwordHash,
        isActive: true
      }
    });

    // Update user's wallet address
    await prisma.user.update({
      where: { id: userId },
      data: { walletAddress: publicKey }
    });

    res.json({
      success: true,
      message: 'Solana wallet created successfully',
      data: {
        publicKey,
        walletId: walletData.id,
        createdAt: walletData.createdAt,
        encrypted: true
      }
    });
  } catch (error) {
    console.error('Error creating wallet:', error);
    res.status(500).json({
      success: false,
      error: 'WALLET_CREATE_ERROR',
      message: 'Failed to create wallet'
    });
  }
});

// Get wallet balance
router.get('/balance', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { publicKey } = req.query;

    let walletPublicKey = publicKey;

    // If no publicKey provided, get from user's wallet
    if (!walletPublicKey) {
      const walletData = await prisma.walletData.findFirst({
        where: { userId, isActive: true }
      });

      if (!walletData) {
        return res.status(404).json({
          success: false,
          error: 'WALLET_NOT_FOUND',
          message: 'No active wallet found for user'
        });
      }

      walletPublicKey = walletData.publicKey;
    }

    try {
      const balance = await connection.getBalance(new PublicKey(walletPublicKey));
      const solBalance = balance / LAMPORTS_PER_SOL;

      res.json({
        success: true,
        data: {
          publicKey: walletPublicKey,
          balance: solBalance,
          lamports: balance
        }
      });
    } catch (solanaError) {
      console.error('Solana balance fetch error:', solanaError);
      res.status(500).json({
        success: false,
        error: 'SOLANA_BALANCE_ERROR',
        message: 'Failed to fetch balance from Solana network'
      });
    }
  } catch (error) {
    console.error('Error fetching balance:', error);
    res.status(500).json({
      success: false,
      error: 'BALANCE_FETCH_ERROR',
      message: 'Failed to fetch balance'
    });
  }
});

// Send tokens
router.post('/send', async (req, res) => {
  try {
    const { from, to, amount, password } = req.body;

    if (!from || !to || !amount || !password) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    if (password.length !== 6) {
      return res.status(400).json({
        success: false,
        message: 'Invalid password'
      });
    }

    // In a real app, you'd:
    // 1. Verify the password
    // 2. Decrypt the private key
    // 3. Create and send the transaction

    // For now, simulate the transaction
    const transactionId = 'mock-tx-' + Date.now();

    res.json({
      success: true,
      data: {
        transactionId,
        amount,
        to,
        from
      }
    });
  } catch (error) {
    console.error('Error sending tokens:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send tokens'
    });
  }
});

// Get token accounts
router.get('/tokens', async (req, res) => {
  try {
    const { publicKey } = req.query;

    if (!publicKey) {
      return res.status(400).json({
        success: false,
        message: 'Public key is required'
      });
    }

    // Get all token accounts
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(new PublicKey(publicKey), {
      programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    });

    const tokens = tokenAccounts.value.map(account => {
      const parsedInfo = account.account.data.parsed.info;
      return {
        mint: parsedInfo.mint,
        balance: parsedInfo.tokenAmount.uiAmount || 0,
        decimals: parsedInfo.tokenAmount.decimals,
        symbol: 'TOKEN', // You'd get this from token metadata
        name: 'Token',
        usdValue: 0, // You'd calculate this from price feeds
      };
    });

    res.json({
      success: true,
      data: {
        tokens
      }
    });
  } catch (error) {
    console.error('Error fetching token accounts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch token accounts'
    });
  }
});

// Get NFTs
router.get('/nfts', async (req, res) => {
  try {
    const { publicKey } = req.query;

    if (!publicKey) {
      return res.status(400).json({
        success: false,
        message: 'Public key is required'
      });
    }

    // Get all token accounts that are NFTs (0 decimals)
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(new PublicKey(publicKey), {
      programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    });

    const nfts = tokenAccounts.value
      .filter(account => account.account.data.parsed.info.tokenAmount.decimals === 0)
      .map(account => {
        const parsedInfo = account.account.data.parsed.info;
        return {
          mint: parsedInfo.mint,
          name: 'NFT #' + Math.floor(Math.random() * 1000),
          collection: 'Collection Name',
          image: 'https://via.placeholder.com/150',
        };
      });

    res.json({
      success: true,
      data: {
        nfts
      }
    });
  } catch (error) {
    console.error('Error fetching NFTs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch NFTs'
    });
  }
});

// Export private key (with password verification)
router.post('/export-key', async (req, res) => {
  try {
    const { password, encryptedPrivateKey } = req.body;

    if (!password || password.length !== 6) {
      return res.status(400).json({
        success: false,
        message: 'Invalid password'
      });
    }

    if (!encryptedPrivateKey) {
      return res.status(400).json({
        success: false,
        message: 'No encrypted private key provided'
      });
    }

    try {
      // Decrypt private key with user's password
      const decryptedPrivateKey = decryptPrivateKey(encryptedPrivateKey, password);
      const privateKeyArray = JSON.parse(decryptedPrivateKey);
      
      res.json({
        success: true,
        data: {
          privateKey: privateKeyArray,
          message: 'Private key exported successfully. Keep it secure!'
        }
      });
    } catch (decryptError) {
      return res.status(400).json({
        success: false,
        message: 'Invalid password or corrupted private key'
      });
    }
  } catch (error) {
    console.error('Error exporting private key:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export private key'
    });
  }
});

// Get user's wallet info
router.get('/info', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const walletData = await prisma.walletData.findFirst({
      where: { userId, isActive: true },
      select: {
        id: true,
        publicKey: true,
        isActive: true,
        createdAt: true
      }
    });

    if (!walletData) {
      return res.status(404).json({
        success: false,
        error: 'WALLET_NOT_FOUND',
        message: 'No active wallet found for user'
      });
    }

    res.json({
      success: true,
      data: {
        wallet: walletData
      }
    });

  } catch (error) {
    console.error('Error getting wallet info:', error);
    res.status(500).json({
      success: false,
      error: 'WALLET_INFO_ERROR',
      message: 'Failed to get wallet info'
    });
  }
});

// Use error handler middleware
router.use(errorHandler);

module.exports = router;
