/**
 * DIRECT FIX: Access this from your browser to force uninstall
 * URL: https://shopflixai-production.up.railway.app/api/force-reinstall?shop=zsellr.myshopify.com&key=clearSessions2024
 */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const shop = url.searchParams.get("shop");
  
  const ADMIN_KEY = process.env.ADMIN_KEY || "clearSessions2024";
  
  if (key !== ADMIN_KEY || !shop) {
    return json({ error: "Unauthorized or missing shop parameter" }, { status: 401 });
  }
  
  try {
    // Delete all sessions for this shop
    const result = await prisma.session.deleteMany({
      where: { shop }
    });
    
    // Also delete app settings
    await prisma.appSettings.deleteMany({ where: { shop } });
    
    // Delete subscription
    await prisma.shopSubscription.deleteMany({ where: { shop } });
    
    return json({
      success: true,
      message: `Cleared ${result.count} session(s) for shop: ${shop}`,
      instructions: [
        "1. Now go to your Shopify Admin",
        "2. Settings → Apps and sales channels",
        "3. Uninstall ShopFlix AI",
        "4. Wait 30 seconds",
        "5. Reinstall the app from Shopify Partner Dashboard"
      ]
    });
    
  } catch (error) {
    return json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 });
  }
};
