// Clear sessions for production database
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

async function clearSessions() {
  try {
    console.log('Clearing sessions for zsellr.myshopify.com...');
    
    const result = await prisma.session.deleteMany({
      where: {
        shop: 'zsellr.myshopify.com'
      }
    });
    
    console.log(`✓ Deleted ${result.count} sessions`);
    
    // Also clear any OAuth state
    console.log('Session cleared successfully!');
    
  } catch (error) {
    console.error('Error clearing sessions:', error);
  } finally {
    await prisma.$disconnect();
  }
}

clearSessions();
