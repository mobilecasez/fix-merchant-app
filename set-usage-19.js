// Script to set product usage to 19 for testing
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function setUsage() {
  const shopDomain = "quickstart-8d0b502f.myshopify.com";
  
  console.log(`Looking for subscription for shop: ${shopDomain}`);
  
  const subscription = await prisma.shopSubscription.findUnique({
    where: { shop: shopDomain },
    include: { plan: true }
  });
  
  if (!subscription) {
    console.log(`❌ No subscription found for ${shopDomain}`);
    return;
  }
  
  console.log(`Current subscription:`, {
    shop: subscription.shop,
    plan: subscription.plan.name,
    status: subscription.status,
    productsUsed: subscription.productsUsed,
    trialProductsUsed: subscription.trialProductsUsed,
    productLimit: subscription.plan.productLimit,
  });
  
  // Update the usage to 19
  const updated = await prisma.shopSubscription.update({
    where: { shop: shopDomain },
    data: {
      productsUsed: 19,
      trialProductsUsed: 19,
    },
  });
  
  console.log(`✅ Usage updated successfully!`);
  console.log(`Products used: ${updated.productsUsed}`);
  console.log(`Trial products used: ${updated.trialProductsUsed}`);
  console.log(`Product limit: ${subscription.plan.productLimit}`);
  console.log(`\nYou can now create 1 more product before hitting the limit!`);
  
  await prisma.$disconnect();
}

setUsage().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
