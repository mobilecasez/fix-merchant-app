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
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`✅ Received ${topic} webhook for ${shop}`);

  // GDPR: Customer data request
  // When a customer requests their data, you need to provide it
  // Since this app doesn't store customer data, we acknowledge the request
  
  if (payload) {
    const data = JSON.parse(payload.toString());
    console.log(`📧 Customer data request:`, {
      shop,
      customer_id: data.customer?.id,
      orders_requested: data.orders_requested,
    });
    console.log(`✓ No customer data stored by this app`);
  }

  // Return 200 to acknowledge receipt
  // In a real scenario where customer data exists, you would email the customer their data
  return new Response(null, { status: 200 });
};
