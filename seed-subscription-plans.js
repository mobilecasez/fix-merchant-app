import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding subscription plans...');

  // Check if Free Plan specifically exists (this is critical for app to work)
  const freePlan = await prisma.subscriptionPlan.findFirst({
    where: { name: 'Free Plan' }
  });
  
  // If there's a "Free Trial" but no "Free Plan", rename it
  if (!freePlan) {
    const freeTrial = await prisma.subscriptionPlan.findFirst({
      where: { name: 'Free Trial' }
    });
    
    if (freeTrial) {
      console.log('Found "Free Trial" - renaming to "Free Plan"...');
      await prisma.subscriptionPlan.update({
        where: { id: freeTrial.id },
        data: { name: 'Free Plan' }
      });
      console.log('✓ Renamed to "Free Plan"');
    }
  }
  
  // Check if we need to seed (no plans at all)
  const existingPlans = await prisma.subscriptionPlan.count();
  
  if (existingPlans >= 6) {
    console.log(`Found ${existingPlans} existing plans. Verifying Free Plan exists...`);
    const verified = await prisma.subscriptionPlan.findFirst({
      where: { name: 'Free Plan' }
    });
    if (verified) {
      console.log('✓ Free Plan verified - all good!');
      return;
    }
  }

  // Create missing plans
  console.log('Creating subscription plans...');
  
  // Create Free Plan if it doesn't exist
  let freePlanRecord = await prisma.subscriptionPlan.findFirst({
    where: { name: 'Free Plan' }
  });
  
  if (!freePlanRecord) {
    freePlanRecord = await prisma.subscriptionPlan.create({
      data: {
        name: 'Free Plan',
        price: 0,
        productLimit: 2,
        description: 'Free Forever - Import up to 2 products per month',
        isActive: true,
      },
    });
    console.log(`✓ Created: ${freePlanRecord.name}`);
  }

  // Create other plans only if they don't exist
  const plansToCreate = [
    { name: 'Starter', price: 4.99, productLimit: 20, description: '$4.99/month - Import up to 20 products' },
    { name: 'Basic', price: 9.99, productLimit: 50, description: '$9.99/month - Import up to 50 products' },
    { name: 'Professional', price: 17.99, productLimit: 100, description: '$17.99/month - Import up to 100 products' },
    { name: 'Advanced', price: 24.99, productLimit: 150, description: '$24.99/month - Import up to 150 products' },
    { name: 'Enterprise', price: 99.00, productLimit: 999, description: '$99.00/month - Import up to 999 products' },
  ];

  for (const planData of plansToCreate) {
    const existing = await prisma.subscriptionPlan.findFirst({
      where: { name: planData.name }
    });
    
    if (!existing) {
      const created = await prisma.subscriptionPlan.create({
        data: { ...planData, isActive: true }
      });
      console.log(`✓ Created: ${created.name}`);
    }
  }

  console.log('\n✓ All subscription plans are ready!');
}

main()
  .catch((e) => {
    console.error('Error seeding subscription plans:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
