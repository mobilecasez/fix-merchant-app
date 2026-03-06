import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice, parseWeight, estimateWeight } from "./helpers";

export async function scrapeWalmart(html: string, url: string): Promise<ScrapedProductData> {
  try {
    console.log('[Walmart Scraper] Starting scrape for:', url);
    console.log('[Walmart Scraper] HTML length provided:', html?.length || 0);
    
    // Use provided HTML if available, otherwise fetch
    let htmlContent = html;
    
    if (!htmlContent || htmlContent.length < 10000) {
      console.log('[Walmart Scraper] Fetching page with HTTP request...');
      await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'accept-language': 'en-US,en;q=0.9',
          'accept-encoding': 'gzip, deflate, br',
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
      
      if (!response.ok) {
        console.log(`[Walmart Scraper] HTTP error: ${response.status}`);
        throw new Error(`Failed to fetch Walmart page: ${response.status}`);
      }
      
      htmlContent = await response.text();
      console.log('[Walmart Scraper] Page fetched successfully, HTML length:', htmlContent.length);
    }
    
    // Check for CAPTCHA or bot detection
    const hasCaptcha = htmlContent.includes('Robot or human') || 
                       htmlContent.includes('BogleWeb') || 
                       htmlContent.includes('Activate and hold the button') ||
                       htmlContent.length < 15000;
    
    if (hasCaptcha) {
      console.log('[Walmart Scraper] CAPTCHA/Bot detection detected, HTML length:', htmlContent.length);
      
      // Check if provided HTML parameter is also CAPTCHA
      const providedHtmlHasCaptcha = html && (
        html.includes('Robot or human') || 
        html.includes('BogleWeb') ||
        html.includes('Activate and hold the button') ||
        html.length < 15000
      );
      
      // Try to use the provided HTML parameter as fallback ONLY if it's clean
      if (html && html.length > 15000 && !providedHtmlHasCaptcha) {
        console.log('[Walmart Scraper] ✓ Using clean provided HTML parameter as fallback');
        htmlContent = html;
      } else {
        if (providedHtmlHasCaptcha) {
          console.log('[Walmart Scraper] ⚠️ Provided HTML also has CAPTCHA, trying Puppeteer instead');
        }
        
        // Try Puppeteer fallback
        console.log('[Walmart Scraper] Attempting Puppeteer fallback...');
        try {
          const puppeteerHTML = await scrapeWalmartWithPuppeteer(url);
          if (puppeteerHTML && puppeteerHTML.length > 10000) {
            console.log('[Walmart Scraper] ✓ Puppeteer fetched HTML, length:', puppeteerHTML.length);
            
            // Check if Puppeteer HTML also has CAPTCHA
            const puppeteerHasCaptcha = puppeteerHTML.includes('Robot or human') || 
                                       puppeteerHTML.includes('BogleWeb') ||
                                       puppeteerHTML.includes('Activate and hold the button');
            
            if (!puppeteerHasCaptcha) {
              console.log('[Walmart Scraper] ✓ Puppeteer HTML looks clean, using it');
              htmlContent = puppeteerHTML;
            } else {
              console.log('[Walmart Scraper] ⚠️ Puppeteer also got CAPTCHA, keeping for AI fallback');
              htmlContent = puppeteerHTML; // Keep it anyway for AI to try
            }
          } else {
            console.log('[Walmart Scraper] ⚠️ Puppeteer HTML too short, keeping original for AI fallback');
            // Don't throw error - keep the original HTML for AI fallback
          }
        } catch (puppeteerError) {
          console.error('[Walmart Scraper] Puppeteer error:', puppeteerError);
          console.log('[Walmart Scraper] ⚠️ Keeping original HTML for AI fallback');
          // Don't throw error - keep the original HTML for AI fallback
        }
      }
    }
    
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

// Puppeteer fallback for Walmart when HTTP requests get blocked
async function scrapeWalmartWithPuppeteer(url: string): Promise<string> {
  console.log('[Walmart Puppeteer] Launching headless browser...');
  
  try {
    const puppeteer = await import('puppeteer');
    
    const browser = await puppeteer.default.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled', // Hide automation
        '--window-size=1920x1080',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ],
    });

    const page = await browser.newPage();
    
    // Remove automation flags
    await page.evaluateOnNewDocument(() => {
      // Overwrite the `navigator.webdriver` property
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
      
      // Mock plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      
      // Mock languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
      
      // Mock platform
      Object.defineProperty(navigator, 'platform', {
        get: () => 'Win32',
      });
    });
    
    // Set realistic viewport
    await page.setViewport({ width: 1920, height: 1080 });
    
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

    console.log('[Walmart Puppeteer] Navigating to:', url);
    
    // Navigate with longer timeout
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 45000,
    });

    console.log('[Walmart Puppeteer] Page loaded, waiting for content...');
    
    // Wait longer for dynamic content to load
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Try to wait for product elements (but don't fail if not found)
    try {
      await page.waitForSelector('h1, [itemprop="name"], [data-testid="product-title"], script[type="application/ld+json"]', { timeout: 5000 });
      console.log('[Walmart Puppeteer] ✓ Product elements found');
    } catch (e) {
      console.log('[Walmart Puppeteer] ⚠️ Product elements not found, continuing anyway...');
    }
    
    // Scroll the page to trigger lazy loading
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
    });
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get the HTML content
    const html = await page.content();
    console.log('[Walmart Puppeteer] Extracted HTML, length:', html.length);

    await browser.close();
    console.log('[Walmart Puppeteer] Browser closed');

    return html;
  } catch (error) {
    console.error('[Walmart Puppeteer] Error:', error);
    throw error;
  }
}
