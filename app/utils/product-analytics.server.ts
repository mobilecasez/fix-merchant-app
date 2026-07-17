/**
 * Price Radar analytics — per-product ORDERS, SESSIONS and CONVERSION for a date range.
 *
 * All maps are keyed by the NUMERIC product id (the tail of the gid) so pixel data
 * (numeric ids from the storefront) and Admin-API data (gids) join cleanly.
 *
 * Sessions come from two conditional sources: our own storefront visit pixel
 * (ProductVisitDaily — works on every plan) and, where available, Shopify's ShopifyQL
 * analytics (Shopify plan and above). ShopifyQL is best-effort: if it errors or the store's
 * plan doesn't support it, we silently fall back to pixel data.
 */
import prisma from "../db.server";

export interface Range { since: Date; until: Date }

export function numericId(gid: string): string {
  return String(gid || "").split("/").pop() || "";
}

/**
 * Admin GraphQL with automatic throttle recovery: Shopify throws `GraphqlQueryError: Throttled`
 * when the app's cost budget is exhausted (heavy pages + background AI jobs can collide). Wait for
 * the bucket to refill and retry instead of crashing the whole loader/job.
 */
async function gqlThrottleSafe(admin: any, query: string, variables: any): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    try {
      const resp: any = await admin.graphql(query, { variables });
      return await resp.json();
    } catch (e: any) {
      if (attempt < 2 && /throttl/i.test(String(e?.message || e))) {
        await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
}
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface OrderCosts { shipCostPrepaid: number; shipCostCod: number; rtoCostPrepaid: number; rtoCostCod: number }
export interface OrderStats {
  orders: number;
  revenue: number;   // post-discount line revenue from DELIVERED orders only
  shipCost: number;  // this product's SHARE of delivered orders' shipping cost
  rtoCost: number;   // this product's SHARE of return-involved orders' RTO cost
  deliveredOrders: number;      // orders containing this product that were delivered
  returnedOrders: number;       // …that came back (RTO / return complete)
  codOrders: number;            // …paid by COD
  containedValue: number;       // Σ full order value of DELIVERED orders containing this product (basket-lift signal)
}
function emptyStats(): OrderStats {
  return { orders: 0, revenue: 0, shipCost: 0, rtoCost: 0, deliveredOrders: 0, returnedOrders: 0, codOrders: 0, containedValue: 0 };
}
export interface OrderStatsResult {
  byProduct: Map<string, OrderStats>;
  totals: {
    orders: number; delivered: number; inTransit: number; returned: number; returnInTransit: number;
    revenue: number; shipCost: number; rtoCost: number;
    deliveredValue: number; // Σ full order value across delivered orders → store AOV = deliveredValue / delivered
  };
}

/** COD if any payment gateway name looks like cash-on-delivery; else treated as prepaid. */
function isCodOrder(order: any): boolean {
  const gateways: string[] = order?.paymentGatewayNames || [];
  return gateways.some((g) => /cash on delivery|\bcod\b/i.test(String(g || "")));
}

// An RTO (return-to-origin) often leaves the order's carrier "Delivery status" reading Delivered or
// In transit, so the merchant's courier app writes it into the order NOTE (e.g. "This shipment has
// been Returned"). We match ONLY that clear event phrasing — "has/was/is/been returned",
// "return(ed) to origin/sender/shipper". Deliberately NOT bare "returned"/"return"/"rto".
//
// We do NOT use order TAGS for return detection: tags like "LOW/MEDIUM/HIGH RTO Risk" are RTO-RISK
// PREDICTIONS (usually on every COD order), not RTO events — matching them flagged every COD order
// as returned. Return detection = Shopify return status + failed delivery + the RTO note only.
const NOTE_RTO = /\b(?:has been|have been|had been|was|were|is|been)\s+returned\b|return(?:ed)?\s+to\s+(?:origin|sender|shipper)/i;

// Shopify FulfillmentDisplayStatus buckets (this is the "Delivery status" column merchants see).
const DELIVERED_STATUSES = new Set(["DELIVERED"]);
const FAILED_STATUSES = new Set(["FAILURE", "NOT_DELIVERED"]);
// Shipped / on its way / prepared — tracked but not delivered yet.
const IN_TRANSIT_STATUSES = new Set([
  "IN_TRANSIT", "OUT_FOR_DELIVERY", "ATTEMPTED_DELIVERY", "CONFIRMED",
  "SUBMITTED", "PICKED_UP", "READY_FOR_PICKUP", "LABEL_PRINTED", "LABEL_PURCHASED",
]);

export type OrderClassification = "delivered" | "returned" | "return_in_transit" | "in_transit" | "not_fulfilled";
export interface OrderClass {
  cod: boolean;
  isDelivered: boolean;
  inTransit: boolean;
  returnComplete: boolean;
  returnInTransit: boolean;
  returnInvolved: boolean;
  classification: OrderClassification;
  reasons: string[]; // which signals fired — for the export "why" column & debugging
}

/**
 * Single source of truth for classifying one order — used by BOTH the KPI aggregation and the CSV
 * export so they always agree. Precedence: returned → return-in-transit → delivered → in-transit →
 * not-fulfilled. "Delivered" means the carrier actually delivered it (fulfillment displayStatus
 * DELIVERED), or — for stores that mark fulfilled without live tracking — the order is simply
 * FULFILLED with no in-transit/delivered tracking. Revenue is counted on DELIVERED orders only.
 */
export function classifyOrder(order: any): OrderClass {
  const rs = order.returnStatus;
  const statuses: string[] = (order.fulfillments || []).map((f: any) => f?.displayStatus).filter(Boolean);
  const failed = statuses.some((s) => FAILED_STATUSES.has(s));
  const noteHit = NOTE_RTO.test(String(order?.note || ""));
  const cod = isCodOrder(order);

  const returnComplete = rs === "RETURNED" || rs === "INSPECTION_COMPLETE" || failed || noteHit;
  const returnInTransit = !returnComplete && rs === "IN_PROGRESS";
  const returnInvolved = returnComplete || returnInTransit;

  const hasDelivered = statuses.some((s) => DELIVERED_STATUSES.has(s));
  const hasInTransit = statuses.some((s) => IN_TRANSIT_STATUSES.has(s));
  // No granular tracking (e.g. merchant "marked as fulfilled") → treat FULFILLED as delivered.
  const fulfilledNoTracking = !hasDelivered && !hasInTransit && order.displayFulfillmentStatus === "FULFILLED";

  let classification: OrderClassification;
  if (returnComplete) classification = "returned";
  else if (returnInTransit) classification = "return_in_transit";
  else if (hasDelivered || fulfilledNoTracking) classification = "delivered";
  else if (hasInTransit) classification = "in_transit";
  else classification = "not_fulfilled";

  const isDelivered = classification === "delivered";
  const inTransit = classification === "in_transit";

  const reasons: string[] = [];
  if (rs && rs !== "NO_RETURN") reasons.push(`returnStatus=${rs}`);
  if (failed) reasons.push(`delivery=${statuses.filter((s) => FAILED_STATUSES.has(s)).join("/")}`);
  if (noteHit) reasons.push("note says returned");
  reasons.push(`deliveryStatus=${statuses.join("/") || order.displayFulfillmentStatus || "unfulfilled"}`);

  return { cod, isDelivered, inTransit, returnComplete, returnInTransit, returnInvolved, classification, reasons };
}

/**
 * Per-product revenue + allocated shipping/RTO cost for a date range, plus store-wide
 * delivered/returned totals. Everything is computed ONCE PER ORDER (a parcel), never per
 * product-line, so a multi-product order isn't double-charged shipping. Each order's shipping /
 * RTO cost is split EQUALLY across the distinct products it contains, so `Σ per-product shipCost
 * == totals.shipCost` and per-row profit reconciles with the store profit.
 *
 * RETURN / RTO detection: Shopify keeps the order's fulfillment status at "fulfilled/delivered"
 * even after an RTO, so we DON'T rely on it for returns. An order is "return-involved" when ANY
 * of: `returnStatus` shows a return (in-transit-back / inspection / completed); a fulfillment came
 * back undeliverable (`FAILURE`/`NOT_DELIVERED`); or the courier wrote an RTO note/tag. Delivered =
 * fulfilled AND not return-involved. Revenue = post-discount line total from delivered orders only.
 *
 * KNOWN ESTIMATE LIMITS (need line-item-level refund/return data — not queried here): a PARTIAL
 * return (some items kept) counts the whole order as returned (kept revenue not counted); a line
 * item whose product was deleted/custom (no product id) contributes no revenue.
 */
export async function getOrderStatsByProduct(admin: any, range: Range, costs: OrderCosts): Promise<OrderStatsResult> {
  const byProduct = new Map<string, OrderStats>();
  const t = { orders: 0, delivered: 0, inTransit: 0, returned: 0, returnInTransit: 0, revenue: 0, shipCost: 0, rtoCost: 0, deliveredValue: 0 };
  const q = `created_at:>=${ymd(range.since)} created_at:<=${ymd(range.until)}`;
  let cursor: string | null = null;
  const MAX_PAGES = 20; // cap ~2000 orders to stay within request time
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await gqlThrottleSafe(admin,
        `#graphql
        query orderStatsForPriceRadar($cursor: String, $q: String!) {
          orders(first: 100, after: $cursor, query: $q, sortKey: CREATED_AT) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              displayFulfillmentStatus
              returnStatus
              paymentGatewayNames
              note
              tags
              fulfillments(first: 10) { displayStatus }
              lineItems(first: 50) {
                nodes { product { id } discountedTotalSet { shopMoney { amount } } }
              }
            }
          }
        }`,
        { cursor, q },
      );
      if (data?.errors?.length) { console.error("[analytics] order stats graphql errors:", JSON.stringify(data.errors)); break; }
      const orders = data?.data?.orders;
      if (!orders) break;
      for (const order of orders.nodes) {
        const { cod, isDelivered, inTransit, returnComplete, returnInTransit, returnInvolved } = classifyOrder(order);

        t.orders += 1;
        if (isDelivered) t.delivered += 1;
        if (inTransit) t.inTransit += 1;
        if (returnComplete) t.returned += 1;
        if (returnInTransit) t.returnInTransit += 1;

        // Per-ORDER cost (a parcel) — charged once, then split across its distinct products.
        const orderShipCost = isDelivered ? (cod ? costs.shipCostCod : costs.shipCostPrepaid) : 0;
        const orderRtoCost = returnInvolved ? (cod ? costs.rtoCostCod : costs.rtoCostPrepaid) : 0;

        // Distinct products in this order + per-product delivered revenue. Also the order's FULL
        // line total (all lines, product or not) — the basket-value signal for loss-leader detection.
        const distinct: string[] = [];
        const revByProduct = new Map<string, number>();
        const seen = new Set<string>();
        let orderTotal = 0;
        for (const li of order.lineItems?.nodes || []) {
          const lineAmt = parseFloat(li.discountedTotalSet?.shopMoney?.amount || "0") || 0;
          orderTotal += lineAmt;
          const pid = li.product?.id ? numericId(li.product.id) : "";
          if (!pid) continue;
          if (!seen.has(pid)) { seen.add(pid); distinct.push(pid); }
          if (isDelivered) revByProduct.set(pid, (revByProduct.get(pid) || 0) + lineAmt);
        }
        const n = distinct.length;
        const shipShare = n > 0 ? orderShipCost / n : 0;
        const rtoShare = n > 0 ? orderRtoCost / n : 0;
        if (isDelivered) t.deliveredValue += orderTotal;

        for (const pid of distinct) {
          const stats = byProduct.get(pid) || emptyStats();
          stats.orders += 1;
          stats.revenue += revByProduct.get(pid) || 0;
          stats.shipCost += shipShare;
          stats.rtoCost += rtoShare;
          if (isDelivered) { stats.deliveredOrders += 1; stats.containedValue += orderTotal; }
          if (returnComplete) stats.returnedOrders += 1;
          if (cod) stats.codOrders += 1;
          byProduct.set(pid, stats);
        }
        // Store totals accrue only what was actually attributed to a product, so per-row sums
        // reconcile exactly (orders with no identifiable product contribute nothing either way).
        t.revenue += Array.from(revByProduct.values()).reduce((a, b) => a + b, 0);
        t.shipCost += shipShare * n;
        t.rtoCost += rtoShare * n;
      }
      if (!orders.pageInfo?.hasNextPage) break;
      cursor = orders.pageInfo.endCursor;
    }
  } catch (err) {
    console.error("[analytics] order stats failed:", err);
  }
  return { byProduct, totals: t };
}

