import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { resetMonthlyUsage } from "../utils/billing.server";

/**
 * Webhook handler for APP_SUBSCRIPTIONS_UPDATE
 * Triggered when:
 * - Subscription renews (monthly)
 * - Subscription status changes
 * - Subscription is upgraded/downgraded
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  try {
    // Reset monthly usage counter when subscription renews or becomes active
    if (payload.app_subscription?.status === "ACTIVE") {await resetMonthlyUsage(shop);}

    // Handle other statuses
    if (payload.app_subscription?.status === "CANCELLED") {// The subscription status is already updated by Shopify
    }

    if (payload.app_subscription?.status === "DECLINED") {}

    if (payload.app_subscription?.status === "EXPIRED") {}

    return new Response(null, { status: 200 });
  } catch (error) {
    console.error(`[Webhook] Error processing ${topic}:`, error);
    return new Response(null, { status: 500 });
  }
};
