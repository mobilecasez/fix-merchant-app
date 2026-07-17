import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  fetchPricingProducts, fetchUnitCosts, getSessionsByProduct, getImportedSessions, getImportMeta,
  getOrderStatsByProduct, getShopCurrency, startOfNextMonthUTC, resolveRange, numericId, conversionPct,
} from "../utils/product-analytics.server";
import {
  loadAdsCreds, credsComplete, getCpcSnapshot, getAccessToken, detectMerchantId,
  fetchProductItemIds, createPmaxCampaign, refreshAdsSnapshot, digits, type CreateCampaignResult,
} from "../utils/google-ads.server";
import { generateCampaignPlan, campaignLadder, PLAN_CREDITS, type PlanProduct } from "../utils/ad-campaign.server";
import { classifyProducts, type BucketInputRow } from "../utils/profit-buckets.server";
import { chargeCredits, refundCredits } from "../utils/billing.server";
import { setAiJob, getAiJob, jobView, withTimeout } from "../utils/ai-jobs.server";
import { isCurrentUserAccountOwner } from "../utils/account-owner.server";
import { reviewCampaigns, applyCampaignFix, type FixInput } from "../utils/ads-review.server";
import { logActivity } from "../utils/activity.server";

// Compute the per-product P&L + item-id coverage that both `plan` and `create` need.
// Pass `liveCreds` to refresh the Google Ads spend snapshot first (plan runs on REAL spend).
async function buildProductData(admin: any, shop: string, days: number, liveCreds?: any) {
  // Throttle-safe + DB-cached: this value gets PERSISTED into the saved plan, so a transient
  // failure must never write "USD" into an INR store's payload. Ads-account currency is a better
  // last resort than a blind USD guess (same-country accounts are the norm).
  let currency = await getShopCurrency(admin, shop);
  if (!currency) {
    const ads = await prisma.googleAdsSettings.findUnique({ where: { shop } }).catch(() => null);
    currency = ads?.currencyCode || "USD";
  }
  let domain = "";
  try {
    const r: any = await admin.graphql(`#graphql query { shop { primaryDomain { url } } }`);
    domain = (await r.json())?.data?.shop?.primaryDomain?.url || "";
  } catch { /* default */ }

  const url = new URL(`https://x/?days=${days || 30}`);
  const importMeta = await getImportMeta(shop);
  const range = resolveRange(url, importMeta.earliest);
  const pixelNotBefore = importMeta.latest ? startOfNextMonthUTC(importMeta.latest) : null;

  const costRow = await prisma.priceRadarSettings.findUnique({ where: { shop } });
  const costs = {
    shipCostPrepaid: costRow?.shipCostPrepaid || 0, shipCostCod: costRow?.shipCostCod || 0,
    rtoCostPrepaid: costRow?.rtoCostPrepaid || 0, rtoCostCod: costRow?.rtoCostCod || 0,
  };
  const costAssumptions = {
    assumedCogsPct: (costRow as any)?.assumedCogsPct ?? 50,
    paymentFeePct: (costRow as any)?.paymentFeePct ?? 2,
  };

  const [products, pixelData, importedData, unitCostData] = await Promise.all([
    fetchPricingProducts(admin, currency),
    getSessionsByProduct(shop, range, pixelNotBefore),
    getImportedSessions(shop, range),
    fetchUnitCosts(admin), // best-effort (needs read_inventory); empty maps = assumed-COGS fallback
  ]);
  const unitCosts = unitCostData.costs;
  const inventorySignals = unitCostData.inventory;
  const orderStats = await getOrderStatsByProduct(admin, range, costs).catch(() => ({ byProduct: new Map(), totals: {} as any }));

  const variantToProduct = new Map<string, string>();
  const productIds = new Set<string>();
  for (const p of products) {
    productIds.add(p.numericId);
    const vn = numericId(p.variantId);
    if (vn) variantToProduct.set(vn, p.numericId);
  }

  let cpc = await getCpcSnapshot(shop);
  // Live refresh only when the integration is enabled (or never synced yet) — an explicitly
  // DISCONNECTED integration must not be silently re-enabled by an AI job.
  if (liveCreds && (cpc.enabled || !cpc.lastSyncAt)) {
    try {
      const fresh = await refreshAdsSnapshot(shop, liveCreds, variantToProduct, productIds, cpc.windowDays || 30);
      cpc = { ...cpc, enabled: true, byProduct: fresh.byProduct, perfByProduct: fresh.perfByProduct };
    } catch (e: any) { console.warn("[ad-campaigns] ads snapshot refresh failed — using cached:", e?.message || e); }
  }

  // Actual attributed ad spend from the Google Ads snapshot when present (scaled from its sync
  // window to this range — down-scaling is honest, up-scaling capped at 3×); otherwise the
  // sessions×CPC estimate.
  const adSpendActual = cpc.enabled && Object.keys(cpc.perfByProduct).length > 0;
  const rangeDays = Math.max(1, Math.round((range.until.getTime() - range.since.getTime()) / 86400000));
  const spendScale = Math.min(3, rangeDays / (cpc.windowDays || 30));

  const rows = products.map((p) => {
    const sessions = (importedData.get(p.numericId) || 0) + (pixelData.byId.get(p.numericId) || 0);
    const stats: any = (orderStats.byProduct as Map<string, any>).get(p.numericId);
    const orders = stats?.orders || 0;
    const productCpc = cpc.enabled ? (cpc.byProduct[p.numericId] ?? null) : null;
    const pf = adSpendActual ? cpc.perfByProduct[p.numericId] : undefined;
    let adSpend = 0; let adClicks: number | null = null; let adSpendSource: "ads" | "estimated" | "none" = "none";
    // adClicks stays UNSCALED (observed sample size — feeds confidence tiers); only money scales.
    if (pf && pf.s > 0) { adSpend = pf.s * spendScale; adClicks = pf.c; adSpendSource = "ads"; }
    else if (!adSpendActual && productCpc != null && sessions > 0) { adSpend = sessions * productCpc; adSpendSource = "estimated"; }
    const revenue = stats?.revenue || 0;
    const shipCost = stats?.shipCost || 0;
    const rtoCost = stats?.rtoCost || 0;
    const profit = revenue - adSpend - shipCost - rtoCost;
    return {
      numericId: p.numericId, productId: p.productId, title: p.title, imageUrl: p.imageUrl,
      price: p.currentPrice, sessions, orders,
      conversion: conversionPct(orders, sessions),
      cpc: productCpc, adClicks, adSpendSource,
      revenue: Math.round(revenue), adSpend: Math.round(adSpend), profit: Math.round(profit),
      shipCost: Math.round(shipCost), rtoCost: Math.round(rtoCost),
      marginPct: revenue > 0 ? Math.round((profit / revenue) * 100) : null,
      deliveredOrders: stats?.deliveredOrders || 0, returnedOrders: stats?.returnedOrders || 0,
      codOrders: stats?.codOrders || 0, containedValue: stats?.containedValue || 0,
      unitCost: unitCosts.get(p.numericId) ?? null,
      totalInventory: p.totalInventory,
    };
  });

  return { currency, domain, rows, variantToProduct, productIds, totals: orderStats.totals as any, adSpendActual, rangeDays, costAssumptions, inventorySignals };
}

