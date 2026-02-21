import { json, ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { JSDOM } from "jsdom";
import { getScraper, MANUAL_HTML_REQUIRED } from "../utils/scrapers.server";
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
  const manualHtml = formData.get("manualHtml") as string | null; // New field for manual HTML paste

  console.log("[FETCH-PRODUCT] URL:", url);
  console.log("[FETCH-PRODUCT] Manual HTML provided:", !!manualHtml, "Length:", manualHtml?.length || 0);

  if (!url) {
    return json({ error: "URL is required" }, { status: 400 });
  }

  try {
    let html = manualHtml || ""; // Use manual HTML if provided
    let fetchSuccess = !!manualHtml; // If manual HTML provided, skip auto-fetch
    
    console.log("[FETCH-PRODUCT] Using manual HTML:", fetchSuccess, "HTML length:", html.length);
    
    // Only try auto-fetch if no manual HTML was provided
    if (!manualHtml) {
      try {
        console.log("Attempting to fetch:", url);
        
        // Add random delay to mimic human behavior
        await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
        
        const response = await fetch(url, {
          headers: {
            'accept-language': 'en-US,en;q=0.9',
            'accept-encoding': 'gzip, deflate, br',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36',
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          },
        });
        
        if (response.ok) {
          html = await response.text();
          
          // Check if we got a CAPTCHA or bot detection page
          if (html.includes('Type the characters you see in this picture') || 
              html.includes('Enter the characters you see below') ||
              html.includes('To discuss automated access to Amazon data please contact') ||
              html.toLowerCase().includes('robot check') ||
              html.length < 10000) {
            console.log(`Got CAPTCHA/bot detection page (size: ${html.length}), keeping HTML for AI fallback`);
            fetchSuccess = true; // Keep HTML available for AI fallback
          } else {
            fetchSuccess = true;
            console.log(`Successfully fetched page, HTML length: ${html.length}`);
          }
        } else {
          console.log(`Initial fetch failed with status ${response.status}, will try with scraper`);
        }
      } catch (fetchError) {
        console.log("Initial fetch failed, will try with scraper:", fetchError);
      }
    }

    const scraper = getScraper(url);

    let productData;
    if (scraper) {
      console.log("Using specialized scraper.");
      try {
        // Log HTML to help with debugging (first 2000 chars)
        console.log("[SCRAPER HTML] First 2000 characters:");
        console.log(html.substring(0, 2000));
        
        // Call scraper with manual HTML override if provided
        productData = await scraper(html, url);
        
        // Check if scraper returned MANUAL_HTML_REQUIRED flag
        if (typeof productData === 'string' && productData === MANUAL_HTML_REQUIRED) {
          console.log("[SCRAPER] Manual HTML required - auto-fetch blocked");
          return json({
            manualHtmlRequired: true,
            message: "The website is blocking automated access. Please manually copy the HTML:",
            instructions: [
              "1. Open the product URL in your browser",
              "2. Press Ctrl+U (Windows) or Cmd+Option+U (Mac) to view page source",
              "   (If right-click is disabled, use keyboard shortcut)",
              "3. Select all the HTML (Ctrl+A / Cmd+A) and copy it",
              "4. Paste the HTML in the text box below and click Import again"
            ]
          });
        }
        
        // Check if manual HTML is required (string response)
        if (typeof productData === 'string' && productData === MANUAL_HTML_REQUIRED) {
          // This is already handled above, should not reach here
          console.log("[SCRAPER] Manual HTML required detected");
        }
        
        // Type guard: only access properties if it's ScrapedProductData
        if (typeof productData !== 'string') {
          console.log("[SCRAPER] ========================================");
          console.log("[SCRAPER] Extracted images:", JSON.stringify(productData.images, null, 2));
          console.log("[SCRAPER] Total images:", productData.images?.length || 0);
          console.log("[SCRAPER] First 3 image URLs:");
          if (productData.images) {
            productData.images.slice(0, 3).forEach((img: string, idx: number) => {
              console.log(`[SCRAPER]   ${idx + 1}. ${img}`);
            });
          }
          console.log("[SCRAPER] ========================================");
        }

        // Validate that scraper returned valid data
        // If product name is missing but we have images, still use the scraper data
        if (typeof productData !== 'string' && (!productData.productName || productData.productName.trim() === "") && 
            (!productData.images || productData.images.length === 0)) {
          console.log(
            "Scraper returned empty product name AND no images, falling back to AI if possible",
          );
          
          // Only fall back to AI if we have HTML content
          if (fetchSuccess && html && html.trim().length > 0) {
            console.log("Falling back to AI scraper with available HTML");
            const aiData = await extractProductDataWithAI(url, html);
            console.log("[AI] AI extracted data:", JSON.stringify({...aiData, images: aiData.images?.slice(0, 3)}, null, 2));
            console.log("[AI] Total AI images:", aiData.images?.length || 0);
            productData = aiData;
          } else {
            console.log("No HTML available for AI fallback");
            throw new Error("Unable to extract product data. Please try again or add the product manually.");
          }
        } else if (typeof productData !== 'string' && (!productData.productName || productData.productName.trim() === "")) {
          console.log("[SCRAPER] Product name empty but has images, will proceed with scraper data");
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
      console.log("No specialized scraper found, using AI.");
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

    // Add HTML for debugging in browser console
    return json({
      ...productData,
      debugHtml: html.substring(0, 5000), // First 5000 chars for debugging
    });
  } catch (error) {
    console.error("Error fetching product data:", error);
    const errorMessage =
      error instanceof Error ? error.message : "An unknown error occurred";
    return json({ error: errorMessage }, { status: 500 });
  }
};
