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

  console.log(`[Webhook] ${topic} received for shop: ${shop}`);
  console.log(`[Webhook] Subscription status: ${payload.app_subscription?.status}`);

  try {
    // Reset monthly usage counter when subscription renews or becomes active
    if (payload.app_subscription?.status === "ACTIVE") {
      console.log(`[Webhook] Resetting monthly usage for shop: ${shop}`);
      await resetMonthlyUsage(shop);
      console.log(`[Webhook] Monthly usage reset complete`);
    }

    // Handle other statuses
    if (payload.app_subscription?.status === "CANCELLED") {
      console.log(`[Webhook] Subscription cancelled for shop: ${shop}`);
      // The subscription status is already updated by Shopify
    }

    if (payload.app_subscription?.status === "DECLINED") {
      console.log(`[Webhook] Subscription declined for shop: ${shop}`);
    }

    if (payload.app_subscription?.status === "EXPIRED") {
      console.log(`[Webhook] Subscription expired for shop: ${shop}`);
    }

    return new Response(null, { status: 200 });
  } catch (error) {
    console.error(`[Webhook] Error processing ${topic}:`, error);
    return new Response(null, { status: 500 });
  }
};
