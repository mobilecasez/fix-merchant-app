import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { retryOperation } from "../utils/retry.js";
import { incrementProductUsage, getOrCreateSubscription, getProductsUsed, getEffectiveProductLimit } from "../utils/billing.server";
import prisma from "../db.server";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);

// ── Credit cost: 1 credit per 5 products (min 1) ─────────────────────────────
export function calcGroupFixCredits(productCount: number): number {
  return Math.max(1, Math.ceil(productCount / 5));
}

// ── Per-violation-type AI prompts ─────────────────────────────────────────────

function buildGroupFixPrompt(violationType: string, products: any[]): string {
  const productJson = JSON.stringify(products, null, 2);

  if (violationType.includes("Identifier") || violationType.includes("GTIN") || violationType.includes("identifier")) {
    return `You are a Google Merchant Center product compliance expert. You are given a list of products that are missing required identifiers (brand, GTIN, and/or MPN).

Your task: For EACH product, use your e-commerce knowledge of brands, product categories, and common GTINs/barcodes to suggest the best possible identifier values.

CRITICAL RULES:
1. NEVER invent a GTIN you are not reasonably confident about. If you're not sure, set gtin to null and explain why.
2. If you can identify a GTIN based on the product title/brand/model, provide it and set needs_verification to true — the merchant must verify it before submitting to GMC.
3. For brand: identify from product title or known product lines.
4. For MPN: use the product SKU if available, or derive from model number in the title.
5. Return ONLY a valid JSON object — no markdown fences, no extra text.

PRODUCTS:
${productJson}

OUTPUT FORMAT (return ONLY this JSON):
{
  "violation_type": "Missing Identifiers",
  "fixes": [
    {
      "product_id": "...",
      "product_title": "...",
      "suggested_brand": "Nike | null",
      "suggested_gtin": "0123456789012 | null",
      "suggested_mpn": "SKU-123 | null",
      "needs_verification": true,
      "confidence": "high | medium | low",
      "reasoning": "Brief explanation of how you identified these values.",
      "manual_steps": [
        "Step 1: Go to Shopify Admin → Products → [Product Title].",
        "Step 2: Scroll to the Inventory section and enter the GTIN/barcode.",
        "Step 3: Set the Vendor field to the brand name.",
        "Step 4: Click Save."
      ]
    }
  ]
}`;
  }

  if (violationType.includes("Pricing") || violationType.includes("pricing")) {
    return `You are a Google Merchant Center pricing compliance expert. You are given a list of products with deceptive pricing — their compare_at_price (MRP) is equal to or less than their sale price, which violates GMC policy.

Your task: For EACH product, suggest a safe, realistic compare_at_price that is strictly greater than the current price, consistent with typical retail margins (10–30% above sale price).

CRITICAL RULES:
1. The suggested compare_at_price MUST be strictly greater than price.
2. Keep margins realistic — typically 15–25% above the sale price.
3. Return ONLY a valid JSON object — no markdown fences, no extra text.

PRODUCTS:
${productJson}

OUTPUT FORMAT (return ONLY this JSON):
{
  "violation_type": "Deceptive Pricing Logic",
  "fixes": [
    {
      "product_id": "...",
      "product_title": "...",
      "current_price": 0.00,
      "current_compare_at_price": 0.00,
      "suggested_compare_at_price": 0.00,
      "reasoning": "Brief explanation (e.g., '20% above sale price is a realistic retail margin for this category').",
      "needs_verification": true,
      "manual_steps": [
        "Step 1: Go to Shopify Admin → Products → [Product Title].",
        "Step 2: Click on the variant or scroll to the Pricing section.",
        "Step 3: Set the 'Compare-at price' to the suggested value.",
        "Step 4: Ensure the Compare-at price is HIGHER than the selling price.",
        "Step 5: Click Save."
      ]
    }
  ]
}`;
  }

  if (violationType.includes("Description") || violationType.includes("Syntax") || violationType.includes("description")) {
    return `You are a senior e-commerce content strategist and Google Merchant Center compliance expert. You are given a list of Shopify products that are missing descriptions or have other mandatory attribute issues.

Your task: For EACH product, write a FULL, well-structured, Google Merchant Center compliant product description using the product title and your knowledge of the product category. The description must be ready to publish — not a placeholder.

STRICT WRITING RULES:
1. Write descriptions in MARKDOWN format. Use these exact markdown elements:
   - ## for section headings (e.g. ## About This Item, ## Key Features, ## What's Included)
   - **bold text** for important product keywords or specifications
   - * for bullet list items (unordered list)
   - Regular paragraphs for introductory and closing text

2. Structure EVERY description exactly like this:

   ## About This Item
   [2-3 sentences: what the product is, its primary purpose, and who it is for. Bold the product name and key descriptors.]

   ## Key Features
   * **[Feature name]**: [Brief explanation of benefit]
   * **[Feature name]**: [Brief explanation of benefit]
   * **[Feature name]**: [Brief explanation of benefit]
   * **[Feature name]**: [Brief explanation of benefit]
   * **[Feature name]**: [Brief explanation of benefit]

   ## What's Included
   * [Item 1]
   * [Item 2]

   [1-2 closing sentences about quality, ideal use case, or who will love this product.]

3. Write at least 150 words per description. Be specific and informative.
4. NEVER use promotional language: no "Buy now", "Order today", "Limited offer", "Don't miss out", "Best deal".
5. NEVER invent specific technical specs (exact dimensions, weight, wattage) unless clearly implied by the product name.
6. Return ONLY a valid JSON object — no extra text outside the JSON.

PRODUCTS:
${productJson}

OUTPUT FORMAT (return ONLY this JSON, with markdown in the suggested_description field):
{
  "violation_type": "Missing Description",
  "fixes": [
    {
      "product_id": "...",
      "product_title": "...",
      "suggested_description": "## About This Item\\n[intro paragraph with **bold keywords**]\\n\\n## Key Features\\n* **Feature**: explanation\\n* **Feature**: explanation\\n* **Feature**: explanation\\n* **Feature**: explanation\\n* **Feature**: explanation\\n\\n## What's Included\\n* Item 1\\n* Item 2\\n\\n[closing sentence]",
      "missing_fields": ["description"],
      "needs_verification": true,
      "manual_steps": [
        "Step 1: Go to Shopify Admin → Products → [Product Title].",
        "Step 2: Scroll to the Description section.",
        "Step 3: Review the AI-generated description and enrich it with product-specific specs or details you know.",
        "Step 4: Click Save."
      ]
    }
  ]
}`;
  }

  if (violationType.includes("Image") || violationType.includes("image")) {
    return `You are a Google Merchant Center image compliance expert. You are given a list of products with image policy violations — images are either too small (under 100x100px) or contain promotional overlays.

Your task: For EACH product, provide clear guidance on exactly what needs to be fixed for the image.

CRITICAL RULES:
1. Images cannot be auto-fixed by software — they require the merchant to upload new images.
2. Provide specific, actionable guidance.
3. Return ONLY a valid JSON object — no markdown fences, no extra text.

PRODUCTS:
${productJson}

OUTPUT FORMAT (return ONLY this JSON):
{
  "violation_type": "Image Policy Violation",
  "fixes": [
    {
      "product_id": "...",
      "product_title": "...",
      "image_url": "...",
      "issue_detail": "Image is too small (e.g., 50x50px) | Image URL contains promotional overlay indicator",
      "can_autofix": false,
      "needs_verification": false,
      "manual_steps": [
        "Step 1: Prepare a new product image that is at least 100x100px (ideally 800x800px or larger).",
        "Step 2: Ensure the image has no text overlays, watermarks, or promotional badges.",
        "Step 3: Go to Shopify Admin → Products → [Product Title] → Media.",
        "Step 4: Delete the non-compliant image and upload the new one.",
        "Step 5: Set the new image as the main product image and click Save."
      ]
    }
  ]
}`;
  }

  // Fallback generic prompt
  return `You are a Google Merchant Center compliance expert. For each product below, provide clear remediation guidance.

PRODUCTS:
${productJson}

Return ONLY a valid JSON object:
{
  "violation_type": "${violationType}",
  "fixes": [
    {
      "product_id": "...",
      "product_title": "...",
      "needs_verification": true,
      "manual_steps": ["Step 1: ...", "Step 2: ..."]
    }
  ]
}`;
}

