import prisma from "../db.server";
import type { ShopSubscription, SubscriptionPlan } from "@prisma/client";

/**
 * Calculate the current products used
 * @param subscription - Subscription object with plan included (can be from loader JSON)
 * @returns The current products used count
 */
export function getProductsUsed(subscription: any): number {
  if (!subscription) return 0;
  return subscription.productsUsed;
}

/**
 * Get the effective product limit for the current billing period.
 * After a downgrade, periodProductLimit stores the old plan's limit so
 * remaining credits carry over until the next billing cycle reset.
 */
export function getEffectiveProductLimit(subscription: any): number {
  if (!subscription) return 0;
  return subscription.periodProductLimit ?? subscription.plan.productLimit;
}

/**
 * Get or create subscription with Free Plan (auto-initializes on first access)
 * Now with auto-recovery: creates Free Plan if missing to prevent startup errors
 */
export async function getOrCreateSubscription(shop: string) {
  let subscription = await prisma.shopSubscription.findUnique({
    where: { shop },
    include: { plan: true },
  });

  if (!subscription) {
    // Get the Free Plan (with fallback to Free Trial for backward compatibility)
    let freePlan = await prisma.subscriptionPlan.findFirst({
      where: { 
        OR: [
          { name: "Free Plan" },
          { name: "Free Trial" }
        ]
      },
    });

    // Auto-create Free Plan if it doesn't exist (auto-recovery)
    if (!freePlan) {
      try {
        freePlan = await prisma.subscriptionPlan.create({
          data: {
            name: 'Free Plan',
            price: 0,
            productLimit: 2,
            description: 'Free Forever - Import up to 2 products per month',
            isActive: true,
          },
        });
      } catch (error) {
        console.error('[Billing] Failed to auto-create Free Plan:', error);
        throw new Error("Free Plan not found and could not be created. Please run: node seed-subscription-plans.js");
      }
    }

    // If plan was "Free Trial", rename it to "Free Plan" for consistency
    if (freePlan.name === "Free Trial") {
      freePlan = await prisma.subscriptionPlan.update({
        where: { id: freePlan.id },
        data: { name: "Free Plan" }
      });
    }

    // Create subscription with Free Plan (permanent free tier)
    subscription = await prisma.shopSubscription.create({
      data: {
        shop,
        plan: { connect: { id: freePlan.id } },
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
    return false;
  }


  if (subscription.status !== "active") {
    return false;
  }

  // Check effective limit (may differ from plan.productLimit after a downgrade)
  const effectiveLimit = getEffectiveProductLimit(subscription);
  const canCreate = subscription.productsUsed < effectiveLimit;
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


  // Increment products used
  await prisma.shopSubscription.update({
    where: { shop },
    data: {
      productsUsed: subscription.productsUsed + 1,
    },
  });

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
      periodProductLimit: null, // Clear carry-over limit; new plan's limit now applies
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
        plan: { connect: { id: planId } },
        chargeId,
        status: "active",
        productsUsed: 0,
        periodProductLimit: null,
        billingCycleStart: now,
        billingCycleEnd: endDate,
      },
    });
  }

  return await prisma.shopSubscription.create({
    data: {
      shop,
      plan: { connect: { id: planId } },
      chargeId,
      status: "active",
      productsUsed: 0,
      periodProductLimit: null,
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

  const isUpgrade = newPlan.productLimit > subscription.plan.productLimit;

  const updates: any = {
    plan: { connect: { id: newPlanId } },
    status: "active",
    // Clear the Shopify charge ID when moving to the free plan
    ...(newPlan.price === 0 ? { chargeId: null } : {}),
  };

  if (isUpgrade) {
    // Upgrade: start a fresh billing cycle with zero usage and clear any
    // carry-over limit from a previous downgrade.
    const now = new Date();
    updates.productsUsed = 0;
    updates.periodProductLimit = null;
    updates.billingCycleStart = now;
    updates.billingCycleEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  } else {
    // Downgrade: keep productsUsed and billingCycleEnd as-is so the merchant
    // retains their remaining credits for the current period.
    // Preserve the highest periodProductLimit seen (handles multiple downgrades
    // in the same period — always keep the best carry-over limit).
    const currentEffectiveLimit = subscription.periodProductLimit ?? subscription.plan.productLimit;
    updates.periodProductLimit = currentEffectiveLimit;
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

  const effectiveLimit = getEffectiveProductLimit(subscription);
  const percentage = (subscription.productsUsed / effectiveLimit) * 100;

  if (percentage >= 100) {
    return {
      percentage,
      level: 'critical',
      message: `You've reached your limit of ${effectiveLimit} products. Upgrade your plan to continue.`,
    };
  } else if (percentage >= 80) {
    return {
      percentage,
      level: 'warning',
      message: `You've used ${subscription.productsUsed} of ${effectiveLimit} products (${Math.round(percentage)}%). Consider upgrading soon.`,
    };
  }

  return { percentage, level: 'none', message: '' };
}
