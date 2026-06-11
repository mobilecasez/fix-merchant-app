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
  
  // Always-on pass: refresh plan DESCRIPTIONS when the copy changes (covers
  // existing databases, which the create-if-missing path below never touches).
  // Only the description is updated — price/limit edits made in Manage Plans
  // are never overwritten.
  const PLAN_DESCRIPTIONS = {
    'Free Plan': 'Free forever — first Basic store scan FREE + 2 credits/month for AI imports & fixes',
    'Starter': '$4.99/month — 20 credits for AI imports, compliance scans & one-click fixes',
    'Basic': '$9.99/month — 50 credits: Basic + Advanced scans, auto-fixes, image fixer & monitoring',
    'Professional': '$17.99/month — 100 credits: full scan suite, Suspension Recovery + appeal letters',
    'Advanced': '$24.99/month — 150 credits: everything at scale — image fixes, monitoring & recovery',
    'Enterprise': '$99.00/month — 999 credits for high-volume stores & agencies',
  };
  for (const [name, description] of Object.entries(PLAN_DESCRIPTIONS)) {
    const plan = await prisma.subscriptionPlan.findFirst({ where: { name } });
    if (plan && plan.description !== description) {
      await prisma.subscriptionPlan.update({ where: { id: plan.id }, data: { description } });
      console.log(`✓ Updated description: ${name}`);
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
  
  const FREE_PLAN_DESC = 'Free forever — first Basic store scan FREE + 2 credits/month for AI imports & fixes';

  if (!freePlanRecord) {
    freePlanRecord = await prisma.subscriptionPlan.create({
      data: {
        name: 'Free Plan',
        price: 0,
        productLimit: 2,
        description: FREE_PLAN_DESC,
        isActive: true,
      },
    });
    console.log(`✓ Created: ${freePlanRecord.name}`);
  } else if (freePlanRecord.description !== FREE_PLAN_DESC) {
    await prisma.subscriptionPlan.update({
      where: { id: freePlanRecord.id },
      data: { description: FREE_PLAN_DESC },
    });
    console.log('✓ Updated Free Plan description');
  }

  // Create plans if missing; refresh descriptions when they change (credits
  // cover imports, scans, auto-fixes, image fixes, suspension recovery, monitoring).
  const plansToCreate = [
    { name: 'Starter', price: 4.99, productLimit: 20, description: '$4.99/month — 20 credits for AI imports, compliance scans & one-click fixes' },
    { name: 'Basic', price: 9.99, productLimit: 50, description: '$9.99/month — 50 credits: Basic + Advanced scans, auto-fixes, image fixer & monitoring' },
    { name: 'Professional', price: 17.99, productLimit: 100, description: '$17.99/month — 100 credits: full scan suite, Suspension Recovery + appeal letters' },
    { name: 'Advanced', price: 24.99, productLimit: 150, description: '$24.99/month — 150 credits: everything at scale — image fixes, monitoring & recovery' },
    { name: 'Enterprise', price: 99.00, productLimit: 999, description: '$99.00/month — 999 credits for high-volume stores & agencies' },
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
    } else if (existing.description !== planData.description) {
      await prisma.subscriptionPlan.update({
        where: { id: existing.id },
        data: { description: planData.description },
      });
      console.log(`✓ Updated description: ${planData.name}`);
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
