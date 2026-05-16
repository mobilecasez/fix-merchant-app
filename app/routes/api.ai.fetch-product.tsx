import { json, ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { JSDOM } from "jsdom";
import { getScraper, MANUAL_HTML_REQUIRED } from "../utils/scrapers.server";
import { ensureCompareAtPrice } from "../utils/scrapers/helpers";
import fs from "fs";
import path from "path";
import { parse } from "node-html-parser";
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { canCreateProduct, incrementProductUsage } from "../utils/billing.server";
import { detectCurrency, convertProductPrices } from "../utils/currency.server";

import { optimizeHtmlForAI } from "../utils/dom-optimizer.server";

async function extractProductDataWithAI(url: string, htmlContent: string) {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_GEMINI_API_KEY environment variable is not set");
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash",
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

  // Use our high-efficiency optimizer to strip bloat and convert to Markdown
  const { markdown, dataScripts } = optimizeHtmlForAI(htmlContent);

  // Extract a list of all images as a direct hint to the AI
  const imageUrlRegex = /https?:\/\/[^"'\s>]+?\.(?:jpg|jpeg|png|webp|avif)(?:\?[^"'\s>]*)?/gi;
  const rawUrlMatches = Array.from(htmlContent.matchAll(imageUrlRegex)).map(m => m[0]);
  
  const root = parse(htmlContent);
  const allImages = Array.from(new Set([
    ...rawUrlMatches,
    ...Array.from(root.querySelectorAll("img, meta[property='og:image']"))
      .map((img: any) => img.getAttribute("src") || img.getAttribute("data-src") || img.getAttribute("content"))
      .filter((src: any) => src && (src.startsWith("http") || src.startsWith("//")))
      .map((src: string) => src.startsWith("//") ? "https:" + src : src)
  ]));

  const prompt = `
    From the following product page content, extract the product information into a JSON object.

    URL: ${url}

    IMAGE HINTS (Found in raw HTML):
    ${JSON.stringify(allImages.slice(0, 50))}

    DATA SCRIPTS (Extracted JSON/State):
    ${dataScripts.substring(0, 300000)}

    CONTENT (Markdown Format):
    ${markdown.substring(0, 300000)}

    Valid Google Product Categories:
    ${categoriesList.join("\n")}

    JSON structure:
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
    - Return a valid JSON object ONLY.
    - Description should be in HTML format.
    - CRITICAL: Identify all product options (e.g., "Size", "Color") and their values.
    - CRITICAL: List all variant combinations in the "variants" array.
    - CRITICAL: You MUST put the main selling price into EVERY variant's "price" field unless explicitly stated otherwise. Do not leave variant prices blank.
    - Use the high-resolution images from the hints or data scripts.
  `;

  let retries = 3;
  let delay = 1000;

  while (retries > 0) {
    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      try {
        const parsedData = JSON.parse(text);
        
        // Apply 20% markup if compareAtPrice is missing or null
        if (parsedData.price && (!parsedData.compareAtPrice || parsedData.compareAtPrice === null)) {
          parsedData.compareAtPrice = ensureCompareAtPrice(parsedData.price, "");}
        
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
  const { session, admin } = await authenticate.admin(request);

  // Fetch shop currency for price conversion
  let shopCurrency = 'USD'; // Default to USD
  try {
    const shopCurrencyQuery = `
      query {
        shop {
          currencyCode
        }
      }
    `;
    const shopData = await admin.graphql(shopCurrencyQuery);
    const shopDataJson = await shopData.json();
    if (shopDataJson.data?.shop?.currencyCode) {
      shopCurrency = shopDataJson.data.shop.currencyCode;
    } else {
      console.warn('[Currency] Shop currency not found, using default USD');
    }
  } catch (error) {
    console.error('[Currency] Error fetching shop currency:', error);
  }

  // Check subscription and product limit BEFORE processing
  const canCreate = await canCreateProduct(session.shop);
  if (!canCreate) {
    return json({ 
      error: "Product limit reached. Please upgrade your subscription or wait for the next billing cycle." 
    }, { status: 403 });
  }

  const formData = await request.formData();
  const url = formData.get("url") as string;
  const manualHtml = formData.get("manualHtml") as string | null; // New field for manual HTML paste
  
  if (!url && !manualHtml) {
    return json({ error: "Product URL is required" }, { status: 400 });
  }

  // If we only have manual HTML but no URL, create a placeholder URL for processing
  const processingUrl = url || "https://manual-upload.local";

  try {
    let html = manualHtml || ""; // Use manual HTML if provided
    let fetchSuccess = !!manualHtml; // If manual HTML provided, skip auto-fetch// Only try auto-fetch if no manual HTML was provided
    if (!manualHtml) {
      try {
        // Fetch with 15 second timeout to prevent hanging and improve speed
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        
        try {
          const response = await fetch(processingUrl, {
            signal: controller.signal,
            headers: {
              'accept-language': 'en-US,en;q=0.9',
              'accept-encoding': 'gzip, deflate, br',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36',
              'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            },
          });
          clearTimeout(timeoutId);
        
          if (response.ok) {
            html = await response.text();
            
            // Check if we got a CAPTCHA or bot detection page
            if (html.includes('Type the characters you see in this picture') || 
                html.includes('Enter the characters you see below') ||
                html.includes('To discuss automated access to Amazon data please contact') ||
                html.toLowerCase().includes('robot check') ||
                html.length < 10000) {fetchSuccess = true; // Keep HTML available for AI fallback
            } else {
              fetchSuccess = true;}
          } else {}
        } catch (fetchError) {
          clearTimeout(timeoutId);
          if (fetchError instanceof Error && fetchError.name === 'AbortError') {}
        }
      } catch (fetchError) {}
    }

    const scraper = getScraper(processingUrl);

    let productData;
    if (scraper) {
      try {
        // Call scraper with manual HTML override if provided
        productData = await scraper(html, processingUrl);
        
        // Check if scraper returned MANUAL_HTML_REQUIRED flag
        if (typeof productData === 'string' && productData === MANUAL_HTML_REQUIRED) {
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
        
        // Validate that scraper returned valid data
        // If product name is missing but we have images, still use the scraper data
        if (typeof productData !== 'string' && (!productData.productName || productData.productName.trim() === "") && 
            (!productData.images || productData.images.length === 0)) {
          // Only fall back to AI if we have HTML content
          if (fetchSuccess && html && html.trim().length > 0) {
            const aiData = await extractProductDataWithAI(processingUrl, html);
            // Merge scraper data with AI data where AI has better variant parsing
            productData = {
              ...productData,
              ...aiData,
              images: aiData.images.length > productData.images.length ? aiData.images : productData.images,
              options: aiData.options.length > 0 ? aiData.options : productData.options,
              variants: aiData.variants.length > 0 ? aiData.variants : productData.variants,
            };
          } else {
            throw new Error("Unable to extract product data. Please try again or add the product manually.");
          }
        }
        
        // Magic Fallback for Amazon: If scraper succeeded but explicitly returned 0 variants, use AI on the HTML to fetch them
        if (typeof productData !== 'string' && productData.productName && (!productData.variants || productData.variants.length === 0)) {
           if (fetchSuccess && html && html.trim().length > 0) {
              const aiData = await extractProductDataWithAI(processingUrl, html);
              if (aiData.variants && aiData.variants.length > 0) {
                 productData.variants = aiData.variants;
                 productData.options = aiData.options;
                 // Merge images if AI found more (often finds high-res gallery)
                 if (aiData.images && aiData.images.length > productData.images.length) {
                    productData.images = aiData.images;
                 }
                 // Ensure main product price is carried over if AI misses it
                 productData.variants = productData.variants.map((v: any) => ({
                   ...v,
                   price: (v.price && String(v.price).trim() !== "" && parseFloat(String(v.price).replace(/[^0-9.]/g, '')) > 0) ? v.price : productData.price,
                 }));
              }
           }
        }
      } catch (scraperError) {
        console.error("Local scraper failed, falling back to AI:", scraperError);
        // Fall back to AI extraction on scraper error
        if (fetchSuccess) {
          productData = await extractProductDataWithAI(processingUrl, html);
        } else {
          throw scraperError;
        }
      }
    } else {
      if (!fetchSuccess) {
        throw new Error("Cannot fetch URL - website may be blocking requests");
      }
      productData = await extractProductDataWithAI(processingUrl, html);
    }

    // Convert currency if needed
    if (productData && productData.price && productData.price.trim() !== "") {
      try {
        const sourceCurrency = detectCurrency(productData.price, processingUrl);
        if (sourceCurrency !== shopCurrency) {
          const converted = await convertProductPrices(
            productData.price,
            productData.compareAtPrice || '',
            sourceCurrency,
            shopCurrency
          );
          productData.price = converted.price;
          if (converted.compareAtPrice) {
            productData.compareAtPrice = converted.compareAtPrice;
          }
        }
      } catch (error) {
        console.warn('[Currency] Currency conversion failed, using original prices:', error);
        // Continue with original prices on error
      }
    }

    // Final validation - check product name
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

    // Validate critical fields - don't charge credit if essential data is missing
    const missingFields: string[] = [];
    
    // Safety fallback: if variants have empty/zero prices but the main product has a price, copy it over
    if (productData.price && productData.variants && productData.variants.length > 0) {
      productData.variants = productData.variants.map((v: any) => ({
        ...v,
        price: (v.price && String(v.price).trim() !== "" && parseFloat(String(v.price).replace(/[^0-9.]/g, '')) > 0) ? v.price : productData.price,
      }));
    }
    
    // Check for images
    if (!productData.images || productData.images.length === 0) {
      missingFields.push("images");
    }
    
    // Check for price - either main price or variant prices
    const hasMainPrice = productData.price && String(productData.price).trim() !== "" && parseFloat(String(productData.price).replace(/[^0-9.]/g, '')) > 0;
    const hasVariantPrices = productData.variants && 
      productData.variants.length > 0 && 
      productData.variants.some((v: any) => v.price && String(v.price).trim() !== "" && parseFloat(String(v.price).replace(/[^0-9.]/g, '')) > 0);
    
    if (!hasMainPrice && !hasVariantPrices) {
      missingFields.push("pricing");
    }
    
    // If critical fields are missing, return warning without charging credit
    if (missingFields.length > 0) {
      return json(
        {
          incompleteData: true,
          missingFields: missingFields,
          message: `Unable to fetch complete product information. Missing: ${missingFields.join(", ")}. No credit was charged.`,
          fetchedHtml: fetchSuccess ? html : "",
          ...productData, // Include partial data for user to see
        },
        { status: 200 }, // 200 because it's not an error, it's a warning
      );
    }

    // All critical fields present - increment product usage counter
    await incrementProductUsage(session.shop);

    return json({ ...productData, fetchedHtml: fetchSuccess ? html : "" });
  } catch (error) {
    console.error("Error fetching product data:", error);
    const errorMessage =
      error instanceof Error ? error.message : "An unknown error occurred";
    return json({ error: errorMessage }, { status: 500 });
  }
};
