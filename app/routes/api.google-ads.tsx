import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { fetchPricingProducts, numericId } from "../utils/product-analytics.server";
import {
  saveAdsSettings, loadAdsCreds, credsComplete, testAdsConnection, refreshAdsSnapshot,
} from "../utils/google-ads.server";
import { isCurrentUserAccountOwner } from "../utils/account-owner.server";

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // Google Ads config is owner-only (same gate as the settings page).
  if (!(await isCurrentUserAccountOwner(request, shop))) return json({ ok: false, error: "Only the store owner can manage this." }, { status: 403 });

  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (intent === "save") {
    await saveAdsSettings(shop, {
      developerToken: form.get("developerToken"),
      clientId: form.get("clientId"),
      clientSecret: form.get("clientSecret"),
      refreshToken: form.get("refreshToken"),
      customerId: form.get("customerId"),
      loginCustomerId: form.get("loginCustomerId"),
      cpcWindowDays: form.get("cpcWindowDays"),
    });
    return json({ ok: true, saved: true });
  }

  if (intent === "test") {
    const { creds } = await loadAdsCreds(shop);
    if (!credsComplete(creds)) return json({ ok: false, error: "Missing credentials — fill in and Save all fields first." }, { status: 400 });
    const res = await testAdsConnection(creds);
    await prisma.googleAdsSettings.update({
      where: { shop },
      data: res.ok
        ? { status: "ok", lastError: null, currencyCode: res.currency || undefined }
        : { status: "error", lastError: res.error || "Unknown error" },
    });
    return json({ ok: res.ok, error: res.error, customerName: res.customerName, currency: res.currency });
  }

  if (intent === "refresh") {
    const { creds, settings } = await loadAdsCreds(shop);
    if (!credsComplete(creds)) return json({ ok: false, error: "Connect your account first (Save + Test)." }, { status: 400 });
    try {
      const products = await fetchPricingProducts(admin, "USD");
      const variantToProduct = new Map<string, string>();
      const productIds = new Set<string>();
      for (const p of products) {
        productIds.add(p.numericId);
        const vn = numericId(p.variantId);
        if (vn) variantToProduct.set(vn, p.numericId);
      }
      // Sync over the merchant's configured window so spend-scaling denominators stay honest.
      const { byProduct } = await refreshAdsSnapshot(shop, creds, variantToProduct, productIds, settings?.cpcWindowDays || 30);
      return json({ ok: true, matched: Object.keys(byProduct).length });
    } catch (e: any) {
      const msg = String(e?.message || e).slice(0, 400);
      await prisma.googleAdsSettings.update({ where: { shop }, data: { status: "error", lastError: msg } }).catch(() => {});
      return json({ ok: false, error: msg }, { status: 502 });
    }
  }

  if (intent === "disconnect") {
    await prisma.googleAdsSettings.update({ where: { shop }, data: { enabled: false } }).catch(() => {});
    return json({ ok: true, disconnected: true });
  }

  return json({ ok: false, error: "Unknown action." }, { status: 400 });
}
