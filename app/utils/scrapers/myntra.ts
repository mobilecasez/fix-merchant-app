import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice, parseWeight, estimateWeight } from "./helpers";

export async function scrapeMyntra(html: string, url: string): Promise<ScrapedProductData> {
  try {
    console.log('[Myntra Scraper] Starting scrape for:', url);
    
    // Try fetch() first - Puppeteer is too heavy for Railway environment
    try {
      console.log('[Myntra Scraper] Attempting fetch() with enhanced headers...');
      
      // Random delay to mimic human behavior
      await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'accept-language': 'en-US,en;q=0.9',
          'accept-encoding': 'gzip, deflate, br',
          'referer': 'https://www.myntra.com/',
          'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': 'same-origin',
          'upgrade-insecure-requests': '1',
        },
      });
      
      if (!response.ok) {
        console.log(`[Myntra Scraper] fetch() failed with status ${response.status}`);
        throw new Error(`Failed to fetch Myntra page: ${response.status}`);
      }
      
      let htmlContent = await response.text();
      console.log('[Myntra Scraper] fetch() successful! HTML length:', htmlContent.length);
      
      return await parseMyntraHTML(htmlContent, url);
    } catch (fetchError) {
      console.error('[Myntra Scraper] fetch() failed:', fetchError);
      
      // If fetch fails and we have provided HTML, try using it
      if (html && html.length > 5000) {
        console.log('[Myntra Scraper] Using provided HTML...');
        return await parseMyntraHTML(html, url);
      }
      
      throw fetchError;
    }
  } catch (error) {
    console.error('[Myntra Scraper] All methods failed:', error);
    
    return {
      productName: "",
      description: "",
      price: "",
      images: [],
      vendor: "Myntra",
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

// Puppeteer fallback for when anti-bot blocks fetch()
async function scrapeMyntraWithPuppeteer(url: string): Promise<ScrapedProductData> {
  const puppeteer = await import('puppeteer');
  let browser;
  
  try {
    console.log('[Myntra Puppeteer] Launching browser with enhanced stealth...');
    browser = await puppeteer.default.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920x1080',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--lang=en-US,en'
      ],
    });
    
    const page = await browser.newPage();
    
    // Enhanced anti-detection: Override webdriver property
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
      // Add chrome object
      (window as any).chrome = {
        runtime: {},
      };
      // Override permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters: any) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission } as PermissionStatus) :
          originalQuery(parameters)
      );
    });
    
    // Set realistic viewport and user agent
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'accept-encoding': 'gzip, deflate, br',
      'referer': 'https://www.google.com/',
      'sec-ch-ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'none',
      'sec-fetch-user': '?1',
      'upgrade-insecure-requests': '1',
    });
    
    // Block unnecessary resources to speed up
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (['stylesheet', 'font', 'media'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });
    
    console.log('[Myntra Puppeteer] Navigating to URL...');
    await page.goto(url, { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });
    
    console.log('[Myntra Puppeteer] Page loaded, waiting for content...');
    
    // Wait for dynamic content to render
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const htmlContent = await page.content();
    console.log('[Myntra Puppeteer] Page loaded successfully, HTML length:', htmlContent.length);
    
    // Check if we got a maintenance/block page
    if (htmlContent.length < 5000 || htmlContent.includes('Site Maintenance') || htmlContent.includes('Access Denied')) {
      console.error('[Myntra Puppeteer] Detected block page - HTML too small or contains block indicators');
      throw new Error('Myntra blocked the request - try again later');
    }
    
    await browser.close();
    
    return await parseMyntraHTML(htmlContent, url);
  } catch (error) {
    console.error('[Myntra Puppeteer] Error:', error);
    if (browser) {
      await browser.close();
    }
    throw error;
  }
}

