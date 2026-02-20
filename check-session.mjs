import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

async function checkSessions() {
  const sessions = await prisma.session.findMany({
    where: {
      OR: [
        { shop: { contains: 'quickstart' } },
        { shop: { contains: 'zsellr' } },
      ],
    },
  });

  console.log('\n=== Sessions in Database ===');
  console.log(JSON.stringify(sessions, null, 2));
  console.log(`\nTotal: ${sessions.length} sessions`);
  
  await prisma.$disconnect();
}

checkSessions().catch((e) => {
  console.error(e);
  process.exit(1);
});
