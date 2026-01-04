import prisma from "../db.server";
import type { ShopSubscription, SubscriptionPlan } from "@prisma/client";

/**
 * Calculate the current products used based on subscription status
 * @param subscription - Subscription object with plan included (can be from loader JSON)
 * @returns The correct products used count (trial or active)
 */
export function getProductsUsed(subscription: any): number {
  if (!subscription) return 0;
  
  return subscription.status === "trial" 
    ? subscription.trialProductsUsed 
    : subscription.productsUsed;
}

/**
 * Get or create subscription with free trial (auto-initializes on first access)
 */
export async function getOrCreateSubscription(shop: string) {
  let subscription = await prisma.shopSubscription.findUnique({
    where: { shop },
    include: { plan: true },
  });

  if (!subscription) {
    // Get the Free Trial plan
    const freeTrialPlan = await prisma.subscriptionPlan.findFirst({
      where: { name: "Free Trial" },
    });

    if (!freeTrialPlan) {
      throw new Error("Free Trial plan not found. Please run seed script.");
    }

    // Create subscription with free trial
    subscription = await prisma.shopSubscription.create({
      data: {
        shop,
        planId: freeTrialPlan.id,
        status: "trial",
        productsUsed: 0,
        trialProductsUsed: 0,
        triedPlanIds: freeTrialPlan.id,
        billingCycleStart: new Date(),
      },
      include: { plan: true },
    });
  }

  return subscription;
}

/**
 * Check if shop has tried a specific plan
 */
export async function hasTriedPlan(shop: string, planId: string): Promise<boolean> {
  const subscription = await prisma.shopSubscription.findUnique({
    where: { shop },
  });

  if (!subscription || !subscription.triedPlanIds) return false;
  
  const triedPlans = subscription.triedPlanIds.split(',').filter(id => id.length > 0);
  return triedPlans.includes(planId);
}

/**
 * Start trial for a specific plan (2 free products)
 */
export async function startPlanTrial(shop: string, planId: string) {
  // Check if this plan was already tried
  const alreadyTried = await hasTriedPlan(shop, planId);
  if (alreadyTried) {
    throw new Error("You've already tried this plan. Please purchase to continue.");
  }

  const existing = await prisma.shopSubscription.findUnique({
    where: { shop },
  });

  const now = new Date();
  const triedPlanIds = existing?.triedPlanIds 
    ? `${existing.triedPlanIds},${planId}` 
    : planId;

  if (existing) {
    return await prisma.shopSubscription.update({
      where: { shop },
      data: {
        planId,
        status: "trial",
        trialProductsUsed: 0,
        triedPlanIds,
        billingCycleStart: now,
      },
    });
  }

  return await prisma.shopSubscription.create({
    data: {
      shop,
      planId,
      status: "trial",
      trialProductsUsed: 0,
      triedPlanIds: planId,
      billingCycleStart: now,
    },
  });
}

/**
 * Check if trial has reached 2 product limit
 */
export async function isTrialLimitReached(shop: string): Promise<boolean> {
  const subscription = await prisma.shopSubscription.findUnique({
    where: { shop },
  });

  if (subscription?.status === "trial") {
    return subscription.trialProductsUsed >= 2;
  }

  return false;
}

/**
 * Check if shop has an active subscription
 */
export async function hasActiveSubscription(shop: string): Promise<boolean> {
  const subscription = await prisma.shopSubscription.findUnique({
    where: { shop },
    include: { plan: true },
  });

  return subscription?.status === "active" || subscription?.status === "trial";
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
    return false;
  }

  if (subscription.status !== "active" && subscription.status !== "trial") {
    return false;
  }

  // For trial status, check 2-product limit
  if (subscription.status === "trial") {
    return subscription.trialProductsUsed < 2;
  }

  // For active subscription, check plan limit
  return subscription.productsUsed < subscription.plan.productLimit;
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

  // Update appropriate counter based on status
  if (subscription.status === "trial") {
    await prisma.shopSubscription.update({
      where: { shop },
      data: {
        trialProductsUsed: subscription.trialProductsUsed + 1,
      },
    });
  } else {
    await prisma.shopSubscription.update({
      where: { shop },
      data: {
        productsUsed: subscription.productsUsed + 1,
      },
    });
  }

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

  // Reset product counter only if moving to a higher limit plan
  if (newPlan.productLimit > subscription.plan.productLimit) {
    updates.productsUsed = 0;
  }

  // If upgrading from trial, reset counters and set billing cycle
  if (subscription.status === "trial") {
    const now = new Date();
    updates.productsUsed = 0;
    updates.trialProductsUsed = 0;
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
