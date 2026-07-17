import { type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  fetchPricingProducts, getOrderStatsByProduct, getSessionsByProduct, getImportedSessions,
  getImportMeta, getShopCurrency, startOfNextMonthUTC, conversionPct, resolveRange,
} from "../utils/product-analytics.server";
import { getCpcSnapshot } from "../utils/google-ads.server";

function cell(v: string | number | null | undefined): string {
  const s = String(v ?? "").replace(/\r?\n/g, " ").replace(/"/g, '""');
  return `"${s}"`;
}
const n2 = (v: number | null) => (v == null ? "" : Math.round(v * 100) / 100);

// Full product P&L report for the current date range — every ranked product, matching the grid.
export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);

  const currency = (await getShopCurrency(admin, shop)) || "USD";

  const grantedScopes = String((session as any).scope || "");
  const hasOrders = /read_orders/.test(grantedScopes);

  const importMeta = await getImportMeta(shop);
  const range = resolveRange(url, importMeta.earliest);
  const pixelNotBefore = importMeta.latest ? startOfNextMonthUTC(importMeta.latest) : null;

  const costRow = await prisma.priceRadarSettings.findUnique({ where: { shop } });
  const costs = {
    shipCostPrepaid: costRow?.shipCostPrepaid || 0, shipCostCod: costRow?.shipCostCod || 0,
    rtoCostPrepaid: costRow?.rtoCostPrepaid || 0, rtoCostCod: costRow?.rtoCostCod || 0,
  };

  const [products, pixelData, importedData, researchRows] = await Promise.all([
    fetchPricingProducts(admin, currency),
    getSessionsByProduct(shop, range, pixelNotBefore),
    getImportedSessions(shop, range),
    prisma.productPriceResearch.findMany({ where: { shop } }),
  ]);
  const orderStats = hasOrders ? await getOrderStatsByProduct(admin, range, costs) : { byProduct: new Map(), totals: {} as any };
  const cpc = await getCpcSnapshot(shop);
  const numericId = (gid: string) => String(gid || "").split("/").pop() || "";
  const researchByVariant = new Map(researchRows.map((r) => [r.variantId, r]));

  // Same ad-spend basis as the grid: ACTUAL Google Ads spend when synced (scaled from the sync
  // window to this range, up-capped 3×), sessions×CPC estimate as the fallback.
  const adSpendActual = cpc.enabled && Object.keys(cpc.perfByProduct).length > 0;
  const rangeDays = Math.max(1, Math.round((range.until.getTime() - range.since.getTime()) / 86400000));
  const spendScale = Math.min(3, rangeDays / (cpc.windowDays || 30));

  const rows = products.map((p) => {
    const sessions = (importedData.get(p.numericId) || 0) + (pixelData.byId.get(p.numericId) || 0);
    const stats: any = orderStats.byProduct.get(p.numericId);
    const orders = stats?.orders || 0;
    const rr = researchByVariant.get(p.variantId);
    const productCpc = cpc.enabled ? (cpc.byProduct[p.numericId] ?? null) : null;
    const pf = adSpendActual ? cpc.perfByProduct[p.numericId] : undefined;
    const adSpend = pf && pf.s > 0 ? pf.s * spendScale : (!adSpendActual && productCpc != null ? sessions * productCpc : 0);
    const shipCost = (stats?.shipCost || 0) + (stats?.rtoCost || 0);
    const revenue = stats?.revenue || 0;
    const cost = adSpend + shipCost;
    const profit = revenue - cost;
    const profitPct = cost > 0 ? Math.round((profit / cost) * 1000) / 10 : null;
    return { p, sessions, orders, conversion: conversionPct(orders, sessions), productCpc, adSpend, shipCost, revenue, profit, profitPct, rr };
  });
  rows.sort((a, b) => (b.sessions - a.sessions) || (b.orders - a.orders) || a.p.title.localeCompare(b.p.title));

  const headers = [
    "Product", "SKU", "Sessions", "Orders", "Conversion %", "Ad CPC", "Ad spend",
    "Revenue", "Shipping + RTO", "Profit / Loss", "Profit %",
    "Current price", "Original price", "Suggested price", "Status",
  ];
  const body = rows.map((r) => [
    r.p.title, r.p.sku || "", r.sessions, r.orders, r.conversion ?? "",
    n2(r.productCpc), n2(r.adSpend || null), n2(r.revenue || null), n2(r.shipCost || null),
    n2(r.profit), r.profitPct ?? "",
    n2(r.p.currentPrice), n2((r.rr as any)?.originalPrice ?? null), n2((r.rr as any)?.researchedPrice ?? null),
    (r.rr as any)?.status || "",
  ].map(cell).join(","));

  const csv = "﻿" + headers.map(cell).join(",") + "\r\n" + body.join("\r\n") + "\r\n";
  const fname = `price-radar-report_${range.since.toISOString().slice(0, 10)}_${range.until.toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fname}"`,
      "Cache-Control": "no-store",
    },
  });
}
