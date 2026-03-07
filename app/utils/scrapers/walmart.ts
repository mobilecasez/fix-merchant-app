import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice, parseWeight, estimateWeight } from "./helpers";
import { MANUAL_HTML_REQUIRED } from "./generic";

export async function scrapeWalmart(html: string, url: string): Promise<ScrapedProductData | typeof MANUAL_HTML_REQUIRED> {
  try {
    console.log('[Walmart Scraper] Starting scrape for:', url);
    console.log('[Walmart Scraper] HTML length provided:', html?.length || 0);
    
    let htmlContent = "";
    let originalHTTPContent = ""; // Backup of original HTTP response
    let fetchSuccessful = false;
    
    // STEP 1: Try fast HTTP request first (works ~30% of the time)
    console.log('[Walmart Scraper] 🚀 Attempting fast HTTP request...');
    try {
      await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
      
      const response = await fetch(url, {
        headers: {
          'accept-language': 'en-US,en;q=0.9',
          'accept-encoding': 'gzip, deflate, br',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'referer': 'https://www.walmart.com/',
          'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': 'same-origin',
          'sec-fetch-user': '?1',
          'upgrade-insecure-requests': '1',
        },
      });
      
      if (response.ok) {
        htmlContent = await response.text();
        originalHTTPContent = htmlContent; // Save backup before validation
        console.log('[Walmart Scraper] ✓ HTTP request successful, HTML length:', htmlContent.length);
        
        // Verify it has price elements
        const hasPriceElements = (
          /\$[\d,]+\.?\d{0,2}/.test(htmlContent) ||
          htmlContent.includes('"price"') ||
          htmlContent.includes('priceInfo') ||
          htmlContent.includes('currentPrice')
        );
        
        // Check for CAPTCHA or blocking (more lenient)
        const isBlocked = (
          htmlContent.includes('Robot or human') ||
          htmlContent.includes('BogleWeb') ||
          htmlContent.includes('Activate and hold the button') ||
          htmlContent.length < 10000 ||
          !hasPriceElements
        );
        
        if (!isBlocked) {
          console.log('[Walmart Scraper] ✅ HTTP fetch SUCCESS - valid HTML with price elements');
          fetchSuccessful = true;
        } else {
          console.log('[Walmart Scraper] ⚠️ HTTP fetch validation failed, will try Puppeteer...');
          console.log('[Walmart Scraper]    - Length check:', htmlContent.length >= 10000);
          console.log('[Walmart Scraper]    - Has price elements:', hasPriceElements);
          console.log('[Walmart Scraper]    - Is CAPTCHA:', htmlContent.includes('Robot or human'));
          // Don't clear htmlContent - keep it as potential fallback
        }
      } else {
        console.log(`[Walmart Scraper] ❌ HTTP error: ${response.status} ${response.statusText}`);
      }
    } catch (httpError) {
      console.log('[Walmart Scraper] ❌ HTTP request failed:', httpError);
    }
    
    // STEP 2: If HTTP failed, try manual HTML from user (if provided)
    if (!fetchSuccessful && html && html.length > 10000) {
      console.log('[Walmart Scraper] 📋 Checking provided manual HTML...');
      const hasPriceElements = (
        /\$[\d,]+\.?\d{0,2}/.test(html) ||
        html.includes('"price"') ||
        html.includes('priceInfo') ||
        html.includes('currentPrice')
      );
      
      const isClean = (
        !html.includes('Robot or human') &&
        !html.includes('BogleWeb') &&
        hasPriceElements
      );
      
      if (isClean) {
        console.log('[Walmart Scraper] ✅ Using provided manual HTML (valid)');
        htmlContent = html;
        fetchSuccessful = true;
      } else {
        console.log('[Walmart Scraper] ⚠️ Provided HTML invalid or missing price elements');
      }
    }
    
    // STEP 3: If still no valid HTML, use enhanced Puppeteer stealth mode with retries
    if (!fetchSuccessful) {
      console.log('[Walmart Scraper] 🤖 Attempting enhanced Puppeteer stealth mode with retry logic...');
      let lastError: Error | null = null;
      const maxRetries = 3;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`[Walmart Scraper] 🔄 Stealth Puppeteer attempt ${attempt}/${maxRetries}...`);
          const puppeteerHTML = await scrapeWalmartWithPuppeteerStealth(url, attempt);
          
          if (puppeteerHTML && puppeteerHTML.length > 10000) {
            console.log('[Walmart Scraper] ✓ Puppeteer fetched HTML, length:', puppeteerHTML.length);
            
            // Verify Puppeteer HTML has price elements
            const puppeteerHasPriceElements = (
              /\$[\d,]+\.?\d{0,2}/.test(puppeteerHTML) ||
              puppeteerHTML.includes('"price"') ||
              puppeteerHTML.includes('priceInfo') ||
              puppeteerHTML.includes('currentPrice')
            );
            
            // Check for CAPTCHA
            const isCaptcha = (
              puppeteerHTML.includes('Robot or human') ||
              puppeteerHTML.includes('BogleWeb') ||
              puppeteerHTML.includes('Activate and hold the button')
            );
            
            console.log('[Walmart Scraper] Puppeteer result - Has price elements:', puppeteerHasPriceElements, ', Is CAPTCHA:', isCaptcha);
            
            if (puppeteerHasPriceElements && !isCaptcha) {
              htmlContent = puppeteerHTML;
              fetchSuccessful = true;
              console.log(`[Walmart Scraper] ✅ Stealth Puppeteer SUCCESS on attempt ${attempt}`);
              break;
            } else {
              console.log(`[Walmart Scraper] ⚠️ Attempt ${attempt}: HTML fetched but blocked/invalid, retrying...`);
              if (attempt < maxRetries) {
                const backoffDelay = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
                console.log(`[Walmart Scraper] ⏳ Waiting ${backoffDelay}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, backoffDelay));
              }
            }
          } else {
            throw new Error('Puppeteer returned insufficient HTML');
          }
        } catch (puppeteerError) {
          lastError = puppeteerError as Error;
          console.error(`[Walmart Scraper] ❌ Attempt ${attempt} failed:`, puppeteerError);
          
          if (attempt < maxRetries) {
            const backoffDelay = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
            console.log(`[Walmart Scraper] ⏳ Waiting ${backoffDelay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
          }
        }
      }
      
      // If all Puppeteer attempts failed, try using original HTTP content as last resort
      if (!fetchSuccessful && originalHTTPContent && originalHTTPContent.length > 10000) {
        console.log('[Walmart Scraper] ⚠️ All Puppeteer attempts failed, using original HTTP content as fallback');
        console.log('[Walmart Scraper] 🔄 HTTP content length:', originalHTTPContent.length);
        htmlContent = originalHTTPContent;
        fetchSuccessful = true;
      }
      
      // If still no valid HTML after all attempts
      if (!fetchSuccessful) {
        console.error('[Walmart Scraper] ❌ All automatic methods failed after', maxRetries, 'Puppeteer attempts');
        console.error('[Walmart Scraper] 📋 Manual HTML paste required as last resort');
        console.log('[Walmart Scraper] Returning MANUAL_HTML_REQUIRED flag');
        return MANUAL_HTML_REQUIRED;
      }
    }
    
    console.log('[Walmart Scraper] Final HTML length before parsing:', htmlContent.length);
    console.log('[Walmart Scraper] Proceeding to parse HTML...');
    
    return await parseWalmartHTML(htmlContent, url);
  } catch (error) {
    console.error('[Walmart Scraper] Error:', error);
    throw error;
  }
}

async function parseWalmartHTML(htmlContent: string, url: string): Promise<ScrapedProductData> {
  try {
    console.log('[Walmart Scraper] Parsing HTML...');
    
    // First try to extract from JSON-LD structured data
    let productData: any = null;
    const jsonLdPattern = /<script type="application\/ld\+json">(.*?)<\/script>/gs;
    const jsonLdMatches = htmlContent.matchAll(jsonLdPattern);
    
    for (const match of jsonLdMatches) {
      try {
        const json = JSON.parse(match[1]);
        if (json['@type'] === 'Product' || (json['@graph'] && Array.isArray(json['@graph']))) {
          const product = json['@type'] === 'Product' ? json : json['@graph'].find((item: any) => item['@type'] === 'Product');
          if (product) {
            productData = product;
            console.log('[Walmart Scraper] Found JSON-LD product data');
            break;
          }
        }
      } catch (e) {
        // Skip invalid JSON
      }
    }
    
    // Also check for embedded __NEXT_DATA__ or window.__WML_REDUX_INITIAL_STATE__
    let reactData: any = null;
    const nextDataPattern = /<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s;
    const nextDataMatch = htmlContent.match(nextDataPattern);
    if (nextDataMatch) {
      try {
        const json = JSON.parse(nextDataMatch[1]);
        console.log('[Walmart Scraper] Found __NEXT_DATA__');
        reactData = json;
      } catch (e) {
        console.log('[Walmart Scraper] Failed to parse __NEXT_DATA__');
      }
    }
    
    // Try window.__WML_REDUX_INITIAL_STATE__
    const reduxPattern = /window\.__WML_REDUX_INITIAL_STATE__\s*=\s*({.*?});/s;
    const reduxMatch = htmlContent.match(reduxPattern);
    if (reduxMatch) {
      try {
        const json = JSON.parse(reduxMatch[1]);
        console.log('[Walmart Scraper] Found __WML_REDUX_INITIAL_STATE__');
        if (json.product) {
          reactData = json;
        }
      } catch (e) {
        console.log('[Walmart Scraper] Failed to parse __WML_REDUX_INITIAL_STATE__');
      }
    }
    
    // Extract product name
    let productName = "";
    
    // From JSON-LD
    if (productData?.name) {
      productName = productData.name;
    }
    // From React data
    else if (reactData?.props?.pageProps?.initialData?.data?.product?.name) {
      productName = reactData.props.pageProps.initialData.data.product.name;
    }
    else if (reactData?.product?.name) {
      productName = reactData.product.name;
    }
    // From HTML
    else {
      const namePatterns = [
        /<h1 itemprop="name"[^>]*>(.*?)<\/h1>/s,
        /<h1[^>]*class="[^"]*prod-ProductTitle[^"]*"[^>]*>(.*?)<\/h1>/s,
        /<h1[^>]*data-testid="product-title"[^>]*>(.*?)<\/h1>/s,
        /<h1[^>]*>(.*?)<\/h1>/s
      ];
      
      for (const pattern of namePatterns) {
        const match = htmlContent.match(pattern);
        if (match) {
          productName = match[1].replace(/<[^>]*>/g, '').trim();
          if (productName && productName.length > 3) break;
        }
      }
    }
    console.log('[Walmart Scraper] Product name:', productName);
    
    // Extract price
    let price = "";
    let compareAtPrice = "";
    
    // From JSON-LD
    if (productData?.offers) {
      const offers = Array.isArray(productData.offers) ? productData.offers[0] : productData.offers;
      if (offers.price) {
        price = offers.price.toString();
        console.log('[Walmart Scraper] Price from JSON-LD:', price);
      }
      if (offers.priceValidUntil || offers.highPrice) {
        compareAtPrice = offers.highPrice?.toString() || "";
      }
    }
    // From React data
    else if (reactData?.props?.pageProps?.initialData?.data?.product?.priceInfo) {
      const priceInfo = reactData.props.pageProps.initialData.data.product.priceInfo;
      if (priceInfo.currentPrice?.price) {
        price = priceInfo.currentPrice.price.toString();
        console.log('[Walmart Scraper] Price from React data:', price);
      }
      if (priceInfo.wasPrice?.price) {
        compareAtPrice = priceInfo.wasPrice.price.toString();
      }
    }
    else if (reactData?.product?.priceInfo) {
      const priceInfo = reactData.product.priceInfo;
      if (priceInfo.currentPrice?.price) {
        price = priceInfo.currentPrice.price.toString();
      }
      if (priceInfo.wasPrice?.price) {
        compareAtPrice = priceInfo.wasPrice.price.toString();
      }
    }
    // From HTML
    else {
      const pricePatterns = [
        /<span itemprop="price"[^>]*content="([^"]+)"/,
        /<span[^>]*data-testid="price-wrap"[^>]*>\$?([\d,]+\.?\d*)<\/span>/,
        /<span[^>]*class="[^"]*price-characteristic[^"]*"[^>]*>(.*?)<\/span>/s,
        /\$[\d,]+\.?\d*/
      ];
      
      for (const pattern of pricePatterns) {
        const match = htmlContent.match(pattern);
        if (match) {
          price = match[1] || match[0];
          price = price.replace(/<[^>]*>/g, '').replace(/\$/g, '').trim();
          if (price && parseFloat(price.replace(/,/g, '')) > 0) {
            console.log('[Walmart Scraper] Price from HTML:', price);
            break;
          }
        }
      }
      
      // Extract compare at price from HTML
      const comparePatterns = [
        /<span[^>]*class="[^"]*was-price[^"]*"[^>]*>\$?([\d,]+\.?\d*)<\/span>/s,
        /<span[^>]*class="[^"]*strikethrough[^"]*"[^>]*>\$?([\d,]+\.?\d*)<\/span>/s,
        /<del[^>]*>\$?([\d,]+\.?\d*)<\/del>/
      ];
      
      for (const pattern of comparePatterns) {
        const match = htmlContent.match(pattern);
        if (match) {
          compareAtPrice = match[1].replace(/<[^>]*>/g, '').replace(/\$/g, '').trim();
          if (compareAtPrice && parseFloat(compareAtPrice.replace(/,/g, '')) > 0) break;
        }
      }
    }
    
    console.log('[Walmart Scraper] Final price:', price);
    console.log('[Walmart Scraper] Compare at price:', compareAtPrice);
    
    // Extract description
    let description = "";
    
    // From JSON-LD
    if (productData?.description) {
      description = productData.description;
    }
    // From React data
    else if (reactData?.props?.pageProps?.initialData?.data?.product?.shortDescription) {
      description = reactData.props.pageProps.initialData.data.product.shortDescription;
    }
    else if (reactData?.product?.shortDescription) {
      description = reactData.product.shortDescription;
    }
    // From HTML
    else {
      const descPatterns = [
        /<div[^>]*class="[^"]*about-desc[^"]*"[^>]*>(.*?)<\/div>/s,
        /<div[^>]*data-testid="product-description"[^>]*>(.*?)<\/div>/s,
        /<div[^>]*itemprop="description"[^>]*>(.*?)<\/div>/s
      ];
      
      for (const pattern of descPatterns) {
        const match = htmlContent.match(pattern);
        if (match) {
          description = match[1].trim();
          if (description.length > 50) break;
        }
      }
    }
    
    // Extract images
    const images: string[] = [];
    
    // From JSON-LD
    if (productData?.image) {
      const imageUrls = Array.isArray(productData.image) ? productData.image : [productData.image];
      imageUrls.forEach((img: string) => {
        if (img && !images.includes(img)) {
          images.push(img);
        }
      });
      console.log('[Walmart Scraper] Images from JSON-LD:', images.length);
    }
    
    // From React data
    if (reactData?.props?.pageProps?.initialData?.data?.product?.imageInfo?.allImages) {
      const allImages = reactData.props.pageProps.initialData.data.product.imageInfo.allImages;
      allImages.forEach((img: any) => {
        if (img.url && !images.includes(img.url)) {
          images.push(img.url);
        }
      });
      console.log('[Walmart Scraper] Images from React data:', images.length);
    }
    else if (reactData?.product?.imageInfo?.allImages) {
      const allImages = reactData.product.imageInfo.allImages;
      allImages.forEach((img: any) => {
        if (img.url && !images.includes(img.url)) {
          images.push(img.url);
        }
      });
    }
    
    // From HTML - multiple patterns
    if (images.length === 0) {
      console.log('[Walmart Scraper] No images from structured data, extracting from HTML...');
      
      // Pattern 1: i5.walmartimages.com with various paths
      const imgPatterns = [
        /https?:\/\/i5\.walmartimages\.com\/(asr|ad|seo|dfw)\/[a-f0-9-]+\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s]*)?/gi,
        /https?:\/\/i5\.walmartimages\.com\/[^"'\s]+\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s]*)?/gi,
      ];
      
      for (const pattern of imgPatterns) {
        const matches = htmlContent.matchAll(pattern);
        for (const match of matches) {
          let imgUrl = match[0];
          // Remove query params for cleaner URLs
          imgUrl = imgUrl.split('?')[0];
          
          // Skip common non-product images
          if (imgUrl.includes('icon') || 
              imgUrl.includes('logo') || 
              imgUrl.includes('badge') ||
              imgUrl.includes('sprite') ||
              imgUrl.length < 50) {
            continue;
          }
          
          if (!images.includes(imgUrl)) {
            images.push(imgUrl);
          }
        }
        
        if (images.length > 0) break;
      }
      
      // Pattern 2: Look for img tags with data-src or src
      if (images.length === 0) {
        const imgTagPattern = /<img[^>]+(?:src|data-src)="([^"]+)"[^>]*>/gi;
        const imgTagMatches = htmlContent.matchAll(imgTagPattern);
        
        for (const match of imgTagMatches) {
          let imgUrl = match[1];
          if (imgUrl.includes('walmartimages.com') && imgUrl.match(/\.(jpg|jpeg|png|webp)/i)) {
            imgUrl = imgUrl.split('?')[0];
            if (!images.includes(imgUrl) && !imgUrl.includes('icon') && !imgUrl.includes('logo')) {
              images.push(imgUrl);
            }
          }
        }
      }
    }
    
    const uniqueImages = Array.from(new Set(images)).slice(0, 10);
    console.log('[Walmart Scraper] Total unique images extracted:', uniqueImages.length);
    if (uniqueImages.length > 0) {
      console.log('[Walmart Scraper] First 3 images:');
      uniqueImages.slice(0, 3).forEach((img, idx) => {
        console.log(`  ${idx + 1}. ${img}`);
      });
    }
    
    // Extract SKU/UPC
    let sku = "";
    let barcode = "";
    
    // From JSON-LD
    if (productData?.sku) {
      sku = productData.sku;
    }
    if (productData?.gtin || productData?.gtin13 || productData?.gtin12) {
      barcode = productData.gtin || productData.gtin13 || productData.gtin12;
    }
    
    // From React data
    if (!sku && reactData?.props?.pageProps?.initialData?.data?.product?.id) {
      sku = reactData.props.pageProps.initialData.data.product.id;
    }
    else if (!sku && reactData?.product?.id) {
      sku = reactData.product.id;
    }
    
    if (!barcode && reactData?.props?.pageProps?.initialData?.data?.product?.upc) {
      barcode = reactData.props.pageProps.initialData.data.product.upc;
    }
    else if (!barcode && reactData?.product?.upc) {
      barcode = reactData.product.upc;
    }
    
    console.log('[Walmart Scraper] SKU:', sku);
    console.log('[Walmart Scraper] Barcode/UPC:', barcode);
    
    // Extract weight
    let weight = "";
    let weightUnit = "lb";
    const weightPatterns = [
      /(?:Assembled Product Weight|Item Weight|Weight)[:\s]*<\/[^>]+>.*?<[^>]+>(.*?)<\/[^>]+>/si,
      /(?:weight|Weight)[:\s]*([\d.]+)\s*(lbs?|pounds?|kg|g|grams?|oz|ounces?)/i
    ];
    
    for (const pattern of weightPatterns) {
      const match = htmlContent.match(pattern);
      if (match) {
        const weightText = match[1] || match[0];
        const weightNum = weightText.match(/([\d.]+)/);
        const unitMatch = weightText.match(/(lbs?|pounds?|kg|g|grams?|oz|ounces?)/i);
        
        if (weightNum) {
          weight = weightNum[1];
          if (unitMatch) {
            const unit = unitMatch[1].toLowerCase();
            if (unit.includes('lb') || unit.includes('pound')) weightUnit = "lb";
            else if (unit.includes('kg') || unit.includes('kilogram')) weightUnit = "kg";
            else if (unit === 'g' || unit.includes('gram')) weightUnit = "g";
            else if (unit.includes('oz') || unit.includes('ounce')) {
              weight = (parseFloat(weight) / 16).toFixed(2);
              weightUnit = "lb";
            }
          }
          console.log('[Walmart Scraper] Weight found:', weight, weightUnit);
          break;
        }
      }
    }
    
    // Final weight handling
    let finalWeight = weight;
    let finalWeightUnit = weightUnit;
    
    if (!weight) {
      console.log('[Walmart Scraper] No weight found, estimating');
      const estimated = estimateWeight(productName);
      finalWeight = estimated.value;
      finalWeightUnit = estimated.unit;
    }
    
    const finalCompareAtPrice = ensureCompareAtPrice(price, compareAtPrice);
    
    console.log('[Walmart Scraper] ========================================');
    console.log('[Walmart Scraper] FINAL DATA SUMMARY:');
    console.log('[Walmart Scraper] Product Name:', productName);
    console.log('[Walmart Scraper] Price:', price);
    console.log('[Walmart Scraper] Compare At Price:', finalCompareAtPrice);
    console.log('[Walmart Scraper] Images:', uniqueImages.length);
    console.log('[Walmart Scraper] SKU:', sku);
    console.log('[Walmart Scraper] Barcode:', barcode);
    console.log('[Walmart Scraper] Weight:', finalWeight, finalWeightUnit);
    console.log('[Walmart Scraper] ========================================');
    
    return {
      productName: cleanProductName(productName),
      description,
      price,
      compareAtPrice: finalCompareAtPrice,
      images: uniqueImages,
      vendor: "Walmart",
      productType: "",
      tags: "",
      costPerItem: "",
      sku: sku,
      barcode: barcode,
      weight: finalWeight,
      weightUnit: finalWeightUnit,
      options: [],
      variants: [],
    };
  } catch (error) {
    console.error('[Walmart Scraper] Parse error:', error);
    throw error;
  }
}

