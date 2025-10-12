const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function updateDatabaseForImages() {
  try {
    console.log('Updating database schema for image storage...');
    
    // This will be handled by Prisma when you run: npx prisma db push
    console.log('Please run: npx prisma db push');
    console.log('This will add the new imageData and imageType columns to the articles table.');
    
    // Check existing articles
    const articles = await prisma.article.findMany({
      select: {
        id: true,
        title: true,
        imageUrl: true,
        imageData: true,
        imageType: true
      }
    });

    console.log(`Found ${articles.length} existing articles:`);
    articles.forEach(article => {
      console.log(`- ${article.title}: imageUrl=${!!article.imageUrl}, imageData=${!!article.imageData}, imageType=${article.imageType}`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

updateDatabaseForImages();
