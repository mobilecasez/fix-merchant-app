import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { retryOperation } from "../utils/retry.js";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);

export async function action({ request }: ActionFunctionArgs) {
  const clonedRequest = request.clone(); // Clone the request before authentication
  const { admin, session } = await authenticate.admin(clonedRequest);
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

  const formData = await request.formData(); // Use the original request for form data
  const productString = formData.get("product") as string; // Expect a single product
  const product = JSON.parse(productString);

  if (!product || typeof product !== 'object') {
    return json({ error: "Invalid request body: expected a single product object" }, { status: 400 });
  }

  // Perform local deterministic check for compareAtPrice vs price
  const issues: any[] = [];
  if (product.compareAtPrice === null || product.compareAtPrice <= product.price) {
    issues.push({
      message: "Google Merchant Center: compareAtPrice must exist and be greater than price.",
      severity: "High"
    });
  }

  // If local checks found issues, return them immediately without calling AI
  if (issues.length > 0) {
    return json({
      id: product.id,
      product_name: product.title,
      issues: issues,
      suggestions_for_sales_improvement: [], // No AI suggestions if we skip AI call
    });
  }

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
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
    currencyCode: shopCurrencyCode, // Add currency code to the product object for AI
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
      -   If the title is less than 90 characters, do NOT flag it as an issue for being too short. Recommended length for optimal SEO display is 60-70 characters. Max 150 characters for Google Merchant Center.
      -   Avoid keyword stuffing, excessive capitalization, and promotional text (e.g., "Free Shipping", "Best Price").
      -   Should be descriptive and include key product attributes such as **brand, product type, model, color, and key features** to prevent duplicate issues and enhance specificity.
  -   **Product Description:**
      -   Should be detailed, compelling, and well-structured.
      -   Use clear headings (e.g., ### Features, ### Benefits), bullet points (*), and paragraphs.
      -   Highlight key features, benefits, use cases, and a clear call-to-action.
      -   Minimum recommended length: 150 words for comprehensive SEO.
  -   **Meta Description:**
      -   If the meta description is less than 200 characters, do NOT flag it as an issue for being too short. Recommended length for optimal search engine results page (SERP) display is 150-160 characters.
      -   Should be unique, compelling, and include a primary keyword and a strong call-to-action.
      -   Must NOT be a direct copy of the product description.
  -   **URL Handle:**
      -   Should be concise, keyword-rich, lowercase, and use hyphens as separators.
      -   Avoid excessively long handles (ideally under 60 characters).
      -   **Must include essential product identifiers like brand, model, and color** to ensure uniqueness and SEO relevance.
  -   **GTIN (Global Trade Item Number):**
      -   Check for presence and validity if applicable (e.g., UPC, EAN, ISBN). If not found or applicable, note its absence.
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

  Please ensure your analysis is based on current product availability as of ${currentMonth} ${currentDay}, ${currentYear}, and avoid making assumptions about unreleased or hypothetical product models.

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
    return json(aiResponse);
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