export interface OrderExportRow {
  name: string;
  createdAt: string;
  payment: string;              // "COD" | "Prepaid"
  gateways: string;
  fulfillmentStatus: string;    // Shopify displayFulfillmentStatus
  returnStatus: string;         // Shopify returnStatus
  trackingStatus: string;       // joined fulfillment displayStatuses
  note: string;
  tags: string;
  classification: OrderClassification;
  countedAs: string;            // "Delivered" | "Returned" | "Return in transit" | "Not delivered"
  reason: string;               // which signals fired
  orderTotal: number;           // post-discount line total (shop currency)
  countedRevenue: number;       // revenue counted into P&L (only if delivered)
  products: string;
}

const CLASS_LABEL: Record<OrderClassification, string> = {
  delivered: "Delivered", returned: "Returned", return_in_transit: "Return in transit",
  in_transit: "In transit", not_fulfilled: "Not fulfilled",
};

/**
 * Every order in the range with its delivered/returned classification and the SIGNALS that
 * decided it — the merchant-facing export for verifying the delivered/returned KPI counts.
 * Uses the same `classifyOrder`, so the export's Delivered/Returned tallies match the cards.
 */
export async function fetchOrderClassifications(admin: any, range: Range): Promise<OrderExportRow[]> {
  const out: OrderExportRow[] = [];
  const q = `created_at:>=${ymd(range.since)} created_at:<=${ymd(range.until)}`;
  let cursor: string | null = null;
  const MAX_PAGES = 20;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const resp: any = await admin.graphql(
        `#graphql
        query orderExportForPriceRadar($cursor: String, $q: String!) {
          orders(first: 100, after: $cursor, query: $q, sortKey: CREATED_AT, reverse: true) {
            pageInfo { hasNextPage endCursor }
            nodes {
              name createdAt
              displayFulfillmentStatus returnStatus paymentGatewayNames note tags
              fulfillments(first: 10) { displayStatus }
              lineItems(first: 50) { nodes { title quantity product { id } discountedTotalSet { shopMoney { amount } } } }
            }
          }
        }`,
        { variables: { cursor, q } },
      );
      const data = await resp.json();
      // Log GraphQL errors but keep going if partial `orders` data still came back.
      if (data?.errors?.length) console.error("[analytics] order export graphql errors:", JSON.stringify(data.errors));
      const orders = data?.data?.orders;
      if (!orders) break;
      for (const order of orders.nodes) {
        const c = classifyOrder(order);
        const lines = order.lineItems?.nodes || [];
        const orderTotal = lines.reduce((s: number, li: any) => s + (parseFloat(li.discountedTotalSet?.shopMoney?.amount || "0") || 0), 0);
        const products = lines.map((li: any) => `${li.title}${li.quantity > 1 ? ` ×${li.quantity}` : ""}`).join(" | ");
        out.push({
          name: order.name || "",
          createdAt: order.createdAt ? new Date(order.createdAt).toISOString().slice(0, 10) : "",
          payment: c.cod ? "COD" : "Prepaid",
          gateways: (order.paymentGatewayNames || []).join(", "),
          fulfillmentStatus: order.displayFulfillmentStatus || "",
          returnStatus: order.returnStatus || "",
          trackingStatus: (order.fulfillments || []).map((f: any) => f?.displayStatus).filter(Boolean).join(", "),
          note: order.note || "",
          tags: (order.tags || []).join(", "),
          classification: c.classification,
          countedAs: CLASS_LABEL[c.classification],
          reason: c.reasons.join("; "),
          orderTotal,
          countedRevenue: c.isDelivered ? orderTotal : 0,
          products,
        });
      }
      if (!orders.pageInfo?.hasNextPage) break;
      cursor = orders.pageInfo.endCursor;
    }
  } catch (err) {
    console.error("[analytics] order export failed:", err);
  }
  return out;
}

