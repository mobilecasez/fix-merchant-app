/**
 * Google Ads — AI campaign architect.
 *
 * v2: the campaign STRUCTURE is decided by code (Producthero-style conversion-volume ladder — an
 * account below ~30 conversions/month must not be split into 4 campaigns or nothing exits
 * learning), buckets come from the same deterministic screener as the Profit Advisor, and the
 * model's job is grouping, budget weighting inside the allowed frame, and merchant-facing
 * rationale. Grounding anchors (date + "your training knowledge is out of date") prevent
 * stale-world-knowledge claims. Campaigns are created feed-only PMax, PAUSED by default.
 */
import { geminiGenerateDetailed, geminiModels, extractJson } from "./gemini.server";
import { fixCurrencyDeep } from "./currency-text.server";

export const PLAN_CREDITS = 30; // AI campaign-plan generation cost (premium: best pro model, full catalogue)

// Campaign planning deliberately uses the BEST pro-tier model available (deeper reasoning over the
// whole catalogue), with graceful fallback. Steerable without a deploy via GEMINI_PLAN_MODEL.
function planModels(): string[] {
  return [...new Set([
    process.env.GEMINI_PLAN_MODEL,
    "gemini-3.1-pro-preview",
    "gemini-pro-latest",
    ...geminiModels(),
  ].filter(Boolean) as string[])];
}

export interface PlanProduct {
  numericId: string;
  title: string;
  sessions: number;
  orders: number;
  conversion: number | null; // orders ÷ sessions %
  revenue: number;
  adSpend: number;
  profit: number;
  marginPct: number | null;  // profit ÷ revenue % — surfaces hidden gems
  price: number;
  imageUrl: string | null;
  hasItemIds: boolean; // Google has seen this product in shopping traffic (targetable by item id)
  bucket?: string;     // deterministic screen result (WINNER/BLEEDER/HIDDEN_GEM/…)
  confidence?: string; // high|medium|low data confidence
  rtoRatePct?: number | null;
  deliveredOrders?: number; // delivered-only order count — the honest tROAS-viability signal
}

export interface PlanCampaign {
  name: string;
  tier: string;                 // winners | growers | longtail | everything-else …
  budgetPct: number;            // share of the total daily budget (sums to 100)
  targetRoas: number | null;    // suggested tROAS (e.g. 4 = 400%), null = let Google optimise
  rationale: string;
  productTitles: string[];      // [] + catchAll=true ⇒ "everything else"
  catchAll: boolean;
  searchThemes?: string[];      // 3-5 PMax search themes (feed-only quality boost)
}

export interface CampaignPlan {
  strategy: string;
  campaigns: PlanCampaign[];
  notes: string[];
  benefits: string[]; // expected benefits, each tied to a finding from the profit report
  suggestedDailyBudget?: number | null; // AI-recommended TOTAL daily budget (ads currency)
}

