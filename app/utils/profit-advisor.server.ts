/**
 * Price Radar — AI Profit Advisor.
 *
 * v2.1 architecture (deterministic screening + PARALLEL AI narration):
 *  1. CODE screens 100% of the catalogue into action buckets (profit-buckets.server.ts) — so
 *     "did it look at every product?" is answered by arithmetic, not model diligence.
 *  2. Generation is SPLIT into parallel calls: one small OVERVIEW call (headline / summary /
 *     key stats / per-section insights / quick wins) plus one ACTIONS call per ~90-product chunk.
 *     A single mega-call used to take 4-6 minutes on the pro fallback and hit the job timeout;
 *     parallel chunks finish in the time of the slowest small call.
 *  3. Every chunk carries its own COVERAGE CONTRACT verified in code: missing ids get one repair
 *     call, anything still missing gets a deterministic fallback action built from the bucket
 *     reason — a report physically cannot drop a product. A failed chunk (network, model down)
 *     degrades to fully deterministic actions instead of failing the whole report.
 *  4. GROUNDING GUARDS: prompts anchor today's date and forbid world-knowledge claims (a report
 *     once told the merchant to pause "unreleased" iPhone models that had long launched); any
 *     action that still contains stale-knowledge language is swapped for its deterministic
 *     fallback, and a violating overview is regenerated once.
 */
import { geminiGenerateDetailed, geminiModels, extractJson } from "./gemini.server";
import { fixCurrencyDeep } from "./currency-text.server";
import type { ClassifiedRow, StoreStats, Bucket } from "./profit-buckets.server";

export const ADVISOR_CREDITS = 20; // premium: best pro-tier model, deeper analysis

// Chunk size for the parallel per-product action calls. ~90 products ≈ 9-12k output tokens per
// call — small enough to answer in ~1 min even on the pro fallback, big enough to keep call
// count (and rate-limit pressure) low.
const CHUNK_SIZE = 90;

// The profit analysis uses the BEST pro-tier model available (env-steerable, graceful fallback).
function advisorModels(): string[] {
  return [...new Set([
    process.env.GEMINI_ADVISOR_MODEL,
    "gemini-3.1-pro-preview",
    "gemini-pro-latest",
    ...geminiModels(),
  ].filter(Boolean) as string[])];
}

export interface AdvisorListedProduct extends ClassifiedRow { pid: string } // "P1", "P2", …

/** Aggregate for bucket rows beyond the listing cap — surfaced, never silently dropped. */
export interface AdvisorOverflow { bucket: Bucket; count: number; revenue: number; adSpend: number; profit: number }

export interface AdvisorTotals {
  products: number;
  sessions: number;
  orders: number;
  revenue: number;
  adSpend: number;
  shipRtoCost: number;
  profit: number;
  delivered: number;
  inTransit: number;
  returned: number;
}

export interface AdvisorInput {
  currency: string;
  rangeLabel: string;
  today: string;               // ISO date — the grounding anchor
  adsConfigured: boolean;
  adSpendActual: boolean;      // true = real Google Ads spend; false = sessions×CPC estimate
  adsCurrency?: string | null; // Google Ads account currency when it differs from the store's
  hasCostInputs: boolean;
  cogs?: { realCount: number; assumedPct: number; feePct: number }; // unit-cost coverage + assumptions
  totals: AdvisorTotals;
  stats: StoreStats;
  counts: Record<Bucket, number>;
  hook: { title: string; revRank: number; profitRank: number; profit: number; revenue: number } | null;
  products: AdvisorListedProduct[]; // every actionable product, pre-bucketed
  overflow: AdvisorOverflow[];
  zombies: { count: number; sessions: number };
  okCount: number;
}

export interface AdvisorAction { id?: string; product: string; recommendation: string; reason: string; impact?: string }
export interface AdvisorSection { title: string; priority: "high" | "medium" | "low"; insight: string; actions: AdvisorAction[] }
export interface AdvisorReport {
  headline: string;
  summary: string;
  keyStats: { label: string; value: string }[];
  sections: AdvisorSection[];
  quickWins: string[];
}

// Fixed section taxonomy — sections map 1:1 to buckets so coverage is verifiable per bucket.
export const SECTION_FOR_BUCKET: Record<Bucket, string> = {
  MARGIN_IMPOSSIBLE: "Margin Impossible — losing money on every sale",
  RTO_LEAK: "RTO Drag — returns are eating profit",
  BLEEDER: "Pause / Cut Ads — bleeding ad spend",
  TRUE_DRAIN: "True Drains — run a 30-day discontinuation test",
  WINNER: "Scale Winners — put real budget behind what earns",
  HIDDEN_GEM: "Hidden Gems — fund the starved high-margin products",
  RAISE_PRICE: "Raise Price / Protect Margin — demand can carry more",
  LOSS_LEADER: "Loss Leaders — keep, but cap the loss",
  PRICE_TEST: "Price & Conversion Tests — traffic that won't buy",
  WATCH: "Watchlist — losing money, data too thin to act",
  ZOMBIE: "Zombies — no traffic at all",
  OK: "",
};

