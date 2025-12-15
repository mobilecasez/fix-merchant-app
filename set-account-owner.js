// Simple script to set accountOwner flag for all sessions
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Update all sessions to have accountOwner = true
  const result = await prisma.session.updateMany({
    data: {
      accountOwner: true,
    },
  });

  console.log(`✅ Updated ${result.count} session(s) - accountOwner set to true`);

  // Show current sessions
  const sessions = await prisma.session.findMany({
    select: {
      shop: true,
      accountOwner: true,
      email: true,
      isOnline: true,
    },
  });

  console.log('\n📋 Current sessions:');
  console.table(sessions);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
