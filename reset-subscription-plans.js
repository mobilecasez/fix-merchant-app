import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('� Updating subscription plans for Free Plan migration...');
  
  // Find the old Free Trial plan
  const freeTrialPlan = await prisma.subscriptionPlan.findFirst({
    where: { name: 'Free Trial' }
  });
  
  if (freeTrialPlan) {
    // Update it to become the Free Plan
    await prisma.subscriptionPlan.update({
      where: { id: freeTrialPlan.id },
      data: {
        name: 'Free Plan',
        description: 'Free Forever - Import up to 2 products per month',
        price: 0,
        productLimit: 2
      }
    });
    console.log('✓ Updated "Free Trial" to "Free Plan"');
    
    // Update all subscriptions with status="trial" to status="active"
    const updated = await prisma.shopSubscription.updateMany({
      where: { status: 'trial' },
      data: { status: 'active' }
    });
    console.log(`✓ Updated ${updated.count} subscriptions from trial to active status`);
  } else {
    console.log('ℹ️  No "Free Trial" plan found - probably already migrated');
  }
  
  console.log('\n✅ Migration complete!');
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
