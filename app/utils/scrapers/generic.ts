import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice, estimateWeight } from "./helpers";

// Special flag to indicate manual HTML is needed
export const MANUAL_HTML_REQUIRED = "MANUAL_HTML_REQUIRED";

/**
 * Generic scraper for any e-commerce website
 * Strategy:
 * 1. Try auto-fetch with good headers
 * 2. If blocked → return flag for manual HTML paste
 * 3. When manual HTML provided → use Gemini AI directly (accurate extraction)
 * 4. When auto-fetched → try pattern parsing first, then AI fallback
 */
export async function scrapeGeneric(
  html: string,
  url: string,
  useAI: boolean = false
): Promise<ScrapedProductData | typeof MANUAL_HTML_REQUIRED> {
  try {
    console.log('[Generic Scraper] Starting scrape for:', url);
    
    let htmlContent = html || "";
    let isManualHtml = false;
    
    // If no HTML provided, try to fetch it
    if (!htmlContent) {
      console.log('[Generic Scraper] Attempting auto-fetch...');
      
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0',
          },
        });
        
        if (!response.ok) {
          console.log(`[Generic Scraper] HTTP error: ${response.status}`);
          return MANUAL_HTML_REQUIRED;
        }
        
        htmlContent = await response.text();
        console.log('[Generic Scraper] Auto-fetch successful, HTML length:', htmlContent.length);
        
        // Check for common blocking patterns
        if (
          htmlContent.length < 5000 ||
          htmlContent.toLowerCase().includes('captcha') ||
          htmlContent.toLowerCase().includes('access denied') ||
          htmlContent.toLowerCase().includes('blocked') ||
          htmlContent.toLowerCase().includes('robot') ||
          htmlContent.toLowerCase().includes('site maintenance')
        ) {
          console.log('[Generic Scraper] Detected blocking/CAPTCHA, requesting manual HTML');
          return MANUAL_HTML_REQUIRED;
        }
      } catch (fetchError) {
        console.error('[Generic Scraper] Fetch failed:', fetchError);
        return MANUAL_HTML_REQUIRED;
      }
    } else {
      // HTML was provided manually by user
      isManualHtml = true;
      console.log('[Generic Scraper] Using manually provided HTML, length:', htmlContent.length);
    }
    
    // CRITICAL: If manual HTML or useAI flag is set, use Gemini AI directly
    // Pattern-based parsing is too fragile for diverse website structures
    if (isManualHtml || useAI) {
      console.log('[Generic Scraper] Using AI parsing (manual HTML or forced)');
      return await parseWithGemini(htmlContent, url);
    }
    
    // For auto-fetched HTML, try pattern-based parsing first (faster)
    console.log('[Generic Scraper] Attempting pattern-based parsing...');
    const parsedData = parseGenericHTML(htmlContent, url);
    
    // If we got good data (title + at least one image), return it
    if (parsedData.productName && parsedData.images.length > 0) {
      console.log('[Generic Scraper] Pattern-based parsing successful');
      return parsedData;
    }
    
    // Otherwise, fall back to AI
    console.log('[Generic Scraper] Pattern-based parsing incomplete, using AI...');
    return await parseWithGemini(htmlContent, url);
    
  } catch (error) {
    console.error('[Generic Scraper] Error:', error);
    // Return empty data to trigger manual flow
    return MANUAL_HTML_REQUIRED;
  }
}

/**
 * Parse HTML using common e-commerce patterns
 * Looks for: Open Graph, JSON-LD, meta tags, common selectors
 */
