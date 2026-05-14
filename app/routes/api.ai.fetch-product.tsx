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

  // Clean HTML by removing styles, and excess whitespace, but KEEP scripts as they often contain JSON-LD and product state (like Myntra's window.__myx)
  const root = parse(htmlContent);
  
  // Extract a list of all images as a direct hint to the AI before cleaning
  const allImages = Array.from(new Set(
    Array.from(root.querySelectorAll("img, meta[property='og:image']"))
      .map((img: any) => img.getAttribute("src") || img.getAttribute("data-src") || img.getAttribute("content"))
      .filter((src: any) => src && (src.startsWith("http") || src.startsWith("//")))
      .map((src: string) => src.startsWith("//") ? "https:" + src : src)
  ));
  
  // Remove visual noise and tracking scripts to drastically reduce payload size
  root.querySelectorAll("style, noscript, svg, path, iframe, canvas, map").forEach((el) => el.remove());
  
  // Remove generic tracking/ads scripts but keep application/ld+json and window state scripts
  root.querySelectorAll("script").forEach((el) => {
    const src = el.getAttribute("src") || "";
    const type = el.getAttribute("type") || "";
    const content = el.text || "";
    
    // NEVER remove JSON-LD or standard JSON data scripts
    if (type.includes("json")) return;
    
    if (
      src.includes("googletag") || 
      src.includes("facebook") || 
      src.includes("analytics") || 
      src.includes("tracker") ||
      (content && !content.includes("{") && !content.includes("[")) // Remove empty/simple scripts
    ) {
      el.remove();
    }
  });
  
  // Truncate to ensure we don't blow up token limits. 800k chars is plenty to catch deep JSON
  // without causing the AI request to time out, as it's only ~200k tokens.
  const htmlString = root.toString();
  const cleanedHtml = htmlString
    .replace(/\s\s+/g, " ") // Replace multiple spaces with single space
    .replace(/>\s+</g, "><") // Remove whitespace between tags
    .trim()
    .substring(0, 800000);

  const prompt = `
    From the HTML content of "${url}", extract the product information into a JSON object.

    Here is a pre-extracted list of ALL image URLs found on the page to help you. Choose the best, highest-resolution product images from this list and any JSON data found in the HTML:
    ${JSON.stringify(allImages)}

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
    - Extract all product image URLs from the pre-extracted list and any JSON/HTML data. Look for high-resolution versions (hiRes, large, zoom).
    - CRITICAL: Identify all product options (e.g., "Size", "Color") and their values.
    - CRITICAL: List all variant combinations in the "variants" array.
    - CRITICAL: You MUST put the main selling price into EVERY variant's "price" field unless explicitly stated otherwise. Do not leave variant prices blank.
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
  if (!url) {
    return json({ error: "URL is required" }, { status: 400 });
  }

  try {
    let html = manualHtml || ""; // Use manual HTML if provided
    let fetchSuccess = !!manualHtml; // If manual HTML provided, skip auto-fetch// Only try auto-fetch if no manual HTML was provided
    if (!manualHtml) {
      try {
        // Fetch with 15 second timeout to prevent hanging and improve speed
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        
        try {
          const response = await fetch(url, {
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

    const scraper = getScraper(url);

    let productData;
    if (scraper) {try {
        // Log HTML to help with debugging (first 2000 chars)// Call scraper with manual HTML override if provided
        productData = await scraper(html, url);
        
        // Check if scraper returned MANUAL_HTML_REQUIRED flag
        if (typeof productData === 'string' && productData === MANUAL_HTML_REQUIRED) {return json({
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
        }
        
        // Type guard: only access properties if it's ScrapedProductData
        if (typeof productData !== 'string') {
          if (productData.images) {
            productData.images.slice(0, 3).forEach((img: string, idx: number) => {});
          }
        }

        // Validate that scraper returned valid data
        // If product name is missing but we have images, still use the scraper data
        if (typeof productData !== 'string' && (!productData.productName || productData.productName.trim() === "") && 
            (!productData.images || productData.images.length === 0)) {
          // Only fall back to AI if we have HTML content
          if (fetchSuccess && html && html.trim().length > 0) {
            const aiData = await extractProductDataWithAI(url, html);
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
        } else if (typeof productData !== 'string' && (!productData.productName || productData.productName.trim() === "")) {}
        
        // If scraper succeeded but missed variants, use AI on the HTML to fetch them
        if (typeof productData !== 'string' && productData.productName && (!productData.variants || productData.variants.length === 0)) {
           if (fetchSuccess && html && html.trim().length > 0) {
              const aiData = await extractProductDataWithAI(url, html);
              if (aiData.variants && aiData.variants.length > 0) {
                 productData.variants = aiData.variants;
                 productData.options = aiData.options;
                 // Merge images if AI found more (often finds high-res gallery)
                 if (aiData.images && aiData.images.length > productData.images.length) {
                    productData.images = aiData.images;
                 }
              }
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
      if (!fetchSuccess) {
        throw new Error("Cannot fetch URL - website may be blocking requests");
      }
      productData = await extractProductDataWithAI(url, html);
    }

    // Convert currency if needed
    if (productData && productData.price && productData.price.trim() !== "") {
      try {
        const sourceCurrency = detectCurrency(productData.price, url);
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
    
    // Check for images
    if (!productData.images || productData.images.length === 0) {
      missingFields.push("images");
    }
    
    // Check for price - either main price or variant prices
    const hasMainPrice = productData.price && productData.price.trim() !== "" && productData.price !== "0";
    const hasVariantPrices = productData.variants && 
      productData.variants.length > 0 && 
      productData.variants.some((v: any) => v.price && v.price.trim() !== "" && v.price !== "0");
    
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
