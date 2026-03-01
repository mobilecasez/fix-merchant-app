// Script to cancel subscription for dev store
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function cancelSubscription() {
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
  });
  
  // Cancel the subscription
  const updated = await prisma.shopSubscription.update({
    where: { shop: shopDomain },
    data: {
      status: "cancelled",
      cancelledAt: new Date(),
    },
  });
  
  console.log(`✅ Subscription cancelled successfully!`);
  console.log(`Updated status: ${updated.status}`);
  console.log(`Cancelled at: ${updated.cancelledAt}`);
  
  await prisma.$disconnect();
}

cancelSubscription().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