/** Resolve the Price Radar date range from URL params — shared by the page loader and the CSV
 * export so both cover the exact same window. "all" spans imported history (needs earliest). */
export function resolveRange(url: URL, importEarliest: Date | null): Range {
  const sinceParam = url.searchParams.get("since");
  const untilParam = url.searchParams.get("until");
  const daysParam = url.searchParams.get("days") || "30";
  if (daysParam === "all") {
    return { since: importEarliest || new Date(Date.now() - 3 * 365 * 86400000), until: new Date() };
  }
  if (sinceParam || untilParam) {
    return {
      since: sinceParam ? new Date(sinceParam + "T00:00:00Z") : new Date(Date.now() - 30 * 86400000),
      until: untilParam ? new Date(untilParam + "T23:59:59Z") : new Date(),
    };
  }
  const days = parseInt(daysParam, 10) || 30;
  return { since: new Date(Date.now() - days * 86400000), until: new Date() };
}

export function startOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
export function startOfNextMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

/**
 * Live sessions per product from our own storefront visit pixel (ProductVisitDaily, keyed by
 * numeric product id) for the given date range. This is plan-agnostic and needs no special
 * Shopify access. `notBefore` clamps the start so pixel days already covered by an imported
 * month aren't double-counted (imported owns the historical window, the pixel owns after it).
 */
