// Script to check current usage
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function checkUsage() {
  const shopDomain = "quickstart-8d0b502f.myshopify.com";
  
  const subscription = await prisma.shopSubscription.findUnique({
    where: { shop: shopDomain },
    include: { plan: true }
  });
  
  if (!subscription) {
    console.log(`❌ No subscription found for ${shopDomain}`);
    return;
  }
  
  console.log(`\n📊 Current Subscription Status:`);
  console.log(`Shop: ${subscription.shop}`);
  console.log(`Plan: ${subscription.plan.name}`);
  console.log(`Status: ${subscription.status}`);
  console.log(`Product Limit: ${subscription.plan.productLimit}`);
  console.log(`Products Used: ${subscription.productsUsed}`);
  console.log(`Trial Products Used: ${subscription.trialProductsUsed}`);
  console.log(`\n🎯 Remaining: ${subscription.plan.productLimit - subscription.productsUsed} products`);
  
  await prisma.$disconnect();
}

checkUsage().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
