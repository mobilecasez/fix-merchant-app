import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { retryOperation } from "../utils/retry.js";
import prisma from "../db.server";
import { incrementProductUsage } from "../utils/billing.server";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);

export async function action({ request }: ActionFunctionArgs) {
  // Clone the request FIRST for body reading, then authenticate with the original.
  // authenticate.admin can consume the request stream in some environments (e.g., when
  // processing OAuth/multipart). Cloning first ensures the body is always readable.
  const bodyClone = request.clone();
  const { admin, session } = await authenticate.admin(request);
  if (!session) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  let shopCurrencyCode: string | undefined = undefined;
  try {
    const shopResponse = await admin.graphql(
      `#graphql
        query shopInfo {
          shop {
            currencyCode
          }
        }`
    );
    const shopData = await shopResponse.json();
    shopCurrencyCode = shopData.data?.shop?.currencyCode;
    if (!shopCurrencyCode) {
      console.warn("Shop currency code not found.");
    }
  } catch (error) {
    console.error("Error fetching shop currency:", error);
  }

  const formData = await bodyClone.formData();
  const productString = formData.get("product") as string; // Expect a single product
  const product = JSON.parse(productString);

  if (!product || typeof product !== 'object') {
    return json({ error: "Invalid request body: expected a single product object" }, { status: 400 });
  }

  // Deterministic pre-checks — these are always correct regardless of AI output
  const localIssues: any[] = [];
  const localSuggestions: any[] = [];

  // Fields we KNOW are present — used after AI responds to strip any false positives
  const knownPresentFields = {
    hasBarcode: !!(product.barcode && String(product.barcode).trim() && String(product.barcode).trim() !== 'null'),
    hasImages:  false, // image count is not available in list queries — never filter image issues here
  };

  if (product.compareAtPrice === null || product.compareAtPrice <= product.price) {
    localIssues.push({
      message: "Google Merchant Center: compareAtPrice must exist and be greater than price.",
      severity: "High"
    });
    localSuggestions.push({
      suggestion: "Ensure 'compareAtPrice' is set and higher than 'price' for effective discount display and Google Merchant Center compliance.",
      priority: "High"
    });
  }

  const model = genAI.getGenerativeModel({
    model: (process.env.GEMINI_TEXT_MODEL || "gemini-3.1-flash-lite"),
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json", // Ensure JSON output
    },
  });

  const productForAI = {
    id: product.id,
    title: product.title,
    handle: product.handle,
    description: product.description,
    metaDescription: product.metaDescription,
    price: product.price,
    compareAtPrice: product.compareAtPrice,
    currencyCode: shopCurrencyCode,
    barcode: product.barcode || null,
    status: product.status || null,
    // vendor is intentionally omitted — in Shopify, 'vendor' is the supplier/wholesaler,
    // NOT the brand. It can be any third-party seller and must NOT be used for brand validation.
    // totalImages is omitted intentionally — image count is not fetched in the product list query.
    // The AI must NOT flag images as an issue since count is unknown.
  };

  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.toLocaleString('default', { month: 'long' });
  const currentDay = currentDate.getDate();

  const prompt = `
  You are a world-class e-commerce and SEO expert specializing in product data optimization. Your task is to perform a meticulous and exhaustive analysis of the following Shopify product, focusing *exclusively* on product-level attributes relevant to Google Merchant Center, SEO, and Google Ads. Do NOT include any store-level or account-level issues (e.g., shipping, tax, payment, website-wide policies). A summarized or incomplete response is unacceptable. You must identify every possible product-specific issue. Be thorough and do not omit any findings, no matter how small.

  Crucially, you must also analyze the product's pricing: the \`compareAtPrice\` must exist and be greater than the \`price\`. If this condition is not met, it is a High severity issue for Google Merchant Center. The currency for the prices is ${shopCurrencyCode || 'USD'}.

  **Specific Guidelines for Analysis:**
  -   **Product Title:**
      -   Keep the title concise and keyword-rich.
      -   **CRITICAL RULE FOR TITLE LENGTH:** The absolute maximum length is 150 characters for Google Merchant Center. However, ideally, aim for 60-70 characters. If including all recommended attributes (brand, product type, model, color) would make the title exceed 70 characters, prioritize conciseness. Do NOT flag a title as an issue simply because it lacks a brand or color IF adding it would make the title too long.
      -   Avoid keyword stuffing, excessive capitalization, and promotional text (e.g., "Free Shipping", "Best Price").
  -   **Product Description:**
      -   Should be detailed, compelling, and well-structured.
      -   Use clear headings (e.g., ### Features, ### Benefits), bullet points (*), and paragraphs.
      -   Highlight key features, benefits, and use cases.
      -   Minimum recommended length: 150 words for comprehensive SEO.
      -   Do NOT flag the description for lacking a "call-to-action" phrase (e.g., "Shop now", "Buy now", "Add to Cart"). Google's policies discourage promotional language in product data, and these phrases are intentionally omitted.
  -   **Meta Description:**
      -   If the meta description is less than 200 characters, do NOT flag it as an issue for being too short. Recommended length for optimal search engine results page (SERP) display is 150-160 characters.
      -   Should be unique, compelling, and include a primary keyword.
      -   Do NOT flag the meta description for lacking an explicit call-to-action phrase. Informative, keyword-rich meta descriptions are preferred.
      -   Must NOT be a direct copy of the product description.
  -   **URL Handle:**
      -   Should be concise, keyword-rich, lowercase, and use hyphens as separators.
      -   Avoid excessively long handles (ideally under 60 characters).
  -   **GTIN (Global Trade Item Number):**
      -   The product data includes a \`barcode\` field. If \`barcode\` is a non-empty, non-null string, the product HAS a GTIN — do NOT flag GTIN as missing.
      -   Only flag GTIN as an issue if \`barcode\` is null, empty, or absent.
      -   When flagging, use "Medium" severity at most — never "High" — since many custom or unbranded products legitimately have no GTIN.
  -   **Brand:**
      -   The product data does NOT include a vendor or brand field. Do NOT flag the brand as missing from the product data. You may flag the title if the brand name is clearly absent from the title itself, but only if adding it would not make the title too long.
  -   **Images:**
      -   The product data does NOT include an image count. Do NOT flag images as an issue under any circumstances. Image-related issues cannot be assessed from the available data.
  -   **Pricing:**
      -   \`compareAtPrice\` must be greater than \`price\` for sale indication.

  After identifying all product-specific issues, provide a detailed list of actionable suggestions to improve sales. These suggestions must also be strictly product-level.

  For this product, return a JSON object. This object must contain:
  1.  The original "id" of the product.
  2.  A "product_name" key with the product's title.
  3.  An "issues" key, which is an array of objects containing every product-specific issue you identify. Each issue object must have a "message" and a "severity" (High, Medium, or Low).
  4.  A "suggestions_for_sales_improvement" key, which is an array of objects. Each object must have a "suggestion" (as a string, without markdown) and a "priority" ('High', 'Medium', or 'Low').

  The product is:
  ${JSON.stringify(productForAI, null, 2)}

  Do NOT fact-check the existence of the product, the product model, or its specifications. Assume the product is a real, valid product being sold by the merchant. Focus purely on SEO, styling, formatting, and Google Merchant Center compliance (like length limits, missing GTIN, missing description, keyword stuffing, capitalization).

  Example response format for a single product (ensure your response is only the JSON object):
  {
    "id": "gid://shopify/Product/123",
    "product_name": "Example Product Title",
    "issues": [
      {
        "message": "Example issue message.",
        "severity": "High"
      }
    ],
    "suggestions_for_sales_improvement": [
      { "suggestion": "Example suggestion.", "priority": "High" }
    ]
  }
  `;

  const maxRetries = 3;
  const initialRetryDelayMs = 1000; // 1 second

  try {
    const aiResponseText = await retryOperation(async () => {
      const result = await Promise.race([
        model.generateContent(prompt),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('AI response timed out')), 120000) // Increased to 120 seconds (2 minutes) timeout
        ),
      ]);
      const response = await (result as any).response;
      return response.text();
    }, 5, initialRetryDelayMs, product.id); // Increased maxRetries to 5

    const startIndex = aiResponseText.indexOf('{');
    const endIndex = aiResponseText.lastIndexOf('}');
    const jsonString = aiResponseText.substring(startIndex, endIndex + 1);
    
    const aiResponse = JSON.parse(jsonString);

    // Combine local deterministic checks with AI findings
    const combinedIssues = [...localIssues, ...(aiResponse.issues || [])];
    const combinedSuggestions = [...localSuggestions, ...(aiResponse.suggestions_for_sales_improvement || [])];

    // Strip any AI false-positives for fields we KNOW are already present
    const gtinKeywords  = ['gtin', 'global trade item', 'upc', 'ean', 'isbn', 'barcode'];
    // Always strip image-related issues — image count is not available in the data we send the AI
    const imageKeywords = ['image', 'photo', 'picture', 'visual'];
    // Strip CTA-related issues — auto-fix intentionally omits promotional CTAs per Google policy
    const ctaKeywords   = ['call-to-action', 'call to action', 'cta', 'shop now', 'buy now', 'add to cart', 'order now'];

    const filteredIssues = combinedIssues.filter(issue => {
      const msg = issue.message.toLowerCase();
      if (knownPresentFields.hasBarcode && gtinKeywords.some(k => msg.includes(k))) return false;
      if (imageKeywords.some(k => msg.includes(k))) return false; // always strip image issues
      if (ctaKeywords.some(k => msg.includes(k))) return false;   // always strip CTA issues
      return true;
    });
    const filteredSuggestions = combinedSuggestions.filter(s => {
      const txt = s.suggestion.toLowerCase();
      if (knownPresentFields.hasBarcode && gtinKeywords.some(k => txt.includes(k))) return false;
      if (imageKeywords.some(k => txt.includes(k))) return false;
      if (ctaKeywords.some(k => txt.includes(k))) return false;
      return true;
    });

    // Deduplicate by message/suggestion text
    const uniqueIssues = filteredIssues.filter((issue, index, self) =>
      index === self.findIndex((t) => t.message === issue.message)
    );
    const uniqueSuggestions = filteredSuggestions.filter((sugg, index, self) =>
      index === self.findIndex((t) => t.suggestion === sugg.suggestion)
    );

    await incrementProductUsage(session.shop);

    // Save to database so it persists
    await prisma.productAICheck.upsert({
      where: { productId: product.id },
      update: {
        status: 'COMPLETE',
        result: { issues: uniqueIssues, suggestions_for_sales_improvement: uniqueSuggestions },
        aiCheckCompleted: true,
        autoFixCompleted: false, // Reset auto-fix status as a new check has been run
      },
      create: {
        productId: product.id,
        shop: session.shop,
        status: 'COMPLETE',
        result: { issues: uniqueIssues, suggestions_for_sales_improvement: uniqueSuggestions },
        aiCheckCompleted: true,
      },
    });

    // Return the full result
    return json({ success: true, issues: uniqueIssues, suggestions_for_sales_improvement: uniqueSuggestions });
  } catch (error: any) {
    console.error(`Final attempt failed for product ${product.id}:`, error);
    return json({
      id: product.id,
      product_name: product.title,
      issues: [{ message: `Failed to get AI response for this product after multiple retries: ${error.message}`, severity: "High" }],
      suggestions_for_sales_improvement: [],
    }, { status: 500 });
  }
}
