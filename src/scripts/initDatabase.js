const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function initDatabase() {
  console.log('🗄️  Initializing database...');
  console.log('📍 Database URL:', process.env.DATABASE_URL);

  try {
    // Enable UUID extension
    await prisma.$executeRaw`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`;

    // Create custom types
    await prisma.$executeRaw`
      DO $$ BEGIN
        CREATE TYPE category_type AS ENUM ('crypto', 'sports', 'entertainment');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;

    await prisma.$executeRaw`
      DO $$ BEGIN
        CREATE TYPE reward_type AS ENUM ('gift_card', 'crypto_token', 'badge', 'points');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;

    await prisma.$executeRaw`
      DO $$ BEGIN
        CREATE TYPE reward_status AS ENUM ('pending', 'claimed', 'expired');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;

    // Create tables
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        email VARCHAR(255) UNIQUE,
        wallet_address VARCHAR(44) UNIQUE,
        username VARCHAR(50) UNIQUE NOT NULL,
        google_id VARCHAR(255) UNIQUE,
        display_name VARCHAR(100),
        avatar_url VARCHAR(500),
        points INTEGER DEFAULT 0,
        streak_count INTEGER DEFAULT 0,
        last_login TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `;

    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS articles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        title VARCHAR(500) NOT NULL,
        content TEXT NOT NULL,
        category category_type NOT NULL,
        source_url VARCHAR(500),
        source_name VARCHAR(100),
        points_value INTEGER DEFAULT 10,
        read_time_estimate INTEGER,
        is_featured BOOLEAN DEFAULT FALSE,
        image_url VARCHAR(500),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `;

    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS user_activities (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
        points_earned INTEGER NOT NULL,
        read_duration INTEGER,
        completed_at TIMESTAMP DEFAULT NOW()
      );
    `;

    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS rewards (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reward_type reward_type NOT NULL,
        reward_value VARCHAR(100),
        status reward_status DEFAULT 'pending',
        claimed_at TIMESTAMP,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `;

    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS badges (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(100) UNIQUE NOT NULL,
        description TEXT,
        icon_url VARCHAR(500),
        points_required INTEGER,
        category VARCHAR(50)
      );
    `;

    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS user_badges (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        badge_id UUID NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
        earned_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, badge_id)
      );
    `;

    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        is_revoked BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `;

    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS leaderboards (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        period VARCHAR(20) NOT NULL,
        points INTEGER NOT NULL,
        rank INTEGER NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, period)
      );
    `;

    // Create indexes
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_users_wallet ON users(wallet_address);`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_users_points ON users(points DESC);`;

    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at DESC);`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_articles_featured ON articles(is_featured) WHERE is_featured = TRUE;`;

    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_user_activities_user_id ON user_activities(user_id);`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_user_activities_article_id ON user_activities(article_id);`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_user_activities_completed_at ON user_activities(completed_at DESC);`;

    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_rewards_user_id ON rewards(user_id);`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_rewards_status ON rewards(status);`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_rewards_type ON rewards(reward_type);`;

    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_user_badges_user_id ON user_badges(user_id);`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_user_badges_badge_id ON user_badges(badge_id);`;

    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_leaderboards_period ON leaderboards(period);`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_leaderboards_points ON leaderboards(points DESC);`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_leaderboards_rank ON leaderboards(rank);`;

    console.log('✅ Database schema created successfully');

    // Check if we need to seed data
    const userCount = await prisma.$queryRaw`SELECT COUNT(*) as count FROM users`;
    const articleCount = await prisma.$queryRaw`SELECT COUNT(*) as count FROM articles`;
    const badgeCount = await prisma.$queryRaw`SELECT COUNT(*) as count FROM badges`;

    console.log(`📊 Current data: ${userCount[0].count} users, ${articleCount[0].count} articles, ${badgeCount[0].count} badges`);

    // Always seed if any table is empty or if FORCE_SEED is set
    const shouldSeed = userCount[0].count === 0 || articleCount[0].count === 0 || badgeCount[0].count === 0 || process.env.FORCE_SEED === 'true';
    
    if (shouldSeed) {
      console.log('🌱 Seeding database with sample data...');
      await seedDatabase();
    } else {
      console.log('✅ Database already has data, skipping seed');
    }

  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

async function seedDatabase() {
  try {
    // Insert initial badges
    await prisma.$executeRaw`
      INSERT INTO badges (name, description, points_required, category) VALUES
      ('First Read', 'Read your first article', 0, 'milestone'),
      ('Crypto Enthusiast', 'Read 10 crypto articles', 0, 'crypto'),
      ('Sports Fan', 'Read 10 sports articles', 0, 'sports'),
      ('Entertainment Buff', 'Read 10 entertainment articles', 0, 'entertainment'),
      ('Daily Reader', 'Read articles for 7 consecutive days', 0, 'streak'),
      ('Weekly Champion', 'Top reader for a week', 0, 'leaderboard'),
      ('Point Collector', 'Earn 1000 points', 1000, 'points'),
      ('Point Master', 'Earn 5000 points', 5000, 'points'),
      ('Point Legend', 'Earn 10000 points', 10000, 'points'),
      ('Content Explorer', 'Read 100 articles', 0, 'milestone'),
      ('Content Master', 'Read 500 articles', 0, 'milestone'),
      ('Content Legend', 'Read 1000 articles', 0, 'milestone'),
      ('Streak Master', 'Maintain a 30-day reading streak', 0, 'streak'),
      ('Buzznob Legend', 'Read 500 articles', 0, 'milestone')
      ON CONFLICT (name) DO NOTHING;
    `;

    // Insert sample articles
    await prisma.$executeRaw`
      INSERT INTO articles (title, content, category, source_name, points_value, read_time_estimate, is_featured, image_url) VALUES
      ('Bitcoin Reaches New All-Time High', 'Bitcoin has reached a new all-time high of $100,000, marking a significant milestone in cryptocurrency adoption. This surge comes after months of institutional adoption and regulatory clarity...', 'crypto', 'CoinDesk', 15, 3, true, 'https://images.coindesk.com/bitcoin-chart.jpg'),
      ('Lakers Win Championship Game', 'The Los Angeles Lakers secured their 18th NBA championship with a thrilling victory over the Boston Celtics. LeBron James led the team with 35 points and 12 assists...', 'sports', 'ESPN', 12, 4, true, 'https://images.espn.com/lakers-celebration.jpg'),
      ('New Marvel Movie Breaks Box Office Records', 'The latest Marvel Cinematic Universe film has shattered box office records, grossing over $1 billion worldwide. The film features an all-star cast...', 'entertainment', 'Variety', 10, 3, false, 'https://images.variety.com/marvel-poster.jpg'),
      ('Ethereum 2.0 Upgrade Complete', 'The long-awaited Ethereum 2.0 upgrade has been successfully implemented, bringing improved scalability and energy efficiency to the network. This marks a major milestone...', 'crypto', 'CoinTelegraph', 20, 5, true, 'https://images.cointelegraph.com/ethereum-upgrade.jpg'),
      ('World Cup Final Set', 'The FIFA World Cup final is set between Argentina and France, promising an exciting match. Both teams have shown exceptional form throughout the tournament...', 'sports', 'FIFA', 15, 2, true, 'https://images.fifa.com/world-cup-trophy.jpg'),
      ('Solana Network Hits 1 Million TPS', 'Solana blockchain has achieved a new milestone by processing over 1 million transactions per second during a stress test. This demonstrates the network''s scalability...', 'crypto', 'Solana News', 18, 4, false, 'https://images.solana.com/network-stats.jpg'),
      ('Taylor Swift Announces New Album', 'Pop superstar Taylor Swift has announced her highly anticipated new album, set to release next month. The album features collaborations with several top artists...', 'entertainment', 'Billboard', 8, 2, false, 'https://images.billboard.com/taylor-swift.jpg'),
      ('NBA Playoffs Begin', 'The NBA playoffs have officially begun with 16 teams competing for the championship. The first round promises exciting matchups and intense competition...', 'sports', 'NBA.com', 14, 3, false, 'https://images.nba.com/playoffs-bracket.jpg'),
      ('DeFi Protocol Launches on Solana', 'A new decentralized finance protocol has launched on the Solana blockchain, offering yield farming opportunities and liquidity mining rewards...', 'crypto', 'DeFi Pulse', 16, 4, false, 'https://images.defipulse.com/protocol-launch.jpg'),
      ('Netflix Original Series Renewed', 'Popular Netflix original series has been renewed for another season after receiving critical acclaim and high viewership numbers...', 'entertainment', 'Netflix', 6, 2, false, 'https://images.netflix.com/series-poster.jpg')
      ON CONFLICT (title) DO NOTHING;
    `;

    // Insert sample users for testing
    await prisma.$executeRaw`
      INSERT INTO users (username, email, display_name, points, streak_count, google_id) VALUES
      ('testuser1', 'test1@example.com', 'Test User 1', 1500, 5, 'google_123456789'),
      ('testuser2', 'test2@example.com', 'Test User 2', 2300, 12, 'google_987654321'),
      ('testuser3', 'test3@example.com', 'Test User 3', 800, 3, 'google_456789123')
      ON CONFLICT (username) DO NOTHING;
    `;

    // Insert some user activities
    await prisma.$executeRaw`
      INSERT INTO user_activities (user_id, article_id, points_earned, read_duration, completed_at)
      SELECT 
        u.id,
        a.id,
        a.points_value,
        a.read_time_estimate * 60,
        NOW() - (random() * interval '7 days')
      FROM users u
      CROSS JOIN articles a
      WHERE random() < 0.3;
    `;

    // Update user points based on activities
    await prisma.$executeRaw`
      UPDATE users SET points = (
        SELECT COALESCE(SUM(points_earned), 0)
        FROM user_activities
        WHERE user_id = users.id
      );
    `;

    console.log('✅ Database seeded successfully');
  } catch (error) {
    console.error('❌ Database seeding failed:', error);
    throw error;
  }
}

module.exports = { initDatabase };