export async function getSessionsByProduct(shop: string, range: Range, notBefore?: Date | null): Promise<{ byId: Map<string, number> }> {
  const byId = new Map<string, number>();
  const since = notBefore && notBefore > range.since ? notBefore : range.since;
  if (since > range.until) return { byId };
  try {
    const rows: any[] = await prisma.productVisitDaily.groupBy({
      by: ["productId"],
      where: { shop, date: { gte: since, lte: range.until } },
      _sum: { visits: true },
    });
    for (const r of rows) byId.set(String(r.productId), r._sum?.visits || 0);
  } catch (err) {
    console.error("[analytics] pixel sessions failed:", err);
  }
  return { byId };
}

/**
 * Historical sessions the merchant imported from a Shopify Analytics CSV (stored per month),
 * summed per product for the given date range. A month bucket counts when its first-of-month
 * falls within [startOfMonth(since), until].
 */
export async function getImportedSessions(shop: string, range: Range): Promise<Map<string, number>> {
  const byId = new Map<string, number>();
  try {
    const rows: any[] = await prisma.productSessionImport.groupBy({
      by: ["productId"],
      where: { shop, month: { gte: startOfMonthUTC(range.since), lte: range.until } },
      _sum: { sessions: true },
    });
    for (const r of rows) byId.set(String(r.productId), r._sum?.sessions || 0);
  } catch (err) {
    console.error("[analytics] imported sessions failed:", err);
  }
  return byId;
}