const PRIORITY_FOR_BUCKET: Record<Bucket, "high" | "medium" | "low"> = {
  MARGIN_IMPOSSIBLE: "high", BLEEDER: "high", RTO_LEAK: "high", TRUE_DRAIN: "high", WINNER: "high",
  HIDDEN_GEM: "medium", RAISE_PRICE: "medium", LOSS_LEADER: "medium", PRICE_TEST: "medium",
  WATCH: "low", ZOMBIE: "low", OK: "low",
};

// Display order of sections in the assembled report (most impactful levers first).
const SECTION_ORDER: Bucket[] = ["MARGIN_IMPOSSIBLE", "BLEEDER", "RTO_LEAK", "TRUE_DRAIN", "WINNER", "HIDDEN_GEM", "RAISE_PRICE", "LOSS_LEADER", "PRICE_TEST", "WATCH"];

// Deterministic fallback wording per bucket — used when the model (and its repair call) fail to
// cover a product, or when its text violates the grounding rules. Guarantees 100% coverage.
const FALLBACK_RECOMMENDATION: Record<Bucket, string> = {
  MARGIN_IMPOSSIBLE: "Raise the price above breakeven or stop selling it — the unit economics lose money on every sale, ads or not.",
  BLEEDER: "Pause this product's ads and re-check in 2 weeks — the spend is not converting.",
  RTO_LEAK: "Turn on COD verification (or make it prepaid-only) and watch the RTO rate for 30 days.",
  TRUE_DRAIN: "Run a 30-day discontinuation test: set it to Draft and check if total profit rises.",
  LOSS_LEADER: "Keep it, but cap its monthly loss and bundle it with a high-margin product.",
  WINNER: "Increase its ad budget/inventory — it earns above your store's bar.",
  HIDDEN_GEM: "Give it dedicated ad budget — margin is strong, it just never got exposure.",
  RAISE_PRICE: "Test a +5-8% price — conversion is far above store average, demand can carry it.",
  PRICE_TEST: "Test a lower price (or improve the product page) — traffic is there, orders aren't.",
  WATCH: "No irreversible moves — run a small capped test and gather 2 more weeks of data.",
  ZOMBIE: "Leave it to the catch-all campaign; revisit if it ever gets traffic.",
  OK: "No action needed.",
};

