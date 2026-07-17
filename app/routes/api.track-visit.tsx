/**
 * PUBLIC storefront visit pixel endpoint. Called (via sendBeacon) by /visit-tracker.js on
 * product pages to record a product-page view. No auth — it only increments a per-day
 * counter and validates the shop is a myshopify domain. Powers per-product session data on
 * stores where ShopifyQL analytics isn't available (Basic plan).
 */
import { json, type ActionFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function loader() {
  // CORS preflight / non-POST probe
  return new Response(null, { status: 204, headers: CORS });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return json({ ok: false }, { status: 405, headers: CORS });
  let body: any = {};
  try { body = await request.json(); } catch { try { body = JSON.parse(await request.text()); } catch { /* ignore */ } }
  const shop = String(body.shop || "").trim().toLowerCase();
  const productId = String(body.productId || body.pid || "").replace(/[^0-9]/g, "");
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) || !productId) {
    return json({ ok: false }, { status: 400, headers: CORS });
  }
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  try {
    await prisma.productVisitDaily.upsert({
      where: { shop_productId_date: { shop, productId, date: day } },
      create: { shop, productId, date: day, visits: 1 },
      update: { visits: { increment: 1 } },
    });
  } catch (err) {
    console.error("[track-visit] upsert failed:", err);
  }
  return json({ ok: true }, { headers: CORS });
}
