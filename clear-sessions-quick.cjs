// Quick script to clear sessions
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log("Clearing sessions...");
  const result = await prisma.session.deleteMany({});
  console.log(`✅ Deleted ${result.count} sessions`);
  await prisma.$disconnect();
}

main().catch(console.error);
