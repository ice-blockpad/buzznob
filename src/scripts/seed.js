const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');
  console.log('ℹ️  Note: Admin users are created via Google OAuth.');
  console.log(`ℹ️  Set ADMIN_EMAIL in .env to auto-promote users to admin role.\n`);

  // Create badges (Achievement System)
  const badges = [
    // Mining Achievements (Common - Epic)
    {
      name: 'First Miner',
      description: 'Complete your first mining session',
      pointsRequired: 50,
      category: 'mining'
    },
    {
      name: 'Mining Enthusiast',
      description: 'Complete 10 mining sessions',
      pointsRequired: 100,
      category: 'mining'
    },
    {
      name: 'Mining Expert',
      description: 'Complete 25 mining sessions',
      pointsRequired: 200,
      category: 'mining'
    },
    {
      name: 'Mining Master',
      description: 'Complete 50 mining sessions',
      pointsRequired: 500,
      category: 'mining'
    },
    {
      name: 'Diamond Hunter',
      description: 'Complete 100 mining sessions',
      pointsRequired: 1000,
      category: 'mining'
    },
    
    // Reading Achievements (Common - Epic)
    {
      name: 'Article Reader',
      description: 'Read your first article',
      pointsRequired: 25,
      category: 'reading'
    },
    {
      name: 'Curious Mind',
      description: 'Read 10 articles',
      pointsRequired: 100,
      category: 'reading'
    },
    {
      name: 'Knowledge Seeker',
      description: 'Read 50 articles',
      pointsRequired: 250,
      category: 'reading'
    },
    {
      name: 'Avid Reader',
      description: 'Read 100 articles',
      pointsRequired: 500,
      category: 'reading'
    },
    {
      name: 'Explorer',
      description: 'Read 200 articles',
      pointsRequired: 1000,
      category: 'reading'
    },
    {
      name: 'Article Master',
      description: 'Read 500 articles',
      pointsRequired: 5000,
      category: 'reading'
    },
    {
      name: 'Mr. Know-It-All',
      description: 'Read 1000 articles',
      pointsRequired: 10000,
      category: 'reading'
    },
    
    // Social Achievements (Rare - Epic)
    {
      name: 'First Referral',
      description: 'Refer your first friend',
      pointsRequired: 100,
      category: 'social'
    },
    {
      name: 'Friend Magnet',
      description: 'Refer 10 friends',
      pointsRequired: 500,
      category: 'social'
    },
    {
      name: 'Social Butterfly',
      description: 'Refer 25 friends',
      pointsRequired: 750,
      category: 'social'
    },
    {
      name: 'Community Builder',
      description: 'Refer 50 friends',
      pointsRequired: 1000,
      category: 'social'
    },
    {
      name: 'Influencer',
      description: 'Refer 100 friends',
      pointsRequired: 2500,
      category: 'social'
    },
    {
      name: 'Social Nerd',
      description: 'Refer 200 friends',
      pointsRequired: 5000,
      category: 'social'
    },
    {
      name: 'Key Opinion Leader',
      description: 'Refer 500 friends',
      pointsRequired: 10000,
      category: 'social'
    },
    
    // Special Achievements (Rare - Legendary)
    {
      name: 'Early Adopter',
      description: 'Join BuzzNob in the first month',
      pointsRequired: 5000,
      category: 'special'
    },
    {
      name: 'Daily Streak',
      description: 'Maintain a 3-day login streak',
      pointsRequired: 100,
      category: 'special'
    },
    {
      name: 'Weekly Warrior',
      description: 'Maintain a 7-day login streak',
      pointsRequired: 200,
      category: 'special'
    },
    {
      name: 'Streak Master',
      description: 'Maintain a 30-day login streak',
      pointsRequired: 1000,
      category: 'special'
    },
    {
      name: 'Point Collector',
      description: 'Earn 10,000 points',
      pointsRequired: 1000,
      category: 'special'
    },
    {
      name: 'Point Master',
      description: 'Earn 50,000 points',
      pointsRequired: 5000,
      category: 'special'
    },
    {
      name: 'BuzzNob Legend',
      description: 'Earn 100,000 points',
      pointsRequired: 10000,
      category: 'special'
    }
  ];

  console.log('📛 Creating badges...');
  for (const badge of badges) {
    await prisma.badge.upsert({
      where: { name: badge.name },
      update: badge,
      create: badge
    });
  }

  console.log('✅ Database seeding completed successfully!');
  console.log(`📊 Seeded ${badges.length} achievement badges`);
}

main()
  .catch((e) => {
    console.error('❌ Database seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
