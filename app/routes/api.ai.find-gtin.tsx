import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { retryOperation } from "../utils/retry.js";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);

/**
 * Fetch all barcodes already in use by the merchant's store (paginates up to 5 pages / 1250 products).
 * Returns a Set of non-empty barcode strings.
 */
async function fetchStoreBarcodes(admin: any): Promise<Set<string>> {
  const barcodes = new Set<string>();
  let cursor: string | null = null;
  let hasNextPage = true;
  let page = 0;
  const MAX_PAGES = 5;

  while (hasNextPage && page < MAX_PAGES) {
    const afterClause = cursor ? `, after: "${cursor}"` : '';
    const response = await admin.graphql(`#graphql
      query storeBarcodes {
        products(first: 250${afterClause}) {
          pageInfo { hasNextPage endCursor }
          nodes {
            variants(first: 10) {
              nodes { barcode }
            }
          }
        }
      }
    `);
    const data = await response.json();
    const products = data?.data?.products;
    if (!products) break;

    for (const product of products.nodes) {
      for (const variant of product.variants.nodes) {
        if (variant.barcode && variant.barcode.trim()) {
          barcodes.add(variant.barcode.trim());
        }
      }
    }

    hasNextPage = products.pageInfo.hasNextPage;
    cursor = products.pageInfo.endCursor;
    page++;
  }

  return barcodes;
}

/**
 * Search UPCitemdb free API for a product by name.
 * Returns the best-matching GTIN string, or null if nothing useful found.
 */
