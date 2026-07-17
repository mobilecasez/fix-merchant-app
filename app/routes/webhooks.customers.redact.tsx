import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * CUSTOMER REDACT WEBHOOK (GDPR)
 * Triggered: When a customer requests deletion of their personal data
 * Purpose: Delete all customer personal data within 30 days
 * 
 * IMPORTANT FOR SHOPIFY APP STORE APPROVAL:
 * - Must respond with 200 status
 * - Must delete ALL customer personal data
 * - This is a GDPR legal requirement
 * 
 * This app stores NO customer personal data:
 * - We only access shop/product data
 * - No customer names, emails, addresses, or orders are stored
 * - Subscription and usage data is shop-level only (not customer-level)
 * 
 * If you store customer data in the future (reviews, wishlists, etc.):
 * - Add database deletion logic here
 * - Delete by customer ID from payload
 * 
 * Reference: https://shopify.dev/docs/apps/build/privacy-law-compliance
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.webhook(request);
  // GDPR customers/redact: this app stores NO customer-level personal data, so there is
  // nothing to delete — just acknowledge. NOTE: `payload` from authenticate.webhook is
  // already parsed; re-parsing it via JSON.parse(payload.toString()) throws and returned 500.
  return new Response(null, { status: 200 });
};
