import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * CUSTOMER DATA REQUEST WEBHOOK (GDPR)
 * Triggered: When a customer requests access to their personal data
 * Purpose: Provide customer with all their data within 30 days
 * 
 * IMPORTANT FOR SHOPIFY APP STORE APPROVAL:
 * - Must respond with 200 status
 * - Must provide customer data or confirm no data exists
 * 
 * This app stores NO customer personal data:
 * - We only access shop/product data
 * - No customer names, emails, addresses, or orders are stored
 * - Subscription data is shop-level only
 * 
 * Reference: https://shopify.dev/docs/apps/build/privacy-law-compliance
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.webhook(request);
  // GDPR customers/data_request: this app stores NO customer personal data, so there is
  // nothing to return — just acknowledge receipt. NOTE: `payload` from authenticate.webhook
  // is already parsed; re-parsing via JSON.parse(payload.toString()) throws and returned 500.
  return new Response(null, { status: 200 });
};
