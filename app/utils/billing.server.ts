import prisma from "../db.server";
import type { ShopSubscription, SubscriptionPlan } from "@prisma/client";

/**
 * Calculate the current products used
 * @param subscription - Subscription object with plan included (can be from loader JSON)
 * @returns The current products used count
 */
export function getProductsUsed(subscription: any): number {
  if (!subscription) return 0;
  
  console.log('[Billing] getProductsUsed - Status:', subscription.status, 'Returning:', subscription.productsUsed);
  
  return subscription.productsUsed;
}

/**
 * Get or create subscription with Free Plan (auto-initializes on first access)
 */
export async function getOrCreateSubscription(shop: string) {
  let subscription = await prisma.shopSubscription.findUnique({
    where: { shop },
    include: { plan: true },
  });

  if (!subscription) {
    // Get the Free Plan
    const freePlan = await prisma.subscriptionPlan.findFirst({
      where: { name: "Free Plan" },
    });

    if (!freePlan) {
      throw new Error("Free Plan not found. Please run seed script.");
    }

    // Create subscription with Free Plan (permanent free tier)
    subscription = await prisma.shopSubscription.create({
      data: {
        shop,
        planId: freePlan.id,
        status: "active",
        productsUsed: 0,
        trialProductsUsed: 0,
        triedPlanIds: "",
        billingCycleStart: new Date(),
      },
      include: { plan: true },
    });
  }

  return subscription;
}

/**
 * Check if shop has an active subscription
 */
export async function hasActiveSubscription(shop: string): Promise<boolean> {
  const subscription = await prisma.shopSubscription.findUnique({
    where: { shop },
    include: { plan: true },
  });

  return subscription?.status === "active";
}

/**
 * Get shop's current subscription details
 */
export async function getShopSubscription(shop: string) {
  return await prisma.shopSubscription.findUnique({
    where: { shop },
    include: { plan: true },
  });
}

/**
 * Check if shop has reached product limit
 */
export async function canCreateProduct(shop: string): Promise<boolean> {
  const subscription = await prisma.shopSubscription.findUnique({
    where: { shop },
    include: { plan: true },
  });

  if (!subscription) {
    console.log('[Billing] No subscription found');
    return false;
  }

  console.log('[Billing] Checking limit - Status:', subscription.status, 'Used:', subscription.productsUsed, 'Limit:', subscription.plan.productLimit);

  if (subscription.status !== "active") {
    console.log('[Billing] Subscription not active');
    return false;
  }

  // Check plan limit
  const canCreate = subscription.productsUsed < subscription.plan.productLimit;
  console.log('[Billing] Subscription check:', canCreate, '(', subscription.productsUsed, '<', subscription.plan.productLimit, ')');
  return canCreate;
}

/**
 * Increment product usage counter and log to usage history
 */
export async function incrementProductUsage(shop: string) {
  const subscription = await prisma.shopSubscription.findUnique({
    where: { shop },
    include: { plan: true },
  });

  if (!subscription) {
    throw new Error("No subscription found for shop");
  }

  console.log('[Billing] Current usage:', subscription.productsUsed);

  // Increment products used
  await prisma.shopSubscription.update({
    where: { shop },
    data: {
      productsUsed: subscription.productsUsed + 1,
    },
  });
  console.log('[Billing] Incremented productsUsed to:', subscription.productsUsed + 1);

  // Log to usage history (daily aggregation) - only for active subscriptions
  if (subscription.status === "active") {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existingRecord = await prisma.usageHistory.findFirst({
      where: {
        shop,
        date: {
          gte: today,
          lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
        },
      },
    });

    if (existingRecord) {
      await prisma.usageHistory.update({
        where: { id: existingRecord.id },
        data: {
          productsCreated: existingRecord.productsCreated + 1,
        },
      });
    } else {
      await prisma.usageHistory.create({
        data: {
          shop,
          date: today,
          productsCreated: 1,
          planName: subscription.plan.name,
          planLimit: subscription.plan.productLimit,
        },
      });
    }
  }
}

