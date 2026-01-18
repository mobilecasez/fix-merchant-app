import { json, ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { JSDOM } from "jsdom";
import { getScraper } from "../utils/scrapers.server";
import { ensureCompareAtPrice } from "../utils/scrapers/helpers";
import fs from "fs";
import path from "path";
import { parse } from "node-html-parser";
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

async function extractProductDataWithAI(url: string, htmlContent: string) {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  console.log(
    "[AI-Scraper] Using Gemini API, key present:",
    !!apiKey,
    "key length:",
    apiKey?.length || 0,
  );

  if (!apiKey) {
    throw new Error("GOOGLE_GEMINI_API_KEY environment variable is not set");
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  const model = genAI.getGenerativeModel({ 
    model: "gemini-2.0-flash",
    generationConfig: {
      responseMimeType: "application/json",
    },
    safetySettings: [
        {
            category: HarmCategory.HARM_CATEGORY_HARASSMENT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
            category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
            category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
            category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
        },
    ]
  });

  const categoriesPath = path.resolve(process.cwd(), "categories.txt");
  const categoriesContent = fs.readFileSync(categoriesPath, "utf-8");
  const categoriesList = categoriesContent
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith("#"))
    .map((line) => line.split(" : ")[1].trim());

  // Clean HTML by removing scripts, styles, and excess whitespace
  const root = parse(htmlContent);
  root.querySelectorAll("script, style, noscript").forEach((el) => el.remove());
  const cleanedHtml = root.toString()
    .replace(/\s\s+/g, " ") // Replace multiple spaces with single space
    .replace(/>\s+</g, "><") // Remove whitespace between tags
    .trim();

  const prompt = `
    From the HTML content of "${url}", extract the product information into a JSON object.

    HTML:
    \`\`\`html
    ${cleanedHtml}
    \`\`\`

    Here is the full list of valid Google Product Categories:
    \`\`\`
    ${categoriesList.join("\n")}
    \`\`\`

    JSON output should follow this structure. Do not include any text or markdown formatting before or after the JSON object.

    {
      "productName": "string",
      "description": "string (HTML format)",
      "vendor": "string",
      "productType": "string",
      "tags": "string (comma-separated)",
      "price": "string",
      "compareAtPrice": "string",
      "costPerItem": "string",
      "sku": "string",
      "barcode": "string",
      "weight": "string",
      "weightUnit": "string (kg, g, lb, or oz)",
      "images": ["url1", "url2", ...],
      "options": [
        { "name": "string", "values": "string (comma-separated)" }
      ],
      "variants": [
        {
          "title": "string",
          "price": "string",
          "sku": "string",
          "barcode": "string",
          "quantity": "string"
        }
      ]
    }

    Instructions:
    - Return an empty string "" or an empty array [] if a field is not found.
    - Description should be in HTML format.
    - Extract all product image URLs from img tags, data attributes, or JavaScript image arrays (e.g., ImageBlockATF, colorImages, imageBlock). Look for high-resolution versions (hiRes, large, zoom) when available.
    - Identify all product options (e.g., "Size", "Color") and their values.
    - List all variant combinations with their price, SKU, and barcode.
    - If a value is absolutely not present, return null for that field.
    - Do not return an empty object. Make your best effort to fill the fields.
  `;

  let retries = 3;
  let delay = 1000;

  while (retries > 0) {
    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      console.log("Raw AI Response:", text);

      try {
        const parsedData = JSON.parse(text);
        
        // Apply 20% markup if compareAtPrice is missing or null
        if (parsedData.price && (!parsedData.compareAtPrice || parsedData.compareAtPrice === null)) {
          parsedData.compareAtPrice = ensureCompareAtPrice(parsedData.price, "");
          console.log("[AI-Scraper] Applied 20% markup to compareAtPrice:", parsedData.compareAtPrice);
        }
        
        return parsedData;
      } catch (e) {
        console.error("Failed to parse JSON from AI response:", e);
        throw new Error("Invalid JSON format in AI response.");
      }
    } catch (error: any) {
      // Check for rate limit error (specific error message may vary)
      if (error.message.includes("429") || error.message.includes("Resource has been exhausted")) {
        retries--;
        if (retries === 0) {
          console.error("AI extraction failed after multiple retries:", error);
          throw new Error("AI service is currently unavailable. Please try again later.");
        }
        console.warn(`Rate limit hit. Retrying in ${delay / 1000}s... (${retries} retries left)`);
        await new Promise(res => setTimeout(res, delay));
        delay *= 2; // Exponential backoff
      } else {
        // For other errors, fail immediately
        console.error("AI extraction failed:", error);
        const errorMessage =
          error instanceof Error ? error.message : "An unknown error occurred";
        throw new Error(errorMessage);
      }
    }
  }
  throw new Error("AI extraction failed after multiple retries.");
}

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const url = formData.get("url") as string;

  if (!url) {
    return json({ error: "URL is required" }, { status: 400 });
  }

  try {
    let html = "";
    let fetchSuccess = false;
    
    // Try to fetch HTML with regular HTTP request first
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36",
        },
      });
      
      if (response.ok) {
        html = await response.text();
        fetchSuccess = true;
      } else {
        console.log(`Initial fetch failed with status ${response.status}, will try with scraper`);
      }
    } catch (fetchError) {
      console.log("Initial fetch failed, will try with scraper:", fetchError);
    }

    const scraper = getScraper(url);

    let productData;
    if (scraper) {
      console.log("Using local scraper.");
      try {
        productData = await scraper(html, url);
        console.log("[SCRAPER] ========================================");
        console.log("[SCRAPER] Extracted images:", JSON.stringify(productData.images, null, 2));
        console.log("[SCRAPER] Total images:", productData.images?.length || 0);
        console.log("[SCRAPER] First 3 image URLs:");
        if (productData.images) {
          productData.images.slice(0, 3).forEach((img, idx) => {
            console.log(`[SCRAPER]   ${idx + 1}. ${img}`);
          });
        }
        console.log("[SCRAPER] ========================================");

        // Validate that scraper returned valid data
        if (!productData.productName || productData.productName.trim() === "") {
          console.log(
            "Scraper returned empty product name",
          );
          
          // If scraper has images, keep them for potential AI use
          const scraperImages = productData.images || [];
          
          // Only fall back to AI if we have HTML content
          if (fetchSuccess && html && html.trim().length > 0) {
            console.log("Falling back to AI scraper with available HTML");
            const aiData = await extractProductDataWithAI(url, html);
            console.log("[AI] AI extracted data:", JSON.stringify({...aiData, images: aiData.images?.slice(0, 3)}, null, 2));
            console.log("[AI] Total AI images:", aiData.images?.length || 0);
            console.log("[SCRAPER] Total scraper images:", scraperImages.length);
            
            // Prioritize scraper images (higher quality), but use AI images as fallback
            aiData.images = scraperImages.length > 0 ? scraperImages : (aiData.images || []);
            console.log("[FINAL] Using images from:", scraperImages.length > 0 ? "scraper" : "AI");
            console.log("[FINAL] Total images in final result:", aiData.images.length);
            productData = aiData;
          } else {
            console.log("No HTML available for AI fallback, scraper failed completely");
            throw new Error("Unable to extract product data. The scraper failed and no HTML is available for AI processing.");
          }
        }
      } catch (scraperError) {
        console.error("Local scraper failed, falling back to AI:", scraperError);
        // Fall back to AI extraction on scraper error
        if (fetchSuccess) {
          productData = await extractProductDataWithAI(url, html);
        } else {
          throw scraperError;
        }
      }
    } else {
      console.log("Using AI scraper.");
      if (!fetchSuccess) {
        throw new Error("Cannot fetch URL - website may be blocking requests");
      }
      productData = await extractProductDataWithAI(url, html);
    }

    // Log final result before sending to client
    console.log("[FINAL RESULT] Sending to client:");
    console.log("[FINAL RESULT] Product name:", productData?.productName);
    console.log("[FINAL RESULT] Images:", JSON.stringify(productData?.images, null, 2));
    console.log("[FINAL RESULT] Total images:", productData?.images?.length || 0);

    // Final validation
    if (
      !productData ||
      !productData.productName ||
      productData.productName.trim() === ""
    ) {
      return json(
        {
          error:
            "Unable to fetch product data. The website may be blocking automated access. Please add product manually.",
        },
        { status: 400 },
      );
    }

    return json(productData);
  } catch (error) {
    console.error("Error fetching product data:", error);
    const errorMessage =
      error instanceof Error ? error.message : "An unknown error occurred";
    return json({ error: errorMessage }, { status: 500 });
  }
};
