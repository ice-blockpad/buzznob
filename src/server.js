const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const articleRoutes = require('./routes/articles');
const rewardRoutes = require('./routes/rewards');
const walletRoutes = require('./routes/wallet');
const miningRoutes = require('./routes/mining');
const kycRoutes = require('./routes/kyc');
const referralRoutes = require('./routes/referrals');
const adminRoutes = require('./routes/admin');
const creatorRoutes = require('./routes/creator');
const dataRoutes = require('./routes/data');
const achievementRoutes = require('./routes/achievements');
const uploadRoutes = require('./routes/uploads');
const { errorHandler } = require('./middleware/errorHandler');
const { connectDB } = require('./config/database');
const { autoSyncDatabase } = require('./scripts/autoSync');
const notificationCron = require('./services/notificationCron');

const app = express();
const PORT = process.env.PORT || 8001;

 // Trust proxy - needed for ngrok and other reverse proxies
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());

// Block access to dotfiles (e.g., /.env, /.git, backups) before any routing/static
app.use((req, res, next) => {
  // Allow ACME and other well-known paths
  if (req.path.startsWith('/.well-known')) return next();

  // Explicitly block .env and common backup extensions anywhere in the path
  const blockedSensitive = /\/(?:core|modules|plugins|themes)?\/\.env(?:\.(?:save|bak|old))?(?:$|\/|\?)/i;
  if (blockedSensitive.test(req.path)) return res.sendStatus(404);

  // Block any other hidden files or directories (paths containing "/.")
  // e.g. /.git, /.htaccess, /.ssh, /.hg, /.svn, /.DS_Store, etc.
  const blockedDotfile = /\/(?:\.(?!well-known)[^/]+)(?:$|\/)/i;
  if (blockedDotfile.test(req.path)) return res.sendStatus(404);

  next();
});

// CORS configuration for mobile app
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      // Development origins
      'http://localhost:3000',
      'http://localhost:8081',
      'http://localhost:19006',
      
      // Expo development origins
      'exp://192.168.1.100:8081',
      'exp://192.168.187.143:8081',
      'exp://localhost:8081',
      'exp://192.168.1.100:19000',
      'exp://192.168.187.143:19000',
      'exp://localhost:19000',
      
      // Production origins (add your actual production domains)
      'https://buzznob.app',
      'https://www.buzznob.app',
      
      // Android development
      'http://10.0.2.2:8001',
      'http://10.0.3.2:8001',
      
      // iOS development
      'http://localhost:8001',
      'http://127.0.0.1:8001'
    ];
    
    // Allow all origins in development
    if (process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'Accept',
    'Origin',
    'Cache-Control',
    'X-File-Name'
  ],
  exposedHeaders: ['X-Total-Count'],
  optionsSuccessStatus: 200,
  preflightContinue: false
}));

// Rate limiting (general)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Stricter limiter for unauthenticated requests (basic WAF against scanners)
const unauthLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // tighter burst for anonymous traffic
  standardHeaders: true,
  legacyHeaders: false,
});

app.use((req, res, next) => {
  // Apply stricter limits to requests without Authorization header
  // (Skip preflight and health checks to avoid noise)
  if (req.method === 'OPTIONS' || req.path === '/health') return next();
  // Auth routes have their own dedicated limiter; skip here to avoid double-throttling
  if (req.path.startsWith('/api/auth')) return next();
  if (!req.headers.authorization) return unauthLimiter(req, res, next);
  return next();
});

// Dedicated limiter for authentication endpoints (login/signup/oauth flows)
const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // sufficient for legitimate flows, curbs bursts
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many auth requests. Please wait a moment and try again.'
});
app.use('/api/auth', authLimiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
app.use(morgan('combined'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV
  });
});

// Static file serving for uploaded images
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/articles', articleRoutes);
app.use('/api/rewards', rewardRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/mining', miningRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/creator', creatorRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/achievements', achievementRoutes);
app.use('/api/uploads', uploadRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: 'API endpoint not found',
    path: req.originalUrl
  });
});

// Error handling middleware
app.use(errorHandler);

// Start server
const startServer = async () => {
  try {
    // Connect to database
    await connectDB();
    
    // Auto-sync database schema (creates missing tables/columns)
    await autoSyncDatabase();
    
    // Start notification cron jobs
    notificationCron.startAll();
    
    // Note: Seed data manually using: npm run db:seed
    // Or run once with: npm run db:reset-seed
    
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV}`);
      console.log(`🔗 Health check: http://localhost:${PORT}/health`);
      console.log(`✅ Database synced and ready`);
      console.log(`\n💡 First time setup:`);
      console.log(`   1. Set ADMIN_EMAIL="${process.env.ADMIN_EMAIL || 'your-email@gmail.com'}" in .env`);
      console.log(`   2. Run: npm run db:seed (to add badges & rewards)`);
      console.log(`   3. Sign in with admin email to get admin access\n`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Promise Rejection:', err);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

startServer();

module.exports = app;
