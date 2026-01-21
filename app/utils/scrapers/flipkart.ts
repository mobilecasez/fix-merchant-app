import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice, parseWeight, estimateWeight } from "./helpers";

export async function scrapeFlipkart(html: string, url: string): Promise<ScrapedProductData> {
  try {
    console.log('[Flipkart Scraper] Starting scrape for:', url);
    console.log('[Flipkart Scraper] Attempting fast fetch() first...');
    
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
      console.log(`[Flipkart Scraper] fetch() failed with status ${response.status}`);
      
      // If 529 or 403 (anti-bot), fall back to Puppeteer
      if (response.status === 529 || response.status === 403 || response.status === 503) {
        console.log('[Flipkart Scraper] Anti-bot detected, falling back to Puppeteer...');
        return await scrapeFlipkartWithPuppeteer(url);
      }
      
      // For other errors, try provided HTML
      if (html && html.length > 10000) {
        console.log('[Flipkart Scraper] Using provided HTML as fallback');
        return await parseFlipkartHTML(html, url);
      }
      
      throw new Error(`Failed to fetch Flipkart page: ${response.status}`);
    }
    
    let htmlContent = await response.text();
    console.log('[Flipkart Scraper] fetch() successful! HTML length:', htmlContent.length);
    
    // Check if we got a CAPTCHA or error page despite 200 status
    if (htmlContent.includes('Access Denied') || htmlContent.includes('Robot or human') || htmlContent.length < 5000) {
      console.log('[Flipkart Scraper] Detected CAPTCHA/block page, falling back to Puppeteer...');
      return await scrapeFlipkartWithPuppeteer(url);
    }
    
    return await parseFlipkartHTML(htmlContent, url);
  } catch (error) {
    console.error('[Flipkart Scraper] Error:', error);
    // Last resort: try Puppeteer
    console.log('[Flipkart Scraper] Attempting Puppeteer as last resort...');
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
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });
    
    // Wait a bit for dynamic content to load
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const htmlContent = await page.content();
    console.log('[Flipkart Puppeteer] Page loaded successfully, HTML length:', htmlContent.length);
    
    await browser.close();
    
    return await parseFlipkartHTML(htmlContent, url);
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
    
    // Extract description and warranty information
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
    
    // Extract warranty information
    const warrantyPatterns = [
      /(?:Warranty|warranty)[:\s]*<\/td>\s*<td[^>]*>(.*?)<\/td>/si,
      /<div[^>]*>(?:Warranty|warranty)[:\s]*(.*?)<\/div>/si,
      /(?:Warranty|warranty)[:\s]*([^<\n]+)/i
    ];
    
    for (const pattern of warrantyPatterns) {
      const match = htmlContent.match(pattern);
      if (match) {
        const warrantyInfo = match[1].replace(/<[^>]*>/g, '').trim();
        if (warrantyInfo && warrantyInfo.length > 5) {
          description += (description ? '\n\n' : '') + `Warranty: ${warrantyInfo}`;
          console.log('[Flipkart Scraper] Warranty found:', warrantyInfo);
          break;
        }
      }
    }
    
    // Extract images from rukminim CDN - ONLY from product gallery
    const images: string[] = [];
    
    // First, try to find the section BEFORE "frequently bought" or similar sections
    // Split HTML at common "frequently bought together" markers
    const splitMarkers = [
      /Frequently Bought Together/i,
      /Similar Products/i,
      /You May Also Like/i,
      /Customers who viewed/i,
      /<div[^>]*class="[^"]*_3n4TvP[^"]*"/i  // Flipkart's frequently bought container
    ];
    
    let productSection = htmlContent;
    for (const marker of splitMarkers) {
      const splitPos = htmlContent.search(marker);
      if (splitPos > 5000) { // Must be after product info (at least 5KB in)
        productSection = htmlContent.substring(0, splitPos);
        console.log('[Flipkart Scraper] Found section marker, cutting at position:', splitPos);
        break;
      }
    }
    
    // Extract all image URLs from product section only
    const imagePattern = /https:\/\/rukminim[12]\.flixcart\.com\/image\/[^"'\s<>]+\.(jpg|jpeg|png|webp)/gi;
    const imageMatches = productSection.match(imagePattern);
    
    if (imageMatches) {
      // Track seen images to avoid duplicates
      const seenImages = new Set<string>();
      
      imageMatches.forEach(imgUrl => {
        // Clean URL - remove any HTML fragments and query parameters
        let cleanUrl = imgUrl.split('>')[0].split('<')[0].split('"')[0].split("'")[0].split('?')[0];
        
        // Skip very small thumbnails
        if (cleanUrl.includes('/128/128/') || cleanUrl.includes('/64/64/') || cleanUrl.includes('/50/50/')) {
          return;
        }
        
        // Convert to high resolution (832x832)
        let highResUrl = cleanUrl
          .replace(/\/200\/200\//, '/832/832/')
          .replace(/\/312\/312\//, '/832/832/')
          .replace(/\/416\/416\//, '/832/832/')
          .replace(/\/1664\/1664\//, '/832/832/');
        
        // Extract unique identifier to avoid duplicates
        const urlId = highResUrl.match(/\/([^\/]+)\.(jpg|jpeg|png|webp)$/i);
        if (urlId && !seenImages.has(urlId[1])) {
          seenImages.add(urlId[1]);
          images.push(highResUrl);
        }
      });
    }
    
    console.log('[Flipkart Scraper] Images extracted:', images.length);
    if (images.length > 0) {
      console.log('[Flipkart Scraper] First image:', images[0]);
      console.log('[Flipkart Scraper] Last image:', images[images.length - 1]);
    }
    
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
      images: images,
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