/** Distinct products imported + the covered month span, for the UI and the "All time" range. */
export async function getImportMeta(shop: string): Promise<{ count: number; earliest: Date | null; latest: Date | null }> {
  try {
    const groups: any[] = await prisma.productSessionImport.groupBy({ by: ["productId"], where: { shop } });
    if (groups.length === 0) return { count: 0, earliest: null, latest: null };
    const agg: any = await prisma.productSessionImport.aggregate({ where: { shop }, _min: { month: true }, _max: { month: true } });
    return { count: groups.length, earliest: agg?._min?.month || null, latest: agg?._max?.month || null };
  } catch (err) {
    console.error("[analytics] import meta failed:", err);
    return { count: 0, earliest: null, latest: null };
  }
}

export function conversionPct(orders: number, sessions: number): number | null {
  if (!sessions || sessions <= 0) return null;
  return Math.round((orders / sessions) * 1000) / 10; // one decimal
}

export interface PricingProduct {
  productId: string;   // gid
  numericId: string;   // numeric tail (join key for analytics)
  variantId: string;   // gid of the primary variant (the one we reprice)
  title: string;
  handle: string;      // storefront handle (join key for landing-page CSV imports)
  vendor: string;
  productType: string;
  imageUrl: string | null;
  currentPrice: number;
  currency: string;
  sku: string | null;
  barcode: string | null;
  totalInventory: number | null; // Product.totalInventory — OOS heuristic for campaign exclusions
}

/**
 * The shop's selling currency, reliably. A single throttled GraphQL call used to silently fall
 * back to "USD" — an INR store then showed "$" across the Ads page and even PERSISTED USD into a
 * saved campaign plan. Now: throttle-safe query → write-through cache (PriceRadarSettings) →
 * last-known cached value → null (callers decide the honest default; never a silent USD guess).
 */
