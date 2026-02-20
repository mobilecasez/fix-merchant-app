import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

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
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`✅ Received ${topic} webhook for ${shop}`);

  // GDPR: Customer data erasure request
  // Delete all customer-related data when requested
  
  if (payload) {
    const data = JSON.parse(payload.toString());
    const customerId = data.customer?.id;
    
    console.log(`🗑️  Customer redaction request:`, {
      shop,
      customer_id: customerId,
    });

    // This app doesn't store customer data, so nothing to delete
    console.log(`✓ No customer data stored by this app`);
    
    // If you stored customer data, delete it here:
    // await db.customerData.deleteMany({ where: { customerId } });
  }

  return new Response(null, { status: 200 });
};
