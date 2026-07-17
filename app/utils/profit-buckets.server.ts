/**
 * Deterministic product screening for the AI Profit Advisor & Campaign Planner.
 *
 * WHY THIS EXISTS: completeness used to depend on the model's diligence ("list every bleeding
 * product") — unverifiable, and merchants rightly asked "did it really look at everything?".
 * Now CODE screens 100% of the catalogue into named action buckets (thresholds derived from the
 * store's own numbers, Producthero/TrueProfit-style), and the model's job shrinks to what LLMs are
 * actually good at: prioritising, quantifying and wording the actions. Coverage becomes a
 * mathematical guarantee, not a hope.
 *
 * Pure functions only (no prisma/network) — unit-testable offline.
 */

export type Bucket =
  | "MARGIN_IMPOSSIBLE" // REAL unit cost proves every sale loses money — unadvertisable at this price
  | "BLEEDER"      // real ad spend, negative profit or zero orders — ads are the leak
  | "RTO_LEAK"     // returns/RTO eating the product (India-specific: COD RTO drag)
  | "TRUE_DRAIN"   // losing money with enough data and no single dominant fixable cost
  | "LOSS_LEADER"  // loses alone but carries bigger baskets — keep, cap the loss
  | "WINNER"       // proven profit + volume — scale
  | "HIDDEN_GEM"   // strong margin, starved of exposure — fund it
  | "RAISE_PRICE"  // converting far above store average with profit — demand can carry a higher price
  | "PRICE_TEST"   // real traffic, no orders, no ad spend — price/page resistance
  | "WATCH"        // losing money but data too thin to convict — gather data
  | "ZOMBIE"       // effectively no traffic and no orders
  | "OK";          // healthy, no action needed

export type Confidence = "high" | "medium" | "low";

export interface BucketInputRow {
  numericId: string;
  title: string;
  sessions: number;
  orders: number;
  conversion: number | null;
  cpc: number | null;
  adSpend: number;                        // window ad spend (actual from Google Ads when available)
  adSpendSource: "ads" | "estimated" | "none";
  adClicks: number | null;                // actual clicks (null when only the CPC estimate exists)
  revenue: number;
  shipCost: number;
  rtoCost: number;
  profit: number;
  marginPct: number | null;
  price: number;
  deliveredOrders: number;
  returnedOrders: number;
  codOrders: number;
  containedValue: number;                 // Σ full order value of delivered orders containing it
  unitCost?: number | null;               // REAL per-unit cost (Shopify inventory / manual); null = unknown
}

export interface CostAssumptions {
  assumedCogsPct: number;                 // % of price assumed as product cost when unitCost is unknown
  paymentFeePct: number;                  // payment-gateway fee, % of price
}
export const DEFAULT_COSTS: CostAssumptions = { assumedCogsPct: 50, paymentFeePct: 2 };

export interface ClassifiedRow extends BucketInputRow {
  bucket: Bucket;
  bucketReason: string;                   // the exact figures that fired the rule
  confidence: Confidence;
  rtoRatePct: number | null;              // returned ÷ (delivered+returned) × 100
  basketLift: number | null;              // avg order value containing it ÷ store AOV
  contributionMarginPct: number | null;   // (price − cogs − ship/order − fee) ÷ price × 100
  breakevenRoas: number | null;           // 1 ÷ contribution margin — the pause/scale decision anchor
  actualRoas: number | null;              // revenue ÷ ad spend (window)
  cogsAssumed: boolean;                   // true = margin math used the assumed-COGS% (not a real cost)
}

export interface StoreStats {
  products: number;
  sessions: number;
  orders: number;
  revenue: number;
  adSpend: number;
  storeConvPct: number | null;            // orders ÷ sessions × 100
  clickThreshold: number;                 // ≈ sessions-per-conversion (Producthero click threshold)
  accountRoas: number | null;             // revenue ÷ ad spend
  avgRtoRatePct: number;                  // returned ÷ (delivered+returned) × 100, store-wide
  storeAOV: number | null;                // delivered order value ÷ delivered orders
  avgSessions: number;                    // mean sessions among products with any traffic
}

