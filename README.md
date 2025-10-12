# 🚀 Buzznob Backend API

Backend API for the Buzznob mobile read-to-earn platform.

## 🛠️ Technology Stack

- **Node.js** with Express.js
- **PostgreSQL** database with Prisma ORM
- **JWT** authentication
- **Google OAuth 2.0** integration
- **Solana** wallet integration
- **Redis** for caching and session management

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Redis (optional)

### Installation

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` with your configuration:
   ```env
   DATABASE_URL="postgresql://username:password@localhost:5432/buzznob_db"
   JWT_SECRET="your-super-secret-jwt-key-here"
   GOOGLE_CLIENT_ID="your-google-client-id"
   GOOGLE_CLIENT_SECRET="your-google-client-secret"
   ```

3. **Set up database**
   ```bash
   npm run db:generate
   npm run db:migrate
   npm run db:seed
   ```

4. **Start development server**
   ```bash
   npm run dev
   ```

The API will be available at `http://localhost:8001`

## 📚 API Endpoints

### Authentication
- `GET /api/auth/google` - Google OAuth login
- `GET /api/auth/google/callback` - Google OAuth callback
- `POST /api/auth/google-mobile` - Mobile Google OAuth
- `POST /api/auth/wallet-login` - Wallet Connect login
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout user

### Users
- `GET /api/users/profile` - Get user profile
- `PUT /api/users/profile` - Update user profile
- `GET /api/users/stats` - Get user statistics
- `GET /api/users/activity` - Get user activity history
- `GET /api/users/badges` - Get user badges
- `DELETE /api/users/account` - Delete user account

### Articles
- `GET /api/articles` - Get articles with pagination
- `GET /api/articles/:id` - Get single article
- `POST /api/articles/:id/read` - Mark article as read
- `GET /api/articles/trending` - Get trending articles
- `GET /api/articles/search` - Search articles

### Rewards
- `GET /api/rewards/available` - Get available rewards
- `POST /api/rewards/redeem` - Redeem reward
- `GET /api/rewards/my-rewards` - Get user's rewards
- `GET /api/rewards/leaderboard` - Get leaderboard
- `GET /api/rewards/badges` - Get all badges
- `POST /api/rewards/:rewardId/claim` - Claim reward

## 🔧 Development

### Database Commands
```bash
# Generate Prisma client
npm run db:generate

# Run database migrations
npm run db:migrate

# Seed database with sample data
npm run db:seed

# Reset database (WARNING: deletes all data)
npm run db:reset

# Open Prisma Studio
npm run db:studio
```

### Testing
```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

### Health Check
```bash
# Check if server is running
npm run health
```

## 🗄️ Database Schema

### Core Tables
- **users** - User accounts and profiles
- **articles** - Content from various sources
- **user_activities** - Reading history and points
- **rewards** - Reward system and redemptions
- **badges** - Achievement system
- **refresh_tokens** - JWT refresh tokens
- **leaderboards** - Gamification data

## 🔐 Authentication

### Google OAuth Flow
1. User clicks "Sign in with Google"
2. Redirects to Google OAuth consent screen
3. Google returns user profile data
4. Backend creates/updates user in database
5. Returns JWT access and refresh tokens

### Wallet Connect Flow
1. User connects Solana wallet
2. Signs a message to prove ownership
3. Backend verifies signature
4. Creates/updates user in database
5. Returns JWT access and refresh tokens

## 📊 Features

### User Management
- Google OAuth authentication
- Wallet Connect integration
- User profile management
- Activity tracking
- Points and rewards system

### Content System
- Article management
- Category filtering (crypto, sports, entertainment)
- Search functionality
- Trending articles
- Reading progress tracking

### Gamification
- Points system
- Badge achievements
- Leaderboards
- Streak tracking
- Reward redemption

## 🚀 Deployment

### Environment Variables
```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/buzznob_db"

# JWT
JWT_SECRET="your-super-secret-jwt-key-here"
JWT_EXPIRES_IN="7d"
JWT_REFRESH_SECRET="your-refresh-token-secret"
JWT_REFRESH_EXPIRES_IN="30d"

# Google OAuth
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
GOOGLE_CALLBACK_URL="http://localhost:8001/api/auth/google/callback"

# Redis
REDIS_URL="redis://localhost:6379"

# Server
PORT=8001
NODE_ENV="production"
```

### Docker Deployment
```bash
# Build and run with Docker Compose
docker-compose up -d
```

## 📈 Monitoring

### Health Check
- `GET /health` - Server health status
- Returns uptime, environment, and timestamp

### Logging
- Morgan for HTTP request logging
- Console logging for errors and info
- Structured logging for production

## 🔒 Security

### Security Headers
- Helmet.js for security headers
- CORS configuration
- Rate limiting
- Input validation

### Authentication Security
- JWT token validation
- Refresh token rotation
- Token blacklisting
- Secure password hashing (if needed)

## 🐛 Troubleshooting

### Common Issues

1. **Database Connection Error**
   - Check PostgreSQL is running
   - Verify DATABASE_URL is correct
   - Run `npm run db:migrate`

2. **Google OAuth Error**
   - Verify GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
   - Check callback URL configuration
   - Ensure OAuth consent screen is set up

3. **JWT Token Error**
   - Verify JWT_SECRET is set
   - Check token expiration
   - Ensure proper token format

### Debug Mode
```bash
# Run with debug logging
DEBUG=* npm run dev
```

## 📞 Support

For issues and questions:
1. Check the troubleshooting section
2. Review error logs
3. Check database connection
4. Verify environment variables

---

**Built with ❤️ for the Buzznob platform**