function currencySymbol(code: string): string {
  try {
    const parts = new Intl.NumberFormat("en", { style: "currency", currency: code }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value || code;
  } catch { return code; }
}

/**
 * Stale-world-knowledge language — a data-grounded report must never claim a product is
 * unreleased/upcoming/speculative (the model's training data is older than the store's catalogue).
 */
const STALE_CLAIMS = /\bunreleased\b|\bnot yet (?:been )?(?:launched|released|announced)\b|\bupcoming (?:launch|release|model)\b|\bspeculative\b|\bpre-?launch\b|\buntil (?:the |its )?(?:launch|release)\b|\brumou?red\b|\bisn'?t out yet\b|\bnot (?:yet )?(?:on the market|available in the market)\b|\bfuture (?:model|release|launch)\b|\bvaporware\b/i;

function groundingBlock(input: AdvisorInput): string {
  return [
    `TODAY'S DATE IS ${input.today}. The data below was extracted LIVE from this store's Shopify admin${input.adsConfigured ? " and Google Ads account" : ""} covering ${input.rangeLabel}.`,
    "This data is the ONLY source of truth about these products. Your training knowledge about product names, brands, model numbers, launch dates, availability or \"typical\" prices is OUT OF DATE and MUST NOT be used.",
    "If a product title resembles something you believe is unreleased, upcoming, discontinued or speculative — you are wrong: the store demonstrably sells it (it has real sessions, orders and revenue below). NEVER state or imply that a product is unreleased, fictional, speculative or discontinued, and never advise waiting for a \"launch\".",
    "Never invent a metric that is absent from the data. Every number in your response must either appear in the data or be simple arithmetic on numbers that do.",
  ].join("\n");
}

function currencyBlock(input: AdvisorInput, sym: string): string {
  const lines = [
    `CURRENCY: all amounts below and in your ENTIRE response are in ${input.currency}. Write every monetary amount with the "${sym}" symbol (e.g. ${sym}1,499). NEVER use "$", "US$", "USD" or the word "dollars" unless ${input.currency} is literally USD.`,
  ];
  if (input.adsCurrency && input.adsCurrency !== input.currency) {
    lines.push(`NOTE: the Google Ads account bills in ${input.adsCurrency} while the store sells in ${input.currency}; ad-spend figures are carried 1:1 (no FX applied).`);
  }
  return lines.join("\n");
}

function benchmarksBlock(input: AdvisorInput, sym: string): string {
  const t = input.totals;
  const s = input.stats;
  return [
    "STORE TOTALS (this window):",
    `- Products: ${t.products}; Sessions: ${t.sessions}; Orders: ${t.orders} (delivered ${t.delivered}, in transit ${t.inTransit}, returned/RTO ${t.returned})`,
    `- Revenue (delivered): ${sym}${t.revenue}; Ad spend: ${sym}${t.adSpend}; Shipping+RTO cost: ${sym}${t.shipRtoCost}; Net profit: ${sym}${t.profit}`,
    "STORE BENCHMARKS (computed from this data — cite them when they justify an action):",
    `- Store conversion: ${s.storeConvPct ?? "-"}%  → ~${s.clickThreshold} sessions needed per sale (the "click threshold")`,
    `- Account ROAS (revenue ÷ ad spend): ${s.accountRoas ?? "n/a"}; Store avg RTO rate: ${s.avgRtoRatePct}%; Store AOV: ${s.storeAOV != null ? sym + s.storeAOV : "n/a"}; Avg sessions/product: ${s.avgSessions}`,
    `Ad spend basis: ${input.adsConfigured ? (input.adSpendActual ? "ACTUAL attributed spend from the Google Ads account" : "estimated as sessions × measured CPC") : "Google Ads NOT connected — ad spend unknown/zero"}. Shipping/RTO costs entered: ${input.hasCostInputs ? "yes" : "no — shipping/RTO cost is 0 in the numbers"}.`,
    ...(input.cogs ? [
      `UNIT ECONOMICS: cMargin = contribution margin (price − product cost − shipping/order − ${input.cogs.feePct}% payment fee) ÷ price; beROAS = breakeven ROAS (1 ÷ margin) — a product earning BELOW its beROAS loses money on ads even with sales; ROAS = actual revenue ÷ ad spend. ${input.cogs.realCount > 0 ? `${input.cogs.realCount} products have REAL unit costs from the store` : "No real unit costs are set"}; "(est)" margins assume product cost ≈ ${input.cogs.assumedPct}% of price — treat (est) margins as indicative, never as proof for irreversible calls. Cite "ROAS X vs breakeven Y" whenever it justifies a pause/scale action.`,
    ] : []),
  ].join("\n");
}

const BUCKET_DEFINITIONS: Record<Bucket, string> = {
  MARGIN_IMPOSSIBLE: "REAL unit cost proves contribution margin ≤ 0 — every sale loses money regardless of ads; only a price rise or delisting fixes it",
  BLEEDER: "real ad spend with negative profit or zero orders — ads are the leak",
  RTO_LEAK: "RTO/return rate far above store average — remember the true cost of an RTO is 3–5× the visible courier charge (packaging, damage, blocked capital, wasted ad clicks)",
  TRUE_DRAIN: "losing money with enough data (≥10 orders / real click volume) and no single fixable cost",
  LOSS_LEADER: "loses on its own but its orders average ≥1.3× store AOV — it builds baskets; keep, cap the loss",
  WINNER: "top-quartile profit or above-account ROAS with real volume — scale",
  HIDDEN_GEM: "profit-positive, margin ≥25%, sessions below store average — starved of exposure, not demand",
  RAISE_PRICE: "converting far above store average with healthy profit — a +5-10% price test is pure margin",
  PRICE_TEST: "real traffic, zero orders, no ad spend — price/page resistance",
  WATCH: "losing money but data too thin to convict — reversible tests only",
  ZOMBIE: "effectively no traffic and no orders",
  OK: "healthy — no action needed",
};

function productLine(sym: string, p: AdvisorListedProduct): string {
  const money = (v: number | null | undefined) => (v == null ? "-" : `${sym}${Math.round(v)}`);
  const econ = ` | cMargin=${p.contributionMarginPct ?? "-"}%${p.cogsAssumed ? "(est)" : ""} | beROAS=${p.breakevenRoas ?? "-"} | ROAS=${p.actualRoas ?? "-"}`;
  return `[${p.pid}] ${p.bucket} | ${p.confidence} | ${p.title} | sess=${p.sessions} | orders=${p.orders} (del ${p.deliveredOrders}/ret ${p.returnedOrders}/cod ${p.codOrders}) | conv=${p.conversion ?? "-"}% | rto=${p.rtoRatePct ?? "-"}% | basket=${p.basketLift ?? "-"}x | adSpend=${money(p.adSpend)}${p.adSpendSource === "estimated" ? "(est)" : ""} | clicks=${p.adClicks ?? "-"} | rev=${money(p.revenue)} | shipCost=${money(p.shipCost)} | rtoCost=${money(p.rtoCost)} | profit=${money(p.profit)} | margin=${p.marginPct ?? "-"}% | price=${money(p.price)}${econ}`;
}

interface BucketAgg { bucket: Bucket; count: number; adSpend: number; revenue: number; profit: number; examples: string[] }

/** Per-bucket aggregates (listed + overflow) — computed in code, cited by the overview call. */
function bucketAggregates(input: AdvisorInput): BucketAgg[] {
  const map = new Map<Bucket, BucketAgg>();
  for (const p of input.products) {
    const a = map.get(p.bucket) || { bucket: p.bucket, count: 0, adSpend: 0, revenue: 0, profit: 0, examples: [] };
    a.count += 1; a.adSpend += p.adSpend || 0; a.revenue += p.revenue || 0; a.profit += p.profit || 0;
    if (a.examples.length < 3) a.examples.push(p.title);
    map.set(p.bucket, a);
  }
  for (const o of input.overflow) {
    const a = map.get(o.bucket) || { bucket: o.bucket, count: 0, adSpend: 0, revenue: 0, profit: 0, examples: [] };
    a.count += o.count; a.adSpend += o.adSpend; a.revenue += o.revenue; a.profit += o.profit;
    map.set(o.bucket, a);
  }
  for (const a of map.values()) { a.adSpend = Math.round(a.adSpend); a.revenue = Math.round(a.revenue); a.profit = Math.round(a.profit); }
  return SECTION_ORDER.filter((b) => map.has(b)).map((b) => map.get(b)!);
}

// ── Overview call: headline / summary / key stats / per-section insights / quick wins ──────────

function buildOverviewPrompt(input: AdvisorInput, aggs: BucketAgg[]): string {
  const sym = currencySymbol(input.currency);
  const lines: string[] = [];
  lines.push("You are a senior e-commerce profit consultant writing the EXECUTIVE LAYER of a product-level P&L action plan for a Shopify merchant. (The per-product actions are produced separately — do NOT write per-product actions here.)");
  lines.push("");
  lines.push(groundingBlock(input));
  lines.push("");
  lines.push(currencyBlock(input, sym));
  lines.push("");
  lines.push(benchmarksBlock(input, sym));
  if (input.hook) {
    lines.push("");
    lines.push(`EXECUTIVE HOOK (your headline MUST lead with this): the store's #${input.hook.revRank} product by revenue ("${input.hook.title}", ${sym}${input.hook.revenue}) ranks only #${input.hook.profitRank} by profit (${sym}${input.hook.profit}).`);
  }
  lines.push("");
  lines.push(`DETERMINISTIC PRE-SCREENING (done in code): our engine screened ALL ${input.stats.products} products and bucketed each one. Segment totals (count | ad spend | revenue | profit | sample titles):`);
  for (const a of aggs) {
    lines.push(`- ${a.bucket} (${BUCKET_DEFINITIONS[a.bucket]}): ${a.count} products | ${sym}${a.adSpend} | ${sym}${a.revenue} | ${sym}${a.profit} | e.g. ${a.examples.slice(0, 3).join(" · ")}`);
  }
  if (input.zombies.count > 0) lines.push(`- ZOMBIE: ${input.zombies.count} products with effectively no traffic (${input.zombies.sessions} total sessions)`);
  if (input.okCount > 0) lines.push(`- OK (healthy, no action): ${input.okCount} products`);
  lines.push("");
  lines.push("RULES: ground every number in the data above (simple arithmetic allowed). No claims about launches, releases, seasons, market trends or brand reputation.");
  lines.push("Insight guidance: WINNER — how to split the freed budget across them and the revenue that buys at their ROAS; HIDDEN_GEM — the case for a dedicated campaign with a specific budget share; BLEEDER — the immediate saving, plus one BULK move for the low-spend tail (exclude from ads in one go) rather than product-by-product effort; RAISE_PRICE — the pure-margin upside of the price tests.");
  lines.push("");
  lines.push("Respond with ONLY a JSON object (no markdown fences), exactly these keys:");
  lines.push('{');
  lines.push('  "headline": "<one punchy line — lead with the executive hook if one was given>",');
  lines.push('  "summary": "<2-3 sentences: profit health + the top moves, with numbers>",');
  lines.push(`  "keyStats": [{"label":"<e.g. Wasted ad spend>","value":"<e.g. ${sym}12,400 across 6 products — ALWAYS ${sym}, never $>"}],`);
  lines.push('  "insights": { "<BUCKET name, e.g. BLEEDER>": "<2-3 sentence section insight citing that segment\'s totals>", ... one entry per segment listed above ... },');
  lines.push('  "quickWins": ["<short do-this-today bullet>", "..."]');
  lines.push('}');
  return lines.join("\n");
}

// ── Actions calls: one per chunk of ~90 products, run in parallel ───────────────────────────────

function buildActionsPrompt(input: AdvisorInput, chunk: AdvisorListedProduct[]): string {
  const sym = currencySymbol(input.currency);
  const present = [...new Set(chunk.map((p) => p.bucket))];
  const lines: string[] = [];
  lines.push("You are a senior e-commerce profit consultant writing PER-PRODUCT actions for a Shopify merchant's P&L plan. (Headline/summary are produced separately — actions only.)");
  lines.push("");
  lines.push(groundingBlock(input));
  lines.push("");
  lines.push(currencyBlock(input, sym));
  lines.push("");
  lines.push(benchmarksBlock(input, sym));
  lines.push("");
  lines.push("Each product below was pre-assigned a FINAL bucket by our deterministic screening engine — do not reclassify. Bucket meanings:");
  for (const b of present) lines.push(`- ${b}: ${BUCKET_DEFINITIONS[b]}`);
  lines.push("");
  lines.push(`PRODUCTS (${chunk.length} products; format: [id] BUCKET | confidence | title | metrics):`);
  for (const p of chunk) lines.push(productLine(sym, p));
  lines.push("");
  lines.push("RULES (a response violating any of these is invalid):");
  lines.push(`1. COMPLETENESS CONTRACT: every id listed above (${chunk[0].pid}…${chunk[chunk.length - 1].pid}) MUST get exactly ONE action. Omitting or duplicating an id makes the response invalid.`);
  lines.push("2. EVERY action's reason must cite at least TWO exact figures from that product's data line (e.g. \"ad spend " + sym + "4,200 for 0 orders in 312 clicks\").");
  lines.push(`3. IMPACT as a dual number with the arithmetic visible, e.g. "−${sym}8,000/mo revenue but +${sym}12,500/mo profit (ad spend ${sym}12,500 saved vs ${sym}8,000 delivered revenue lost)". State BOTH what the merchant gives up AND what they gain.`);
  lines.push("4. CONFIDENCE: a low-confidence product may only get reversible actions (pause/test/gather data) — never discontinue or a permanent price change.");
  lines.push("5. The action must FIT the product's bucket, and be SPECIFIC to the numbers:");
  if (present.includes("MARGIN_IMPOSSIBLE")) lines.push(`   - MARGIN_IMPOSSIBLE: state the exact breakeven price (unit cost + shipping/order + fees) and recommend raising to at least breakeven +10%, or delisting if the market won't bear it.`);
  if (present.includes("WINNER")) lines.push(`   - WINNER: name a concrete daily ad budget for THIS product (e.g. scale from its current spend at its ROAS: "raise to ~${sym}X/day") and the expected extra revenue at its current ROAS. Cite its ROAS vs beROAS headroom when present.`);
  if (present.includes("HIDDEN_GEM")) lines.push(`   - HIDDEN_GEM: name a small concrete daily test budget (e.g. "${sym}100-200/day in a dedicated Hidden Gems campaign") and what its margin makes that worth.`);
  if (present.includes("RAISE_PRICE")) lines.push(`   - RAISE_PRICE: name the exact new price to test (e.g. "+7% → ${sym}X") and the pure-margin gain at current volume.`);
  if (present.includes("PRICE_TEST")) lines.push(`   - PRICE_TEST: name the exact lower price to test and the conversion rate it needs to pay back.`);
  if (present.includes("BLEEDER")) lines.push("   - BLEEDER: pause/exclude from ads; state the monthly spend saved.");
  lines.push("");
  lines.push('Respond with ONLY JSON (no markdown fences): {"actions":[{"id":"P7","product":"<product title>","recommendation":"<what to do>","reason":"<cites ≥2 figures>","impact":"<dual number with arithmetic>"}]}');
  lines.push("Order actions by impact (biggest first). Keep wording practical and concise.");
  return lines.join("\n");
}

function str(v: any, fallback = ""): string { return typeof v === "string" ? v : (v == null ? fallback : String(v)); }

/**
 * Extract a canonical pid ("P7") from whatever the model wrote ("P7", "p07", "[P7]", "P7 — title",
 * bare "7"). A strip-everything normalizer is DANGEROUS here: "P7 — Blue Shirt 2XL" would strip to
 * "P72" — a *different* valid id — silently corrupting the coverage check in both directions.
 */
function pidOf(v: any): string | undefined {
  const s = str(v).trim().toUpperCase();
  const m = s.match(/^\[?\s*P\s*0*(\d+)\s*\]?/);
  if (m) return `P${m[1]}`;
  if (/^\d+$/.test(s)) return `P${Number(s)}`;
  return undefined;
}

const normTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function deterministicAction(p: AdvisorListedProduct): AdvisorAction {
  return { id: p.pid, product: p.title, recommendation: FALLBACK_RECOMMENDATION[p.bucket], reason: p.bucketReason, impact: undefined };
}

/** Parse a chunk response's actions into pid → action, accepting only ids from THIS chunk.
 *  Accepts {"actions":[…]} AND a bare top-level array (models emit both shapes). */
function parseChunkActions(j: any, chunk: AdvisorListedProduct[]): Map<string, AdvisorAction> {
  const valid = new Map(chunk.map((p) => [p.pid, p]));
  const byTitle = new Map(chunk.map((p) => [normTitle(p.title), p]));
  const out = new Map<string, AdvisorAction>();
  const actions: any[] = Array.isArray(j) ? j : (Array.isArray(j?.actions) ? j.actions : []);
  for (const a of actions) {
    const pid = pidOf(a?.id);
    const product = (pid && valid.get(pid)) || byTitle.get(normTitle(str(a?.product)));
    if (!product || out.has(product.pid)) continue;
    out.set(product.pid, {
      id: product.pid,
      product: product.title,
      recommendation: str(a?.recommendation),
      reason: str(a?.reason),
      impact: str(a?.impact) || undefined,
    });
  }
  return out;
}

/**
 * Last-ditch parse: when the WHOLE response fails JSON.parse (models occasionally emit one broken
 * escape/lone surrogate mid-document, killing an otherwise-valid 30k-char payload), scan for
 * individual `{"id": …}` objects and parse each one independently — corruption then costs the one
 * broken action instead of the entire chunk.
 */
function salvageActionObjects(text: string): any[] {
  const out: any[] = [];
  const re = /\{\s*"id"\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && out.length < 400) {
    const start = m.index;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try { out.push(JSON.parse(text.slice(start, i + 1))); } catch { /* this one is the broken one — skip */ }
          re.lastIndex = i + 1;
          break;
        }
      }
    }
  }
  return out;
}