function sym(code: string): string {
  try {
    const parts = new Intl.NumberFormat("en", { style: "currency", currency: code }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value || code;
  } catch { return code; }
}

export interface PlanOptions {
  profitReport?: any;                                       // saved profit analysis (used when present)
  newStore?: boolean;                                       // no traffic/sales history yet
  totalProducts?: number;                                   // full catalogue size
  rest?: { count: number; sessions: number; revenue: number }; // aggregate of products beyond the top list
  today?: string;                                           // ISO date — grounding anchor
  rangeDays?: number;                                       // window the metrics cover
  conv30?: number;                                          // delivered conversions scaled to 30 days
  maxCampaigns?: number;                                    // conversion-ladder gate (incl. catch-all)
  accountRoas?: number | null;                              // store revenue ÷ ad spend
  adSpendActual?: boolean;                                  // real Google Ads spend vs estimate
  currentDailySpend?: number | null;                        // window ad spend ÷ window days — the budget anchor
}

/** Producthero-style conversion-volume ladder: how many campaigns the account can FEED with data. */
export function campaignLadder(conv30: number): { max: number; reason: string } {
  if (conv30 < 30) return { max: 1, reason: `only ~${Math.round(conv30)} delivered orders/30d — below 30, a single campaign is the only structure that exits learning` };
  if (conv30 < 70) return { max: 2, reason: `~${Math.round(conv30)} delivered orders/30d supports 2 campaigns (core + quarantine/activation)` };
  if (conv30 < 100) return { max: 3, reason: `~${Math.round(conv30)} delivered orders/30d supports 3 campaigns` };
  if (conv30 < 200) return { max: 4, reason: `~${Math.round(conv30)} delivered orders/30d supports 4 campaigns (each can still gather ≥30 conv/mo)` };
  return { max: 5, reason: `~${Math.round(conv30)} delivered orders/30d — full 5-campaign structure viable` };
}

function groundingBlock(today: string, rangeDays: number | undefined): string {
  return [
    `TODAY'S DATE IS ${today}. The data below was extracted LIVE from the store's Shopify admin and Google Ads account${rangeDays ? ` (last ${rangeDays} days)` : ""}.`,
    "This data is the ONLY source of truth. Your training knowledge about product names, brands, model numbers, launch dates or availability is OUT OF DATE and MUST NOT be used — every product listed is real and currently sold. Never claim a product is unreleased, upcoming or speculative, and never base grouping on assumed seasonality or market events.",
  ].join("\n");
}

function buildPrompt(currency: string, products: PlanProduct[], targetableCount: number, opts: PlanOptions = {}): string {
  const { profitReport, newStore, totalProducts, rest } = opts;
  const s = sym(currency);
  const maxCampaigns = Math.max(1, opts.maxCampaigns || 5);
  const lines: string[] = [];
  lines.push("You are an elite Google Ads Strategist and E-commerce Media Buyer. Your objective is to design the");
  lines.push("OPTIMAL Performance Max (PMax) Shopping campaign structure for a Shopify store based on its recent");
  lines.push("performance data and AI Profit Advisor insights.");
  lines.push("");
  lines.push(groundingBlock(opts.today || new Date().toISOString().slice(0, 10), opts.rangeDays));
  lines.push("");
  lines.push(`All money is in ${currency} (${s}). Products marked targetable=yes can be individually targeted in listing groups;`);
  lines.push("products marked targetable=no can ONLY be covered by the catch-all campaign.");
  lines.push("");
  if (newStore) {
    lines.push("NEW STORE MODE: this store has little or no traffic/sales history yet. Design a sensible STARTER");
    lines.push("structure from the catalogue itself — one hero campaign with the most promising products plus the");
    lines.push("catch-all (2 campaigns max). Note that regenerating after a few weeks of data will sharpen the plan.");
    lines.push("");
  }
  lines.push("INPUT DATA:");
  lines.push("--------------------------------------------------");
  lines.push("PROFIT ANALYSIS REPORT:");
  if (profitReport) {
    const compact = {
      headline: profitReport.headline, summary: profitReport.summary, keyStats: profitReport.keyStats,
      sections: (profitReport.sections || []).map((sec: any) => ({
        title: sec.title, priority: sec.priority, insight: sec.insight,
        actions: (sec.actions || []).map((a: any) => ({ product: a.product, recommendation: a.recommendation })),
      })),
      quickWins: profitReport.quickWins,
    };
    lines.push(JSON.stringify(compact).slice(0, 9000));
  } else {
    lines.push("(not available — plan from the product metrics alone)");
  }
  lines.push("");
  lines.push(`PRODUCT METRICS${totalProducts ? ` (${products.length} of ${totalProducts} products, ranked by revenue/traffic)` : ""}`);
  lines.push("(title | BUCKET | confidence | sessions | orders | conv% | rto% | revenue | adSpend | profit | margin% | price | targetable):");
  for (const p of products) {
    lines.push(`- ${p.title} | ${p.bucket || "-"} | ${p.confidence || "-"} | ${p.sessions} | ${p.orders} | ${p.conversion ?? "-"} | ${p.rtoRatePct ?? "-"} | ${s}${p.revenue} | ${s}${p.adSpend} | ${s}${p.profit} | ${p.marginPct != null ? p.marginPct + "%" : "-"} | ${s}${p.price} | ${p.hasItemIds ? "yes" : "no"}`);
  }
  if (rest && rest.count > 0) {
    lines.push(`- …plus ${rest.count} more products not listed (combined: ${rest.sessions} sessions, ${s}${rest.revenue} revenue) — automatically covered by the catch-all campaign.`);
  }
  lines.push("--------------------------------------------------");
  lines.push("");
  lines.push(`DATA DICTIONARY: sessions = storefront product-page visits; orders = orders containing the product; conv% = orders ÷ sessions; rto% = returned ÷ completed orders; revenue = delivered-order revenue after discounts; adSpend = ${opts.adSpendActual ? "ACTUAL attributed Google Ads spend" : "sessions × measured CPC (estimate)"}; profit = revenue − adSpend − shipping/RTO cost; margin% = profit ÷ revenue.`);
  lines.push("BUCKET comes from a deterministic screen of the whole catalogue: WINNER (scale), HIDDEN_GEM (starved high-margin), RAISE_PRICE (profitable, converts far above store average — winners-adjacent), BLEEDER (ad spend not converting — quarantine/exclude), MARGIN_IMPOSSIBLE (real unit cost proves every sale loses money — excluded from ALL campaigns including the catch-all until repriced), RTO_LEAK (returns drag), TRUE_DRAIN/WATCH (losing money), PRICE_TEST (traffic, no orders), LOSS_LEADER (carries baskets), ZOMBIE (no traffic), OK (healthy).");
  lines.push("");
  lines.push("STRATEGIC RULES & CONSTRAINTS:");
  lines.push(`1. CAMPAIGN COUNT (hard limit, decided by conversion volume — do not exceed it): create AT MOST ${maxCampaigns} campaign${maxCampaigns > 1 ? "s" : ""} INCLUDING the catch-all. Why: ~${Math.round(opts.conv30 ?? 0)} delivered orders/30d; each campaign needs ≥30 conversions/month to exit Google's learning phase.${maxCampaigns === 1 ? " With 1 campaign, it IS the catch-all: whole feed, notes carry the strategy." : ""}`);
  lines.push("2. Budget Allocation: total budgetPct MUST equal exactly 100. Default frame (adjust ±10 points with justification): Winners/Alpha 50-70%, Hidden Gems/Growers 15-25%, Testing/Activation 10-20%, catch-all the remainder.");
  lines.push("3. The \"Alpha/Winners\" tier: the WINNER-bucket and top-profit products carry the majority of budget.");
  lines.push("4. The \"Bleeders\" (exclusions): BLEEDER/TRUE_DRAIN products MUST NOT appear in any named campaign — they stay in the low-budget catch-all; remind the merchant about them in notes. MARGIN_IMPOSSIBLE products are removed from EVERY campaign (catch-all included) by the engine — note that they need a price fix first.");
  lines.push("5. The \"Testing/Traffic\" tier: PRICE_TEST products (high sessions, no orders) may get a campaign with a LOWER target ROAS to keep visibility while prices are tested.");
  lines.push("6. The \"Hidden Gems\" tier: HIDDEN_GEM products were starved of exposure, not demand — give the best of them a real budget (10-20%) so they gather data.");
  lines.push("7. The catch-all: exactly one campaign flagged catchAll=true (productTitles=[]), LAST, covering all remaining inventory on a modest budget.");
  lines.push(`8. Target ROAS: set targetRoas to null for EVERY campaign. A brand-new Performance Max campaign must gather conversion data before it can hit a target — a target ROAS on day one suppresses serving and starves sales (the store's untargeted campaigns consistently outperform targeted ones). Do NOT cite specific ROAS targets in rationale; the merchant adds a per-campaign target later, from Campaign health, once it has ~30 conversions.`);
  lines.push(`9. Only targetable=yes products in named campaigns (${targetableCount} are targetable). TIER MEMBERSHIP IS BUCKET-COMPLETE — never subsample: a winners campaign holds EVERY targetable WINNER (and RAISE_PRICE) product, a hidden-gems campaign EVERY targetable HIDDEN_GEM, a testing campaign EVERY targetable PRICE_TEST. List them all explicitly; the engine verifies each tier against the report's buckets and auto-adds anything you omit.`);
  lines.push("10. searchThemes: for every campaign give 3-5 short search themes derived ONLY from the product titles/types in it (what a buyer would type). No brand claims, no seasonal guesses.");
  lines.push("11. Campaign names: short and merchant-friendly (e.g. \"PMax — Core Winners\", \"PMax — Hidden Gems\").");
  lines.push("12. OUTPERFORM THE STATUS QUO: this plan must beat the current allocation, not restate it. Quantify the reallocation in benefits: the measured bleeder/drain waste (from the report/metrics) moves into winners and hidden gems — state the expected extra monthly revenue that spend buys at the winners' own ROAS (show the arithmetic).");
  lines.push(`13. suggestedDailyBudget: recommend the TOTAL daily budget for this structure — anchor it on the account's CURRENT daily spend${opts.currentDailySpend != null ? ` (~${s}${Math.round(opts.currentDailySpend)}/day measured this window)` : " (window ad spend ÷ days)"} reallocated toward winners; do not exceed ~1.5× current daily spend unless the winners' ROAS clearly supports it. State the reasoning inside strategy.`);
  lines.push("");
  lines.push("OUTPUT FORMAT: respond with ONLY a valid JSON object — no markdown fences, no text outside the JSON:");
  lines.push('{ "strategy": "<2-3 sentences: the overall account strategy and why>",');
  lines.push('  "suggestedDailyBudget": <number — recommended TOTAL daily budget>,');
  lines.push('  "campaigns": [ { "name": "<merchant-friendly name>", "tier": "<winners|growers|testing|hidden-gems|longtail|everything-else>",');
  lines.push('      "budgetPct": <number>, "targetRoas": <decimal ratio like 4.5, or null>, "rationale": "<1-2 sentences with the numbers that justify this grouping>",');
  lines.push('      "productTitles": ["<exact titles from the list>"], "catchAll": <true|false>, "searchThemes": ["<3-5 short themes>"] } ],');
  lines.push(`  "benefits": ["<3-6 concrete expected benefits of THIS plan for THIS store, each grounded in ${profitReport ? "a profit-report finding" : "the product data"} with its numbers (amounts in ${s})>"],`);
  lines.push(`  "notes": ["<specific actionable advice referencing the report — e.g. the excluded bleeders and why, when to add tROAS to thin campaigns (amounts in ${s})>"] }`);
  return lines.join("\n");
}

function str(v: any, fb = ""): string { return typeof v === "string" ? v : v == null ? fb : String(v); }
const normTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function generateCampaignPlan(currency: string, products: PlanProduct[], opts: PlanOptions = {}): Promise<{ ok: boolean; plan?: CampaignPlan; model?: string; promptChars?: number; error?: string }> {
  const targetable = products.filter((p) => p.hasItemIds).length;
  try {
    const prompt = buildPrompt(currency, products, targetable, opts);
    // Full prompt + raw response go to the server logs for inspection (`railway logs`).
    console.log(`[ad-campaign] PROMPT (${prompt.length} chars, ${products.length} products, models=${planModels().join(",")}) >>>\n${prompt}`);
    const { text, model } = await geminiGenerateDetailed(
      { models: planModels(), retryBusyMs: 8000, busyRetries: 2, config: { generationConfig: { temperature: 0.3, responseMimeType: "application/json", maxOutputTokens: 65536 } } },
      prompt,
    );
    console.log(`[ad-campaign] RESPONSE (model=${model}, ${text.length} chars) >>>\n${text}`);
    const j = extractJson(text);
    if (!j || !Array.isArray(j.campaigns) || !j.campaigns.length) {
      return { ok: false, error: "The AI plan could not be generated. Please try again." };
    }
    // FUZZY title matching (case/punctuation-insensitive) — exact `Set.has` used to silently drop
    // products whose title the model reworded even slightly.
    const byNorm = new Map(products.map((p) => [normTitle(p.title), p]));
    const maxCampaigns = Math.max(1, Math.min(5, opts.maxCampaigns || 5));
    // Buckets that may never sit in a NAMED campaign, no matter what the model listed.
    const FORBIDDEN_NAMED = new Set(["BLEEDER", "TRUE_DRAIN", "MARGIN_IMPOSSIBLE"]);
    let campaigns: PlanCampaign[] = j.campaigns.slice(0, maxCampaigns).map((c: any) => {
      const matched: PlanProduct[] = [];
      for (const t of (Array.isArray(c?.productTitles) ? c.productTitles : [])) {
        const p = byNorm.get(normTitle(str(t)));
        if (p && !FORBIDDEN_NAMED.has(String(p.bucket || "")) && !matched.some((m) => m.numericId === p.numericId)) matched.push(p);
      }
      return {
        name: str(c?.name, "Campaign").slice(0, 60),
        tier: str(c?.tier, "custom"),
        budgetPct: Math.max(0, Math.round(Number(c?.budgetPct) || 0)),
        // Start EVERY campaign with NO target ROAS. A target on a fresh Performance Max campaign
        // throttles serving before Google has any conversion data — the #1 cause of "high cost, no
        // sales". Merchants add a target later (per campaign) from Campaign health once it converts.
        targetRoas: null,
        rationale: str(c?.rationale),
        productTitles: matched.map((p) => p.title), // canonical titles (survive the create step's lookup)
        catchAll: c?.catchAll === true,
        searchThemes: Array.isArray(c?.searchThemes) ? c.searchThemes.slice(0, 5).map((t: any) => str(t).slice(0, 80)).filter(Boolean) : [],
      };
    });
    // Guarantee exactly one catch-all, as the LAST campaign. A synthesized catch-all must NOT
    // inherit a named campaign's identity (its quarantine tROAS would throttle the entire feed).
    campaigns = campaigns.filter((c, i) => !c.catchAll || campaigns.findIndex((x) => x.catchAll) === i);
    if (!campaigns.some((c) => c.catchAll)) {
      if (campaigns.length >= maxCampaigns && campaigns.length > 0) {
        const donor = campaigns[campaigns.length - 1];
        campaigns[campaigns.length - 1] = { name: "Everything else", tier: "everything-else", budgetPct: donor.budgetPct, targetRoas: null, rationale: "Catch-all for all remaining products.", productTitles: [], catchAll: true, searchThemes: [] };
      } else {
        campaigns.push({ name: "Everything else", tier: "everything-else", budgetPct: 0, targetRoas: null, rationale: "Catch-all for all remaining products.", productTitles: [], catchAll: true, searchThemes: [] });
      }
    }
    campaigns.sort((a, b) => Number(a.catchAll) - Number(b.catchAll));
    // ── BUCKET-COMPLETE tier membership (enforced in code, not model diligence): the profit
    //    report's buckets ARE the campaign assignment. If the report says 42 winners, the winners
    //    campaign holds all 42 targetable ones — a model that listed only 10 gets the rest added.
    //    Model-picked extras are kept (it may fold tiers when the conversion ladder caps count). ──
    const TIER_BUCKETS: Record<string, string[]> = {
      winners: ["WINNER", "RAISE_PRICE"], alpha: ["WINNER", "RAISE_PRICE"],
      "hidden-gems": ["HIDDEN_GEM"], growers: ["HIDDEN_GEM"],
      testing: ["PRICE_TEST"], traffic: ["PRICE_TEST"],
    };
    for (const c of campaigns) {
      if (c.catchAll) continue;
      const wantBuckets = TIER_BUCKETS[str(c.tier).toLowerCase().trim()];
      if (!wantBuckets) continue;
      const have = new Set(c.productTitles.map(normTitle));
      for (const p of products) {
        if (!p.hasItemIds || !p.bucket || !wantBuckets.includes(p.bucket)) continue;
        if (!have.has(normTitle(p.title))) { c.productTitles.push(p.title); have.add(normTitle(p.title)); }
      }
    }
    // A product may belong to only ONE named campaign (item-id overlap resolves by Ad Rank, not
    // intent) — first campaign in display order keeps it.
    const claimed = new Set<string>();
    for (const c of campaigns) {
      if (c.catchAll) continue;
      c.productTitles = c.productTitles.filter((t) => {
        const k = normTitle(t);
        if (claimed.has(k)) return false;
        claimed.add(k);
        return true;
      });
    }
    // A named campaign left with NO products (e.g. the model built it entirely from forbidden
    // buckets) would strand its budget share — drop it and let normalization redistribute.
    const pruned = campaigns.filter((c) => !c.catchAll && c.productTitles.length === 0);
    if (pruned.length) {
      campaigns = campaigns.filter((c) => c.catchAll || c.productTitles.length > 0);
      console.warn(`[ad-campaign] pruned ${pruned.length} empty named campaign(s): ${pruned.map((p) => p.name).join(", ")}`);
    }
    // ── tROAS safety: a campaign whose products have <30 DELIVERED conversions/30d must run
    //    WITHOUT tROAS (tROAS on thin history suppresses serving). Enforced in code, not left to
    //    the model. `orders` counts RTO'd/in-transit orders too — deliveredOrders is the signal. ──
    const scale30 = 30 / Math.max(1, opts.rangeDays || 30);
    const convOf = (p?: PlanProduct) => (p ? (p.deliveredOrders ?? p.orders) : 0);
    const totalConv30 = opts.conv30 ?? products.reduce((s2, p) => s2 + convOf(p), 0) * scale30;
    for (const c of campaigns) {
      const conv = c.catchAll
        ? totalConv30 // catch-all sees whole-account volume
        : c.productTitles.reduce((s2, t) => s2 + convOf(byNorm.get(normTitle(t))), 0) * scale30;
      if (c.targetRoas != null && conv < 30) {
        c.targetRoas = null;
        c.rationale = (c.rationale ? c.rationale + " " : "") + `(tROAS removed: ~${Math.round(conv)} conversions/30d is under the ~30 needed — add a target after it converts for a month.)`;
      }
    }
    // Normalise budget split to 100. Rounding drift lands on the LARGEST campaign (never the
    // catch-all, whose floor below must survive).
    const sum = campaigns.reduce((s2, c) => s2 + c.budgetPct, 0);
    if (sum <= 0) campaigns.forEach((c, i) => { c.budgetPct = Math.floor(100 / campaigns.length) + (i === 0 ? 100 % campaigns.length : 0); });
    else if (sum !== 100) {
      campaigns.forEach((c) => { c.budgetPct = Math.round((c.budgetPct / sum) * 100); });
      const diff = 100 - campaigns.reduce((s2, c) => s2 + c.budgetPct, 0);
      const biggest = campaigns.reduce((a, b) => (b.budgetPct > a.budgetPct ? b : a));
      biggest.budgetPct += diff;
    }
    // Catch-all floor: a 0% catch-all is silently skipped at create time, leaving remaining
    // inventory in NO campaign. Give it ≥3%, deducted from the largest named campaign.
    if (campaigns.length > 1) {
      const ca = campaigns[campaigns.length - 1];
      if (ca.catchAll && ca.budgetPct < 3) {
        const named = campaigns.slice(0, -1).reduce((a, b) => (b.budgetPct > a.budgetPct ? b : a));
        const bump = 3 - ca.budgetPct;
        if (named.budgetPct > bump) { named.budgetPct -= bump; ca.budgetPct = 3; }
      }
    }
    // Code-authored operating notes (facts, not model prose).
    const codeNotes = [
      "Campaigns start with NO target ROAS — a target on a fresh Performance Max throttles serving before Google has conversion data (the top cause of high cost + low sales). Let them spend and learn for 2–4 weeks, then add a per-campaign target from Campaign health once each has ~15–30 conversions.",
      "New/edited PMax campaigns take 7–14 days of formal learning and ~6–8 weeks to stabilise — avoid budget changes >20% or weekly reshuffles while learning.",
      "All campaigns are created PAUSED — review products and budgets in Google Ads, then enable.",
    ];
    // Sanitize every text field: the model must not leak "$"/"USD" into a non-USD store's plan.
    const plan: CampaignPlan = fixCurrencyDeep({
      strategy: str(j.strategy), campaigns,
      notes: [...(Array.isArray(j.notes) ? j.notes.slice(0, 6).map((n: any) => str(n)).filter(Boolean) : []), ...codeNotes].slice(0, 8),
      benefits: Array.isArray(j.benefits) ? j.benefits.slice(0, 6).map((b: any) => str(b)).filter(Boolean) : [],
      suggestedDailyBudget: Number(j.suggestedDailyBudget) > 0 ? Math.round(Number(j.suggestedDailyBudget)) : null,
    }, currency);
    return { ok: true, plan, model, promptChars: prompt.length };
  } catch (e: any) {
    const msg = String(e?.message || e);
    console.error("[ad-campaign] plan failed:", msg);
    if (/Google AI \(Gemini\) credits|Google has DENIED/i.test(msg)) return { ok: false, error: msg };
    return { ok: false, error: "The campaign plan couldn't be generated right now. Please try again." };
  }
}