export async function action({ request }: ActionFunctionArgs) {
  const bodyClone = request.clone();
  const { session } = await authenticate.admin(request);
  if (!session) return json({ error: "Unauthorized" }, { status: 401 });

  const { scanId, violationType, products } = await bodyClone.json();

  if (!scanId || !violationType || !Array.isArray(products) || products.length === 0) {
    return json({ error: "scanId, violationType, and products array are required." }, { status: 400 });
  }

  // ── Credit check ──────────────────────────────────────────────────────────
  const creditsNeeded = calcGroupFixCredits(products.length);
  const subscription = await getOrCreateSubscription(session.shop);
  const used = getProductsUsed(subscription);
  const limit = getEffectiveProductLimit(subscription);

  if (used + creditsNeeded > limit) {
    return json(
      { error: `Not enough credits. This fix needs ${creditsNeeded} credit${creditsNeeded > 1 ? "s" : ""} (${products.length} products × 1 credit per 5). You have ${limit - used} remaining.` },
      { status: 402 }
    );
  }

  // ── Run AI ────────────────────────────────────────────────────────────────
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
  });

  const prompt = buildGroupFixPrompt(violationType, products);

  try {
    const aiText = await retryOperation(async () => {
      const result = await Promise.race([
        model.generateContent(prompt),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("AI timed out")), 120000)
        ),
      ]);
      return (await (result as any).response).text();
    }, 3, 1500, scanId);

    const start = aiText.indexOf("{");
    const end = aiText.lastIndexOf("}");
    const aiResult = JSON.parse(aiText.substring(start, end + 1));

    // ── Deduct credits ───────────────────────────────────────────────────────
    for (let i = 0; i < creditsNeeded; i++) {
      await incrementProductUsage(session.shop);
    }

    // ── Persist fix record on the scan ──────────────────────────────────────
    try {
      const scan = await (prisma as any).storeScan.findUnique({ where: { id: scanId } });
      if (scan) {
        const existing = (scan.result as any) || {};
        const groupFixes = existing.group_fixes || {};
        groupFixes[violationType] = { fixes: aiResult.fixes, appliedAt: new Date().toISOString(), creditsUsed: creditsNeeded };
        await (prisma as any).storeScan.update({
          where: { id: scanId },
          data: { result: { ...existing, group_fixes: groupFixes } },
        });
      }
    } catch (e) {
      console.warn("[GroupFix] Could not persist fix record:", e);
    }

    return json({ success: true, fixes: aiResult.fixes, creditsUsed: creditsNeeded, violationType });
  } catch (err: any) {
    console.error("[GroupFix] AI error:", err);
    return json({ error: `Auto-fix failed: ${err.message}` }, { status: 500 });
  }
}