/** Chunk-response parsing with layered fallbacks: whole-JSON → per-object salvage. */
function parseActionsLoose(text: string, chunk: AdvisorListedProduct[], label: string): Map<string, AdvisorAction> {
  let actions = parseChunkActions(extractJson(text), chunk);
  if (actions.size === 0 && text.length > 500) {
    const salvaged = salvageActionObjects(text);
    actions = parseChunkActions(salvaged, chunk);
    if (actions.size > 0) console.warn(`[profit-advisor] ${label}: whole-JSON parse failed — salvaged ${actions.size} actions object-by-object`);
    else console.warn(`[profit-advisor] ${label}: 0/${chunk.length} actions matched from a ${text.length}-char response — head: ${text.slice(0, 300).replace(/\s+/g, " ")} … tail: ${text.slice(-300).replace(/\s+/g, " ")}`);
  }
  return actions;
}

const isBillingError = (e: any) => /Google AI \(Gemini\) credits|Google has DENIED/i.test(String(e?.message || e));

interface ChunkResult { actions: Map<string, AdvisorAction>; model?: string; missing: number; repaired: number; fallback: number }

/** One chunk: model call → parse → grounding scrub → coverage repair → deterministic fallback. */
async function runActionsChunk(input: AdvisorInput, chunk: AdvisorListedProduct[], callOpts: any, label: string): Promise<ChunkResult> {
  const byPid = new Map(chunk.map((p) => [p.pid, p]));
  let actions = new Map<string, AdvisorAction>();
  let model: string | undefined;
  // Low thinking: writing action lines from pre-computed buckets is mechanical — without this,
  // Gemini 3's dynamic thinking has eaten the whole output budget (MAX_TOKENS truncation).
  const chunkOpts = { ...callOpts, lowThinking: true };
  try {
    const prompt = buildActionsPrompt(input, chunk);
    const t0 = Date.now();
    const res = await geminiGenerateDetailed(chunkOpts, prompt);
    model = res.model;
    console.log(`[profit-advisor] ${label}: ${chunk.length} products, model=${res.model}, ${Math.round((Date.now() - t0) / 1000)}s, ${res.text.length} chars`);
    actions = parseActionsLoose(res.text, chunk, label);
  } catch (e: any) {
    if (isBillingError(e)) throw e; // actionable account-level failure — surface it
    console.error(`[profit-advisor] ${label} failed (falling back to deterministic actions):`, String(e?.message || e).slice(0, 200));
  }

  // Grounding scrub: an action containing stale-world-knowledge language is swapped for the
  // deterministic fallback (its reason IS the screening arithmetic — always safe).
  for (const [pid, a] of actions) {
    if (STALE_CLAIMS.test(`${a.recommendation} ${a.reason} ${a.impact || ""}`)) {
      const p = byPid.get(pid)!;
      console.warn(`[profit-advisor] ${label}: stale-knowledge claim on ${pid} — replaced with deterministic action`);
      actions.set(pid, deterministicAction(p));
    }
  }

  // Coverage: one repair call for missing ids, then deterministic fallback for the rest.
  let missingRows = chunk.filter((p) => !actions.has(p.pid));
  const missing = missingRows.length;
  let repaired = 0;
  if (missingRows.length > 0) {
    console.warn(`[profit-advisor] ${label}: ${missingRows.length}/${chunk.length} ids missing — issuing repair call`);
    try {
      const sym = currencySymbol(input.currency);
      const repairPrompt = [
        groundingBlock(input), "",
        `You produced per-product profit actions but OMITTED these ${missingRows.length} products. Write the missing action items now.`,
        `All amounts in ${input.currency} (${sym}). Each action's reason must cite ≥2 exact figures; impact is a dual number with arithmetic.`,
        "", ...missingRows.map((p) => productLine(sym, p)), "",
        'Respond with ONLY JSON: {"actions":[{"id":"<Pxx>","product":"<title>","recommendation":"…","reason":"…","impact":"…"}]}',
      ].join("\n");
      const rep = await geminiGenerateDetailed(chunkOpts, repairPrompt);
      const repActions = parseActionsLoose(rep.text, missingRows, `${label} repair`);
      for (const [pid, a] of repActions) { actions.set(pid, a); repaired++; }
    } catch (e: any) {
      if (isBillingError(e)) throw e;
      console.error(`[profit-advisor] ${label} repair failed:`, String(e?.message || e).slice(0, 200));
    }
  }
  missingRows = chunk.filter((p) => !actions.has(p.pid));
  for (const p of missingRows) actions.set(p.pid, deterministicAction(p));
  return { actions, model, missing, repaired, fallback: missingRows.length };
}