async function parseMyntraHTML(htmlContent: string, url: string): Promise<ScrapedProductData> {
  try {
    console.log('[Myntra Scraper] Parsing HTML...');
    console.log('[Myntra Scraper] HTML length:', htmlContent.length);
    
    // First, try to extract JSON data from script tags - Myntra embeds product data as JSON
    let productData: any = null;
    
    // Pattern 1: Look for __PRELOADED_STATE__ or similar JSON data
    const jsonPatterns = [
      /<script[^>]*>window\.__PRELOADED_STATE__\s*=\s*({.*?})<\/script>/gs,
      /<script[^>]*>window\.pdpData\s*=\s*({.*?})<\/script>/gs,
      /<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs,
      /<script[^>]*>var\s+pdpData\s*=\s*({.*?});<\/script>/gs,
    ];
    
    for (const pattern of jsonPatterns) {
      const matches = htmlContent.matchAll(pattern);
      for (const match of matches) {
        try {
          const jsonText = match[1];
          productData = JSON.parse(jsonText);
          if (productData && (productData.name || productData.pdpData || productData['@type'] === 'Product')) {
            console.log('[Myntra Scraper] Found product JSON data');
            break;
          }
        } catch (e) {
          // Invalid JSON, continue
        }
      }
      if (productData) break;
    }
    
    // Extract from JSON if available
    let productName = "";
    let price = "";
    let compareAtPrice = "";
    let images: string[] = [];
    let description = "";
    let brand = "";
    let sizes: string[] = [];
    
    if (productData) {
      console.log('[Myntra Scraper] Extracting from JSON data');
      
      // Try different JSON structures
      if (productData['@type'] === 'Product') {
        // JSON-LD format
        productName = productData.name || "";
        if (productData.offers) {
          price = '₹' + (productData.offers.price || "");
          compareAtPrice = '₹' + (productData.offers.highPrice || "");
        }
        if (productData.image) {
          images = Array.isArray(productData.image) ? productData.image : [productData.image];
        }
        description = productData.description || "";
        brand = productData.brand?.name || "";
      } else if (productData.pdpData) {
        // Myntra's custom format
        const pd = productData.pdpData;
        productName = pd.name || "";
        price = pd.price?.discounted ? '₹' + pd.price.discounted : "";
        compareAtPrice = pd.price?.mrp ? '₹' + pd.price.mrp : "";
        images = pd.media?.albums?.[0]?.images || [];
        description = pd.description || "";
        brand = pd.brand?.name || "";
        sizes = pd.sizes?.map((s: any) => s.label) || [];
      }
    }
    
    // If JSON extraction failed, fall back to HTML parsing
    if (!productName) {
      console.log('[Myntra Scraper] JSON extraction failed, trying HTML patterns...');
      
      // Extract product name from HTML
      const namePatterns = [
        /<h1[^>]*class="[^"]*pdp-title[^"]*"[^>]*>(.*?)<\/h1>/s,
        /<h1[^>]*class="[^"]*pdp-name[^"]*"[^>]*>(.*?)<\/h1>/s,
        /"name"\s*:\s*"([^"]+)"/,
        /<meta[^>]*property="og:title"[^>]*content="([^"]+)"/,
        /<title>([^<]+)<\/title>/,
      ];
      
      for (const pattern of namePatterns) {
        const match = htmlContent.match(pattern);
        if (match) {
          productName = match[1].replace(/<[^>]*>/g, '').trim();
          if (productName) break;
        }
      }
    }
    
    console.log('[Myntra Scraper] Product name:', productName);
    
    if (!price) {
      // Extract price from HTML
      const pricePatterns = [
        /<span[^>]*class="[^"]*pdp-price[^"]*"[^>]*>.*?₹\s*([\d,]+)/s,
        /<strong[^>]*class="[^"]*pdp-price[^"]*"[^>]*>.*?₹\s*([\d,]+)/s,
        /"price"\s*:\s*"?₹?\s*([\d,]+)"?/,
        /<span[^>]*class="[^"]*pdp-discount-price[^"]*"[^>]*>.*?₹\s*([\d,]+)/s,
        /"discounted"\s*:\s*(\d+)/,
      ];
      
      for (const pattern of pricePatterns) {
        const match = htmlContent.match(pattern);
        if (match) {
          price = '₹' + match[1];
          console.log('[Myntra Scraper] Price found:', price);
          break;
        }
      }
    }
    
    if (!compareAtPrice) {
      // Extract compare at price (MRP) from HTML
      const comparePatterns = [
        /<span[^>]*class="[^"]*pdp-mrp[^"]*"[^>]*>.*?₹\s*([\d,]+)/s,
        /<s[^>]*>.*?₹\s*([\d,]+)/s,
        /<del[^>]*>.*?₹\s*([\d,]+)/s,
        /"mrp"\s*:\s*"?₹?\s*([\d,]+)"?/,
        /"mrp"\s*:\s*(\d+)/,
      ];
      
      for (const pattern of comparePatterns) {
        const match = htmlContent.match(pattern);
        if (match) {
          compareAtPrice = '₹' + match[1];
          console.log('[Myntra Scraper] Compare price found:', compareAtPrice);
          break;
        }
      }
    }
    
    if (!description) {
      // Extract description from HTML
      const descPatterns = [
        /<div[^>]*class="[^"]*pdp-product-description-content[^"]*"[^>]*>(.*?)<\/div>/s,
        /<div[^>]*class="[^"]*pdp-description[^"]*"[^>]*>(.*?)<\/div>/s,
        /<div[^>]*class="[^"]*product-description[^"]*"[^>]*>(.*?)<\/div>/s,
        /"description"\s*:\s*"([^"]+)"/,
      ];
      
      for (const pattern of descPatterns) {
        const match = htmlContent.match(pattern);
        if (match) {
          description = match[1].trim();
          if (description.length > 50) break;
        }
      }
    }
    
    if (images.length === 0) {
      // Extract images from Myntra's image viewer or JSON data
      console.log('[Myntra Scraper] Extracting images from HTML...');
      
      // Pattern 1: Look for image URLs in image viewer
      const imagePattern = /https:\/\/assets\.myntassets\.com\/[^"'\s<>]+\.(jpg|jpeg|png|webp)/gi;
      const imageMatches = htmlContent.match(imagePattern);
      
      if (imageMatches) {
        imageMatches.forEach(imgUrl => {
          // Clean URL - remove any HTML fragments
          const cleanUrl = imgUrl.split('>')[0].split('<')[0].split('"')[0].split("'")[0];
          
          // Convert to high-res by removing size parameters or changing dimensions
          let highResUrl = cleanUrl;
          // Remove size parameters that might limit quality
          highResUrl = highResUrl.replace(/\/w_\d+,h_\d+\//, '/');
          highResUrl = highResUrl.replace(/\/resize\/\d+x\d+\//, '/');
          
          // Only include product images (not logos, icons, etc)
          if (highResUrl.includes('/h_') || highResUrl.includes('/f_auto') || !highResUrl.includes('/w_')) {
            if (!images.includes(highResUrl)) {
              images.push(highResUrl);
            }
          }
        });
      }
      
      // Pattern 2: Look in JSON data for image URLs
      const jsonImagePattern = /"(?:image|images|imageUrl)"\s*:\s*"(https:\/\/assets\.myntassets\.com\/[^"]+)"/gi;
      let jsonMatch;
      while ((jsonMatch = jsonImagePattern.exec(htmlContent)) !== null) {
        const imgUrl = jsonMatch[1];
        if (!images.includes(imgUrl)) {
          images.push(imgUrl);
        }
      }
    }
    
    const uniqueImages = Array.from(new Set(images)).slice(0, 10);
    console.log('[Myntra Scraper] Images extracted:', uniqueImages.length);
    
    if (sizes.length === 0) {
      // Extract size options if available
      const sizePattern = /<button[^>]*class="[^"]*size-buttons-[^"]*"[^>]*>([^<]+)<\/button>/gi;
      let sizeMatch;
      while ((sizeMatch = sizePattern.exec(htmlContent)) !== null) {
        const size = sizeMatch[1].trim();
        if (size && !sizes.includes(size)) {
          sizes.push(size);
        }
      }
    }
    
    if (!brand) {
      // Extract brand from HTML
      const brandPatterns = [
        /<div[^>]*class="[^"]*pdp-title[^"]*"[^>]*><h1[^>]*class="[^"]*pdp-name[^"]*"[^>]*>([^<]+)/s,
        /"brand"\s*:\s*"([^"]+)"/,
        /<meta[^>]*property="og:brand"[^>]*content="([^"]+)"/,
      ];
      
      for (const pattern of brandPatterns) {
        const match = htmlContent.match(pattern);
        if (match) {
          brand = match[1].trim();
          if (brand) break;
        }
      }
    }
    
    // Extract material/fabric details
    let materialInfo = "";
    const materialPattern = /(?:Material|Fabric)[:\s]*<\/span>.*?<span[^>]*>(.*?)<\/span>/si;
    const materialMatch = htmlContent.match(materialPattern);
    if (materialMatch) {
      materialInfo = materialMatch[1].replace(/<[^>]*>/g, '').trim();
    }
    
    // Build final description with additional details
    let finalDescription = description;
    
    if (brand) {
      finalDescription += `<p><strong>Brand:</strong> ${brand}</p>`;
    }
    
    if (materialInfo) {
      finalDescription += `<p><strong>Material:</strong> ${materialInfo}</p>`;
    }
    
    if (sizes.length > 0) {
      finalDescription += `<p><strong>Available Sizes:</strong> ${sizes.join(', ')}</p>`;
    }
    
    // Extract weight or estimate
    let weight = "";
    let weightUnit = "kg";
    const weightPatterns = [
      /(?:Weight|Net Weight)[:\s]*<\/span>.*?<span[^>]*>(.*?)<\/span>/si,
      /(?:weight|Weight)[:\s]*([\d.]+)\s*(kg|g|grams?|kilograms?)/i
    ];
    
    for (const pattern of weightPatterns) {
      const match = htmlContent.match(pattern);
      if (match) {
        const weightText = match[1] || match[0];
        const weightNum = weightText.match(/([\d.]+)/);
        const unitMatch = weightText.match(/(kg|g|grams?|kilograms?)/i);
        
        if (weightNum) {
          weight = weightNum[1];
          if (unitMatch) {
            const unit = unitMatch[1].toLowerCase();
            if (unit.includes('kg') || unit.includes('kilogram')) weightUnit = "kg";
            else if (unit === 'g' || unit.includes('gram')) weightUnit = "g";
          }
          console.log('[Myntra Scraper] Weight found:', weight, weightUnit);
          break;
        }
      }
    }
    
    // Estimate weight if not found (clothing is typically light)
    let finalWeight = weight;
    let finalWeightUnit = weightUnit;
    
    if (!weight) {
      console.log('[Myntra Scraper] No weight found, estimating for clothing');
      // Most clothing items are 200-500g
      finalWeight = "0.3";
      finalWeightUnit = "kg";
    }
    
    // Ensure compare at price
    const finalCompareAtPrice = ensureCompareAtPrice(price, compareAtPrice);
    
    return {
      productName: cleanProductName(productName),
      description: finalDescription,
      price,
      compareAtPrice: finalCompareAtPrice,
      images: uniqueImages,
      vendor: "Myntra",
      productType: "",
      tags: "",
      costPerItem: "",
      sku: "",
      barcode: "",
      weight: finalWeight,
      weightUnit: finalWeightUnit,
      options: sizes.length > 0 ? [{ name: "Size", values: sizes.join(', ') }] : [],
      variants: [],
    };
  } catch (error) {
    console.error('[Myntra Scraper] Parse error:', error);
    throw error;
  }
}
