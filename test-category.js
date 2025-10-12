require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testCategory() {
  try {
    const result = await prisma.$queryRaw`SELECT category FROM articles LIMIT 1`;
    console.log('Category type:', typeof result[0].category);
    console.log('Category value:', result[0].category);
    console.log('Raw result:', result[0]);
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

testCategory();