export async function getShopCurrency(admin: any, shop: string): Promise<string | null> {
  try {
    const data = await gqlThrottleSafe(admin, `#graphql query { shop { currencyCode } }`, {});
    const code = data?.data?.shop?.currencyCode;
    if (code) {
      prisma.priceRadarSettings.upsert({
        where: { shop }, update: { storeCurrency: code } as any, create: { shop, storeCurrency: code } as any,
      }).catch(() => {});
      return code;
    }
  } catch (err) {
    console.warn("[analytics] shop currency fetch failed (falling back to cache):", String((err as any)?.message || err).slice(0, 160));
  }
  try {
    const row: any = await prisma.priceRadarSettings.findUnique({ where: { shop } });
    if (row?.storeCurrency) return row.storeCurrency;
  } catch { /* cache miss */ }
  return null;
}

export interface InventorySignal { tracked: boolean; policy: string } // policy: DENY | CONTINUE

/**
 * BEST-EFFORT per-product unit cost (COGS) + inventory-tracking signals from Shopify
 * (`inventoryItem.unitCost/tracked`, `variant.inventoryPolicy`). The inventoryItem fields need the
 * `read_inventory` scope — a shop without it gets empty maps and callers fall back to the
 * merchant's assumed-COGS% setting (and skip inventory-based exclusions). Kept as its OWN
 * throttle-safe query so a scope denial can never take down the main product fetch.
 */
export async function fetchUnitCosts(admin: any): Promise<{ costs: Map<string, number>; inventory: Map<string, InventorySignal> }> {
  const costs = new Map<string, number>();
  const inventory = new Map<string, InventorySignal>();
  let cursor: string | null = null;
  const MAX_PAGES = 40;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await gqlThrottleSafe(admin,
        `#graphql
        query unitCostsForPriceRadar($cursor: String) {
          products(first: 100, after: $cursor, query: "status:active") {
            pageInfo { hasNextPage endCursor }
            nodes { id variants(first: 1) { nodes { inventoryPolicy inventoryItem { tracked unitCost { amount } } } } }
          }
        }`,
        { cursor },
      );
      if (data?.errors?.length) { console.warn("[analytics] unit costs unavailable (needs read_inventory?):", JSON.stringify(data.errors).slice(0, 200)); break; }
      const products = data?.data?.products;
      if (!products) break;
      for (const p of products.nodes) {
        const v = p?.variants?.nodes?.[0];
        const pid = numericId(p.id);
        const amt = parseFloat(v?.inventoryItem?.unitCost?.amount || "");
        if (Number.isFinite(amt) && amt > 0) costs.set(pid, amt);
        if (v) inventory.set(pid, { tracked: v?.inventoryItem?.tracked === true, policy: String(v?.inventoryPolicy || "") });
      }
      if (!products.pageInfo?.hasNextPage) break;
      cursor = products.pageInfo.endCursor;
    }
  } catch (err) {
    console.warn("[analytics] unit cost fetch failed (non-fatal):", String((err as any)?.message || err).slice(0, 200));
  }
  return { costs, inventory };
}

/** Active products with their primary variant + price, for the Price Radar grid. */
export async function fetchPricingProducts(admin: any, currency: string): Promise<PricingProduct[]> {
  const out: PricingProduct[] = [];
  let cursor: string | null = null;
  const MAX_PAGES = 40; // ~4000 products cap
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await gqlThrottleSafe(admin,
      `#graphql
      query pricingProducts($cursor: String) {
        products(first: 100, after: $cursor, query: "status:active") {
          pageInfo { hasNextPage endCursor }
          nodes {
            id title handle vendor productType totalInventory
            featuredImage { url }
            variants(first: 1) { nodes { id price sku barcode } }
          }
        }
      }`,
      { cursor },
    );
    const products = data?.data?.products;
    if (!products) break;
    for (const p of products.nodes) {
      const v = p.variants?.nodes?.[0];
      if (!v) continue;
      out.push({
        productId: p.id,
        numericId: numericId(p.id),
        variantId: v.id,
        title: p.title,
        handle: p.handle || "",
        vendor: p.vendor || "",
        productType: p.productType || "",
        imageUrl: p.featuredImage?.url || null,
        currentPrice: parseFloat(v.price) || 0,
        currency,
        sku: v.sku || null,
        barcode: v.barcode || null,
        totalInventory: typeof p.totalInventory === "number" ? p.totalInventory : null,
      });
    }
    if (!products.pageInfo?.hasNextPage) break;
    cursor = products.pageInfo.endCursor;
  }
  return out;
}