// Lightweight status endpoint — polled by the page while the plan job runs (zero Shopify API cost).
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const planJob = jobView(await getAiJob(session.shop, "campaign_plan_job"));
  const published = await prisma.adsCampaign.count({ where: { shop: session.shop } }).catch(() => 0);
  return json({ planJob, published });
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // Campaign creation spends real ad budget — owner-only, like the Google Ads settings.
  if (!(await isCurrentUserAccountOwner(request, shop))) {
    return json({ ok: false, error: "Only the store owner can manage ad campaigns." }, { status: 403 });
  }

  const isJson = (request.headers.get("content-type") || "").includes("application/json");
  const body: any = isJson ? await request.json().catch(() => ({})) : Object.fromEntries((await request.formData()).entries());
  const intent = String(body.intent || "");

  const { creds } = await loadAdsCreds(shop);
  if (!credsComplete(creds)) {
    return json({ ok: false, error: "Connect your Google Ads account first (Settings → Google Ads)." }, { status: 400 });
  }

  // ── Generate the AI campaign plan (pro model, ~1-3 min) — runs as a DETACHED background job;
  //    the click returns immediately and the page polls until the saved plan updates. Uses the
  //    saved profit analysis when there is one; a NEW store still gets a starter plan. ──
  if (intent === "plan") {
    const JOB = "campaign_plan_job";
    const existingJob = jobView(await getAiJob(shop, JOB));
    if (existingJob?.status === "running") return json({ ok: true, started: true, already: true });
    const profitRow = await prisma.aiReport.findUnique({ where: { shop_kind: { shop, kind: "profit_advisor" } } }).catch(() => null);
    const charged = await chargeCredits(shop, PLAN_CREDITS);
    if (!charged) return json({ ok: false, error: `Not enough credits — the AI campaign plan costs ${PLAN_CREDITS} credits. Upgrade your plan to run it.` }, { status: 402 });
    const startedAt = new Date().toISOString();
    await setAiJob(shop, JOB, { status: "running", startedAt });
    const daysBody = String(body.days || "30");

    void (async () => {
    try {
      const days = parseInt(daysBody, 10) || 30;
      // buildProductData refreshes the Google Ads snapshot first — the plan runs on REAL spend.
      const data = await buildProductData(admin, shop, days, creds);
      const accessToken = await getAccessToken(creds);

      // Which products Google can target individually (item ids seen in shopping traffic).
      let itemIdMap = new Map<string, string[]>();
      try { itemIdMap = await fetchProductItemIds(creds, accessToken, data.variantToProduct, data.productIds); } catch { /* coverage 0 */ }
      const merchantId = await detectMerchantId(creds, accessToken);

      if (data.rows.length < 2) {
        await refundCredits(shop, PLAN_CREDITS);
        await setAiJob(shop, JOB, { status: "error", error: "Your store needs at least a couple of active products to plan campaigns.", startedAt, finishedAt: new Date().toISOString() });
        return;
      }

      // Deterministic screen over the WHOLE catalogue — the same buckets the Profit Advisor uses,
      // so the campaign tiers (winners/gems/bleeders) rest on code-verified classification.
      // Money totals from ACTIVE rows (matching adSpend/sessions populations) — orderStats.totals
      // also counts draft/archived products' orders.
      const totalsC = data.totals || {};
      const totalAdSpendC = data.rows.reduce((s, r) => s + (r.adSpend || 0), 0);
      const rowRevenueC = data.rows.reduce((s, r) => s + (r.revenue || 0), 0);
      const { rows: classified, stats: storeStats } = classifyProducts(data.rows as unknown as BucketInputRow[], {
        orders: totalsC.orders || 0, delivered: totalsC.delivered || 0, returned: totalsC.returned || 0,
        revenue: rowRevenueC, adSpend: totalAdSpendC, deliveredValue: totalsC.deliveredValue || 0,
        sessions: data.rows.reduce((s, r) => s + r.sessions, 0),
      }, data.costAssumptions);
      const bucketById = new Map(classified.map((c) => [c.numericId, c]));

      // Conversion-volume ladder: campaign count is gated by delivered orders/30d (in code, not
      // model judgement — splitting a low-volume account guarantees campaigns stuck in learning).
      const conv30 = (totalsC.delivered || 0) * (30 / Math.max(1, data.rangeDays || 30));
      const ladder = campaignLadder(conv30);

      // EVERY Price Radar product feeds the plan individually (the pro model reasons over the
      // whole catalogue — low-impression but profitable "hidden gems" included). A 2000-line
      // safety cap protects the context window; anything beyond goes in as an aggregate.
      const CAP = 2000;
      let active = [...data.rows].sort((a, b) => (b.revenue - a.revenue) || (b.sessions - a.sessions) || (b.profit - a.profit));
      // NEW STORE: no traffic/sales history at all — plan a starter structure from the catalogue.
      const newStore = !data.rows.some((r) => r.sessions > 0 || r.orders > 0 || r.adSpend > 0);
      const top = active.slice(0, CAP);
      const restRows = active.slice(CAP);
      const rest = {
        count: restRows.length,
        sessions: restRows.reduce((s, r) => s + r.sessions, 0),
        revenue: restRows.reduce((s, r) => s + r.revenue, 0),
      };
      const planProducts: PlanProduct[] = top.map((r) => {
        const c = bucketById.get(r.numericId);
        return {
          numericId: r.numericId, title: r.title, sessions: r.sessions, orders: r.orders,
          conversion: r.conversion, revenue: r.revenue, adSpend: r.adSpend, profit: r.profit,
          marginPct: r.marginPct, price: r.price,
          imageUrl: r.imageUrl, hasItemIds: itemIdMap.has(r.numericId),
          bucket: c?.bucket, confidence: c?.confidence, rtoRatePct: c?.rtoRatePct ?? null,
          deliveredOrders: r.deliveredOrders,
        };
      });

      const result = await withTimeout(generateCampaignPlan(data.currency, planProducts, {
        profitReport: profitRow ? (profitRow.data as any) : undefined,
        newStore, totalProducts: data.rows.length, rest,
        today: new Date().toISOString().slice(0, 10),
        rangeDays: data.rangeDays, conv30: Math.round(conv30),
        maxCampaigns: newStore ? 2 : ladder.max,
        accountRoas: storeStats.accountRoas, adSpendActual: data.adSpendActual,
        currentDailySpend: totalAdSpendC > 0 ? totalAdSpendC / Math.max(1, data.rangeDays || 30) : null,
      }), 12 * 60 * 1000, "Campaign plan"); // must stay under jobView's stale threshold (15 min)
      if (!result.ok) {
        await refundCredits(shop, PLAN_CREDITS);
        await setAiJob(shop, JOB, { status: "error", error: result.error || "The plan failed.", startedAt, finishedAt: new Date().toISOString() });
        return;
      }

      const settings = await prisma.googleAdsSettings.findUnique({ where: { shop } });
      // Product lookup for the UI (chips + ad preview).
      const productInfo: Record<string, { title: string; image: string | null; price: number; revenue: number; orders: number; targetable: boolean }> = {};
      for (const p of planProducts) productInfo[p.title] = { title: p.title, image: p.imageUrl, price: p.price, revenue: p.revenue, orders: p.orders, targetable: p.hasItemIds };

      const generatedAt = new Date().toISOString();
      const basedOnReportAt = profitRow ? ((profitRow.meta as any)?.generatedAt || profitRow.updatedAt.toISOString()) : null;
      const payload = {
        ok: true, plan: result.plan, productInfo,
        merchantId: merchantId || "",
        adsCurrency: settings?.currencyCode || data.currency,
        storeCurrency: data.currency,
        storeDomain: data.domain,
        targetableCount: itemIdMap.size,
        analysed: planProducts.length,
        totalProducts: data.rows.length,
        newStore, profitBased: !!profitRow,
        model: result.model || null, promptChars: result.promptChars || null,
        generatedAt, basedOnReportAt,
      };
      // Persist so re-opening the page is free — credits only on regenerate.
      await prisma.aiReport.upsert({
        where: { shop_kind: { shop, kind: "campaign_plan" } },
        update: { data: payload as any, meta: { generatedAt, basedOnReportAt } },
        create: { shop, kind: "campaign_plan", data: payload as any, meta: { generatedAt, basedOnReportAt } },
      }).catch((e) => console.error("[ad-campaigns] plan save failed:", e?.message));
      await setAiJob(shop, JOB, { status: "done", startedAt, finishedAt: new Date().toISOString(), model: result.model || null });
    } catch (e: any) {
      await refundCredits(shop, PLAN_CREDITS);
      console.error("[ad-campaigns] plan job failed:", e?.message || e);
      const msg = String(e?.message || e);
      await setAiJob(shop, JOB, {
        status: "error", startedAt, finishedAt: new Date().toISOString(),
        error: /Google AI \(Gemini\) credits|Google has DENIED|timed out/i.test(msg) ? msg : msg.slice(0, 300),
      });
    }
    })();

    return json({ ok: true, started: true });
  }

  // ── Create the campaigns in Google Ads (feed-only PMax, PAUSED unless chosen otherwise) ──
  if (intent === "create") {
    try {
      const merchantId = digits(String(body.merchantId || ""));
      if (!merchantId) return json({ ok: false, error: "A Merchant Center ID is required — click Detect or enter it manually." }, { status: 400 });
      const totalBudget = Number(body.totalBudget) || 0;
      if (totalBudget <= 0) return json({ ok: false, error: "Enter a total daily budget." }, { status: 400 });
      const status: "PAUSED" | "ENABLED" = body.status === "ENABLED" ? "ENABLED" : "PAUSED";
      const campaigns: any[] = Array.isArray(body.campaigns) ? body.campaigns.slice(0, 5) : [];
      if (!campaigns.length) return json({ ok: false, error: "No campaigns to create." }, { status: 400 });
      const targetCountries: string[] = Array.isArray(body.countries) ? body.countries.map((x: any) => String(x)).filter(Boolean).slice(0, 10) : [];

      const data = await buildProductData(admin, shop, 30);
      const accessToken = await getAccessToken(creds);
      const itemIdMap = await fetchProductItemIds(creds, accessToken, data.variantToProduct, data.productIds).catch(() => new Map<string, string[]>());
      // Fuzzy (case/punctuation-insensitive) title lookup — exact matching silently dropped
      // products whose title the model or UI reworded slightly.
      const normT = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const byTitle = new Map(data.rows.map((r) => [normT(r.title), r.numericId]));
      const finalUrl = data.domain || `https://${shop}`;

      // Budget-floor sanity: a campaign under ~3× the account's cost-per-order never exits
      // learning. Computed from this store's numbers; surfaced as a warning, never a block.
      const totalOrders = data.rows.reduce((s, r) => s + r.orders, 0);
      const totalSpend = data.rows.reduce((s, r) => s + (r.adSpend || 0), 0);
      const storeCpa = totalOrders > 0 && totalSpend > 0 ? totalSpend / totalOrders : null;

      // ── Hard exclusions (from EVERY campaign, catch-all included) ──
      // MARGIN_IMPOSSIBLE: a REAL unit cost proves each sale loses money — advertising it burns
      // cash twice. OOS: requires PER-PRODUCT proof (inventory tracked + oversell denied + zero
      // stock + no window orders) — a store-wide guess would nuke dropship/untracked catalogues.
      const totalsX = data.totals || {};
      const rowRevenueX = data.rows.reduce((s, r) => s + (r.revenue || 0), 0);
      const { rows: classifiedX } = classifyProducts(data.rows as unknown as BucketInputRow[], {
        orders: totalsX.orders || 0, delivered: totalsX.delivered || 0, returned: totalsX.returned || 0,
        revenue: rowRevenueX, adSpend: totalSpend, deliveredValue: totalsX.deliveredValue || 0,
        sessions: data.rows.reduce((s, r) => s + r.sessions, 0),
      }, data.costAssumptions);
      const invSig = data.inventorySignals as Map<string, { tracked: boolean; policy: string }>;
      const excludedIds = new Set<string>();
      const exclusionNotes: string[] = [];
      const marginImpossible = classifiedX.filter((r) => r.bucket === "MARGIN_IMPOSSIBLE");
      const oos = data.rows.filter((r: any) => {
        const sig = invSig.get(r.numericId);
        return sig?.tracked === true && sig.policy === "DENY" && r.totalInventory != null && r.totalInventory <= 0 && r.orders === 0;
      });
      for (const r of marginImpossible) excludedIds.add(r.numericId);
      for (const r of oos as any[]) excludedIds.add(r.numericId);
      // Exclusion works via Merchant Center item ids — a product Google has never served has none
      // (nothing to exclude, and nothing currently serving either). Report coverage honestly.
      const excludable = [...excludedIds].filter((pid) => (itemIdMap.get(pid) || []).length > 0);
      const unexcludable = excludedIds.size - excludable.length;
      const note = (n: number, what: string, why: string) => n > 0 && exclusionNotes.push(`${n} ${what} product${n === 1 ? "" : "s"} excluded from all campaigns (${why}).`);
      note(marginImpossible.length, "margin-impossible", "real unit cost proves every sale loses money — fix the price first");
      note((oos as any[]).length, "out-of-stock", "inventory tracked at zero with oversell off — paid clicks would land on unbuyable pages");
      if (unexcludable > 0) exclusionNotes.push(`${unexcludable} of the excluded products have no Google shopping history yet (no item ids) — nothing is serving for them today, but re-run campaign creation after they first appear in shopping traffic.`);

      const usedItemIds: string[] = [];
      // Seed the catch-all's exclusion list with the hard-excluded products' item ids.
      for (const pid of excludable) usedItemIds.push(...(itemIdMap.get(pid) || []));
      const results: Array<CreateCampaignResult & { name: string; dailyBudget: number; skipped?: boolean; warning?: string }> = [];
      const persisted: Array<{ shop: string; resourceName: string; name: string; tier: string; targetRoas: number | null; dailyBudget: number }> = [];
      for (const c of campaigns) {
        const name = String(c.name || "Campaign").slice(0, 60);
        const budgetPct = Math.max(0, Number(c.budgetPct) || 0);
        const dailyBudget = Math.round(totalBudget * budgetPct) / 100;
        const catchAll = c.catchAll === true;
        if (dailyBudget <= 0) { results.push({ ok: false, step: "skipped", name, dailyBudget, skipped: true, error: "0% budget — skipped." }); continue; }

        let includeItemIds: string[] | undefined;
        let excludeItemIds: string[] | undefined;
        if (catchAll) {
          const dedupedExcludes = [...new Set(usedItemIds)];
          if (dedupedExcludes.length > 900) {
            exclusionNotes.push(`The catch-all can only exclude 900 item ids (Google's filter limit) — ${dedupedExcludes.length - 900} exclusion ids were dropped, so a few excluded/named products may also serve in the catch-all.`);
          }
          excludeItemIds = dedupedExcludes.length ? dedupedExcludes : undefined;
        } else {
          const ids: string[] = [];
          let droppedByExclusion = 0;
          for (const t of (Array.isArray(c.productTitles) ? c.productTitles : [])) {
            const pid = byTitle.get(normT(String(t)));
            if (!pid) continue;
            if (excludedIds.has(pid)) { droppedByExclusion++; continue; }
            ids.push(...(itemIdMap.get(pid) || []));
          }
          includeItemIds = [...new Set(ids)];
          if (!includeItemIds.length) {
            results.push({ ok: false, step: "products", name, dailyBudget, error: droppedByExclusion > 0
              ? `All of this campaign's products were hard-excluded (margin-impossible / out of stock) — fix their price or stock and recreate.`
              : "None of this campaign's products have targetable item ids — they'll be covered by the catch-all instead." });
            continue;
          }
        }

        const res = await createPmaxCampaign(creds, accessToken, {
          name, dailyBudget, status, merchantId, finalUrl,
          // tROAS ratio: a percent-style value (e.g. 450) gets normalized to 4.5.
          targetRoas: Number(c.targetRoas) > 0 ? (Number(c.targetRoas) > 20 ? Number(c.targetRoas) / 100 : Number(c.targetRoas)) : null,
          includeItemIds, excludeItemIds,
          searchThemes: Array.isArray(c.searchThemes) ? c.searchThemes.map((t: any) => String(t)).filter(Boolean).slice(0, 5) : undefined,
          targetCountries,
        });
        // Only a SUCCESSFULLY created campaign claims its item ids — a failed campaign's products
        // must stay coverable by the catch-all (excluding them would leave them in no campaign).
        if (!catchAll && res.ok && includeItemIds?.length) usedItemIds.push(...includeItemIds);
        const warning = storeCpa != null && dailyBudget < 3 * storeCpa
          ? `Daily budget ${Math.round(dailyBudget)} is under 3× your cost-per-order (~${Math.round(storeCpa)}) — it may never exit Google's learning phase. Consider merging it into a bigger campaign.`
          : undefined;
        results.push({ ...res, name, dailyBudget, warning });
        if (res.ok && res.campaignResource) {
          persisted.push({
            shop, resourceName: res.campaignResource, name, tier: String(c.tier || ""),
            targetRoas: Number(c.targetRoas) > 0 ? (Number(c.targetRoas) > 20 ? Number(c.targetRoas) / 100 : Number(c.targetRoas)) : null,
            dailyBudget,
          });
        }
      }

      const created = results.filter((r) => r.ok).length;
      // Remember what we published so the page can show a "Published" state + live Review.
      if (persisted.length) {
        try {
          await prisma.adsCampaign.createMany({ data: persisted, skipDuplicates: true });
          await logActivity(shop, "campaign_plan", `Published ${persisted.length} Google Ads campaign${persisted.length === 1 ? "" : "s"}`, { count: persisted.length });
        } catch (e: any) { console.warn("[ad-campaigns] persist failed:", e?.message || e); }
      }
      return json({ ok: true, created, results, status, exclusionNotes });
    } catch (e: any) {
      console.error("[ad-campaigns] create failed:", e?.message || e);
      return json({ ok: false, error: String(e?.message || e).slice(0, 400) }, { status: 502 });
    }
  }

  // ── Review live campaign performance (published campaigns) ──
  if (intent === "review") {
    const res = await reviewCampaigns(shop, creds);
    return json(res, { status: res.ok ? 200 : 502 });
  }

  // ── Apply a one-click fix to a live Google Ads campaign (spends/affects real budget) ──
  if (intent === "apply_fix") {
    const fix: FixInput = {
      type: String(body.fixType || "") as any,
      resourceName: String(body.resourceName || ""),
      budgetResource: body.budgetResource ? String(body.budgetResource) : undefined,
      value: body.value != null ? Number(body.value) : undefined,
    };
    if (!["lower_troas", "remove_troas", "pause", "raise_budget", "lower_budget"].includes(fix.type)) {
      return json({ ok: false, error: "Unknown fix." }, { status: 400 });
    }
    const res = await applyCampaignFix(creds, fix);
    if (res.ok) await logActivity(shop, "campaign_fix", `Applied ${fix.type.replace("_", " ")} to a campaign`, { type: fix.type, value: fix.value ?? null });
    return json(res, { status: res.ok ? 200 : 502 });
  }

  return json({ ok: false, error: "Unknown action." }, { status: 400 });
}