/**
 * Reset monthly product usage (should be called via cron or webhook)
 */
export async function resetMonthlyUsage(shop: string) {
  const now = new Date();
  
  await prisma.shopSubscription.update({
    where: { shop },
    data: {
      productsUsed: 0,
      billingCycleStart: now,
      billingCycleEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
    },
  });
}

/**
 * Create or update shop subscription after successful billing
 */
export async function createSubscription(
  shop: string,
  planId: string,
  chargeId?: string
) {
  const now = new Date();
  const endDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

  const existingSubscription = await prisma.shopSubscription.findUnique({
    where: { shop },
  });

  if (existingSubscription) {
    return await prisma.shopSubscription.update({
      where: { shop },
      data: {
        planId,
        chargeId,
        status: "active",
        productsUsed: 0,
        billingCycleStart: now,
        billingCycleEnd: endDate,
      },
    });
  }

  return await prisma.shopSubscription.create({
    data: {
      shop,
      planId,
      chargeId,
      status: "active",
      productsUsed: 0,
      billingCycleStart: now,
      billingCycleEnd: endDate,
    },
  });
}

/**
 * Cancel shop subscription
 */
export async function cancelSubscription(shop: string) {
  await prisma.shopSubscription.update({
    where: { shop },
    data: {
      status: "cancelled",
      cancelledAt: new Date(),
    },
  });
}

/**
 * Upgrade or downgrade subscription plan
 */
export async function changePlan(shop: string, newPlanId: string) {
  const subscription = await prisma.shopSubscription.findUnique({
    where: { shop },
    include: { plan: true },
  });

  if (!subscription) {
    throw new Error("No subscription found");
  }

  const newPlan = await prisma.subscriptionPlan.findUnique({
    where: { id: newPlanId },
  });

  if (!newPlan) {
    throw new Error("Invalid plan");
  }

  const updates: any = {
    planId: newPlanId,
    status: "active",
  };

  // Reset product counter only if moving to a higher limit plan, or if upgrading from Free Plan
  if (newPlan.productLimit > subscription.plan.productLimit || subscription.plan.name === "Free Plan") {
    updates.productsUsed = 0;
    const now = new Date();
    updates.billingCycleStart = now;
    updates.billingCycleEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  }

  return await prisma.shopSubscription.update({
    where: { shop },
    data: updates,
  });
}

/**
 * Get usage statistics for a shop
 */
export async function getUsageStats(shop: string, days: number = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const history = await (prisma as any).usageHistory.findMany({
    where: {
      shop,
      date: {
        gte: startDate,
      },
    },
    orderBy: {
      date: 'asc',
    },
  });

  const totalProducts = history.reduce((sum: number, record: any) => sum + record.productsCreated, 0);
  const avgPerDay = history.length > 0 ? totalProducts / history.length : 0;

  return {
    history,
    totalProducts,
    avgPerDay,
    daysTracked: history.length,
  };
}

/**
 * Check usage percentage and return warning level
 */
export async function getUsageWarning(shop: string): Promise<{
  percentage: number;
  level: 'none' | 'warning' | 'critical';
  message: string;
}> {
  const subscription = await prisma.shopSubscription.findUnique({
    where: { shop },
    include: { plan: true },
  });

  if (!subscription) {
    return { percentage: 0, level: 'none', message: '' };
  }

  const percentage = (subscription.productsUsed / subscription.plan.productLimit) * 100;

  if (percentage >= 100) {
    return {
      percentage,
      level: 'critical',
      message: `You've reached your limit of ${subscription.plan.productLimit} products. Upgrade your plan to continue.`,
    };
  } else if (percentage >= 80) {
    return {
      percentage,
      level: 'warning',
      message: `You've used ${subscription.productsUsed} of ${subscription.plan.productLimit} products (${Math.round(percentage)}%). Consider upgrading soon.`,
    };
  }

  return { percentage, level: 'none', message: '' };
}