// Enhanced Puppeteer with stealth mode and human-like behavior for Walmart
async function scrapeWalmartWithPuppeteerStealth(url: string, attemptNumber: number = 1): Promise<string> {
  console.log(`[Walmart Stealth] 🚀 Launching stealth browser (attempt ${attemptNumber})...`);
  
  try {
    const puppeteerExtra = await import('puppeteer-extra');
    const StealthPlugin = await import('puppeteer-extra-plugin-stealth');
    
    puppeteerExtra.default.use(StealthPlugin.default());
    
    const browser = await puppeteerExtra.default.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    });

    const page = await browser.newPage();
    
    // Randomize viewport for more human-like behavior
    const viewportWidth = 1920 + Math.floor(Math.random() * 100);
    const viewportHeight = 1080 + Math.floor(Math.random() * 100);
    await page.setViewport({ width: viewportWidth, height: viewportHeight });
    
    // Set extra headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Referer': 'https://www.walmart.com/',
      'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-user': '?1',
      'upgrade-insecure-requests': '1',
    });

    console.log('[Walmart Stealth] Navigating to:', url);
    
    // Add random delay before navigation (human-like)
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
    
    // Navigate with networkidle2 for better content loading
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 45000,
    });

    console.log('[Walmart Stealth] Page loaded, simulating human behavior...');
    
    // Random wait (human-like)
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
    
    // Human-like scrolling behavior
    console.log('[Walmart Stealth] Scrolling page naturally...');
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight / 2) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });
    
    // Random mouse movements (more human-like)
    await page.mouse.move(100 + Math.random() * 500, 100 + Math.random() * 500);
    await new Promise(resolve => setTimeout(resolve, Math.random() * 500 + 200));
    await page.mouse.move(200 + Math.random() * 500, 200 + Math.random() * 500);
    
    // Wait for content to load
    console.log('[Walmart Stealth] Waiting for product content...');
    try {
      await page.waitForSelector('h1, [itemprop="name"], [data-testid="product-title"], script[type="application/ld+json"]', { timeout: 8000 });
      console.log('[Walmart Stealth] ✓ Product elements found');
    } catch (e) {
      console.log('[Walmart Stealth] ⚠️ Product elements not found, continuing anyway...');
    }
    
    // Additional wait for JavaScript to render
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get the HTML content
    const html = await page.content();
    console.log('[Walmart Stealth] Extracted HTML, length:', html.length);

    await browser.close();
    console.log('[Walmart Stealth] Browser closed successfully');

    return html;
  } catch (error) {
    console.error('[Walmart Stealth] Error:', error);
    throw error;
  }
}
