import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function clearSessions() {
  try {
    console.log("🗑️  Clearing all sessions from database...\n");
    
    // Delete all sessions
    const result = await prisma.session.deleteMany({});
    
    console.log(`✅ Deleted ${result.count} session(s)`);
    console.log("\n📋 Next steps:");
    console.log("  1. Uninstall the app from your test store (zsellr.myshopify.com)");
    console.log("  2. Reinstall the app");
    console.log("  3. Test the auth flow\n");
    
  } catch (error) {
    console.error("❌ Error clearing sessions:", error);
  } finally {
    await prisma.$disconnect();
  }
}

clearSessions();
