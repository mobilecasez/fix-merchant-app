import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * SHOP REDACT WEBHOOK (GDPR - CRITICAL)
 * Triggered: 48 hours after app uninstallation (Shopify GDPR requirement)
 * Purpose: PERMANENTLY DELETE all shop data
 * 
 * CRITICAL FOR SHOPIFY APP STORE APPROVAL:
 * - Must respond with 200 status
 * - Must delete ALL shop data immediately
 * - This is a GDPR legal requirement - failure can result in app rejection
 * 
 * Data Deletion:
 * - Sessions (authentication tokens)
 * - Subscriptions (billing info)
 * - Usage history (product imports, AI usage)
 * - Reviews/ratings
 * - Settings/preferences
 * 
 * Timeline:
 * 1. Merchant uninstalls app → app/uninstalled webhook
 * 2. 48 hours later → shop/redact webhook (THIS ONE)
 * 3. All data must be deleted immediately upon receiving this webhook
 * 
 * Reference: https://shopify.dev/docs/apps/build/privacy-law-compliance
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`✅ Received ${topic} webhook for ${shop}`);

  // GDPR: Shop data erasure request
  // This webhook is sent by Shopify 48 hours after app uninstallation
  // We MUST delete all shop data immediately upon receiving this webhook
  // Reference: https://shopify.dev/docs/apps/build/privacy-law-compliance
  
  if (payload) {
    const data = JSON.parse(payload.toString());
    
    console.log(`🗑️  Shop redaction request:`, {
      shop,
      shop_id: data.shop_id,
    });

    // Delete all data related to this shop
    await Promise.all([
      db.session.deleteMany({ where: { shop } }),
      db.shopSubscription.deleteMany({ where: { shop } }),
      db.usageHistory.deleteMany({ where: { shop } }),
      db.shopReview.deleteMany({ where: { shop } }),
      db.appSettings.deleteMany({ where: { shop } }),
    ]);

    console.log(`✅ All data permanently deleted for shop: ${shop}`);
  }

  return new Response(null, { status: 200 });
};