// ── Overview parsing + deterministic fallback ───────────────────────────────────────────────────

interface Overview { headline: string; summary: string; keyStats: { label: string; value: string }[]; insights: Record<string, string>; quickWins: string[] }

function parseOverview(j: any): Overview | null {
  if (!j) return null;
  return {
    headline: str(j.headline),
    summary: str(j.summary),
    keyStats: Array.isArray(j.keyStats) ? j.keyStats.slice(0, 6).map((k: any) => ({ label: str(k?.label), value: str(k?.value) })) : [],
    insights: j.insights && typeof j.insights === "object"
      ? Object.fromEntries(Object.entries(j.insights).map(([k, v]) => [k.toUpperCase().trim(), str(v)]))
      : {},
    quickWins: Array.isArray(j.quickWins) ? j.quickWins.slice(0, 8).map((q: any) => str(q)).filter(Boolean) : [],
  };
}

/** A fully deterministic executive layer — used when the overview call fails outright. */
function deterministicOverview(input: AdvisorInput, aggs: BucketAgg[]): Overview {
  const sym = currencySymbol(input.currency);
  const money = (n: number) => `${sym}${Math.round(n).toLocaleString()}`;
  const bleed = aggs.find((a) => a.bucket === "BLEEDER");
  const gems = aggs.find((a) => a.bucket === "HIDDEN_GEM");
  const winners = aggs.find((a) => a.bucket === "WINNER");
  const keyStats: { label: string; value: string }[] = [];
  if (bleed) keyStats.push({ label: "Bleeding ad spend", value: `${money(bleed.adSpend)} across ${bleed.count} products` });
  if (winners) keyStats.push({ label: "Winner profit", value: `${money(winners.profit)} from ${winners.count} products` });
  if (gems) keyStats.push({ label: "Hidden gems", value: `${gems.count} high-margin products starved of traffic` });
  keyStats.push({ label: "Net profit (window)", value: money(input.totals.profit) });
  const insights = Object.fromEntries(aggs.map((a) => [a.bucket,
    `${a.count} product${a.count === 1 ? "" : "s"} in this segment — combined ad spend ${money(a.adSpend)}, revenue ${money(a.revenue)}, profit ${money(a.profit)}.`]));
  const quickWins: string[] = [];
  if (bleed && bleed.adSpend > 0) quickWins.push(`Pause ads on the ${bleed.count} bleeding products to stop ${money(bleed.adSpend)} of unproductive spend.`);
  if (gems) quickWins.push(`Give the ${gems.count} hidden gems a small dedicated ad budget — their margins already work.`);
  if (winners) quickWins.push(`Shift freed budget to the ${winners.count} proven winners (${money(winners.profit)} profit).`);
  return {
    headline: input.hook
      ? `Your #${input.hook.revRank} product by revenue ranks #${input.hook.profitRank} by profit — fix the gap to protect ${money(input.totals.profit)}.`
      : `Protect ${money(input.totals.profit)} net profit: ${bleed ? `stop ${money(bleed.adSpend)} of ad bleed` : "tune the flagged products"} and scale what works.`,
    summary: `Deterministic screening covered all ${input.stats.products} products. ${bleed ? `${bleed.count} are bleeding ad spend (${money(bleed.adSpend)}); ` : ""}${winners ? `${winners.count} winners drive ${money(winners.profit)} profit; ` : ""}${gems ? `${gems.count} high-margin products are starved of exposure.` : ""}`,
    keyStats, insights, quickWins,
  };
}

