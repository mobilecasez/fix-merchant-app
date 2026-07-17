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
  const { shop } = await authenticate.webhook(request);
  // GDPR shop/redact (sent 48h after uninstall): permanently delete all data for this shop.
  // NOTE: `payload` from authenticate.webhook is ALREADY a parsed object — re-parsing it via
  // JSON.parse(payload.toString()) throws ("[object Object]" isn't JSON) and made this webhook
  // return 500. We only need `shop`, so delete directly and always acknowledge with 200.
  try {
    await Promise.all([
      db.session.deleteMany({ where: { shop } }),
      db.shopSubscription.deleteMany({ where: { shop } }),
      db.usageHistory.deleteMany({ where: { shop } }),
      db.shopReview.deleteMany({ where: { shop } }),
      db.appSettings.deleteMany({ where: { shop } }),
      // Price Radar / AI era data — leaving these would keep dead shops in cron batches
      // (weekly digest) and retain merchant data past the GDPR deadline.
      db.aiReport.deleteMany({ where: { shop } }),
      db.priceRadarSettings.deleteMany({ where: { shop } }),
      db.googleAdsSettings.deleteMany({ where: { shop } }),
      db.productPriceResearch.deleteMany({ where: { shop } }),
      db.productSessionImport.deleteMany({ where: { shop } }),
      db.productVisitDaily.deleteMany({ where: { shop } }),
      db.priceBatchJob.deleteMany({ where: { shop } }),
      db.productAICheck.deleteMany({ where: { shop } }),
      db.storeMonitor.deleteMany({ where: { shop } }),
      db.storeScan.deleteMany({ where: { shop } }),
    ]);
  } catch (err) {
    console.error(`[shop/redact] deletion failed for ${shop}:`, err);
  }

  return new Response(null, { status: 200 });
};
