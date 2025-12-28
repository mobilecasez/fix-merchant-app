import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log('Clearing old subscription plans...');
  
  // Delete all existing plans
  const deleted = await prisma.subscriptionPlan.deleteMany({});
  console.log(`Deleted ${deleted.count} old plans`);

  console.log('Creating new subscription plans...');

  // Create the new subscription plans
  const plans = await prisma.subscriptionPlan.createMany({
    data: [
      {
        name: "Free Trial",
        price: 0,
        productLimit: 2,
        description: "7 days free trial",
        isActive: true,
      },
      {
        name: "Starter",
        price: 4.99,
        productLimit: 20,
        description: "$4.99/month - Import up to 20 products",
        isActive: true,
      },
      {
        name: "Basic",
        price: 9.99,
        productLimit: 50,
        description: "$9.99/month - Import up to 50 products",
        isActive: true,
      },
      {
        name: "Professional",
        price: 17.99,
        productLimit: 100,
        description: "$17.99/month - Import up to 100 products",
        isActive: true,
      },
      {
        name: "Advanced",
        price: 24.99,
        productLimit: 150,
        description: "$24.99/month - Import up to 150 products",
        isActive: true,
      },
      {
        name: "Enterprise",
        price: 99.00,
        productLimit: 999,
        description: "$99.00/month - Import up to 999 products",
        isActive: true,
      },
    ],
  });

  console.log(`\n✓ Created ${plans.count} new plans:`);
  console.log(`  - Free Trial: $0 (2 products)`);
  console.log(`  - Starter: $4.99 (20 products)`);
  console.log(`  - Basic: $9.99 (50 products)`);
  console.log(`  - Professional: $17.99 (100 products)`);
  console.log(`  - Advanced: $24.99 (150 products)`);
  console.log(`  - Enterprise: $99.00 (999 products)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