// ── Orchestration ───────────────────────────────────────────────────────────────────────────────

export async function runProfitAdvisor(input: AdvisorInput): Promise<{ ok: boolean; report?: AdvisorReport; model?: string; error?: string; coverage?: { expected: number; missingAfterModel: number; repaired: number; fallback: number } }> {
  try {
    const genCfg = { generationConfig: { temperature: 0.3, responseMimeType: "application/json", maxOutputTokens: 65536 } };
    const callOpts = { models: advisorModels(), retryBusyMs: 8000, busyRetries: 2, config: genCfg };
    const aggs = bucketAggregates(input);

    // Chunk the (bucket-sorted) product list; all chunks + the overview run IN PARALLEL, so wall
    // time ≈ the slowest small call instead of one giant serial generation.
    const chunks: AdvisorListedProduct[][] = [];
    for (let i = 0; i < input.products.length; i += CHUNK_SIZE) chunks.push(input.products.slice(i, i + CHUNK_SIZE));
    console.log(`[profit-advisor] ${input.products.length} products → ${chunks.length} parallel action calls (+1 overview), models=${advisorModels().join(",")}`);

    const overviewPromise = (async (): Promise<{ ov: Overview; model?: string }> => {
      try {
        const prompt = buildOverviewPrompt(input, aggs);
        let res = await geminiGenerateDetailed(callOpts, prompt);
        let ov = parseOverview(extractJson(res.text));
        // Grounding guard on the executive layer: one regeneration, then deterministic fallback.
        if (ov && STALE_CLAIMS.test(JSON.stringify(ov))) {
          console.warn("[profit-advisor] overview contains a stale-knowledge claim — regenerating once");
          const res2 = await geminiGenerateDetailed(callOpts, prompt + "\n\nYOUR PREVIOUS ATTEMPT WAS REJECTED for referencing product launches/releases. Every product is REAL and CURRENTLY SOLD. Do not mention launches, releases or availability at all.");
          const ov2 = parseOverview(extractJson(res2.text));
          if (ov2 && !STALE_CLAIMS.test(JSON.stringify(ov2))) { ov = ov2; res = res2; }
          else ov = null;
        }
        if (!ov || (!ov.headline && !ov.summary)) return { ov: deterministicOverview(input, aggs), model: res.model };
        return { ov, model: res.model };
      } catch (e: any) {
        if (isBillingError(e)) throw e;
        console.error("[profit-advisor] overview call failed (using deterministic overview):", String(e?.message || e).slice(0, 200));
        return { ov: deterministicOverview(input, aggs) };
      }
    })();

    const [{ ov, model: ovModel }, ...chunkResults] = await Promise.all([
      overviewPromise,
      ...chunks.map((c, i) => runActionsChunk(input, c, callOpts, `chunk ${i + 1}/${chunks.length}`)),
    ]);

    // Assemble: fixed section taxonomy, actions in listing order (already impact-sorted per bucket).
    const actionByPid = new Map<string, AdvisorAction>();
    for (const cr of chunkResults) for (const [pid, a] of cr.actions) actionByPid.set(pid, a);
    const byBucket = new Map<Bucket, AdvisorAction[]>();
    for (const p of input.products) {
      const a = actionByPid.get(p.pid) || deterministicAction(p);
      if (!byBucket.has(p.bucket)) byBucket.set(p.bucket, []);
      byBucket.get(p.bucket)!.push(a);
    }
    const overflowByBucket = new Map(input.overflow.map((o) => [o.bucket, o]));
    const sym = currencySymbol(input.currency);
    // A bucket earns a section when it has LISTED products OR an overflow aggregate — a lever must
    // never disappear just because its products didn't make the individual-listing cap.
    const sections: AdvisorSection[] = SECTION_ORDER
      .filter((b) => byBucket.has(b) || (overflowByBucket.get(b)?.count || 0) > 0)
      .map((b) => {
        const agg = aggs.find((a) => a.bucket === b);
        const o = overflowByBucket.get(b);
        let insight = ov.insights[b] || (agg ? `${agg.count} products — combined ad spend ${sym}${agg.adSpend}, revenue ${sym}${agg.revenue}, profit ${sym}${agg.profit}.` : "");
        const actions = byBucket.get(b) || [];
        if (o && o.count > 0) {
          if (b === "BLEEDER") {
            // The long tail of tiny spenders gets ONE bulk action, not per-product busywork.
            actions.push({
              product: `${o.count} low-spend bleeding products (long tail)`,
              recommendation: "Exclude them from ad campaigns in one bulk move — select them on Price Radar and Mark as Draft, or let the AI Campaign Planner quarantine them automatically.",
              reason: `individually small but combined ad spend ${sym}${o.adSpend} for profit ${sym}${o.profit} in this window`,
              impact: `+${sym}${Math.abs(o.profit)}/mo profit recovered for zero revenue loss (they produced ${sym}${o.revenue})`,
            });
          } else if (!/more .* beyond|not listed/i.test(insight)) {
            insight += ` (${o.count} more ${b.replace(/_/g, " ").toLowerCase()} products beyond the listed ones are included in this segment's totals: ad spend ${sym}${o.adSpend}, profit ${sym}${o.profit}.)`;
          }
        }
        return { title: SECTION_FOR_BUCKET[b], priority: PRIORITY_FOR_BUCKET[b], insight, actions };
      });
    if (input.zombies.count > 0) {
      sections.push({
        title: SECTION_FOR_BUCKET.ZOMBIE, priority: "low",
        insight: ov.insights.ZOMBIE || `${input.zombies.count} products had effectively no traffic (${input.zombies.sessions} total sessions). Leave them to the catch-all campaign; revisit any that start getting sessions.`,
        actions: [],
      });
    }

    const report0: AdvisorReport = {
      headline: ov.headline || "Profit opportunities in your catalogue",
      summary: ov.summary,
      keyStats: ov.keyStats,
      sections,
      quickWins: ov.quickWins.filter((q) => !STALE_CLAIMS.test(q)),
    };
    const report = fixCurrencyDeep(report0, input.currency);

    const coverage = {
      expected: input.products.length,
      missingAfterModel: chunkResults.reduce((s, c) => s + c.missing, 0),
      repaired: chunkResults.reduce((s, c) => s + c.repaired, 0),
      fallback: chunkResults.reduce((s, c) => s + c.fallback, 0),
    };
    const model = ovModel || chunkResults.find((c) => c.model)?.model;
    console.log(`[profit-advisor] assembled: ${sections.length} sections, ${input.products.length} actions; coverage=${JSON.stringify(coverage)}; model=${model}`);
    if (!report.sections.length) return { ok: false, error: "The AI returned an empty analysis. Please try again." };
    return { ok: true, report, model, coverage };
  } catch (e: any) {
    const msg = String(e?.message || e);
    console.error("[profit-advisor] failed:", msg);
    // Billing exhaustion is actionable — surface it verbatim instead of the generic message.
    if (isBillingError(e)) return { ok: false, error: msg };
    return { ok: false, error: "The profit analysis couldn't be generated right now. Please try again in a moment." };
  }
}
