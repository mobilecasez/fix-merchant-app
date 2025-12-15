import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding subscription plans...');

  // Check if plans already exist
  const existingPlans = await prisma.subscriptionPlan.count();
  
  if (existingPlans > 0) {
    console.log(`Found ${existingPlans} existing plans. Skipping seed.`);
    return;
  }

  // Create the three subscription plans
  const trialPlan = await prisma.subscriptionPlan.create({
    data: {
      name: 'Free Trial',
      price: 0,
      productLimit: 10,
      description: '7-day free trial - Test all features with up to 10 products',
      isActive: true,
    },
  });

  const basicPlan = await prisma.subscriptionPlan.create({
    data: {
      name: 'Basic',
      price: 4.99,
      productLimit: 20,
      description: 'Perfect for getting started - Add up to 20 products per month',
      isActive: true,
    },
  });

  const proPlan = await prisma.subscriptionPlan.create({
    data: {
      name: 'Professional',
      price: 9.99,
      productLimit: 50,
      description: 'Great for growing businesses - Add up to 50 products per month',
      isActive: true,
    },
  });

  const premiumPlan = await prisma.subscriptionPlan.create({
    data: {
      name: 'Premium',
      price: 14.99,
      productLimit: 100,
      description: 'For power users - Add up to 100 products per month',
      isActive: true,
    },
  });

  console.log('✓ Created subscription plans:');
  console.log(`  - ${trialPlan.name}: $${trialPlan.price} (${trialPlan.productLimit} products) - FREE TRIAL`);
  console.log(`  - ${basicPlan.name}: $${basicPlan.price} (${basicPlan.productLimit} products)`);
  console.log(`  - ${proPlan.name}: $${proPlan.price} (${proPlan.productLimit} products)`);
  console.log(`  - ${premiumPlan.name}: $${premiumPlan.price} (${premiumPlan.productLimit} products)`);
}

main()
  .catch((e) => {
    console.error('Error seeding subscription plans:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
