require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function resetAndSeed() {
  console.log('🔄 Resetting and seeding database...');
  
  try {
    // Clear all data
    console.log('🗑️  Clearing existing data...');
    await prisma.$executeRaw`TRUNCATE TABLE user_activities, user_badges, rewards, leaderboards, articles, users, badges, refresh_tokens RESTART IDENTITY CASCADE`;
    
    // Insert badges
    console.log('🏆 Inserting badges...');
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
      ('Buzznob Legend', 'Read 500 articles', 0, 'milestone');
    `;

    // Insert articles
    console.log('📰 Inserting articles...');
    await prisma.$executeRaw`
      INSERT INTO articles (title, content, category, source_name, points_value, read_time_estimate, is_featured, image_url) VALUES
      ('Bitcoin Reaches New All-Time High', 'Bitcoin has reached a new all-time high of $100,000, marking a significant milestone in cryptocurrency adoption. This surge comes after months of institutional adoption and regulatory clarity. Major financial institutions have been increasingly adopting Bitcoin as a store of value, while retail investors continue to show strong interest. The price surge has also been supported by favorable regulatory developments in several countries.', 'crypto', 'CoinDesk', 15, 3, true, 'https://images.coindesk.com/bitcoin-chart.jpg'),
      ('Lakers Win Championship Game', 'The Los Angeles Lakers secured their 18th NBA championship with a thrilling victory over the Boston Celtics. LeBron James led the team with 35 points and 12 assists, while Anthony Davis contributed 28 points and 15 rebounds. The game went into overtime, with the Lakers maintaining their composure in the final minutes to secure the victory.', 'sports', 'ESPN', 12, 4, true, 'https://images.espn.com/lakers-celebration.jpg'),
      ('New Marvel Movie Breaks Box Office Records', 'The latest Marvel Cinematic Universe film has shattered box office records, grossing over $1 billion worldwide in just two weeks. The film features an all-star cast including Robert Downey Jr., Chris Evans, and Scarlett Johansson. Critics have praised the film for its stunning visual effects and compelling storyline.', 'entertainment', 'Variety', 10, 3, false, 'https://images.variety.com/marvel-poster.jpg'),
      ('Ethereum 2.0 Upgrade Complete', 'The long-awaited Ethereum 2.0 upgrade has been successfully implemented, bringing improved scalability and energy efficiency to the network. This marks a major milestone in blockchain technology, transitioning from proof-of-work to proof-of-stake consensus mechanism. The upgrade is expected to reduce energy consumption by 99% while increasing transaction throughput.', 'crypto', 'CoinTelegraph', 20, 5, true, 'https://images.cointelegraph.com/ethereum-upgrade.jpg'),
      ('World Cup Final Set', 'The FIFA World Cup final is set between Argentina and France, promising an exciting match. Both teams have shown exceptional form throughout the tournament, with Argentina led by Lionel Messi and France by Kylian Mbappe. The final will be held at Lusail Stadium in Qatar.', 'sports', 'FIFA', 15, 2, true, 'https://images.fifa.com/world-cup-trophy.jpg'),
      ('Solana Network Hits 1 Million TPS', 'Solana blockchain has achieved a new milestone by processing over 1 million transactions per second during a stress test. This demonstrates the network''s scalability and potential for mass adoption. The test was conducted using a custom validator setup and showed consistent performance under high load.', 'crypto', 'Solana News', 18, 4, false, 'https://images.solana.com/network-stats.jpg'),
      ('Taylor Swift Announces New Album', 'Pop superstar Taylor Swift has announced her highly anticipated new album, set to release next month. The album features collaborations with several top artists including Ed Sheeran and Billie Eilish. Swift revealed the album cover and tracklist during a surprise announcement on social media.', 'entertainment', 'Billboard', 8, 2, false, 'https://images.billboard.com/taylor-swift.jpg'),
      ('NBA Playoffs Begin', 'The NBA playoffs have officially begun with 16 teams competing for the championship. The first round promises exciting matchups and intense competition. Top seeds include the Boston Celtics, Denver Nuggets, and Phoenix Suns, each looking to make a deep playoff run.', 'sports', 'NBA.com', 14, 3, false, 'https://images.nba.com/playoffs-bracket.jpg'),
      ('DeFi Protocol Launches on Solana', 'A new decentralized finance protocol has launched on the Solana blockchain, offering yield farming opportunities and liquidity mining rewards. The protocol aims to provide users with high-yield investment options while maintaining security and transparency. Early users can earn up to 500% APY on their deposits.', 'crypto', 'DeFi Pulse', 16, 4, false, 'https://images.defipulse.com/protocol-launch.jpg'),
      ('Netflix Original Series Renewed', 'Popular Netflix original series has been renewed for another season after receiving critical acclaim and high viewership numbers. The show has become one of the platform''s most-watched series, with fans eagerly awaiting the next season. Production is set to begin next month.', 'entertainment', 'Netflix', 6, 2, false, 'https://images.netflix.com/series-poster.jpg');
    `;

    // Insert sample users
    console.log('👥 Inserting users...');
    await prisma.$executeRaw`
      INSERT INTO users (username, email, display_name, points, streak_count, google_id) VALUES
      ('testuser1', 'test1@example.com', 'Test User 1', 1500, 5, 'google_123456789'),
      ('testuser2', 'test2@example.com', 'Test User 2', 2300, 12, 'google_987654321'),
      ('testuser3', 'test3@example.com', 'Test User 3', 800, 3, 'google_456789123');
    `;

    // Insert some user activities
    console.log('📊 Inserting user activities...');
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
    console.log('💰 Updating user points...');
    await prisma.$executeRaw`
      UPDATE users SET points = (
        SELECT COALESCE(SUM(points_earned), 0)
        FROM user_activities
        WHERE user_id = users.id
      );
    `;

    // Verify data
    const userCount = await prisma.$queryRaw`SELECT COUNT(*) as count FROM users`;
    const articleCount = await prisma.$queryRaw`SELECT COUNT(*) as count FROM articles`;
    const badgeCount = await prisma.$queryRaw`SELECT COUNT(*) as count FROM badges`;

    console.log('✅ Database reset and seeded successfully!');
    console.log(`📊 Final data: ${userCount[0].count} users, ${articleCount[0].count} articles, ${badgeCount[0].count} badges`);

  } catch (error) {
    console.error('❌ Error resetting and seeding database:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

resetAndSeed();
