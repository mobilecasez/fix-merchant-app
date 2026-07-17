import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getOrCreateSubscription, getRemainingCredits, chargeCredits, refundCredits } from "../utils/billing.server";
import { researchCompetitivePrice, bulkCreditCost, SINGLE_CREDIT } from "../utils/price-research.server";
import {
  fetchPricingProducts, fetchUnitCosts, getSessionsByProduct, getImportedSessions, getImportMeta,
  getOrderStatsByProduct, getShopCurrency, startOfNextMonthUTC, conversionPct, resolveRange, numericId,
} from "../utils/product-analytics.server";
import { getCpcSnapshot, loadAdsCreds, credsComplete, refreshAdsSnapshot } from "../utils/google-ads.server";
import { runProfitAdvisor, ADVISOR_CREDITS, type AdvisorListedProduct } from "../utils/profit-advisor.server";
import { classifyProducts, computeRankInversionHook, selectForListing, type BucketInputRow } from "../utils/profit-buckets.server";
import { setAiJob, getAiJob, jobView, withTimeout } from "../utils/ai-jobs.server";
import { startPriceBatch } from "../utils/price-batch.server";
import { matchBuckets } from "../utils/session-import.server";
import { refreshBestSellerCollection } from "../utils/bestseller-collection.server";
import { logActivity } from "../utils/activity.server";

function serializeResearch(r: any) {
  return {
    variantId: r.variantId, productId: r.productId, currentPrice: r.currentPrice, originalPrice: r.originalPrice ?? null, currency: r.currency,
    researchedPrice: r.researchedPrice, priceLow: r.priceLow, priceHigh: r.priceHigh,
    rationale: r.rationale, sources: r.sources || [], confidence: r.confidence, status: r.status,
    appliedAt: r.appliedAt ? r.appliedAt.toISOString() : null,
    researchedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
    priceHistory: (r.priceHistory as any) || [],
  };
}

// The product's price the FIRST time we ever touched it — set once, never overwritten, so the
// merchant always sees where a price started even after applying a new one.
async function originalPriceOnce(shop: string, variantId: string, fallback: number): Promise<number | null> {
  const existing = await prisma.productPriceResearch.findUnique({
    where: { shop_variantId: { shop, variantId } }, select: { originalPrice: true },
  }).catch(() => null);
  return existing?.originalPrice ?? (fallback > 0 ? fallback : null);
}

async function applyVariantPrice(admin: any, productId: string, variantId: string, price: number): Promise<boolean> {
  try {
    const resp: any = await admin.graphql(
      `#graphql
      mutation priceRadarApply($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id price }
          userErrors { field message }
        }
      }`,
      { variables: { productId, variants: [{ id: variantId, price: String(price) }] } },
    );
    const d = await resp.json();
    const errs = d?.data?.productVariantsBulkUpdate?.userErrors;
    if (errs && errs.length) { console.error("[price-radar] apply userErrors:", errs); return false; }
    return !!d?.data?.productVariantsBulkUpdate?.productVariants?.length;
  } catch (e) {
    console.error("[price-radar] apply failed:", e);
    return false;
  }
}

// Set a product's status (e.g. DRAFT to pull it from the storefront + ad channels, or ACTIVE).
async function setProductStatus(admin: any, productId: string, status: "ACTIVE" | "DRAFT" | "ARCHIVED"): Promise<boolean> {
  try {
    const resp: any = await admin.graphql(
      `#graphql
      mutation priceRadarStatus($input: ProductInput!) {
        productUpdate(input: $input) { product { id status } userErrors { field message } }
      }`,
      { variables: { input: { id: productId, status } } },
    );
    const d = await resp.json();
    const errs = d?.data?.productUpdate?.userErrors;
    if (errs && errs.length) { console.error("[price-radar] status userErrors:", errs); return false; }
    return d?.data?.productUpdate?.product?.status === status;
  } catch (e) {
    console.error("[price-radar] status update failed:", e);
    return false;
  }
}

