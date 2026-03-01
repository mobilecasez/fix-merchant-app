// Script to activate subscription and set usage to 19
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function activateAndSetUsage() {
  const shopDomain = "quickstart-8d0b502f.myshopify.com";
  
  const updated = await prisma.shopSubscription.update({
    where: { shop: shopDomain },
    data: {
      status: "active",
      productsUsed: 19,
      trialProductsUsed: 0,
      cancelledAt: null,
    },
  });
  
  const subscription = await prisma.shopSubscription.findUnique({
    where: { shop: shopDomain },
    include: { plan: true }
  });
  
  console.log(`✅ Subscription activated with 19/20 usage!`);
  console.log(`Status: ${subscription.status}`);
  console.log(`Plan: ${subscription.plan.name}`);
  console.log(`Products used: ${subscription.productsUsed}/${subscription.plan.productLimit}`);
  console.log(`\n🎯 You can now create 1 more product before hitting the limit!`);
  
  await prisma.$disconnect();
}

activateAndSetUsage().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
