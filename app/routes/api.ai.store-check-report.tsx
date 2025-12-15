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
  You are a world-class e-commerce and SEO expert. Your task is to perform a detailed analysis of a Shopify store's data to find key issues related to Google Merchant Center and general SEO. For each issue, provide a detailed explanation and specific, actionable fixes.

  Input Data:

  \`\`\`json
  {
  "store_url": "${storeUrl}",
  "raw_html_content": "${rawHtmlContent}",
  "current_time": "${currentTime}"
  }
  \`\`\`

  Instructions:
  1.  **Crawl the Store:** Begin a deep crawl starting from the provided \`storeUrl\`. Follow all internal links to discover product pages, collections, blog posts, and crucial store policy pages. **All examples provided in the output must be based on actual findings from this crawl.**
  2.  **Locate and Analyze Policy Pages:** Actively search for and analyze the content of the following pages. Use a multi-faceted approach by checking common URL slugs (e.g., \`/shipping\`, \`/privacy-policy\`, \`/returns\`), as well as link text in the footer, header, and sitemap (e.g., 'Shipping Policy', 'Returns & Refunds', 'Contact Us').
      * **Shipping Policy:** **Verify its existence and accessibility.** If found, analyze its content to ensure it clearly defines shipping costs, methods, and delivery times. If not found or inaccessible, report it as a missing/broken page.
      * **Returns/Refund Policy:** **Verify its existence and accessibility.** If found, analyze its content to ensure it clearly outlines the return window, conditions, and process. If not found or inaccessible, report it as a missing/broken page.
      * **Privacy Policy:** **Verify its existence and accessibility.** If found, analyze its content to ensure it clearly states what user data is collected and how it is used. If not found or inaccessible, report it as a missing/broken page.
      * **Contact Us Page:** **Verify its existence and accessibility.** If found, analyze its content to ensure it provides multiple, verifiable forms of contact information (e.g., email address, phone number, physical address). If not found or inaccessible, report it as a missing/broken page.
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
      * For each finding, provide a detailed \`issue_description\` explaining the problem, a \`severity\` field with a value of "High", "Medium", or "Low", and a detailed \`suggested_fix\` explaining how to resolve the issue. **All examples, including URLs and product names, must be accurate and directly reflect data found during the crawl of the provided \`storeUrl\`. Do not use hypothetical examples.**

  Output Format:

  Your entire response must be a single JSON object. Each issue should include a "severity" field with values "High", "Medium", or "Low", an "issue_description" field, and a "suggested_fix" field.

  \`\`\`json
  {
  "pointers": {
  "merchant_center_compliance": [
  {
  "issue_description": "The store's contact information is missing from the shipping policy page, which is a critical requirement for Google Merchant Center. Specifically, the bot was unable to find a clear email address or phone number on the page located at ${storeUrl}/pages/shipping-policy.",
  "severity": "High",
  "suggested_fix": "Add a clear and easily accessible contact email address and phone number to the shipping policy page. Ensure this information is consistent across all policy pages and the 'Contact Us' page. For example, add a line like 'For inquiries, please contact us at support@yourstore.com or call +1-555-123-4567'."
  },
  {
  "issue_description": "The return policy is ambiguously worded and does not clearly define the return window or conditions, which can confuse customers and violate Google Merchant Center policies. For instance, the policy at ${storeUrl}/pages/return-policy states 'returns are accepted within a reasonable timeframe' without specifying a number of days.",
  "severity": "Medium",
  "suggested_fix": "Revise the return policy to explicitly state the number of days for returns (e.g., 'within 30 days of purchase'), the condition of items accepted for return (e.g., 'unworn and in original packaging'), and a step-by-step process for initiating a return. Provide clear instructions on how customers can start a return, including any required forms or contact methods."
  },
  {
  "issue_description": "The privacy policy page is either missing or difficult to locate, which is a critical compliance issue for data protection regulations and Google Merchant Center. The bot could not find a link to a privacy policy in the footer, header, or sitemap, nor at common URLs like ${storeUrl}/privacy-policy.",
  "severity": "High",
  "suggested_fix": "Create a comprehensive privacy policy page that clearly outlines what user data is collected, how it is used, and how users can manage their data. Ensure this page is easily accessible from the store's footer and linked prominently on relevant pages."
  },
  {
  "issue_description": "The 'Contact Us' page is missing or lacks sufficient verifiable contact information, which can reduce customer trust and lead to Google Merchant Center disapprovals. The page at ${storeUrl}/contact only provides a contact form without an email address or phone number.",
  "severity": "High",
  "suggested_fix": "Ensure the 'Contact Us' page exists and provides multiple, verifiable forms of contact information, such as a direct email address, a phone number, and a physical address if applicable. This builds customer trust and meets policy requirements."
  }
  ],
  "site_structure_and_seo": [
  {
  "issue_description": "Multiple URLs (e.g., ${storeUrl}/products/example-product and ${storeUrl}/products/example-product/) are pointing to the same product content, causing duplicate content issues that can negatively impact SEO. This was observed on several product pages during the crawl.",
  "severity": "Low",
  "suggested_fix": "Implement canonical tags on all duplicate pages to point to the preferred version. Ensure internal links consistently use the canonical URL. For example, if ${storeUrl}/products/example-product is the preferred URL, all other variations should have a canonical tag pointing to it."
  },
  {
  "issue_description": "Some product URLs are excessively long and contain irrelevant parameters, making them less SEO-friendly and harder for users to remember. For example, a URL like ${storeUrl}/products/example-product-name?variant=12345&sessionid=abcde was found.",
  "severity": "Medium",
  "suggested_fix": "Shorten product URLs to be concise and keyword-rich. Remove unnecessary parameters and use hyphens to separate words for better readability and SEO. Aim for a clean URL structure like ${storeUrl}/products/example-product-name."
  },
  {
  "issue_description": "Several pages have missing or excessively long meta titles and descriptions, which can negatively impact click-through rates from search results. For example, the meta title for ${storeUrl}/collections/example-collection is 'Example Collection | My Store | Shop Now!!!' which is too long.",
  "severity": "Medium",
  "suggested_fix": "Optimize meta titles to be concise (50-60 characters) and descriptive, including primary keywords. Optimize meta descriptions to be compelling (150-160 characters) and accurately summarize page content. Use tools to preview how titles and descriptions appear in search results."
  },
  {
  "issue_description": "The store has broken internal links leading to 404 pages, which degrades user experience and negatively impacts SEO by wasting crawl budget. For example, a link on the homepage points to ${storeUrl}/collections/non-existent-collection, which returns a 404.",
  "severity": "High",
  "suggested_fix": "Identify and fix all broken internal links. Regularly audit the website for broken links using a link checker tool. Implement 301 redirects for pages that have moved or been deleted to preserve SEO value."
  }
  ],
  "customer_trust_and_policy": [
  {
  "issue_description": "The refund policy page is missing or has a broken link, which erodes customer trust and is a direct violation of Google Merchant Center requirements. The bot could not access the refund policy at ${storeUrl}/pages/refund-policy, resulting in a 404 error.",
  "severity": "High",
  "suggested_fix": "Create or restore the refund policy page. Ensure it is linked prominently in the footer and clearly outlines the refund process, eligibility, and timelines. Verify the link is functional and accessible to all users."
  },
  {
  "issue_description": "The shipping policy page is missing or has a broken link, which is crucial for customer transparency and Google Merchant Center compliance. The bot could not access the shipping policy at ${storeUrl}/pages/shipping, resulting in a 404 error.",
  "severity": "High",
  "suggested_fix": "Create or restore the shipping policy page. Ensure it is easily accessible from the footer and clearly defines shipping costs, methods, and delivery times. Verify the link is functional and the content is comprehensive."
  }
  ],
  "product_page_issues": [
  {
  "issue_description": "Several products are missing GTINs (Global Trade Item Numbers) or have incorrect ones, which is a common issue for Google Merchant Center product disapprovals. For example, the product 'Example Product Name 1' (ID: 12345) is missing a UPC, and 'Example Product Name 2' (ID: 67890) has an invalid EAN. A list of affected products: ['Example Product Name 1', 'Example Product Name 2'].",
  "severity": "High",
  "suggested_fix": "For all products, ensure accurate GTINs (UPC, EAN, ISBN, JAN) are provided. If a product genuinely does not have a GTIN, mark it as 'identifier_exists: FALSE' in your product data feed. Use a product data management system to ensure data accuracy for products like 'Example Product Name 1' and 'Example Product Name 2'."
  },
  {
  "issue_description": "Product titles are too long, exceeding the optimal character limit for search engines and often getting truncated in search results. For example, the product 'Example Product with a Very Long and Descriptive Title That Exceeds Recommended Limits' has an excessively long title. A list of affected products: ['Example Product with a Very Long and Descriptive Title That Exceeds Recommended Limits', 'Another Product with an Overly Verbose Title'].",
  "severity": "Low",
  "suggested_fix": "Shorten product titles to be concise, descriptive, and include primary keywords at the beginning. Aim for titles between 50-70 characters for optimal display. For example, 'Concise Product Title' is more effective for 'Example Product with a Very Long and Descriptive Title That Exceeds Recommended Limits'."
  },
  {
  "issue_description": "Price discrepancies were found on product pages where the sale price was not lower than the original price, which can confuse customers and violate Google Merchant Center policies. For example, on 'Example Product Name 3' (ID: 54321), the original price is $25.00 and the sale price is $25.00. A list of affected products: ['Example Product Name 3', 'Example Product Name 4'].",
  "severity": "High",
  "suggested_fix": "Ensure that for all products on sale, the 'sale_price' is strictly less than the 'original_price'. Correct any instances where this condition is not met for products like 'Example Product Name 3'. Clearly display both prices to highlight the discount."
  },
  {
  "issue_description": "Product descriptions are too short or lack sufficient detail, which can hinder customer purchasing decisions and negatively impact SEO. For example, 'Example Product Name 5' (ID: 98765) has a description of only 'A great product'. A list of affected products: ['Example Product Name 5', 'Example Product Name 6'].",
  "severity": "Medium",
  "suggested_fix": "Expand product descriptions to be comprehensive, highlighting key features, benefits, and specifications. Use bullet points and clear formatting to improve readability. Include relevant keywords naturally to boost SEO for products like 'Example Product Name 5'."
  }
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
