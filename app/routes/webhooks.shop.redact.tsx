import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // GDPR: Shop data erasure request (48 hours after uninstall)
  // Delete all shop-related data
  
  if (payload) {
    const data = JSON.parse(payload.toString());
    
    console.log("Shop redaction request:", {
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

    console.log(`All data deleted for shop: ${shop}`);
  }

  return new Response(null, { status: 200 });
};
