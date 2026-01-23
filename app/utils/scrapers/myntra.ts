import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice, parseWeight, estimateWeight } from "./helpers";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

export async function scrapeMyntra(html: string, url: string): Promise<ScrapedProductData> {
  try {
    console.log('[Myntra Scraper] Starting scrape for:', url);
    
    // CRITICAL: Myntra blocks server-side fetch requests completely (returns 483-byte maintenance page)
    // Check if provided HTML is blocked (too small)
    const isHtmlBlocked = !html || html.length < 10000;
    
    if (isHtmlBlocked) {
      console.log('[Myntra Scraper] HTML is blocked or missing (length:', html?.length || 0, '), using Puppeteer...');
      return await scrapeMyntraWithPuppeteer(url);
    }
    
    console.log('[Myntra Scraper] Using provided HTML from browser (length:', html.length, ')');
    return await parseMyntraJSON(html, url);

  } catch (error) {
    console.error("[Myntra Scraper] Error:", error);
    // Return empty fallback
    return {
      productName: "", description: "", price: "", images: [], vendor: "Myntra",
      productType: "", tags: "", compareAtPrice: "", costPerItem: "", sku: "",
      barcode: "", weight: "", weightUnit: "kg", options: [], variants: [],
    };
  }
}

async function scrapeMyntraWithPuppeteer(url: string): Promise<ScrapedProductData> {
  let browser;
  try {
    console.log('[Myntra Puppeteer] Using puppeteer-extra with stealth plugin...');
    
    // Add stealth plugin to evade detection
    puppeteer.use(StealthPlugin());
    
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--disable-blink-features=AutomationControlled',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      ]
    });

    const page = await browser.newPage();
    
    // Set realistic viewport
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Set comprehensive headers
    await page.setExtraHTTPHeaders({
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'accept-encoding': 'gzip, deflate, br',
      'cache-control': 'max-age=0',
      'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'none',
      'sec-fetch-user': '?1',
      'upgrade-insecure-requests': '1',
    });

    console.log('[Myntra Puppeteer] Navigating to URL...');
    await page.goto(url, { 
      waitUntil: 'networkidle0',
      timeout: 90000 
    });

    // Wait for dynamic content to load
    console.log('[Myntra Puppeteer] Waiting for content to load...');
    await new Promise(resolve => setTimeout(resolve, 8000));

    const htmlContent = await page.content();
    console.log('[Myntra Puppeteer] Page loaded! HTML length:', htmlContent.length);
    
    // Log first 500 chars to debug
    console.log('[Myntra Puppeteer] First 500 chars:', htmlContent.substring(0, 500));

    await browser.close();

    return await parseMyntraJSON(htmlContent, url);

  } catch (error) {
    console.error('[Myntra Puppeteer] Error:', error);
    if (browser) await browser.close();
    throw error;
  }
}

