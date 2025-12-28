import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const existingPlans = await prisma.subscriptionPlan.count();
  
  if (existingPlans > 0) {
    console.log(`Plans already exist (${existingPlans})`);
    return;
  }

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

  console.log(`Created ${plans.count} plans`);
}

main()
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
