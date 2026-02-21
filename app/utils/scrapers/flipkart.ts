import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice, parseWeight, estimateWeight } from "./helpers";

export async function scrapeFlipkart(html: string, url: string): Promise<ScrapedProductData> {
  try {
    console.log('[Flipkart Scraper] Starting scrape for:', url);
    console.log('[Flipkart Scraper] HTML parameter provided:', !!html, 'Length:', html?.length || 0);
    
    let htmlContent = html;
    
    // Only fetch if HTML parameter is not provided or is too small
    if (!html || html.length < 10000) {
      console.log('[Flipkart Scraper] Fetching page with HTTP request...');
      
      // Random delay to mimic human behavior
      await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'accept-language': 'en-US,en;q=0.9',
          'accept-encoding': 'gzip, deflate, br',
          'referer': 'https://www.flipkart.com/',
          'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': 'same-origin',
          'upgrade-insecure-requests': '1',
        },
      });
      
      // Check if we hit anti-bot protection (529 or similar errors)
      if (!response.ok) {
        console.log(`[Flipkart Scraper] HTTP error: ${response.status} ${response.statusText}`);
        
        // Try to use the provided HTML parameter as fallback
        if (html && html.length > 10000) {
          console.log('[Flipkart Scraper] Using provided HTML as fallback');
          htmlContent = html;
        } else if (response.status === 529 || response.status === 403 || response.status === 503) {
          // If 529 or 403 (anti-bot) and no HTML fallback, try Puppeteer
          console.log('[Flipkart Scraper] Anti-bot detected, falling back to Puppeteer...');
          return await scrapeFlipkartWithPuppeteer(url);
        } else {
          throw new Error(`Failed to fetch Flipkart page: ${response.status}`);
        }
      } else {
        htmlContent = await response.text();
        console.log('[Flipkart Scraper] Page fetched successfully, HTML length:', htmlContent.length);
        
        // Check if we got a CAPTCHA or error page despite 200 status
        if (htmlContent.includes('Access Denied') || 
            htmlContent.includes('Robot or human') || 
            htmlContent.length < 5000) {
          console.log('[Flipkart Scraper] CAPTCHA/Bot detection page detected');
          
          // Try to use the provided HTML parameter as fallback
          if (html && html.length > 10000) {
            console.log('[Flipkart Scraper] Using provided HTML parameter as fallback');
            htmlContent = html;
          } else {
            console.log('[Flipkart Scraper] Falling back to Puppeteer...');
            return await scrapeFlipkartWithPuppeteer(url);
          }
        }
      }
    } else {
      console.log('[Flipkart Scraper] Using provided HTML parameter (already fetched)');
    }
    
    return await parseFlipkartHTML(htmlContent, url);
  } catch (error) {
    console.error('[Flipkart Scraper] Error:', error);
    
    // Try to use provided HTML parameter as last resort before Puppeteer
    if (html && html.length > 10000) {
      console.log('[Flipkart Scraper] Attempting to parse provided HTML as last resort...');
      try {
        return await parseFlipkartHTML(html, url);
      } catch (parseError) {
        console.error('[Flipkart Scraper] Parse error:', parseError);
      }
    }
    
    // Final fallback: try Puppeteer
    console.log('[Flipkart Scraper] Attempting Puppeteer as final fallback...');
    try {
      return await scrapeFlipkartWithPuppeteer(url);
    } catch (puppeteerError) {
      console.error('[Flipkart Scraper] Puppeteer also failed:', puppeteerError);
      return {
        productName: "",
        description: "",
        price: "",
        images: [],
        vendor: "Flipkart",
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
}

// Puppeteer fallback for when anti-bot blocks fetch()
async function scrapeFlipkartWithPuppeteer(url: string): Promise<ScrapedProductData> {
  const puppeteer = await import('puppeteer');
  let browser;
  
  try {
    console.log('[Flipkart Puppeteer] Launching browser with stealth mode...');
    browser = await puppeteer.default.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920x1080',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 0.0 Safari/537.36'
      ],
    });
    
    const page = await browser.newPage();
    
    // Set viewport and extra headers
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({
      'accept-language': 'en-US,en;q=0.9',
      'accept-encoding': 'gzip, deflate, br',
      'referer': 'https://www.flipkart.com/',
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
    
    console.log('[Flipkart Puppeteer] Navigating to URL...');
    await page.goto(url, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    // Wait for dynamic content to load
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log('[Flipkart Puppeteer] Extracting product data from DOM...');
    
    // Get page title - most reliable source for product name
    const pageTitle = await page.title();
    
    // Extract data directly from the DOM
    const productData = await page.evaluate((title) => {
      // Helper to clean text
      const cleanText = (text: string | null | undefined) => text?.trim().replace(/\s+/g, ' ') || '';
      
      // Extract product name from page title (most reliable)
      let productName = '';
      
      // Clean page title - remove Flipkart branding
      if (title) {
        productName = title
          .replace(/\s*\|\s*Flipkart\.com.*$/i, '')
          .replace(/\s*Online at Best Price in India.*$/i, '')
          .replace(/\s*Buy\s+/i, '')
          .replace(/\s*at\s+Flipkart.*$/i, '')
          .trim();
      }
      
      // Fallback: try breadcrumb/navigation text if title extraction failed
      if (!productName || productName.length < 10) {
        const bodyText = document.body.innerText;
        const lines = bodyText.split('\n').map(l => l.trim());
        
        // Look for product-like lines (contains size, specs, brand keywords)
        for (const line of lines) {
          if (line.length > 20 && line.length < 200 &&
              line.match(/\d+\s*(L|ML|KG|G|W|GB|TB|Inch|MM|CM)|Door|Star|Refrigerator|Speaker|Bluetooth|Soundbar/i) &&
              !line.match(/^(Login|Cart|More|Key|Highlights|Visit|Buy|Apply|Bank|EMI|₹)/i)) {
            productName = line;
            break;
          }
        }
      }
      
      // Extract MRP (strikethrough price) and selling price
      let mrp = ''; // Compare at price (strikethrough)
      let price = ''; // Actual selling price
      
      // Strategy: Find the main product pricing section
      // The main price usually appears with:
      // 1. Discount percentage (like "86%")
      // 2. Strikethrough original price
      // 3. Current price with ₹ symbol
      // They typically appear together in the same container
      
      // 1. First, find selling price - look for prominent price with ₹ (not in ads)
      // Main product price is usually NOT in these patterns:
      // - "Buy at ₹..." (CTA button)
      // - "Pay ₹..." (EMI)
      // - Small prices < ₹100
      
      const bodyText = document.body.innerText;
      const textLines = bodyText.split('\n').map(l => l.trim());
      
      // Find lines with just price (₹X,XXX format) - these are likely the main prices
      let foundPriceSection = false;
      for (let i = 0; i < textLines.length; i++) {
        const line = textLines[i];
        
        // Look for selling price pattern: just "₹X,XXX" on its own line or with discount%
        if (line.match(/^(↓\d+%)?₹\s*[\d,]+$/) || line.match(/^\d+%\s*₹\s*[\d,]+$/)) {
          const priceMatch = line.match(/₹\s*([\d,]+)/);
          if (priceMatch) {
            const priceValue = parseInt(priceMatch[1].replace(/,/g, ''));
            if (priceValue > 500) { // Reasonable product price
              price = '₹' + priceMatch[1];
              foundPriceSection = true;
              
              // Look for MRP in nearby lines (usually 1-2 lines before)
              for (let j = Math.max(0, i - 3); j < i; j++) {
                const prevLine = textLines[j];
                // MRP is usually just numbers (no ₹) or has ↓discount%
                const mrpMatch = prevLine.match(/^(↓\d+%)?(\d{1,2},?\d{3,})$/);
                if (mrpMatch && !prevLine.includes('₹')) {
                  const mrpValue = parseInt(mrpMatch[2].replace(/,/g, ''));
                  if (mrpValue > priceValue) { // MRP should be higher than selling price
                    mrp = '₹' + mrpMatch[2];
                    break;
                  }
                }
              }
              
              if (price) break; // Found main price, stop searching
            }
          }
        }
      }
      
      // Fallback 1: Look for strikethrough elements near price elements
      if (!mrp || !price) {
        const strikeDivs = Array.from(document.querySelectorAll('div[style*="line-through"]'));
        const strikePrices: string[] = [];
        
        strikeDivs.forEach(el => {
          const text = el.textContent?.trim() || '';
          const priceMatch = text.match(/(\d{1,2},?\d{3,})/);
          if (priceMatch) {
            const priceValue = parseInt(priceMatch[1].replace(/,/g, ''));
            if (priceValue > 500) {
              strikePrices.push('₹' + priceMatch[1]);
            }
          }
        });
        
        if (strikePrices.length > 0 && !mrp) {
          mrp = strikePrices[0];
        }
      }
      
      // Fallback 2: Extract from body text if still not found
      if (!price) {
        const allPrices = bodyText.match(/₹\s*([\d,]+)/g) || [];
        for (const priceText of allPrices) {
          const match = priceText.match(/₹\s*([\d,]+)/);
          if (match) {
            const priceValue = parseInt(match[1].replace(/,/g, ''));
            if (priceValue > 500 && priceValue < 1000000) {
              price = '₹' + match[1];
              break;
            }
          }
        }
      }
      
      // Extract images - look for product images
      const images: string[] = [];
      const imgElements = document.querySelectorAll('img[src*="rukminim"], img[src*="flixcart"]');
      imgElements.forEach(img => {
        const src = img.getAttribute('src');
        if (src && src.includes('rukminim') && src.match(/\.(jpg|jpeg|png|webp)/i)) {
          // Convert to high-res
          let highRes = src.replace(/\/128\/128\//, '/832/832/')
                          .replace(/\/416\/416\//, '/832/832/')
                          .replace(/\/200\/200\//, '/832/832/')
                          .replace(/\/312\/312\//, '/832/832/')
                          .replace(/\/80\/80\//, '/832/832/');
          if (!images.includes(highRes)) {
            images.push(highRes);
          }
        }
      });
      
      // Get page text for description
      const description = bodyText.substring(0, 500);
      
      return {
        productName,
        price,
        mrp,
        images,
        description,
      };
    }, pageTitle);
    
    console.log('[Flipkart Puppeteer] Extracted:', {
      name: productData.productName,
      price: productData.price,
      mrp: productData.mrp,
      images: productData.images.length
    });
    
    await browser.close();
    
    // Validate and return
    const estimated = estimateWeight(productData.productName);
    
    // Use MRP as compare at price if available, otherwise calculate
    const finalCompareAtPrice = productData.mrp || ensureCompareAtPrice(productData.price, '');
    
    return {
      productName: cleanProductName(productData.productName),
      description: productData.description,
      price: productData.price,
      compareAtPrice: finalCompareAtPrice,
      images: productData.images.slice(0, 10),
      vendor: "Flipkart",
      productType: "",
      tags: "",
      costPerItem: "",
      sku: "",
      barcode: "",
      weight: estimated.value,
      weightUnit: estimated.unit,
      options: [],
      variants: [],
    };
  } catch (error) {
    console.error('[Flipkart Puppeteer] Error:', error);
    if (browser) {
      await browser.close();
    }
    throw error;
  }
}

async function parseFlipkartHTML(htmlContent: string, url: string): Promise<ScrapedProductData> {
  try {
    console.log('[Flipkart Scraper] Parsing HTML...');
    
    // Extract product name
    let productName = "";
    const namePatterns = [
      /<span class="VU-ZEz">(.*?)<\/span>/s,
      /<span class="B_NuCI">(.*?)<\/span>/s,
      /<h1[^>]*><span[^>]*class="[^"]*VU-[^"]*"[^>]*>(.*?)<\/span>/s,
      /<h1[^>]*>(.*?)<\/h1>/s
    ];
    
    for (const pattern of namePatterns) {
      const match = htmlContent.match(pattern);
      if (match) {
        productName = match[1].replace(/<[^>]*>/g, '').trim();
        if (productName) break;
      }
    }
    console.log('[Flipkart Scraper] Product name:', productName);
    
    // Extract price
    let price = "";
    const pricePatterns = [
      /<div class="Nx9bqj CxhGGd"[^>]*>(.*?)<\/div>/s,
      /<div class="_30jeq3 _16Jk6d"[^>]*>(.*?)<\/div>/s,
      /<div class="_30jeq3"[^>]*>(.*?)<\/div>/s,
      /₹([\d,]+)/
    ];
    
    for (const pattern of pricePatterns) {
      const match = htmlContent.match(pattern);
      if (match) {
        const priceText = match[1] || match[0];
        const priceNum = priceText.match(/₹?([\d,]+)/);
        if (priceNum) {
          price = '₹' + priceNum[1];
          console.log('[Flipkart Scraper] Price found:', price);
          break;
        }
      }
    }
    
    // Extract compare at price
    let compareAtPrice = "";
    const comparePatterns = [
      /<div class="yRaY8j ZYYwLA"[^>]*>(.*?)<\/div>/s,
      /<div class="yRaY8j"[^>]*>(.*?)<\/div>/s,
      /<div class="_3I9_wc _2p6lqe"[^>]*>(.*?)<\/div>/s
    ];
    
    for (const pattern of comparePatterns) {
      const match = htmlContent.match(pattern);
      if (match) {
        const compareText = match[1];
        const compareNum = compareText.match(/₹?([\d,]+)/);
        if (compareNum) {
          compareAtPrice = '₹' + compareNum[1];
          console.log('[Flipkart Scraper] Compare price found:', compareAtPrice);
          break;
        }
      }
    }
    
    // Extract description
    let description = "";
    const descPatterns = [
      /<div class="_6VBbE3"[^>]*>(.*?)<\/div>/s,
      /<div class="_1mXcCf"[^>]*>(.*?)<\/div>/s,
      /<div class="_3WHvuP"[^>]*>(.*?)<\/div>/s
    ];
    
    for (const pattern of descPatterns) {
      const match = htmlContent.match(pattern);
      if (match) {
        description = match[1].trim();
        if (description.length > 50) break;
      }
    }
    
    // Extract images from rukminim CDN
    const images: string[] = [];
    const imagePattern = /https:\/\/rukminim[12]\.flixcart\.com\/image\/[^"'\s<>]+\.(jpg|jpeg|png|webp)/gi;
    const imageMatches = htmlContent.match(imagePattern);
    
    if (imageMatches) {
      imageMatches.forEach(imgUrl => {
        // Clean URL - remove any HTML fragments
        const cleanUrl = imgUrl.split('>')[0].split('<')[0].split('"')[0].split("'")[0];
        
        // Convert to high-res by changing dimensions
        let highResUrl = cleanUrl;
        // Replace small dimensions with large ones
        highResUrl = highResUrl.replace(/\/128\/128\//, '/832/832/');
        highResUrl = highResUrl.replace(/\/416\/416\//, '/832/832/');
        highResUrl = highResUrl.replace(/\/200\/200\//, '/832/832/');
        highResUrl = highResUrl.replace(/\/312\/312\//, '/832/832/');
        
        if (!images.includes(highResUrl) && !highResUrl.includes('/128/') && !highResUrl.includes('/64/')) {
          images.push(highResUrl);
        }
      });
    }
    
    const uniqueImages = Array.from(new Set(images)).slice(0, 10);
    console.log('[Flipkart Scraper] Images extracted:', uniqueImages.length);
    
    // Extract weight
    let weight = "";
    let weightUnit = "kg";
    const weightPatterns = [
      /(?:Item Weight|Product Weight|Weight)[:\s]*<\/td>\s*<td[^>]*>(.*?)<\/td>/si,
      /(?:weight|Weight)[:\s]*([\d.]+)\s*(kg|g|grams?|kilograms?|lbs?|pounds?)/i
    ];
    
    for (const pattern of weightPatterns) {
      const match = htmlContent.match(pattern);
      if (match) {
        const weightText = match[1] || match[0];
        const weightNum = weightText.match(/([\d.]+)/);
        const unitMatch = weightText.match(/(kg|g|grams?|kilograms?|lbs?|pounds?)/i);
        
        if (weightNum) {
          weight = weightNum[1];
          if (unitMatch) {
            const unit = unitMatch[1].toLowerCase();
            if (unit.includes('kg') || unit.includes('kilogram')) weightUnit = "kg";
            else if (unit === 'g' || unit.includes('gram')) weightUnit = "g";
            else if (unit.includes('lb') || unit.includes('pound')) weightUnit = "lb";
          }
          console.log('[Flipkart Scraper] Weight found:', weight, weightUnit);
          break;
        }
      }
    }
    
    // Parse weight or estimate
    let finalWeight = weight;
    let finalWeightUnit = weightUnit;
    
    if (!weight) {
      console.log('[Flipkart Scraper] No weight found, estimating');
      const estimated = estimateWeight(productName);
      finalWeight = estimated.value;
      finalWeightUnit = estimated.unit;
    }
    
    // Ensure compare at price
    const finalCompareAtPrice = ensureCompareAtPrice(price, compareAtPrice);
    
    return {
      productName: cleanProductName(productName),
      description,
      price,
      compareAtPrice: finalCompareAtPrice,
      images: uniqueImages,
      vendor: "Flipkart",
      productType: "",
      tags: "",
      costPerItem: "",
      sku: "",
      barcode: "",
      weight: finalWeight,
      weightUnit: finalWeightUnit,
      options: [],
      variants: [],
    };
  } catch (error) {
    console.error('[Flipkart Scraper] Parse error:', error);
    throw error;
  }
}