async function parseMyntraJSON(htmlContent: string, url: string): Promise<ScrapedProductData> {
    console.log('[Myntra Scraper] Extracting JSON blob from HTML...');

    // Myntra stores all product data in a script variable named window.__myx
    // We regex to find this specific script content
    const scriptRegex = /<script>window\.__myx\s*=\s*({.*?})<\/script>/;
    const match = htmlContent.match(scriptRegex);

    let pdpData: any = null;

    if (match && match[1]) {
        try {
            const jsonRaw = match[1];
            const parsedData = JSON.parse(jsonRaw);
            // The structure is usually window.__myx = { pdpData: { ... } }
            pdpData = parsedData.pdpData;
            console.log('[Myntra Scraper] Successfully parsed window.__myx JSON');
        } catch (e) {
            console.error('[Myntra Scraper] JSON Parsing failed', e);
        }
    }

    // Fallback: If JSON fails, try standard regex (less reliable on Myntra)
    if (!pdpData) {
        console.log('[Myntra Scraper] JSON blob not found, falling back to regex extraction');
        return extractViaRegex(htmlContent);
    }

    // --- 1. Extract Basic Info from JSON ---
    const productName = pdpData.name || pdpData.analytics?.articleName || "";
    const brand = pdpData.brand?.name || "Myntra";
    
    // Description: Myntra usually has "productDetails" array
    let description = pdpData.productDetails 
        ? pdpData.productDetails.map((d: any) => `<p><strong>${d.title}:</strong> ${d.description}</p>`).join('')
        : "";

    // Add material info if available
    if (pdpData.articleAttributes?.['Fabric']) {
        description += `<p><strong>Material:</strong> ${pdpData.articleAttributes['Fabric']}</p>`;
    }

    // --- 2. Extract Price ---
    // Myntra prices are usually numbers, need conversion to string
    const price = pdpData.price?.discounted ? pdpData.price.discounted.toString() : "";
    const compareAtPrice = pdpData.price?.mrp ? pdpData.price.mrp.toString() : "";

    // --- 3. Extract & Fix Images (The Critical Part) ---
    // Myntra images come in a 'media' array. The URLs usually have low-res params.
    // We must regex replace them to get 'h_1440,q_100,w_1080'
    
    let images: string[] = [];
    if (pdpData.media && pdpData.media.albums && pdpData.media.albums.length > 0) {
        // Usually the first album contains the main images
        images = pdpData.media.albums[0].images.map((img: any) => {
            let src = img.src || img.secureSrc;
            if (!src) return null;

            // FIX RESOLUTION
            // Pattern: assets.myntassets.com/.../h_($H),q_($Q),w_($W)/...
            // We force it to max quality
            return src
                .replace(/h_\d+/, 'h_1440')
                .replace(/w_\d+/, 'w_1080')
                .replace(/q_\d+/, 'q_100');
        }).filter((url: string | null) => url !== null);
    }

    console.log(`[Myntra Scraper] Extracted ${images.length} high-res images`);

    // --- 4. Variants (Sizes) ---
    // Myntra lists sizes in pdpData.sizes
    const variants: any[] = [];
    if (pdpData.sizes && Array.isArray(pdpData.sizes)) {
        pdpData.sizes.forEach((size: any) => {
            if (size.available) {
                variants.push({
                    title: size.label,
                    price: price,
                    compareAtPrice: compareAtPrice,
                    sku: size.skuId || ""
                });
            }
        });
    }

    // Weight Estimation
    const weightParsed = estimateWeight(productName);
    
    return {
        productName: cleanProductName(productName),
        description: description,
        price,
        compareAtPrice: ensureCompareAtPrice(price, compareAtPrice),
        images: images,
        vendor: brand,
        productType: pdpData.analytics?.masterCategory || "Clothing",
        tags: [pdpData.analytics?.gender, pdpData.analytics?.articleType].filter(Boolean).join(", "),
        costPerItem: "",
        sku: pdpData.id ? pdpData.id.toString() : "",
        barcode: "",
        weight: weightParsed.value,
        weightUnit: weightParsed.unit,
        options: variants.length > 0 ? [{ name: "Size", values: variants.map(v => v.title).join(", ") }] : [],
        variants: variants
    };
}

// Fallback function if the JSON script is missing (unlikely but safe to have)
function extractViaRegex(html: string): ScrapedProductData {
    const titleMatch = html.match(/<h1 class="pdp-title"[^>]*>(.*?)<\/h1>/);
    const nameMatch = html.match(/<h1 class="pdp-name"[^>]*>(.*?)<\/h1>/);
    
    const title = titleMatch ? titleMatch[1] : "";
    const name = nameMatch ? nameMatch[1] : "";
    const fullName = `${title} ${name}`.trim();

    const priceMatch = html.match(/"price":(\d+)/);
    const mrpMatch = html.match(/"mrp":(\d+)/);

    // Regex for images in standard HTML (flaky in React apps)
    const imgRegex = /backgroundImage:\s*url\((.*?)\)/g;
    const images: string[] = [];
    let match;
    while ((match = imgRegex.exec(html)) !== null) {
        if(match[1]) images.push(match[1].replace(/["']/g, ""));
    }

    const weightParsed = estimateWeight(fullName);

    return {
        productName: cleanProductName(fullName),
        description: "",
        price: priceMatch ? priceMatch[1] : "",
        compareAtPrice: mrpMatch ? mrpMatch[1] : "",
        images: images,
        vendor: "Myntra",
        productType: "",
        tags: "",
        costPerItem: "",
        sku: "",
        barcode: "",
        weight: weightParsed.value,
        weightUnit: weightParsed.unit,
        options: [],
        variants: []
    };
}
