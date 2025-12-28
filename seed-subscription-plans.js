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

  // Create the subscription plans (all monthly billing)
  const trialPlan = await prisma.subscriptionPlan.create({
    data: {
      name: 'Free Trial',
      price: 0,
      productLimit: 2,
      description: '7-day free trial - Test all features with up to 2 products',
      isActive: true,
    },
  });

  const plan1 = await prisma.subscriptionPlan.create({
    data: {
      name: 'Starter',
      price: 4.99,
      productLimit: 20,
      description: '$4.99/month - Import up to 20 products',
      isActive: true,
    },
  });

  const plan2 = await prisma.subscriptionPlan.create({
    data: {
      name: 'Basic',
      price: 9.99,
      productLimit: 50,
      description: '$9.99/month - Import up to 50 products',
      isActive: true,
    },
  });

  const plan3 = await prisma.subscriptionPlan.create({
    data: {
      name: 'Professional',
      price: 17.99,
      productLimit: 100,
      description: '$17.99/month - Import up to 100 products',
      isActive: true,
    },
  });

  const plan4 = await prisma.subscriptionPlan.create({
    data: {
      name: 'Advanced',
      price: 24.99,
      productLimit: 150,
      description: '$24.99/month - Import up to 150 products',
      isActive: true,
    },
  });

  const enterprisePlan = await prisma.subscriptionPlan.create({
    data: {
      name: 'Enterprise',
      price: 99.00,
      productLimit: 999,
      description: '$99.00/month - Import up to 999 products',
      isActive: true,
    },
  });

  console.log('✓ Created subscription plans:');
  console.log(`  - ${trialPlan.name}: $${trialPlan.price} (${trialPlan.productLimit} products) - FREE TRIAL`);
  console.log(`  - ${plan1.name}: $${plan1.price} (${plan1.productLimit} products)`);
  console.log(`  - ${plan2.name}: $${plan2.price} (${plan2.productLimit} products)`);
  console.log(`  - ${plan3.name}: $${plan3.price} (${plan3.productLimit} products)`);
  console.log(`  - ${plan4.name}: $${plan4.price} (${plan4.productLimit} products)`);
  console.log(`  - ${enterprisePlan.name}: $${enterprisePlan.price} (${enterprisePlan.productLimit} products)`);
}

main()
  .catch((e) => {
    console.error('Error seeding subscription plans:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
