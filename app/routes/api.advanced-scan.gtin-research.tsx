import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { retryOperation } from "../utils/retry.js";
import { incrementProductUsage, getOrCreateSubscription, getProductsUsed, getEffectiveProductLimit } from "../utils/billing.server";

// 1 credit per 5 products (min 1) — same formula used across all scan fixes
function calcResearchCredits(productCount: number): number {
  return Math.max(1, Math.ceil(productCount / 5));
}

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);

function buildResearchPrompt(
  directory: string,
  products: Array<{ id: string; title: string; mpn?: string }>,
  existingGtins: string[]
): string {
  const list = products
    .map(p => `{"id":"${p.id}","title":${JSON.stringify(p.title)}${p.mpn ? `,"mpn":${JSON.stringify(p.mpn)}` : ""}}`)
    .join(",\n");

  const existingNote = existingGtins.length
    ? `\nDO NOT USE these GTINs — already in use by other products in this store:\n[${existingGtins.map(g => `"${g}"`).join(", ")}]\n`
    : "";

  const hint =
    directory === "electronics"
      ? "Focus on consumer electronics: phones, laptops, tablets, TVs, cameras, accessories."
      : directory === "apparel"
      ? "Focus on apparel, footwear, and fashion: clothing, shoes, bags, sportswear."
      : directory === "food"
      ? "Focus on food and grocery: packaged foods, beverages, supplements, health products."
      : "Use broad retail knowledge across all categories.";

  return `You are a GTIN/barcode research specialist. ${hint}
${existingNote}
For each product below, try to find its GTIN (EAN-13 or UPC-12) using two strategies:

STRATEGY 1 — EXACT MATCH: Find the precise GTIN for this exact product (specific model, variant, SKU).
STRATEGY 2 — NEAREST MATCH: If exact not found, find the GTIN of the most closely related product in the same brand/product family/series. This is a fallback — mark it clearly.

RULES:
1. Never invent or randomly guess a GTIN. Only return GTINs you have genuine knowledge of.
2. Never return a GTIN from the "already in use" list above.
3. If you find neither exact nor nearest, set gtin to null.
4. Response MUST be valid JSON only — no markdown, no extra text.

PRODUCTS:
[${list}]

Return ONLY this JSON:
{"results":[{
  "id":"...",
  "gtin":"13-digit-or-null",
  "confidence":"high|medium|low",
  "is_nearest":false,
  "nearest_note":"Only set if is_nearest=true — describe the related product this GTIN belongs to",
  "source":"Brief note: how you found this"
}]}`;
}

export async function action({ request }: ActionFunctionArgs) {
  const bodyClone = request.clone();
  const { session } = await authenticate.admin(request);
  if (!session) return json({ error: "Unauthorized" }, { status: 401 });

  const {
    products,
    directory = "general",
    existingGtins = [],
  } = await bodyClone.json() as {
    products: Array<{ id: string; title: string; mpn?: string }>;
    directory?: string;
    existingGtins?: string[];
  };

  if (!products?.length) return json({ error: "products array is required." }, { status: 400 });

  const creditsNeeded = calcResearchCredits(products.length);

  // Credit check
  const subscription = await getOrCreateSubscription(session.shop);
  const used = getProductsUsed(subscription);
  const limit = getEffectiveProductLimit(subscription);
  if (used + creditsNeeded > limit) {
    return json({
      error: `Not enough credits. This search costs ${creditsNeeded} credit${creditsNeeded > 1 ? "s" : ""} (${products.length} product${products.length > 1 ? "s" : ""} × 1 credit per 5). You have ${limit - used} remaining.`,
    }, { status: 402 });
  }

  // Food: try Open Food Facts live API first
  if (directory === "food") {
    try {
      const foodResults = await Promise.all(
        products.slice(0, 10).map(async (p) => {
          try {
            const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(p.title)}&search_simple=1&action=process&json=1&page_size=3`;
            const res = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { "User-Agent": "ShopFlixAI/1.0" } });
            if (!res.ok) return { id: p.id, gtin: null, confidence: "low", is_nearest: false, source: "Open Food Facts: no result" };
            const data: any = await res.json();
            // Pick first result whose barcode is not in existing list
            const match = (data?.products || []).find((prod: any) => prod.code && !existingGtins.includes(prod.code));
            if (match) {
              const isExact = match.product_name?.toLowerCase().includes(p.title.split(" ")[0].toLowerCase());
              return {
                id: p.id,
                gtin: match.code,
                confidence: isExact ? "medium" : "low",
                is_nearest: !isExact,
                nearest_note: !isExact ? `Related product: "${match.product_name}"` : undefined,
                source: `Open Food Facts: "${match.product_name}"`,
              };
            }
            return { id: p.id, gtin: null, confidence: "low", is_nearest: false, source: "Open Food Facts: no match" };
          } catch {
            return { id: p.id, gtin: null, confidence: "low", is_nearest: false, source: "Open Food Facts: timeout" };
          }
        })
      );
      for (let i = 0; i < creditsNeeded; i++) await incrementProductUsage(session.shop);
      return json({ success: true, results: foodResults, creditsUsed: creditsNeeded, directory });
    } catch { /* fall through to AI */ }
  }

  // All directories: AI research
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
  });

  const prompt = buildResearchPrompt(directory, products, existingGtins);

  try {
    const aiText = await retryOperation(async () => {
      const result = await Promise.race([
        model.generateContent(prompt),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("AI timed out")), 60000)),
      ]);
      return (await (result as any).response).text();
    }, 2, 1000, "gtin-research");

    const start = aiText.indexOf("{");
    const end = aiText.lastIndexOf("}");
    const parsed = JSON.parse(aiText.substring(start, end + 1));

    // Server-side duplicate guard: strip any result whose GTIN is already in existingGtins
    const results = (parsed.results || []).map((r: any) => {
      if (r.gtin && existingGtins.includes(r.gtin)) {
        return { ...r, gtin: null, confidence: "low", source: `${r.source} [GTIN removed — duplicate]` };
      }
      return r;
    });

    for (let i = 0; i < creditsNeeded; i++) await incrementProductUsage(session.shop);
    return json({ success: true, results, creditsUsed: creditsNeeded, directory });
  } catch (err: any) {
    return json({ error: `Research failed: ${err.message}` }, { status: 500 });
  }
}
