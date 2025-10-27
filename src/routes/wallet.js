const express = require('express');
const { prisma } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');
const { Keypair, PublicKey, Connection, LAMPORTS_PER_SOL, Transaction, SystemProgram } = require('@solana/web3.js');
const { getAssociatedTokenAddress, getAccount } = require('@solana/spl-token');
const { encryptPrivateKey, decryptPrivateKey, hashPassword, verifyPassword } = require('../utils/crypto');

const router = express.Router();

// Initialize Solana connection
const connection = new Connection('https://api.mainnet-beta.solana.com');

// Create new wallet
router.post('/create', authenticateToken, async (req, res) => {
  try {
    console.log('🔐 Wallet creation request received');
    console.log('User ID:', req.user.id);
    console.log('Request body:', req.body);
    
    const userId = req.user.id;
    const { password } = req.body;

    console.log('Password received:', password ? `${password.length} digits` : 'No password');

    if (!password || password.length !== 6) {
      console.log('❌ Invalid password format');
      return res.status(400).json({
        success: false,
        error: 'INVALID_PASSWORD',
        message: 'Password must be exactly 6 digits'
      });
    }

    console.log('✅ Password format valid');

    // Check if user already has a wallet
    const existingWallet = await prisma.walletData.findFirst({
      where: { userId, isActive: true }
    });

    if (existingWallet) {
      console.log('❌ User already has a wallet');
      return res.status(400).json({
        success: false,
        error: 'WALLET_ALREADY_EXISTS',
        message: 'User already has an active wallet'
      });
    }

    console.log('✅ No existing wallet found, proceeding with creation');

    // Generate new Solana keypair
    const keypair = Keypair.generate();
    const publicKey = keypair.publicKey.toString();
    const privateKey = Array.from(keypair.secretKey);

    console.log('✅ Solana keypair generated');

    // Encrypt private key with user's PIN
    const encryptedPrivateKey = encryptPrivateKey(JSON.stringify(privateKey), password);
    const passwordHash = hashPassword(password);

    console.log('✅ Private key encrypted and password hashed');

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

    console.log('✅ Wallet data stored in database');

    // Update user's wallet address
    await prisma.user.update({
      where: { id: userId },
      data: { walletAddress: publicKey }
    });

    console.log('✅ User wallet address updated');

    console.log('🎉 Wallet creation successful!');
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
    console.error('❌ Error creating wallet:', error);
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

// Verify PIN for wallet operations
router.post('/verify-pin', authenticateToken, async (req, res) => {
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

    // Get user's wallet data
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

    // Verify the password
    const isValid = verifyPassword(password, walletData.passwordHash);

    if (!isValid) {
      return res.status(401).json({
        success: false,
        error: 'INVALID_PASSWORD',
        message: 'PIN does not match'
      });
    }

    res.json({
      success: true,
      message: 'PIN verified successfully',
      data: {
        verified: true,
        walletId: walletData.id
      }
    });

  } catch (error) {
    console.error('Error verifying PIN:', error);
    res.status(500).json({
      success: false,
      error: 'PIN_VERIFICATION_ERROR',
      message: 'Failed to verify PIN'
    });
  }
});

// Send tokens
router.post('/send', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { to, amount, password } = req.body;

    if (!to || !amount || !password) {
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

    // Get user's wallet data
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

    // Verify the password
    const isValid = verifyPassword(password, walletData.passwordHash);

    if (!isValid) {
      return res.status(401).json({
        success: false,
        error: 'INVALID_PASSWORD',
        message: 'PIN does not match'
      });
    }

    // Decrypt private key
    const encryptedPrivateKey = JSON.parse(walletData.encryptedPrivateKey);
    const decryptedPrivateKey = decryptPrivateKey(encryptedPrivateKey, password);
    const privateKeyArray = JSON.parse(decryptedPrivateKey);

    // Create keypair from decrypted private key
    const keypair = Keypair.fromSecretKey(new Uint8Array(privateKeyArray));

    // Check balance
    const balance = await connection.getBalance(keypair.publicKey);
    const solBalance = balance / LAMPORTS_PER_SOL;

    if (solBalance < amount) {
      return res.status(400).json({
        success: false,
        error: 'INSUFFICIENT_BALANCE',
        message: 'Insufficient SOL balance'
      });
    }

    // Create transaction
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: new PublicKey(to),
        lamports: amount * LAMPORTS_PER_SOL,
      })
    );

    // Get recent blockhash
    const { blockhash } = await connection.getRecentBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = keypair.publicKey;

    // Sign and send transaction
    transaction.sign(keypair);
    const signature = await connection.sendRawTransaction(transaction.serialize());

    // Wait for confirmation
    await connection.confirmTransaction(signature);

    res.json({
      success: true,
      data: {
        transactionId: signature,
        amount,
        to,
        from: walletData.publicKey
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
router.post('/export-key', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { password } = req.body;

    if (!password || password.length !== 6) {
      return res.status(400).json({
        success: false,
        message: 'Invalid password'
      });
    }

    // Get user's wallet data
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

    // Verify the password
    const isValid = verifyPassword(password, walletData.passwordHash);

    if (!isValid) {
      return res.status(401).json({
        success: false,
        error: 'INVALID_PASSWORD',
        message: 'PIN does not match'
      });
    }

    // Decrypt private key
    const encryptedPrivateKey = JSON.parse(walletData.encryptedPrivateKey);
    const decryptedPrivateKey = decryptPrivateKey(encryptedPrivateKey, password);
    const privateKeyArray = JSON.parse(decryptedPrivateKey);
    
    res.json({
      success: true,
      data: {
        privateKey: privateKeyArray,
        message: 'Private key exported successfully. Keep it secure!'
      }
    });
  } catch (error) {
    console.error('Error exporting private key:', error);
    res.status(500).json({
      success: false,
      error: 'EXPORT_ERROR',
      message: error.message || 'Failed to export private key'
    });
  }
});

// Get user's wallet info
router.get('/info', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const [walletData, user] = await Promise.all([
      prisma.walletData.findFirst({
        where: { userId, isActive: true },
        select: {
          id: true,
          publicKey: true,
          isActive: true,
          createdAt: true
        }
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          points: true,
          miningBalance: true
        }
      })
    ]);

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
        wallet: walletData,
        buzzBalance: user?.points || 0,
        miningBalance: user?.miningBalance || 0
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
