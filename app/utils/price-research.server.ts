/**
 * Price Radar — competitive-price research engine.
 *
 * Uses Gemini WITH Google Search grounding to find what other stores currently charge and
 * recommend a competitive price. The model id is env-configurable (GEMINI_PRICE_MODEL) and
 * defaults to a known-good id — so a future "batch" model / "Gemini 3.1 Flash" can be
 * swapped in without a code change, and a wrong id can't hard-break the feature.
 *
 * Grounding note: if the runtime model/SDK rejects the googleSearch tool, we retry once
 * WITHOUT grounding (model knowledge only) and mark confidence "low" so callers can tell
 * the price is approximate rather than market-sourced.
 */
import { geminiGenerateText, extractJson } from "./gemini.server";

export const SINGLE_CREDIT = 1;

/**
 * Bulk credit cost — flat per-batch tiers with a built-in volume discount.
 * 1–50 → 5, 51–100 → 10, 101–250 → 20, 251–500 → 35, then +5 per extra 100.
 */
export function bulkCreditCost(n: number): number {
  if (n <= 0) return 0;
  if (n <= 50) return 5;
  if (n <= 100) return 10;
  if (n <= 250) return 20;
  if (n <= 500) return 35;
  return 35 + Math.ceil((n - 500) / 100) * 5;
}

export interface PriceResearchInput {
  title: string;
  vendor?: string;
  productType?: string;
  currentPrice: number;
  currency: string;
  barcode?: string | null;
  sku?: string | null;
}

export interface PriceResearchResult {
  researchedPrice: number | null;
  currency: string;
  low: number | null;
  high: number | null;
  rationale: string;
  sources: string[];
  confidence: "high" | "medium" | "low" | null;
}

function num(v: any): number | null {
  const n = typeof v === "string" ? parseFloat(v.replace(/[^0-9.]/g, "")) : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function buildPrompt(input: PriceResearchInput): string {
  return [
    "You are a competitive-pricing analyst for an online store. Using live Google Search, find what",
    "INDEPENDENT third-party stores currently charge for this exact product (or the closest equivalent),",
    "then recommend a competitive selling price.",
    "",
    `Product: ${input.title}`,
    input.vendor ? `Brand/Vendor: ${input.vendor}` : "",
    input.productType ? `Type: ${input.productType}` : "",
    input.barcode ? `GTIN/Barcode: ${input.barcode}` : "",
    `Current price: ${input.currentPrice} ${input.currency}`,
    "",
    "CRITICAL — who counts as a competitor:",
    "- INCLUDE independent resellers, marketplaces and smaller online stores that actually compete on price.",
    "- EXCLUDE the brand's own/official store, the manufacturer's website, and authorized flagship sellers",
    "  (e.g. Apple, Samsung, the brand's own .com, official brand storefronts on marketplaces). They list at",
    "  full MSRP and are NOT a competitive benchmark — including them wrongly inflates the price. Mark any",
    '  such listing you cite with "official": true so it is excluded from the market range.',
    "- EXCLUDE listings that are clearly a different model / size / variant, and treat any single price sitting",
    "  far above the main cluster of sellers as an outlier (usually an official/MSRP price), not the market.",
    "",
    "How to price:",
    "- Base market_low, market_high and the suggestion ONLY on the competitive cluster of independent sellers.",
    "- Recommend a price at or slightly below the typical competitive price — attractive but not implausibly low.",
    `- Keep the same currency (${input.currency}); convert any listing quoted in another currency.`,
    '- If you cannot find at least two competitive listings, set suggested_price to null and confidence "low".',
    "",
    "Respond with ONLY a JSON object (no markdown), exactly these keys:",
    `{"suggested_price": <number|null>, "currency": "${input.currency}", "market_low": <number|null>,`,
    ' "market_high": <number|null>,',
    ' "competitors": [{"seller": "<store name>", "price": <number>, "official": <true|false>}, ...],',
    ' "rationale": "<one short sentence; note that official/brand MSRP prices were excluded>",',
    ' "confidence": "high|medium|low"}',
  ].filter(Boolean).join("\n");
}

/** Median of a numeric array (already sortable). */
function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function callGemini(prompt: string, grounded: boolean): Promise<string> {
  const config = grounded
    ? { tools: [{ googleSearch: {} }], generationConfig: { temperature: 0 } }
    : { generationConfig: { temperature: 0, responseMimeType: "application/json" } };
  return geminiGenerateText({ preferredModel: process.env.GEMINI_PRICE_MODEL, config }, prompt);
}

export async function researchCompetitivePrice(input: PriceResearchInput): Promise<PriceResearchResult> {
  const prompt = buildPrompt(input);
  let text = "";
  let grounded = true;
  try {
    text = await callGemini(prompt, true);
  } catch {
    grounded = false;
    try { text = await callGemini(prompt, false); } catch { text = ""; }
  }
  const j = extractJson(text) || {};
  let price = num(j.suggested_price);
  let low = num(j.market_low);
  let high = num(j.market_high);

  // Build the competitive cluster from the cited competitors, dropping official/brand sellers.
  const comps: any[] = Array.isArray(j.competitors) ? j.competitors : [];
  const competitive = comps
    .filter((c) => c && c.official !== true && String(c.seller || "").trim())
    .map((c) => ({ seller: String(c.seller).trim(), price: num(c.price) }))
    .filter((c): c is { seller: string; price: number } => c.price != null)
    .sort((a, b) => a.price - b.price);

  if (competitive.length >= 2) {
    let prices = competitive.map((c) => c.price);
    const med = median(prices);
    // Defensive: drop any straggler > 2× the median (an official/MSRP price the model didn't flag).
    prices = prices.filter((p) => p <= med * 2);
    const cMed = median(prices);
    low = prices[0];
    high = prices[prices.length - 1];
    // Clamp an inflated or missing suggestion down to the competitive median.
    if (price == null || price > high || price > cMed * 1.15) price = Math.round(cMed * 100) / 100;
  }

  // Prefer real competitor store names as the sources shown to the merchant.
  const sellerNames = [...new Set(competitive.map((c) => c.seller))].slice(0, 6);
  const sources = sellerNames.length
    ? sellerNames
    : Array.isArray(j.sources) ? j.sources.filter((s: any) => typeof s === "string").slice(0, 6) : [];

  let confidence = (["high", "medium", "low"].includes(j.confidence) ? j.confidence : null) as PriceResearchResult["confidence"];
  // Downgrade confidence when we couldn't ground on live search.
  if (!grounded && confidence && confidence !== "low") confidence = "medium";
  if (!grounded && !confidence) confidence = "low";
  return {
    researchedPrice: price,
    currency: (typeof j.currency === "string" && j.currency) || input.currency,
    low,
    high,
    rationale: typeof j.rationale === "string" ? j.rationale.slice(0, 300) : "",
    sources,
    confidence,
  };
}