function parseGenericHTML(html: string, url: string): ScrapedProductData {
  console.log('[Generic Parser] Extracting data from HTML...');
  
  const data: ScrapedProductData = {
    productName: "",
    description: "",
    price: "",
    images: [],
    vendor: extractDomain(url),
    productType: "",
    tags: "",
    compareAtPrice: "",
    costPerItem: "",
    sku: "",
    barcode: "",
    weight: "",
    weightUnit: "kg",
    options: [],
    variants: [],
  };
  
  // 1. Try JSON-LD structured data
  const jsonLdMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis);
  if (jsonLdMatch) {
    console.log(`[Generic Parser] Found ${jsonLdMatch.length} JSON-LD blocks`);
    for (const match of jsonLdMatch) {
      try {
        const jsonText = match.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '');
        const jsonData = JSON.parse(jsonText);
        
        // Extract product data from JSON-LD
        if (jsonData['@type'] === 'Product' || jsonData.name) {
          data.productName = data.productName || jsonData.name || "";
          data.description = data.description || jsonData.description || "";
          
          // Price from JSON-LD
          if (jsonData.offers) {
            const offers = Array.isArray(jsonData.offers) ? jsonData.offers[0] : jsonData.offers;
            data.price = data.price || offers.price || "";
            
            // Compare at price (highPrice or price before discount)
            if (offers.highPrice) {
              data.compareAtPrice = offers.highPrice;
            }
          }
          
          // Images from JSON-LD
          if (jsonData.image) {
            const images = Array.isArray(jsonData.image) ? jsonData.image : [jsonData.image];
            images.forEach((img: any) => {
              const imgUrl = typeof img === 'string' ? img : img.url || img.contentUrl;
              if (imgUrl && imgUrl.startsWith('http')) {
                data.images.push(imgUrl);
              }
            });
          }
          
          // SKU
          data.sku = data.sku || jsonData.sku || "";
          
          // Brand as vendor
          if (jsonData.brand) {
            const brand = typeof jsonData.brand === 'string' ? jsonData.brand : jsonData.brand.name;
            data.vendor = brand || data.vendor;
          }
          
          console.log('[Generic Parser] ✓ Extracted from JSON-LD:', {
            name: data.productName.substring(0, 50),
            price: data.price,
            images: data.images.length
          });
        }
      } catch (e) {
        // Skip invalid JSON
      }
    }
  }
  
  // 2. Extract product title using multiple strategies
  if (!data.productName) {
    // Strategy 1: Look for product-specific meta tags and elements
    const productNamePatterns = [
      /<meta[^>]*property=["']product:name["'][^>]*content=["']([^"']+)["']/i,
      /<meta[^>]*name=["']product["'][^>]*content=["']([^"']+)["']/i,
      /<h1[^>]*class=["'][^"']*product[^"']*["'][^>]*>([^<]+)<\/h1>/i,
      /<h1[^>]*class=["'][^"']*title[^"']*["'][^>]*>([^<]+)<\/h1>/i,
      /<span[^>]*class=["'][^"']*product[^"']*title[^"']*["'][^>]*>([^<]+)<\/span>/i,
      /<div[^>]*class=["'][^"']*product[^"']*title[^"']*["'][^>]*>([^<]+)<\/div>/i,
    ];
    
    for (const pattern of productNamePatterns) {
      const match = html.match(pattern);
      if (match && match[1] && match[1].trim().length > 5) {
        data.productName = match[1].trim().replace(/<[^>]*>/g, '');
        console.log('[Generic Parser] ✓ Title from product-specific pattern');
        break;
      }
    }
    
    // Strategy 2: Open Graph title (but clean it up)
    if (!data.productName) {
      const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
      if (ogTitle && ogTitle[1]) {
        // Clean og:title by removing common suffixes like " | Brand Name" or " - Website"
        let title = ogTitle[1];
        title = title.replace(/\s*[|\-–]\s*.*(Buy|Shop|Store|Online|Website|India).*$/i, '');
        title = title.replace(/\s*[|\-–]\s*[A-Z][a-z]+\s*$/i, ''); // Remove trailing brand names
        data.productName = title.trim();
        console.log('[Generic Parser] ✓ Title from og:title (cleaned)');
      }
    }
    
    // Strategy 3: Page title as last fallback
    if (!data.productName) {
      const pageTitle = html.match(/<title>([^<]+)<\/title>/i);
      if (pageTitle && pageTitle[1]) {
        let title = pageTitle[1];
        title = title.replace(/\s*[|\-–]\s*.*(Buy|Shop|Store|Online|Website|India).*$/i, '');
        title = title.replace(/\s*[|\-–]\s*[A-Z][a-z]+\s*$/i, '');
        data.productName = title.trim();
        console.log('[Generic Parser] ✓ Title from page title (cleaned)');
      }
    }
  }
  
  const ogDescription = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
  if (ogDescription && !data.description) {
    data.description = ogDescription[1];
    console.log('[Generic Parser] ✓ Description from og:description');
  }
  
  const ogImage = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/gi);
  if (ogImage) {
    ogImage.forEach(match => {
      const imgMatch = match.match(/content=["']([^"']+)["']/i);
      if (imgMatch && imgMatch[1].startsWith('http')) {
        data.images.push(imgMatch[1]);
      }
    });
    console.log(`[Generic Parser] ✓ Found ${ogImage.length} og:image tags`);
  }
  
  // 3. Try meta description as fallback
  if (!data.description) {
    const metaDesc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
    if (metaDesc) {
      data.description = metaDesc[1];
      console.log('[Generic Parser] ✓ Description from meta description');
    }
  }
  
  // 4. Try common price patterns
  if (!data.price) {
    const pricePatterns = [
      /["']price["']\s*:\s*["']?(\d+\.?\d*)["']?/i,
      /₹\s*(\d+[,\s]*\d*\.?\d{0,2})/,
      /\$\s*(\d+[,\s]*\d*\.?\d{0,2})/,
      /£\s*(\d+[,\s]*\d*\.?\d{0,2})/,
      /€\s*(\d+[,\s]*\d*\.?\d{0,2})/,
      /price[^>]*>.*?(\d+[,\s]*\d*\.?\d{0,2})/i,
    ];
    
    for (const pattern of pricePatterns) {
      const match = html.match(pattern);
      if (match) {
        data.price = match[1].replace(/[,\s]/g, ''); // Remove commas and spaces
        console.log('[Generic Parser] ✓ Price from pattern:', data.price);
        break;
      }
    }
  }
  
  // 4.5. Extract MRP/Compare-at-Price (strikethrough prices, "Was:", "MRP:", etc.)
  if (!data.compareAtPrice) {
    const mrpPatterns = [
      // Look for strikethrough/deleted prices
      /<(?:del|s|strike)[^>]*>.*?₹\s*(\d+[,\s]*\d*\.?\d{0,2})/i,
      /<(?:del|s|strike)[^>]*>.*?\$\s*(\d+[,\s]*\d*\.?\d{0,2})/i,
      // Look for "MRP", "Was", "Original Price" labels
      /(?:MRP|M\.R\.P\.|Was|Original Price|List Price)[^>]*:?[^>]*₹\s*(\d+[,\s]*\d*\.?\d{0,2})/i,
      /(?:MRP|M\.R\.P\.|Was|Original Price|List Price)[^>]*:?[^>]*\$\s*(\d+[,\s]*\d*\.?\d{0,2})/i,
      // Look for data attributes
      /data-(?:mrp|compare|original)[^>]*=["'](\d+[,\s]*\d*\.?\d{0,2})["']/i,
      // Look for class names with strikethrough/original
      /<span[^>]*class=["'][^"']*(?:strike|cross|mrp|original)[^"']*["'][^>]*>.*?₹\s*(\d+[,\s]*\d*\.?\d{0,2})/i,
    ];
    
    for (const pattern of mrpPatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        const mrpPrice = match[1].replace(/[,\s]/g, '');
        // Only use if MRP is higher than selling price
        if (data.price && parseFloat(mrpPrice) > parseFloat(data.price)) {
          data.compareAtPrice = mrpPrice;
          console.log('[Generic Parser] ✓ MRP/Compare-at-Price from pattern:', data.compareAtPrice);
          break;
        }
      }
    }
  }
  
  // 5. Try to find more images using common patterns
  if (data.images.length < 3) {
    const imgPatterns = [
      /<img[^>]*src=["']([^"']*product[^"']+)["']/gi,
      /<img[^>]*data-src=["']([^"']+)["']/gi,
      /["']image["']\s*:\s*["']([^"']+)["']/gi,
    ];
    
    for (const pattern of imgPatterns) {
      const matches = html.matchAll(pattern);
      for (const match of matches) {
        const imgUrl = match[1];
        if (imgUrl && (imgUrl.startsWith('http') || imgUrl.startsWith('//'))) {
          const fullUrl = imgUrl.startsWith('//') ? 'https:' + imgUrl : imgUrl;
          if (!data.images.includes(fullUrl)) {
            data.images.push(fullUrl);
          }
        }
      }
    }
    console.log(`[Generic Parser] Total images found: ${data.images.length}`);
  }
  
  // Clean up images (remove duplicates, invalid URLs)
  data.images = Array.from(new Set(data.images))
    .filter(img => img && img.startsWith('http'))
    .slice(0, 10); // Max 10 images
  
  // Ensure compare at price
  data.compareAtPrice = ensureCompareAtPrice(data.price, data.compareAtPrice);
  
  // Estimate weight if not found
  if (!data.weight) {
    const weightParsed = estimateWeight(data.productName);
    data.weight = weightParsed.value;
    data.weightUnit = weightParsed.unit;
  }
  
  console.log('[Generic Parser] Final result:', {
    name: data.productName.substring(0, 50),
    price: data.price,
    images: data.images.length,
    description: data.description.substring(0, 100)
  });
  
  return data;
}

/**
 * Parse HTML using Google Gemini AI
 */
async function parseWithGemini(html: string, url: string): Promise<ScrapedProductData> {
  console.log('[Generic Scraper] Using Gemini AI to parse HTML...');
  
  try {
    // Get Gemini API key from environment
    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_GEMINI_API_KEY not configured');
    }
    
    // Truncate HTML to avoid token limits (keep first 50k chars)
    const truncatedHtml = html.substring(0, 50000);
    
    const prompt = `You are a professional e-commerce data extraction expert. Your task is to analyze this product page HTML and extract ACCURATE product information.

Return ONLY a valid JSON object (no markdown code blocks, no explanations, no extra text) in this exact format:

{
  "productName": "exact product name",
  "description": "product description in HTML",
  "price": "selling price number",
  "compareAtPrice": "MRP/original price",
  "images": ["image URLs"],
  "vendor": "brand name",
  "productType": "product category/type",
  "sku": "SKU code",
  "weight": "weight value",
  "weightUnit": "unit"
}

EXTRACTION RULES (FOLLOW EXACTLY):

**CRITICAL: Always start by finding the product title first, then use it to identify the brand**

1. PRODUCT NAME - Extract the ACTUAL product title shown to customers:
   • Look for main product heading (usually h1/h2 tag or prominent title)
   • This is THE PRIMARY source of information - the brand name is usually at the START of the title or many be included within it. There might be chances that title is broken into multiple divs/spans like brand has another div/span and title remaining details have another div/span. In such cases, combine them to form the complete product title and regenerate it.  • DO NOT use website name, store name, or meta og:title if it includes brand suffixes
   • Remove website name after " | " or " - " characters
   • Example: "Nike Men's Cotton Shirt - Blue" → The brand is "Nike"
   • Example: "Roadster Men's Casual Shirt" → The brand is "Roadster"
   • Use smartly there might be chances that its broken into multiple divs/spans.

2. VENDOR (BRAND NAME) - CRITICAL - Extract the brand from the PRODUCT TITLE or as i exmplained above:
   • **PRIMARY METHOD**: The brand is usually the FIRST word or first few words in the product title
   • Look at the product title you extracted in step 1 - the brand is typically at the beginning
   • Examples:
     - "Nike Air Max Shoes" → Brand: "Nike"
     - "Roadster Men's Casual Shirt" → Brand: "Roadster"
     - "Levi's 511 Slim Fit Jeans" → Brand: "Levi's"
     - "H&M Cotton T-Shirt" → Brand: "H&M"
   • **DO NOT use "Manufactured by", "Seller", "Sold by", or "Marketed by" fields**
   • **DO NOT use the website/store name** (myntra.com, ajio.com, etc.)
   • If brand is not clear from title, look for brand meta tags or schema.org brand field
   • The brand should match what customers recognize the product by

3. DESCRIPTION - Extract comprehensive product details:
   • Include features, specifications, material, care instructions
   • Format in clean HTML with <p>, <ul>, <li> tags
   • Include size guide, fit info if available
   • At least 100-200 words of meaningful content
   • Use the brand name from step 2 naturally in the description

4. PRICE - Current selling price (customer pays this):
   • Extract the LOWEST visible price
   • Remove ALL currency symbols (₹, Rs, $, etc.)
   • Remove commas, spaces
   • Just the numeric value: "1499" NOT "₹1,499"

5. COMPARE AT PRICE (MRP) - CRITICAL for showing discounts:
   • Find strikethrough/crossed prices (<del>, <s>, <strike> tags)
   • Look for "MRP:", "M.R.P.:", "Was:", "Original Price:", "List Price:"
   • MUST be HIGHER than selling price
   • If genuinely not found, use empty string "" (don't make up or calculate)

6. IMAGES - HIGH-DEFINITION Product Gallery Images ONLY:
   **CRITICAL: Focus ONLY on the product image gallery/slider section**
   
   • **PRIMARY SOURCE**: Look for the main product image gallery or slider:
     - Usually has classes/IDs like: "gallery", "slider", "carousel", "product-images", "image-viewer", "thumbnails"
     - Often contains <img> tags within gallery containers or data attributes like data-src, data-zoom, data-large
     - May have thumbnail navigation or dots indicating multiple images
   
   • **HIGH-DEFINITION Priority** (in order of preference):
     1. FIRST: Look for zoom/large/high-res versions: data-zoom-image, data-large, data-high-res, data-full
     2. SECOND: Look for srcset with highest resolution (e.g., "image_1200x1200.jpg 1200w")
     3. THIRD: Regular src attribute from gallery/slider section
   
   • **What to INCLUDE**:
     - All unique product photos showing different angles (front, back, side, detail shots)
     - Color/style variations if available in gallery
     - Lifestyle/model shots if in the same gallery
     - Look for highest resolution URLs (prefer URLs with dimensions like 1200x1200, 1500x1500 over smaller ones)
   
   • **What to EXCLUDE**:
     - Logo images, brand watermarks
     - Banner images, promotional ads
     - Related/recommended product images (outside main gallery)
     - Icon images (cart, wishlist, share buttons)
     - Images smaller than 500x500 if possible
   
   • **Technical Requirements**:
     - Must start with http:// or https://
     - Remove duplicate URLs (same image different parameters)
     - Return 5-10 high-quality images minimum if available
     - If URL has size parameters (like /w_400/), try to maximize them (like /w_1500/)
   
   • **Common Gallery HTML Patterns to Look For**:
     - <div class="product-gallery"> ... </div>
     - <div class="image-carousel"> ... </div>
     - <ul class="product-thumbnails"> ... </ul>
     - data-image-gallery="..." or data-images="[...]"
     - JSON arrays in script tags containing image URLs

7. PRODUCT TYPE - Category/classification:
   • What type of product is this?
   • Examples: "Shirt", "T-Shirt", "Jeans", "Shoes", "Watch"
   • Be specific: "Men's Casual Shirt" better than just "Clothing"

8. WEIGHT - Physical weight if mentioned:
   • Look in product specifications table
   • Only if explicitly stated
   • Empty string if not found

HTML to analyze:
${truncatedHtml}`;


    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: prompt
            }]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2048,
          }
        }),
      }
    );
    
    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }
    
    const result = await response.json();
    const generatedText = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    console.log('[Generic Scraper] Gemini response length:', generatedText.length);
    
    // Extract JSON from response (remove markdown code blocks if present)
    let jsonText = generatedText.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```\n?$/g, '');
    }
    
    const parsedData = JSON.parse(jsonText);
    console.log('[Generic Scraper] ✓ Gemini parsing successful');
    
    // Ensure all required fields exist
    const data: ScrapedProductData = {
      productName: cleanProductName(parsedData.productName || ""),
      description: parsedData.description || "",
      price: parsedData.price || "",
      images: Array.isArray(parsedData.images) ? parsedData.images.filter((img: string) => img.startsWith('http')) : [],
      vendor: parsedData.vendor || extractDomain(url),
      productType: parsedData.productType || "",
      tags: parsedData.tags || "",
      compareAtPrice: parsedData.compareAtPrice || ensureCompareAtPrice(parsedData.price, ""),
      costPerItem: parsedData.costPerItem || "",
      sku: parsedData.sku || "",
      barcode: parsedData.barcode || "",
      weight: parsedData.weight || "",
      weightUnit: parsedData.weightUnit || "kg",
      options: parsedData.options || [],
      variants: parsedData.variants || [],
    };
    
    // Estimate weight if not found
    if (!data.weight) {
      const weightParsed = estimateWeight(data.productName);
      data.weight = weightParsed.value;
      data.weightUnit = weightParsed.unit;
    }
    
    return data;
    
  } catch (error) {
    console.error('[Generic Scraper] Gemini AI parsing failed:', error);
    
    // Return minimal data to indicate failure
    return {
      productName: "",
      description: "",
      price: "",
      images: [],
      vendor: extractDomain(url),
      productType: "",
      tags: "",
      compareAtPrice: "",
      costPerItem: "",
      sku: "",
      barcode: "",
      weight: "",
      weightUnit: "kg",
      options: [],
      variants: [],
    };
  }
}

/**
 * Extract domain name from URL for vendor
 */
function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '').split('.')[0];
  } catch {
    return "Unknown";
  }
}