async function searchUpcItemDb(query: string): Promise<string | null> {
  try {
    const encoded = encodeURIComponent(query);
    const res = await fetch(`https://api.upcitemdb.com/prod/trial/search?s=${encoded}&type=product`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const items: any[] = data?.items ?? [];
    if (!items.length) return null;

    // Prefer EAN-13 or UPC-A (12-digit) codes; skip anything that looks fake
    for (const item of items) {
      const candidates: string[] = [
        item.ean,
        item.upc,
        ...(item.offers?.map((o: any) => o.merchant_barcode) ?? []),
      ].filter(Boolean);

      for (const code of candidates) {
        const clean = String(code).replace(/\D/g, '');
        if (clean.length === 12 || clean.length === 13 || clean.length === 14) {
          return clean;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Use Gemini to infer a GTIN from richer product context.
 * Explicitly tells the model it may suggest a likely GTIN from its training data
 * but MUST mark it as estimated if not certain.
 */
async function geminiGtinLookup(
  title: string,
  brand: string,
): Promise<{ gtin: string | null; confidence: 'high' | 'low' | 'none' }> {
  const model = genAI.getGenerativeModel({
    model: (process.env.GEMINI_TEXT_MODEL || "gemini-3.1-flash-lite"),
    generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
  });

  const prompt = `
You are a product data expert with access to a large knowledge base of retail products and their GTINs (UPC, EAN, ISBN, JAN codes).

Your task: identify the most likely GTIN for this product.

Product Title: "${title}"
Brand: "${brand || 'Unknown'}"

Instructions:
- A GTIN is a 12-digit UPC-A, 13-digit EAN-13, or 14-digit GTIN-14 numeric code.
- Search your knowledge for this exact product model and its known barcode.
- If you are CONFIDENT (>85% sure) you know the real GTIN for this specific model, return it with confidence "high".
- If you can find a GTIN for a very similar product from the same brand/model family (e.g., different color variant), return it with confidence "low" and note it is an approximation.
- If you truly cannot find any reliable GTIN, return gtin: null and confidence: "none". Do NOT invent numbers.

Respond ONLY with a JSON object:
{
  "gtin": "<numeric string or null>",
  "confidence": "high" | "low" | "none",
  "note": "<short explanation of where this came from, or why null>"
}`;

  try {
    const aiResponseText = await retryOperation(async () => {
      const result = await Promise.race([
        model.generateContent(prompt),
        new Promise((_, reject) => setTimeout(() => reject(new Error('AI timed out')), 60000)),
      ]);
      return (await (result as any).response).text();
    }, 3, 1000, title);

    const start = aiResponseText.indexOf('{');
    const end = aiResponseText.lastIndexOf('}');
    const parsed = JSON.parse(aiResponseText.substring(start, end + 1));
    const rawGtin = parsed.gtin ? String(parsed.gtin).replace(/\D/g, '') : null;
    const validGtin = rawGtin && (rawGtin.length === 12 || rawGtin.length === 13 || rawGtin.length === 14)
      ? rawGtin
      : null;
    return { gtin: validGtin, confidence: parsed.confidence ?? (validGtin ? 'low' : 'none') };
  } catch {
    return { gtin: null, confidence: 'none' };
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  if (!session) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const productString = url.searchParams.get("product");
  if (!productString) {
    return json({ error: "Product data is missing" }, { status: 400 });
  }

  let product: { id: string; title: string; brand?: string; existingBarcode?: string };
  try {
    product = JSON.parse(decodeURIComponent(productString));
  } catch {
    return json({ error: "Invalid product JSON" }, { status: 400 });
  }

  const { title, brand = '', existingBarcode = '' } = product;

  // ── Step 1: Fetch all barcodes already used in this store ──────────────────
  let storeBarcodes: Set<string>;
  try {
    storeBarcodes = await fetchStoreBarcodes(admin);
  } catch {
    storeBarcodes = new Set();
  }

  // If the existing barcode is already in the store (from THIS product) that's fine —
  // remove it from the conflict set since we're evaluating it for THIS product.
  if (existingBarcode) storeBarcodes.delete(existingBarcode.trim());

  const isConflict = (gtin: string) => storeBarcodes.has(gtin.trim());

  // ── Step 2: Try UPCitemdb ──────────────────────────────────────────────────
  const searchQuery = brand ? `${brand} ${title}` : title;
  let foundGtin: string | null = null;
  let source: string = 'none';
  let confidence: string = 'none';
  let conflictDetected = false;

  const upcResult = await searchUpcItemDb(searchQuery);
  if (upcResult) {
    if (!isConflict(upcResult)) {
      foundGtin = upcResult;
      source = 'upcitemdb';
      confidence = 'high';
    } else {
      // Found via API but conflicts with an existing product — still report it
      foundGtin = upcResult;
      source = 'upcitemdb';
      confidence = 'high';
      conflictDetected = true;
    }
  }

  // ── Step 3: If UPCitemdb found nothing, try brand-only search ─────────────
  if (!foundGtin && brand && brand !== title) {
    const brandResult = await searchUpcItemDb(`${brand} ${title.split(' ').slice(0, 4).join(' ')}`);
    if (brandResult && !isConflict(brandResult)) {
      foundGtin = brandResult;
      source = 'upcitemdb_approx';
      confidence = 'low';
    }
  }

  // ── Step 4: Gemini fallback ────────────────────────────────────────────────
  if (!foundGtin || conflictDetected) {
    const geminiResult = await geminiGtinLookup(title, brand);
    if (geminiResult.gtin) {
      if (!isConflict(geminiResult.gtin)) {
        if (!foundGtin) {
          foundGtin = geminiResult.gtin;
          source = 'ai';
          confidence = geminiResult.confidence;
          conflictDetected = false;
        }
      } else if (!foundGtin) {
        // Gemini found something but it conflicts too
        foundGtin = geminiResult.gtin;
        source = 'ai';
        confidence = geminiResult.confidence;
        conflictDetected = true;
      }
    }
  }

  // ── Step 5: Build a user-friendly message ──────────────────────────────────
  let message: string;
  if (!foundGtin) {
    message = "No GTIN could be found for this product. You may need to check the manufacturer's website or use an external GTIN database.";
  } else if (conflictDetected) {
    message = `A GTIN was found (${foundGtin}) but it is already assigned to another product in your store. Please verify manually.`;
  } else if (confidence === 'high') {
    message = `GTIN found via product database (${source === 'upcitemdb' ? 'UPCitemdb' : 'AI'}) with high confidence.`;
  } else {
    message = `An approximate GTIN was found (similar product family). Please verify before submitting to Google Merchant Center.`;
  }

  return json({
    gtin: foundGtin,
    confidence,
    source,
    conflictDetected,
    message,
    storeBarcodesChecked: storeBarcodes.size,
  });
}