// Lightweight status endpoint — the page POLLS this while background AI jobs run (a full page
// revalidate re-fetches the whole catalogue from Shopify and collides with the job's own API
// usage → Throttled). This costs zero Shopify API calls.
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const job = await prisma.priceBatchJob.findFirst({ where: { shop: session.shop }, orderBy: { createdAt: "desc" } });
  const advisorJob = jobView(await getAiJob(session.shop, "profit_advisor_job"));
  return json({
    job: job ? { id: job.id, status: job.status, processedCount: job.processedCount, productCount: job.productCount } : null,
    advisorJob,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // ── Import historical sessions (JSON body: the CSV is parsed + aggregated in the browser) ──
  // Payload: { intent, kind, hasMonth, buckets: { identifier: { "YYYY-MM-01": sessions } } }.
  if ((request.headers.get("content-type") || "").includes("application/json")) {
    const body: any = await request.json().catch(() => null);
    if (!body || body.intent !== "import_sessions") return json({ ok: false, error: "Bad request." }, { status: 400 });
    const buckets = (body.buckets || {}) as Record<string, Record<string, number>>;
    const kind = String(body.kind || "url");
    const identifiers = Object.keys(buckets);
    if (identifiers.length === 0) {
      return json({ ok: false, error: "Nothing to import — the file had no product rows with a sessions count." }, { status: 400 });
    }
    const products = await fetchPricingProducts(admin, "USD");
    const result = matchBuckets(buckets, kind, products.map((p) => ({ numericId: p.numericId, title: p.title, handle: p.handle })));
    if (result.matchedProductCount === 0) {
      return json({ ok: false, error: `None of the ${identifiers.length} products in the file matched your store. Make sure the export uses product titles, handles, or /products/ URLs.` }, { status: 400 });
    }
    // Replace the whole shop's import so re-uploading is a clean overwrite.
    await prisma.productSessionImport.deleteMany({ where: { shop } });
    const dataRows = result.matched.map((m) => ({
      shop, productId: m.productId, productTitle: m.title.slice(0, 250), month: m.month, sessions: m.sessions,
    }));
    const CHUNK = 4000; // stay under Postgres parameter limits (5 columns per row)
    for (let i = 0; i < dataRows.length; i += CHUNK) {
      await prisma.productSessionImport.createMany({ data: dataRows.slice(i, i + CHUNK) });
    }
    return json({ ok: true, matched: result.matchedProductCount, unmatched: result.unmatchedIdentifiers, total: identifiers.length, months: result.months, hasMonth: body.hasMonth !== false });
  }

  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  // ── Single-product competitive price research (1 credit) ──
  if (intent === "research") {
    const variantId = String(form.get("variantId") || "");
    const productId = String(form.get("productId") || "");
    const title = String(form.get("title") || "");
    if (!variantId || !productId || !title) return json({ ok: false, error: "Missing product." }, { status: 400 });
    const currency = String(form.get("currency") || "USD");
    const currentPrice = parseFloat(String(form.get("currentPrice") || "0")) || 0;
    const charged = await chargeCredits(shop, SINGLE_CREDIT);
    if (!charged) return json({ ok: false, error: "Not enough credits. Upgrade your plan to research more prices." }, { status: 402 });
    const r = await researchCompetitivePrice({
      title, vendor: String(form.get("vendor") || ""), productType: String(form.get("productType") || ""),
      currentPrice, currency, barcode: String(form.get("barcode") || "") || null,
    });
    if (r.researchedPrice == null) await refundCredits(shop, SINGLE_CREDIT); // nothing found → refund
    const originalPrice = await originalPriceOnce(shop, variantId, currentPrice);
    const fields = {
      productTitle: title, imageUrl: String(form.get("imageUrl") || "") || null, currentPrice, originalPrice, currency: r.currency,
      researchedPrice: r.researchedPrice, priceLow: r.low, priceHigh: r.high, rationale: r.rationale,
      sources: r.sources, confidence: r.confidence, status: r.researchedPrice != null ? "researched" : "failed",
      batchJobId: null as string | null,
    };
    const row = await prisma.productPriceResearch.upsert({
      where: { shop_variantId: { shop, variantId } },
      create: { shop, productId, variantId, ...fields },
      update: { ...fields, appliedAt: null },
    });
    return json({ ok: true, research: serializeResearch(row), creditsUsed: r.researchedPrice != null ? SINGLE_CREDIT : 0 });
  }

  // ── Save an edited/manual price (no charge). Upserts so a manually-typed price persists
  //    even when the product was never researched. ──
  if (intent === "save") {
    const variantId = String(form.get("variantId") || "");
    const productId = String(form.get("productId") || "");
    const price = parseFloat(String(form.get("price") || "0"));
    if (!variantId || !productId || !(price > 0)) return json({ ok: false, error: "Enter a valid price." }, { status: 400 });
    const title = String(form.get("title") || "") || "(manual)";
    const currency = String(form.get("currency") || "USD");
    const currentPrice = parseFloat(String(form.get("currentPrice") || "0")) || price;
    const originalPrice = await originalPriceOnce(shop, variantId, currentPrice);
    await prisma.productPriceResearch.upsert({
      where: { shop_variantId: { shop, variantId } },
      update: { researchedPrice: price, status: "edited", originalPrice },
      create: { shop, productId, variantId, productTitle: title, currentPrice, originalPrice, currency, researchedPrice: price, status: "edited" },
    });
    return json({ ok: true });
  }

  // ── Discard a researched price (Cancel → clears it so the row can be re-searched) ──
  if (intent === "discard") {
    const variantId = String(form.get("variantId") || "");
    if (!variantId) return json({ ok: false, error: "Missing product." }, { status: 400 });
    await prisma.productPriceResearch.deleteMany({ where: { shop, variantId } });
    return json({ ok: true, cleared: true });
  }

  // ── Save the merchant's average shipping / RTO costs (feed Total cost + Profit/Loss) ──
  if (intent === "save_costs") {
    // Strip thousands separators / stray chars first (e.g. "1,00,000" or "₹1,000") so parseFloat
    // doesn't silently truncate "1,000" to 1. Keep only digits and a single decimal point.
    const num = (k: string) => {
      // Keep digits, a decimal point, and a leading minus (so a negative slips through to the
      // `>= 0` guard below and becomes 0 rather than having its sign stripped into a positive).
      const cleaned = String(form.get(k) || "0").replace(/[^0-9.-]/g, "");
      const n = parseFloat(cleaned);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    };
    const values: any = {
      shipCostPrepaid: num("shipCostPrepaid"), shipCostCod: num("shipCostCod"),
      rtoCostPrepaid: num("rtoCostPrepaid"), rtoCostCod: num("rtoCostCod"),
    };
    // Contribution-margin assumptions (percent fields, clamped). A CLEARED input must not persist
    // as 0% — blank means "leave unchanged" (0% COGS would inflate every assumed margin).
    const pct = (k: string, max: number) => {
      const raw = String(form.get(k) ?? "").trim();
      if (raw === "") return undefined;
      return Math.min(max, Math.max(0, num(k)));
    };
    const cogsPct = pct("assumedCogsPct", 95);
    if (cogsPct !== undefined) values.assumedCogsPct = cogsPct;
    const feePct = pct("paymentFeePct", 15);
    if (feePct !== undefined) values.paymentFeePct = feePct;
    if (form.has("weeklyDigest")) values.weeklyDigest = String(form.get("weeklyDigest")) === "true";
    await prisma.priceRadarSettings.upsert({
      where: { shop }, update: values, create: { shop, ...values },
    });
    return json({ ok: true, savedCosts: true });
  }

  // ── Apply a price (researched or manually typed) to the live Shopify variant. Upserts so a
  //    manual apply persists an "applied" record (row then shows the Applied badge). ──
  if (intent === "apply") {
    const variantId = String(form.get("variantId") || "");
    const productId = String(form.get("productId") || "");
    const price = parseFloat(String(form.get("price") || "0"));
    if (!variantId || !productId || !(price > 0)) return json({ ok: false, error: "Invalid price." }, { status: 400 });
    // Capture the pre-change live price (before we push the new one) so originalPrice is the true first value.
    const preChangePrice = parseFloat(String(form.get("currentPrice") || "0")) || 0;
    const existing = await prisma.productPriceResearch.findUnique({
      where: { shop_variantId: { shop, variantId } }, select: { originalPrice: true, priceHistory: true, currentPrice: true },
    }).catch(() => null);
    const originalPrice = existing?.originalPrice ?? (preChangePrice > 0 ? preChangePrice : null);
    const ok = await applyVariantPrice(admin, productId, variantId, price);
    if (!ok) return json({ ok: false, error: "Could not update the price on Shopify." }, { status: 500 });
    const title = String(form.get("title") || "") || "(manual)";
    const currency = String(form.get("currency") || "USD");
    // Append a history entry (from → to). Skip a no-op (same price re-applied). Keep last 30.
    const prevHistory: any[] = Array.isArray(existing?.priceHistory) ? (existing!.priceHistory as any[]) : [];
    const fromPrice = existing?.currentPrice ?? (preChangePrice || null);
    const nextHistory = (fromPrice != null && Math.abs(fromPrice - price) < 0.005)
      ? prevHistory
      : [...prevHistory, { price, from: fromPrice, at: new Date().toISOString() }].slice(-30);
    const row = await prisma.productPriceResearch.upsert({
      where: { shop_variantId: { shop, variantId } },
      update: { status: "applied", appliedAt: new Date(), currentPrice: price, researchedPrice: price, originalPrice, priceHistory: nextHistory },
      create: { shop, productId, variantId, productTitle: title, currentPrice: price, originalPrice, currency, researchedPrice: price, status: "applied", appliedAt: new Date(), priceHistory: nextHistory },
    });
    return json({ ok: true, research: serializeResearch(row) });
  }

  // ── Apply every researched (not-yet-applied) price ──
  if (intent === "apply_all") {
    const rows = await prisma.productPriceResearch.findMany({
      where: { shop, status: { in: ["researched", "edited"] }, researchedPrice: { not: null } },
    });
    let applied = 0, failed = 0;
    for (const row of rows) {
      if (row.researchedPrice == null) continue;
      const ok = await applyVariantPrice(admin, row.productId, row.variantId, row.researchedPrice);
      if (ok) {
        await prisma.productPriceResearch.update({ where: { id: row.id }, data: { status: "applied", appliedAt: new Date(), currentPrice: row.researchedPrice } });
        applied++;
      } else failed++;
    }
    return json({ ok: true, applied, failed });
  }

  // ── Clear an imported-sessions backfill ──
  if (intent === "clear_import") {
    await prisma.productSessionImport.deleteMany({ where: { shop } });
    return json({ ok: true });
  }

  // ── Bulk set product status (e.g. Mark as Draft → hides from storefront + ad channels) ──
  if (intent === "bulk_status") {
    const productIds = String(form.get("productIds") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const status = String(form.get("status") || "DRAFT").toUpperCase();
    if (!productIds.length) return json({ ok: false, error: "No products selected." }, { status: 400 });
    if (!["ACTIVE", "DRAFT", "ARCHIVED"].includes(status)) return json({ ok: false, error: "Invalid status." }, { status: 400 });
    let updated = 0, failed = 0;
    for (const id of productIds.slice(0, 200)) {
      const ok = await setProductStatus(admin, id, status as any);
      if (ok) updated++; else failed++;
    }
    return json({ ok: true, updated, failed, status });
  }

  // ── AI Profit Advisor (pro model, ~1-3 min): the Gemini call runs as a DETACHED background
  //    job — the click returns immediately and the page polls until the saved report updates.
  //    A synchronous request this long gets killed by browser/proxy timeouts. ──
  if (intent === "profit_advisor") {
    const JOB = "profit_advisor_job";
    const existingJob = jobView(await getAiJob(shop, JOB));
    if (existingJob?.status === "running") return json({ ok: true, started: true, already: true });
    const charged = await chargeCredits(shop, ADVISOR_CREDITS);
    if (!charged) return json({ ok: false, error: `Not enough credits — the Profit Advisor costs ${ADVISOR_CREDITS} credits. Upgrade your plan to run it.` }, { status: 402 });
    const startedAt = new Date().toISOString();
    await setAiJob(shop, JOB, { status: "running", startedAt });
    void logActivity(shop, "profit_report", "Ran the AI Profit Advisor");
    // Capture everything from the request BEFORE detaching.
    const formCurrency = String(form.get("currency") || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    const daysForm = String(form.get("days") || "30");
    const sinceForm = String(form.get("since") || "");
    const untilForm = String(form.get("until") || "");

    void (async () => {
    try {
      // Shop currency: trust the page's verified value first (the grid already renders in it),
      // then the throttle-safe cached lookup — a transient GraphQL failure can't flip us to USD.
      const currency = formCurrency || (await getShopCurrency(admin, shop)) || "USD";
      console.log("[profit_advisor] shop=%s currency=%s (background job)", shop, currency);

      const url = new URL("https://x/");
      // Range comes from the form (same window the merchant is viewing).
      url.searchParams.set("days", daysForm);
      if (sinceForm) url.searchParams.set("since", sinceForm);
      if (untilForm) url.searchParams.set("until", untilForm);
      const importMeta = await getImportMeta(shop);
      const range = resolveRange(url, importMeta.earliest);
      const pixelNotBefore = importMeta.latest ? startOfNextMonthUTC(importMeta.latest) : null;

      const costRow = await prisma.priceRadarSettings.findUnique({ where: { shop } });
      const costs = {
        shipCostPrepaid: costRow?.shipCostPrepaid || 0, shipCostCod: costRow?.shipCostCod || 0,
        rtoCostPrepaid: costRow?.rtoCostPrepaid || 0, rtoCostCod: costRow?.rtoCostCod || 0,
      };
      const hasCostInputs = costs.shipCostPrepaid > 0 || costs.shipCostCod > 0 || costs.rtoCostPrepaid > 0 || costs.rtoCostCod > 0;
      const costAssumptions = {
        assumedCogsPct: (costRow as any)?.assumedCogsPct ?? 50,
        paymentFeePct: (costRow as any)?.paymentFeePct ?? 2,
      };

      const scopes = String((session as any).scope || "");
      const hasOrders = /read_orders/.test(scopes);
      const [products, pixelData, importedData, unitCostData] = await Promise.all([
        fetchPricingProducts(admin, currency),
        getSessionsByProduct(shop, range, pixelNotBefore),
        getImportedSessions(shop, range),
        fetchUnitCosts(admin), // best-effort: empty without read_inventory → assumed-COGS% fallback
      ]);
      const unitCosts = unitCostData.costs;
      const orderStats = hasOrders ? await getOrderStatsByProduct(admin, range, costs) : { byProduct: new Map(), totals: { orders: 0, delivered: 0, inTransit: 0, returned: 0, returnInTransit: 0, revenue: 0, shipCost: 0, rtoCost: 0, deliveredValue: 0 } };
      const cpc = await getCpcSnapshot(shop);

      // ACTUAL ad spend: refresh the Google Ads snapshot live so the report uses real attributed
      // spend + clicks (not the sessions×CPC estimate, which overcharges organic-heavy products).
      // Falls back to the cached snapshot, then to the estimate. Gated on `enabled || never-synced`
      // so an explicitly DISCONNECTED integration is never silently re-enabled by this job.
      let cpcMap = cpc.byProduct;
      let perf = cpc.perfByProduct;
      let adsEnabled = cpc.enabled;
      const perfWindow = cpc.windowDays || 30; // refresh syncs over this same window
      if (cpc.configured && (cpc.enabled || !cpc.lastSyncAt)) {
        try {
          const { creds } = await loadAdsCreds(shop);
          if (credsComplete(creds)) {
            const variantToProduct = new Map<string, string>();
            const productIdSet = new Set<string>();
            for (const p of products) { productIdSet.add(p.numericId); const vn = numericId(p.variantId); if (vn) variantToProduct.set(vn, p.numericId); }
            const fresh = await refreshAdsSnapshot(shop, creds, variantToProduct, productIdSet, perfWindow);
            cpcMap = fresh.byProduct; perf = fresh.perfByProduct; adsEnabled = true;
          }
        } catch (e: any) {
          console.warn("[profit_advisor] live ads refresh failed — using cached snapshot:", e?.message || e);
        }
      }
      const adSpendActual = adsEnabled && Object.keys(perf).length > 0;
      const rangeDays = Math.max(1, Math.round((range.until.getTime() - range.since.getTime()) / 86400000));
      // Real spend is measured over the sync window; scale it to the report window. Down-scaling
      // is proportional (honest); up-scaling is capped at 3× so an "all time" range can't
      // extrapolate a 30-day spend rate into fiction.
      const spendScale = Math.min(3, rangeDays / perfWindow);

      let totalAdSpend = 0;
      const rows: BucketInputRow[] = products.map((p) => {
        const sessions = (importedData.get(p.numericId) || 0) + (pixelData.byId.get(p.numericId) || 0);
        const stats: any = orderStats.byProduct.get(p.numericId);
        const orders = stats?.orders || 0;
        const productCpc = adsEnabled ? (cpcMap[p.numericId] ?? null) : null;
        const pf = adSpendActual ? perf[p.numericId] : undefined;
        let adSpend = 0; let adClicks: number | null = null; let adSpendSource: "ads" | "estimated" | "none" = "none";
        if (pf && pf.s > 0) {
          // adClicks stays UNSCALED (observed sample size — feeds confidence tiers); only money scales.
          adSpend = pf.s * spendScale; adClicks = pf.c; adSpendSource = "ads";
        } else if (!adSpendActual && productCpc != null && sessions > 0) {
          adSpend = sessions * productCpc; adSpendSource = "estimated";
        }
        totalAdSpend += adSpend;
        const shipCost = stats?.shipCost || 0;
        const rtoCost = stats?.rtoCost || 0;
        const revenue = stats?.revenue || 0;
        const profit = revenue - adSpend - shipCost - rtoCost;
        return {
          numericId: p.numericId, title: p.title, sessions, orders,
          conversion: conversionPct(orders, sessions), cpc: productCpc,
          adSpend: Math.round(adSpend), adSpendSource, adClicks,
          revenue: Math.round(revenue), shipCost: Math.round(shipCost), rtoCost: Math.round(rtoCost),
          profit: Math.round(profit), marginPct: revenue > 0 ? Math.round((profit / revenue) * 100) : null,
          price: p.currentPrice,
          deliveredOrders: stats?.deliveredOrders || 0, returnedOrders: stats?.returnedOrders || 0,
          codOrders: stats?.codOrders || 0, containedValue: stats?.containedValue || 0,
          unitCost: unitCosts.get(p.numericId) ?? null,
        };
      });

      // ── Deterministic screening: EVERY product gets a bucket in code (complete by construction);
      //    the model only prioritises/quantifies/words the actions. ──
      const totals = orderStats.totals as any;
      const totalSessions = rows.reduce((s, r) => s + r.sessions, 0);
      // MONEY totals come from the ACTIVE-product rows (orderStats.totals also counts draft/
      // archived products' orders, which have no row here — using them would break the
      // "waterfall == Σ per-row" reconciliation). Order COUNTS stay store-wide.
      const rowRevenue = rows.reduce((s, r) => s + r.revenue, 0);
      const rowShipCost = rows.reduce((s, r) => s + r.shipCost, 0);
      const rowRtoCost = rows.reduce((s, r) => s + r.rtoCost, 0);
      const { rows: classified, stats: storeStats, counts } = classifyProducts(rows, {
        orders: totals.orders || 0, delivered: totals.delivered || 0, returned: totals.returned || 0,
        revenue: rowRevenue, adSpend: totalAdSpend, deliveredValue: totals.deliveredValue || 0,
        sessions: totalSessions,
      }, costAssumptions);
      const hook = computeRankInversionHook(classified);

      // Fair per-bucket selection: every lever (bleeders, winners, gems, price moves…) keeps its
      // guaranteed share of the individual-listing cap; the rest surfaces as aggregates.
      const { listed: listedRows, overflow } = selectForListing(classified, 400, 30, 150);
      const listed: AdvisorListedProduct[] = listedRows.map((r, i) => ({ ...r, pid: `P${i + 1}` }));
      const zombieRows = classified.filter((r) => r.bucket === "ZOMBIE");

      if (listed.length === 0) {
        await refundCredits(shop, ADVISOR_CREDITS);
        await setAiJob(shop, JOB, { status: "error", error: "Not enough product activity to analyse yet — come back once you have some sessions and orders in this date range.", startedAt, finishedAt: new Date().toISOString() });
        return;
      }

      const rangeLabel = `${range.since.toISOString().slice(0, 10)} to ${range.until.toISOString().slice(0, 10)}`;
      const advisorTotals = {
        products: products.length, sessions: totalSessions,
        orders: totals.orders || 0, revenue: Math.round(rowRevenue), adSpend: Math.round(totalAdSpend),
        shipRtoCost: Math.round(rowShipCost + rowRtoCost),
        profit: Math.round(rowRevenue - totalAdSpend - rowShipCost - rowRtoCost),
        delivered: totals.delivered || 0, inTransit: totals.inTransit || 0, returned: totals.returned || 0,
      };
      const result = await withTimeout(runProfitAdvisor({
        currency, rangeLabel, today: new Date().toISOString().slice(0, 10),
        adsConfigured: cpc.configured, adSpendActual,
        adsCurrency: cpc.currency && cpc.currency !== currency ? cpc.currency : null,
        hasCostInputs,
        cogs: { realCount: unitCosts.size, assumedPct: costAssumptions.assumedCogsPct, feePct: costAssumptions.paymentFeePct },
        totals: advisorTotals, stats: storeStats, counts, hook,
        products: listed,
        overflow,
        zombies: { count: counts.ZOMBIE, sessions: zombieRows.reduce((s, r) => s + r.sessions, 0) },
        okCount: counts.OK,
      }), 12 * 60 * 1000, "Profit analysis"); // generation is parallel-chunked (~2-4 min typical); 12 min covers pro-model fallback chains

      if (!result.ok) {
        await refundCredits(shop, ADVISOR_CREDITS);
        await setAiJob(shop, JOB, { status: "error", error: result.error || "The analysis failed.", startedAt, finishedAt: new Date().toISOString() });
        return;
      }
      // Persist the report so the merchant can re-open it for free (credits only on regenerate).
      const generatedAt = new Date().toISOString();
      const meta = {
        currency, rangeLabel, analysed: listed.length, generatedAt, model: result.model || null,
        screened: { total: products.length, listed: listed.length, counts, adSpendSource: adSpendActual ? "google-ads" : (adsEnabled ? "estimated" : "none"), cogsRealCount: unitCosts.size, assumedCogsPct: costAssumptions.assumedCogsPct },
        coverage: result.coverage || null,
        waterfall: {
          revenue: advisorTotals.revenue, adSpend: advisorTotals.adSpend,
          shipCost: Math.round(rowShipCost), rtoCost: Math.round(rowRtoCost),
          profit: advisorTotals.profit,
        },
      };
      await prisma.aiReport.upsert({
        where: { shop_kind: { shop, kind: "profit_advisor" } },
        update: { data: result.report as any, meta },
        create: { shop, kind: "profit_advisor", data: result.report as any, meta },
      }).catch((e) => console.error("[profit_advisor] save failed:", e?.message));
      await setAiJob(shop, JOB, { status: "done", startedAt, finishedAt: new Date().toISOString(), model: result.model || null });
    } catch (e: any) {
      await refundCredits(shop, ADVISOR_CREDITS);
      console.error("[profit_advisor] job failed:", e?.message || e);
      const msg = String(e?.message || e);
      await setAiJob(shop, JOB, {
        status: "error", startedAt, finishedAt: new Date().toISOString(),
        error: /Google AI \(Gemini\) credits|Google has DENIED|timed out/i.test(msg) ? msg : "Couldn't generate the analysis. Please try again.",
      });
    }
    })();

    return json({ ok: true, started: true });
  }

  // ── Start a bulk async research job (tiered credits, email when ready) ──
  if (intent === "bulk") {
    const sub = await getOrCreateSubscription(shop);
    const currency = String(form.get("currency") || "USD");
    const products = await fetchPricingProducts(admin, currency);
    const count = products.length;
    if (count === 0) return json({ ok: false, error: "No active products to research." }, { status: 400 });
    const cost = bulkCreditCost(count);
    const charged = await chargeCredits(shop, cost);
    if (!charged) {
      return json({ ok: false, error: `This needs ${cost} credits for ${count} products, but you have ${getRemainingCredits(sub)}. Upgrade to run it.`, cost, count }, { status: 402 });
    }
    let email = "";
    try {
      const r: any = await admin.graphql(`#graphql
        query { shop { email } }`);
      const d = await r.json();
      email = d?.data?.shop?.email || "";
    } catch { /* ignore */ }
    const job = await prisma.priceBatchJob.create({
      data: { shop, status: "pending", productCount: count, creditsCharged: cost, model: process.env.GEMINI_PRICE_MODEL || process.env.GEMINI_TEXT_MODEL || "gemini-3.1-flash-lite", email },
    });
    startPriceBatch(job.id, shop, products.map((p) => ({
      productId: p.productId, variantId: p.variantId, title: p.title, vendor: p.vendor,
      productType: p.productType, currentPrice: p.currentPrice, currency: p.currency, barcode: p.barcode, imageUrl: p.imageUrl,
    })));
    return json({ ok: true, jobId: job.id, cost, count, email });
  }

  // ── Create / refresh the auto-updating "Best Sellers" smart collection ──
  if (intent === "create_bestseller_collection") {
    const scopes = String((session as any).scope || "");
    if (!/read_orders/.test(scopes)) {
      return json({ ok: false, error: "This needs order access. Please reload the app to approve the updated permissions, then try again." }, { status: 403 });
    }
    const topN = Math.min(50, Math.max(3, parseInt(String(form.get("topN") || "20"), 10) || 20));
    try {
      const res = await refreshBestSellerCollection(admin, shop, { topN, scopes });
      if (!res.ok) return json({ ok: false, error: res.error }, { status: 400 });
      await logActivity(shop, "bestseller_collection", `Best-sellers collection · ${res.count} products`, { count: res.count, added: res.added, removed: res.removed, created: res.created });
      return json({ ok: true, ...res });
    } catch (e: any) {
      console.error("[bestseller] create failed:", e?.message || e);
      return json({ ok: false, error: "Could not build the collection right now. Please try again." }, { status: 500 });
    }
  }

  return json({ ok: false, error: "Unknown action." }, { status: 400 });
}
