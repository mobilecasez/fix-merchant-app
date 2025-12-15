import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { retryOperation } from "../utils/retry.js";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);

export async function action({ request }: ActionFunctionArgs) {
  const clonedRequest = request.clone();
  const { admin, session } = await authenticate.admin(clonedRequest);
  if (!session) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const storeUrl = formData.get("store_url") as string;
  const rawHtmlContent = formData.get("raw_html_content") as string;

  if (!storeUrl || !rawHtmlContent) {
    return json({ error: "Invalid request body: missing store_url or raw_html_content" }, { status: 400 });
  }

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  });

  const currentDate = new Date();
  const currentTime = currentDate.toISOString();

  const prompt = `
  You are a world-class e-commerce and SEO expert. Your task is to perform a high-level analysis of a Shopify store's data to find key issues related to Google Merchant Center and general SEO. Do not provide a detailed report, but give a concise summary of the findings.

  Input Data:

  \`\`\`json
  {
  "store_url": "${storeUrl}",
  "raw_html_content": "${rawHtmlContent}",
  "current_time": "${currentTime}"
  }
  \`\`\`

  Instructions:
  1.  **Crawl the Store:** Begin a deep crawl starting from the provided \`storeUrl\`. Follow all internal links to discover product pages, collections, blog posts, and crucial store policy pages.
  2.  **Locate and Analyze Policy Pages:** Actively search for and analyze the content of the following pages. Use a multi-faceted approach by checking common URL slugs (e.g., \`/shipping\`, \`/privacy-policy\`, \`/returns\`), as well as link text in the footer, header, and sitemap (e.g., 'Shipping Policy', 'Returns & Refunds', 'Contact Us').
      * **Shipping Policy:** Verify that it exists, is easily accessible, and clearly defines shipping costs, methods, and delivery times.
      * **Returns/Refund Policy:** Verify that it exists, is easily accessible, and clearly outlines the return window, conditions, and process.
      * **Privacy Policy:** Verify that it exists, is easily accessible, and clearly states what user data is collected and how it is used.
      * **Contact Us Page:** Verify that it exists, is easily accessible, and provides multiple, verifiable forms of contact information (e.g., email address, phone number, physical address).
  3.  **Perform Compliance Checks:**
      * **Google Merchant Center & Ads Policies:** Flag any policy that is missing, has a broken link, or is ambiguously worded as a **'High'** severity issue. This includes unclear returns, shipping, or contact information.
      * **Price Discrepancy:** On a sample of product pages, ensure the \`original_price\` (or \`mrp\`) is always greater than the \`sale_price\`. Flag any instance where this condition is not met as a **'High'** severity issue under \`product_page_issues\`.
  4.  **Perform SEO and Structural Analysis:**
      * **Broken Links:** Crawl a significant number of internal links and report any that lead to 404 pages.
      * **Canonicalization & Duplicate Content:** Check for multiple URLs pointing to the same content (e.g., \`storeurl.com/product\` and \`storeurl.com/product/\` or duplicate policy pages with different slugs).
      * **URL Structure:** Evaluate URL slugs for clarity and SEO-friendliness (e.g., short, keyword-rich).
      * **Meta Information:** Analyze a sample of pages for missing or excessively long meta titles and descriptions.
  5.  **Summarize Findings:**
      * Group your findings into the following four categories: \`merchant_center_compliance\`, \`site_structure_and_seo\`, \`customer_trust_and_policy\`, and \`product_page_issues\`.
      * For each finding, provide a short, one-sentence \`message\` and a \`severity\` field with a value of "High", "Medium", or "Low".

  Output Format:

  Your entire response must be a single JSON object. Each issue should include a "severity" field with values "High", "Medium", or "Low".

  \`\`\`json
  {
  "pointers": {
  "merchant_center_compliance": [
  { "message": "Missing contact information on policy pages.", "severity": "High" },
  { "message": "Return policy is not clearly defined or easily accessible.", "severity": "Medium" }
  ],
  "site_structure_and_seo": [
  { "message": "Multiple URLs for the same privacy policy page were found, causing potential duplicate content issues.", "severity": "Low" },
  { "message": "Some product URLs are excessively long and not keyword-rich.", "severity": "Medium" }
  ],
  "customer_trust_and_policy": [
  { "message": "The refund policy page is missing or has a broken link.", "severity": "High" }
  ],
  "product_page_issues": [
  { "message": "Several products have missing or incorrect GTINs.", "severity": "High" },
  { "message": "Product titles are too long, exceeding the optimal character limit.", "severity": "Low" }
  ]
  }
  }
  \`\`\`
  `;

  const maxRetries = 3;
  const initialRetryDelayMs = 1000;

  try {
    const aiResponseText = await retryOperation(async () => {
      const result = await Promise.race([
        model.generateContent(prompt),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('AI response timed out')), 120000)
        ),
      ]);
      const response = await (result as any).response;
      return response.text();
    }, maxRetries, initialRetryDelayMs, storeUrl);

    const startIndex = aiResponseText.indexOf('{');
    const endIndex = aiResponseText.lastIndexOf('}');
    const jsonString = aiResponseText.substring(startIndex, endIndex + 1);
    
    const aiResponse = JSON.parse(jsonString);
    return json({ ...aiResponse, debugPrompt: prompt }); // Include the prompt in the response
  } catch (error: any) {
    console.error(`Final attempt failed for store URL ${storeUrl}:`, error);
    return json({
      error: `Failed to get AI response for store URL ${storeUrl} after multiple retries: ${error.message}`,
      debugPrompt: prompt, // Include prompt even on error for debugging
    }, { status: 500 });
  }
}
