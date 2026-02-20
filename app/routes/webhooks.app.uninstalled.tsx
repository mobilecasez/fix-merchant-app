import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * APP UNINSTALLED WEBHOOK
 * Triggered: Immediately when merchant uninstalls the app from their store
 * Purpose: Clean up session data and prepare for GDPR shop/redact webhook
 * 
 * IMPORTANT: This is NOT the final data deletion step
 * - Shopify will send shop/redact webhook 48 hours later for GDPR compliance
 * - The shop/redact webhook handles complete data deletion
 * 
 * Shopify Best Practice: Only delete sessions here, not subscription/usage data
 * Reference: https://shopify.dev/docs/apps/build/privacy-law-compliance
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`✅ Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
    console.log(`🗑️  Deleted sessions for ${shop}`);
  }

  return new Response();
};