export interface ClassifyResult {
  rows: ClassifiedRow[];
  stats: StoreStats;
  counts: Record<Bucket, number>;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Confidence tier — stops confident calls on thin data (competitors' #1 credibility gap). */
export function confidenceFor(row: BucketInputRow): Confidence {
  const clicks = row.adClicks ?? 0;
  if (row.orders >= 50 || clicks >= 200) return "high";
  if (row.orders >= 10 || clicks >= 100 || row.sessions >= 300) return "medium";
  return "low";
}

export function classifyProducts(rows: BucketInputRow[], totals: { orders: number; delivered: number; returned: number; revenue: number; adSpend: number; deliveredValue: number; sessions: number }, costs: CostAssumptions = DEFAULT_COSTS): ClassifyResult {
  const withTraffic = rows.filter((r) => r.sessions > 0);
  const avgSessions = withTraffic.length ? withTraffic.reduce((s, r) => s + r.sessions, 0) / withTraffic.length : 0;
  const storeConvPct = totals.sessions > 0 ? (totals.orders / totals.sessions) * 100 : null;
  // Producthero-style click threshold ≈ clicks needed for one conversion (floor 20, cap 400).
  const clickThreshold = Math.min(400, Math.max(20, storeConvPct && storeConvPct > 0 ? Math.ceil(100 / storeConvPct) : 100));
  const accountRoas = totals.adSpend > 0 ? totals.revenue / totals.adSpend : null;
  const completedStore = totals.delivered + totals.returned;
  const avgRtoRatePct = completedStore > 0 ? (totals.returned / completedStore) * 100 : 0;
  const storeAOV = totals.delivered > 0 ? totals.deliveredValue / totals.delivered : null;

  // Winner profit bar: 75th percentile of positive profits (so WINNER means "top quartile", not
  // "made any profit at all") — but never higher than what a small store can reach.
  const positives = rows.map((r) => r.profit).filter((p) => p > 0).sort((a, b) => a - b);
  const profitP75 = positives.length ? positives[Math.floor(positives.length * 0.75)] : 0;

  const stats: StoreStats = {
    products: rows.length, sessions: totals.sessions, orders: totals.orders,
    revenue: totals.revenue, adSpend: totals.adSpend,
    storeConvPct: storeConvPct != null ? r1(storeConvPct) : null,
    clickThreshold, accountRoas: accountRoas != null ? r1(accountRoas) : null,
    avgRtoRatePct: r1(avgRtoRatePct), storeAOV: storeAOV != null ? Math.round(storeAOV) : null,
    avgSessions: Math.round(avgSessions),
  };

  const counts: Record<Bucket, number> = {
    MARGIN_IMPOSSIBLE: 0, BLEEDER: 0, RTO_LEAK: 0, TRUE_DRAIN: 0, LOSS_LEADER: 0, WINNER: 0,
    HIDDEN_GEM: 0, RAISE_PRICE: 0, PRICE_TEST: 0, WATCH: 0, ZOMBIE: 0, OK: 0,
  };
  // Per-order shipping SHARE for margin math: the product's own delivered average, else the store
  // average share. Numerator and denominator both come from these rows (Σ allocated shares ÷ Σ
  // product-order incidences) — dividing by store-wide delivered ORDERS would reconstruct the FULL
  // per-order cost (~basket-size× the share) and mix active-row money with store-wide counts.
  const shipOrderEvents = rows.reduce((s, r) => s + r.deliveredOrders, 0);
  const storeAvgShipShare = shipOrderEvents > 0
    ? rows.reduce((s, r) => s + r.shipCost, 0) / shipOrderEvents : 0;

  const out: ClassifiedRow[] = rows.map((row) => {
    const completed = row.deliveredOrders + row.returnedOrders;
    const rtoRatePct = completed > 0 ? r1((row.returnedOrders / completed) * 100) : null;
    const basketLift = storeAOV && row.deliveredOrders > 0
      ? r1((row.containedValue / row.deliveredOrders) / storeAOV) : null;
    const confidence = confidenceFor(row);
    const spend = row.adSpend || 0;
    const loss = row.profit < 0 ? -row.profit : 0;
    const totalCost = spend + row.shipCost + row.rtoCost;
    const clicksProxy = row.adClicks ?? (spend > 0 && row.cpc ? spend / row.cpc : 0);
    const highRto = rtoRatePct != null && completed >= 5 && rtoRatePct >= Math.max(15, 2.5 * avgRtoRatePct);

    // ── Contribution economics (the pause/scale decision anchor from every top profit tool) ──
    const cogsAssumed = row.unitCost == null;
    const effUnitCost = row.unitCost ?? row.price * (costs.assumedCogsPct / 100);
    const ownShipShare = row.deliveredOrders > 0 ? row.shipCost / row.deliveredOrders : null;
    const shipPerOrder = ownShipShare ?? storeAvgShipShare;
    const contribution = row.price - effUnitCost - shipPerOrder - row.price * (costs.paymentFeePct / 100);
    const contributionMarginPct = row.price > 0 ? r1((contribution / row.price) * 100) : null;
    const breakevenRoas = contribution > 0 && row.price > 0 ? r1(row.price / contribution) : null;
    const actualRoas = spend > 0 ? r1(row.revenue / spend) : null;

    let bucket: Bucket; let reason: string;

    // TRUE_DRAIN needs real order/click evidence — sessions-only "medium" confidence must not
    // unlock a discontinuation call on a 1-order product.
    const drainEvidence = row.orders >= 10 || (row.adClicks ?? 0) >= 100;

    // MARGIN_IMPOSSIBLE conviction guards (the conviction hard-excludes the product from ALL ad
    // campaigns, so no estimate may participate in it):
    // - zero-history rows are judged WITHOUT the shipping estimate (price − real cost − fee only);
    // - the price/cost pair is variant #1's — when actual sales imply a materially higher selling
    //   price (pricier variants / multi-unit orders), the pair doesn't represent what sells: skip;
    // - proven basket-carriers are deliberate below-cost anchors → LOSS_LEADER path, not a kill.
    const convictionContribution = ownShipShare != null ? contribution : row.price - effUnitCost - row.price * (costs.paymentFeePct / 100);
    const salesMixConsistent = row.deliveredOrders === 0 || row.revenue <= 0 || row.revenue / row.deliveredOrders <= row.price * 1.5;
    const basketCarrier = basketLift != null && basketLift >= 1.3 && row.deliveredOrders >= 5;

    if (!cogsAssumed && row.price > 0 && convictionContribution <= 0 && salesMixConsistent && !basketCarrier) {
      // Only REAL figures convict — an assumption must never brand a product unsellable.
      bucket = "MARGIN_IMPOSSIBLE";
      reason = `price ${Math.round(row.price)} minus real unit cost ${Math.round(effUnitCost)}${ownShipShare != null ? `, ~${Math.round(ownShipShare)} shipping/order` : ""} and ${costs.paymentFeePct}% fees leaves ${r1((convictionContribution / row.price) * 100)}% margin — every sale loses money before ads`;
    } else if (loss > 0 && basketLift != null && basketLift >= 1.3 && row.deliveredOrders >= 5 && spend < 0.5 * totalCost) {
      // Ad-spend-dominated losses are BLEEDERs (fix the ads), not loss leaders to be tolerated.
      bucket = "LOSS_LEADER";
      reason = `loses ${Math.round(loss)} on its own, but its ${row.deliveredOrders} delivered orders average ${basketLift}× the store AOV — it carries bigger baskets`;
    } else if ((loss > 0 && row.rtoCost > 0 && row.rtoCost >= 0.5 * totalCost) || (highRto && (row.rtoCost === 0 || row.rtoCost >= 0.2 * Math.max(1, row.revenue)))) {
      // rtoCost === 0 ⇒ the merchant hasn't entered RTO costs — a high RTO RATE still convicts
      // (the classification comes from real returned orders, not the cost inputs).
      bucket = "RTO_LEAK";
      reason = `RTO rate ${rtoRatePct}% vs store avg ${r1(avgRtoRatePct)}% (${row.returnedOrders} of ${completed} completed orders returned)${row.rtoCost > 0 ? `; RTO cost ${Math.round(row.rtoCost)} against revenue ${Math.round(row.revenue)}` : "; enter RTO costs in Price Radar to see the money impact"}`;
    } else if (spend > 0 && (loss > 0 || (row.orders === 0 && clicksProxy >= clickThreshold))) {
      bucket = "BLEEDER";
      reason = row.orders === 0
        ? `spent ${Math.round(spend)} on ads for 0 orders (${Math.round(clicksProxy)} clicks vs ~${clickThreshold} needed per sale)`
        : `ad spend ${Math.round(spend)} vs revenue ${Math.round(row.revenue)} → profit ${Math.round(row.profit)}; ads are the dominant cost`;
    } else if (loss > 0 && drainEvidence) {
      bucket = "TRUE_DRAIN";
      reason = `profit ${Math.round(row.profit)} across ${row.orders} orders with no single dominant fixable cost (ads ${Math.round(spend)}, ship ${Math.round(row.shipCost)}, RTO ${Math.round(row.rtoCost)})`;
    } else if (loss > 0) {
      bucket = "WATCH";
      reason = `losing ${Math.round(loss)} but only ${row.orders} orders / ${row.sessions} sessions — too thin to convict`;
    } else if (row.profit > 0 && (row.marginPct ?? 0) >= 25 && row.sessions < Math.max(20, avgSessions)) {
      bucket = "HIDDEN_GEM";
      reason = `${row.marginPct}% margin on ${Math.round(row.revenue)} revenue with only ${row.sessions} sessions (store avg ${Math.round(avgSessions)}) — starved of exposure, not demand`;
    } else if (row.profit > 0 && row.orders >= 2 && (row.profit >= profitP75 || (spend > 0 && accountRoas != null && row.revenue / spend >= accountRoas))) {
      bucket = "WINNER";
      reason = spend > 0
        ? `profit ${Math.round(row.profit)} at ROAS ${r1(row.revenue / spend)} (account avg ${r1(accountRoas || 0)})`
        : `profit ${Math.round(row.profit)} from ${row.orders} orders with no ad spend behind it`;
    } else if (row.profit > 0 && row.orders >= 5 && row.conversion != null && storeConvPct != null && storeConvPct > 0 && row.conversion >= 1.8 * storeConvPct) {
      bucket = "RAISE_PRICE";
      reason = `conversion ${row.conversion}% vs store avg ${r1(storeConvPct)}% across ${row.orders} orders — demand can carry a +5-10% price test from ${Math.round(row.price)}`;
    } else if (row.orders === 0 && spend === 0 && row.sessions >= Math.max(30, clickThreshold)) {
      bucket = "PRICE_TEST";
      reason = `${row.sessions} sessions (≥ the ~${clickThreshold} a sale needs) but 0 orders — price or page resistance`;
    } else if (row.orders === 0 && row.sessions < Math.max(5, clickThreshold * 0.25)) {
      bucket = "ZOMBIE";
      reason = `${row.sessions} sessions, 0 orders — effectively invisible`;
    } else {
      bucket = "OK";
      reason = `no flag fired: profit ${Math.round(row.profit)}, ${row.orders} orders, ${row.sessions} sessions`;
    }

    counts[bucket] += 1;
    return { ...row, bucket, bucketReason: reason, confidence, rtoRatePct, basketLift, contributionMarginPct, breakevenRoas, actualRoas, cogsAssumed };
  });

  return { rows: out, stats, counts };
}

// Buckets that get individual per-product actions in the report (ZOMBIE/OK are aggregate-only).
export const ACTIONABLE_BUCKETS: Bucket[] = ["MARGIN_IMPOSSIBLE", "BLEEDER", "RTO_LEAK", "TRUE_DRAIN", "LOSS_LEADER", "WINNER", "HIDDEN_GEM", "RAISE_PRICE", "PRICE_TEST", "WATCH"];

export interface ListingOverflow { bucket: Bucket; count: number; revenue: number; adSpend: number; profit: number }

/**
 * Pick which products get INDIVIDUAL action lines, fairly across buckets. A naive
 * biggest-bucket-first fill once let 762 ad-bleeders consume the whole cap — the report came out
 * with ONE section and no winners / gems / price levers at all. Every non-empty bucket is
 * guaranteed a floor of slots (its most impactful products), no bucket may hog more than
 * `bucketCap`, and the remaining capacity goes to the highest-impact products across buckets.
 * Everything unlisted is returned as per-bucket aggregates — surfaced, never silently dropped.
 */
export function selectForListing(rows: ClassifiedRow[], cap = 400, floor = 30, bucketCap = 150): { listed: ClassifiedRow[]; overflow: ListingOverflow[] } {
  const impact = (r: ClassifiedRow) => (r.adSpend || 0) + Math.abs(r.profit || 0) + (r.revenue || 0) * 0.1;
  const byBucket = new Map<Bucket, ClassifiedRow[]>();
  for (const b of ACTIONABLE_BUCKETS) {
    const group = rows.filter((r) => r.bucket === b).sort((a, c) => impact(c) - impact(a));
    if (group.length) byBucket.set(b, group);
  }
  const chosen = new Set<ClassifiedRow>();
  // 1. Floors: every lever stays visible.
  for (const group of byBucket.values()) for (const r of group.slice(0, Math.min(floor, cap))) chosen.add(r);
  // 2. Fill remaining capacity by impact across buckets, respecting the per-bucket cap.
  const takenPerBucket = new Map<Bucket, number>();
  for (const r of chosen) takenPerBucket.set(r.bucket, (takenPerBucket.get(r.bucket) || 0) + 1);
  const rest = [...byBucket.values()].flat().filter((r) => !chosen.has(r)).sort((a, c) => impact(c) - impact(a));
  for (const r of rest) {
    if (chosen.size >= cap) break;
    if ((takenPerBucket.get(r.bucket) || 0) >= bucketCap) continue;
    chosen.add(r);
    takenPerBucket.set(r.bucket, (takenPerBucket.get(r.bucket) || 0) + 1);
  }
  // Final order: bucket display order, then impact — stable, readable ids.
  const order = Object.fromEntries(ACTIONABLE_BUCKETS.map((b, i) => [b, i]));
  const listed = [...chosen].sort((a, c) => (order[a.bucket] - order[c.bucket]) || (impact(c) - impact(a)));
  const overflow: ListingOverflow[] = [];
  for (const [b, group] of byBucket) {
    const rest2 = group.filter((r) => !chosen.has(r));
    if (!rest2.length) continue;
    overflow.push({
      bucket: b, count: rest2.length,
      revenue: Math.round(rest2.reduce((s, r) => s + r.revenue, 0)),
      adSpend: Math.round(rest2.reduce((s, r) => s + r.adSpend, 0)),
      profit: Math.round(rest2.reduce((s, r) => s + r.profit, 0)),
    });
  }
  return { listed, overflow };
}

/**
 * The executive hook: among the top-10 revenue products, the one whose PROFIT rank falls furthest
 * behind its revenue rank ("your #2 product by revenue is #17 by profit — a ₹31k gap"). The most
 * attention-grabbing personalised line this category has found — 5 lines of arithmetic.
 */
export function computeRankInversionHook(rows: ClassifiedRow[]): { title: string; revRank: number; profitRank: number; profit: number; revenue: number } | null {
  const byRevenue = [...rows].filter((r) => r.revenue > 0).sort((a, b) => b.revenue - a.revenue);
  if (byRevenue.length < 3) return null;
  const byProfit = [...rows].sort((a, b) => b.profit - a.profit);
  const profitRank = new Map(byProfit.map((r, i) => [r.numericId, i + 1]));
  let best: { title: string; revRank: number; profitRank: number; profit: number; revenue: number } | null = null;
  byRevenue.slice(0, 10).forEach((r, i) => {
    const pr = profitRank.get(r.numericId) || 0;
    const gap = pr - (i + 1);
    if (gap > 3 && (!best || gap > best.profitRank - best.revRank)) {
      best = { title: r.title, revRank: i + 1, profitRank: pr, profit: Math.round(r.profit), revenue: Math.round(r.revenue) };
    }
  });
  return best;
}
