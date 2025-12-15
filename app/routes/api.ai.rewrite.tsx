import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { GoogleGenerativeAI } from "@google/generative-ai";

// IMPORTANT: Ensure GOOGLE_GEMINI_API_KEY is set in your .env file
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);

async function getGeminiSuggestion(prompt: string) {
  if (!process.env.GOOGLE_GEMINI_API_KEY) {
    console.error("Google Gemini API key is not set.");
    // Fallback for local development if key is missing
    return `(AI Suggestion) ${prompt.substring(0, 50)}...`;
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error: any) {
    console.error("Error calling Gemini API:", error);
    throw new Error(`Gemini API Error: ${error.message}`);
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
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

  const { field, title, description } = await request.json();

  let prompt;
  if (field === "title") {
    prompt = `Please rewrite the provided title, ensuring the output is only the final rewritten title with no additional text. The title should be:

SEO Optimized for Google Merchant Center, aiming to increase sales via Google Ads.
Descriptive, Concise & Keyword-Rich.
Include the Brand name intact.
Include the Model name.
Place the Color/Variant name in a prominent, central position within the title.

Original title: "${title}"
The currency for any pricing mentioned is ${shopCurrencyCode || 'USD'}.`;
  } else if (field === "description") {
    prompt = `Please rewrite the provided product Description, ensuring the entire output is only the final rewritten Description, rendered as a complete HTML snippet (including appropriate HTML tags like <h3>, <p>, <strong>, <ul>, <li>, <br>). There should be no additional text, conversational elements, or introductory/concluding remarks outside of the HTML structure. The rewritten description must adhere to the following:

The currency for any pricing mentioned is ${shopCurrencyCode || 'USD'}.

The description content should start with an <h3> tag containing "About This Item" (<h3><strong>About This Item</strong></h3>).

Apply clear HTML formatting:

Use <h3> tags with <strong> for main section headings (e.g., <h3><strong>Key Features</strong></h3>, <h3><strong>Device Compatibility</strong></h3>).

Use <p> tags for paragraphs of text.

Use <ul> and <li> tags for bulleted lists.

Use <strong> tags for bolding important keywords or specific product details.

Use <br> for line breaks within paragraphs where appropriate.

Ensure proper HTML structure, indentation, and spacing for readability in the code.

SEO Optimized: The description should be SEO optimized for Google Merchant Center to increase sales through Google Ads.

Content Quality: It must be Descriptive, Concise, and Keyword-Rich, but avoid excessive repetition that could lead to rejection by Google Merchant Center.

Policy Adherence: Always consider the latest Google Merchant Center policies.

Brand Inclusion: The Brand name must be included and kept intact.

Model Inclusion: The Model name must be included.

Data Correction/Addition: If the provided Description has incorrect or missing Product Model or Variant information, correct or add it based on the information provided in the accompanying Title, which is always considered to have the correct variant and model. For example, add a device compatibility point with the correct model name if applicable.

External Search for Description (if needed):

If the provided Description is empty, not provided, or very short, use the Title to search for relevant product information on leading e-commerce sites in the region.

Use the gathered information to generate a comprehensive and optimized description that meets all the other requirements.

Versatility: The rewrite should be adaptable for any product type (e.g., Mobile Phone, Mobile Cover, Shoes, T-Shirt, Clothes, Jewellery, Showpiece, etc.). Read both the Title and Description carefully to tailor the rewrite accordingly.

HTML Tag Conversion: Convert any existing plain text or Markdown formatting from the original description into the specified HTML structure.

Again the description should start directly with About This Item only and nothing like a title or any thing extra should be added before that.

Original title: "${title}"
Original description: "${description}"`;
  } else if (field === "tags") {
    prompt = `Please generate a comma-separated list of relevant SEO-friendly tags for a product. The output should ONLY be the comma-separated tags and nothing else.

Base the tags on the product's brand, model, type, and other key features found in the title and description.

Original title: "${title}"
Original description: "${description}"`;
  } else if (field === "gtin") {
    prompt = `You are an expert in e-commerce product data and universal product identifiers (UPIs) such as GTINs, UPCs, and EANs.

Your task is to find the exact GTIN for a specific product variant based on the provided product name, model, and color. The product information is in the title below.
Product Title: "${title}"

The output should be ONLY the GTIN (as a string), or the string "null" if not found. Do not include any other text or explanation.

Specific Instructions:

Search for the GTIN: Perform an exhaustive search using the provided product name, model, and color to locate the specific, internationally recognized GTIN (UPC, EAN, or JAN) for this product variant.

Validate the Result: A GTIN must be a numeric string of a specific length (e.g., 12 digits for a UPC, 13 for an EAN). Do not return an internal SKU or a manufacturer part number (MPN).

Handle Missing GTINs: If you cannot find a definitive, valid GTIN for the exact product variant provided, you must return "null". It is critical that you do not invent or guess a GTIN. An incorrect GTIN can lead to product disapprovals on platforms like Google Merchant Center.`;
  } else if (field === "seo_title") {
    prompt = `Please generate a SEO-optimized product title that is EXACTLY 70 characters or less. This title is for the page title meta tag and should be optimized for search engines.

Requirements:
- Maximum 70 characters (STRICT LIMIT)
- SEO optimized for search engines
- Include primary keywords
- Include brand name
- Concise and compelling
- No special characters that break SEO

The output should be ONLY the SEO title with no additional text.

Original title: "${title}"
The currency for any pricing mentioned is ${shopCurrencyCode || 'USD'}.`;
  } else if (field === "seo_description") {
    prompt = `Please generate a SEO-optimized product description that is EXACTLY 320 characters or less. This description is for the meta description tag and should be optimized for search engines.

Requirements:
- Maximum 320 characters (STRICT LIMIT)
- SEO optimized for search engines
- Include primary keywords naturally
- Compelling and descriptive
- Plain text only (no HTML)
- Include brand and key product features
- Encourage click-through

The output should be ONLY the SEO description with no additional text.

Original title: "${title}"
Original description: "${description}"
The currency for any pricing mentioned is ${shopCurrencyCode || 'USD'}.`;
  } else {
    return json({ error: "Invalid field specified" }, { status: 400 });
  }

  try {
    let suggestion = await getGeminiSuggestion(prompt);
    // Clean the suggestion to remove the markdown code block and ALL newlines
    suggestion = suggestion
      .replace(/^```html\n/, "")
      .replace(/\n```$/, "")
      .replace(/>\s+</g, "><")
      .replace(/\r?\n|\r/g, "");

    // Add spacing paragraphs before and after headings, but not before the first heading
    suggestion = suggestion.replace(/<\/h3>/g, '</h3><p><br></p>');
    suggestion = suggestion.replace(/<h3>/g, '<p><br></p><h3>');
    if (suggestion.startsWith('<p><br></p>')) {
      suggestion = suggestion.substring(11);
    }

    return json({ suggestion });
  } catch (error: any) {
    return json({ error: error.message }, { status: 500 });
  }
};
