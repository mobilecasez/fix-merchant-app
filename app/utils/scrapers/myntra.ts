import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice, parseWeight, estimateWeight } from "./helpers";

export async function scrapeMyntra(html: string, url: string): Promise<ScrapedProductData> {
  try {
    console.log('[Myntra Scraper] Starting scrape for:', url);
    console.log('[Myntra Scraper] Attempting fast fetch() first...');
    
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
    
    // Check if we hit anti-bot protection (529 or similar errors)
    if (!response.ok) {
      console.log(`[Myntra Scraper] fetch() failed with status ${response.status}`);
      
      // If 529 or 403 (anti-bot), fall back to Puppeteer
      if (response.status === 529 || response.status === 403 || response.status === 503) {
        console.log('[Myntra Scraper] Anti-bot detected, falling back to Puppeteer...');
        return await scrapeMyntraWithPuppeteer(url);
      }
      
      // For other errors, try provided HTML
      if (html && html.length > 10000) {
        console.log('[Myntra Scraper] Using provided HTML as fallback');
        return await parseMyntraHTML(html, url);
      }
      
      throw new Error(`Failed to fetch Myntra page: ${response.status}`);
    }
    
    let htmlContent = await response.text();
    console.log('[Myntra Scraper] fetch() successful! HTML length:', htmlContent.length);
    
    // Check if we got a CAPTCHA or error page despite 200 status
    if (htmlContent.includes('Access Denied') || htmlContent.includes('Robot or human') || htmlContent.length < 5000) {
      console.log('[Myntra Scraper] Detected CAPTCHA/block page, falling back to Puppeteer...');
      return await scrapeMyntraWithPuppeteer(url);
    }
    
    return await parseMyntraHTML(htmlContent, url);
  } catch (error) {
    console.error('[Myntra Scraper] Error:', error);
    // Last resort: try Puppeteer
    console.log('[Myntra Scraper] Attempting Puppeteer as last resort...');
    try {
      return await scrapeMyntraWithPuppeteer(url);
    } catch (puppeteerError) {
      console.error('[Myntra Scraper] Puppeteer also failed:', puppeteerError);
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
}

// Puppeteer fallback for when anti-bot blocks fetch()
async function scrapeMyntraWithPuppeteer(url: string): Promise<ScrapedProductData> {
  const puppeteer = await import('puppeteer');
  let browser;
  
  try {
    console.log('[Myntra Puppeteer] Launching browser with stealth mode...');
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
      'referer': 'https://www.myntra.com/',
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
    
    // Wait a bit for dynamic content to load
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const htmlContent = await page.content();
    console.log('[Myntra Puppeteer] Page loaded successfully, HTML length:', htmlContent.length);
    
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
    
    // Extract product name - Myntra uses h1.pdp-title or script JSON data
    let productName = "";
    const namePatterns = [
      /<h1[^>]*class="[^"]*pdp-title[^"]*"[^>]*>(.*?)<\/h1>/s,
      /<h1[^>]*class="[^"]*pdp-name[^"]*"[^>]*>(.*?)<\/h1>/s,
      /"name"\s*:\s*"([^"]+)"/,
      /<meta[^>]*property="og:title"[^>]*content="([^"]+)"/,
    ];
    
    for (const pattern of namePatterns) {
      const match = htmlContent.match(pattern);
      if (match) {
        productName = match[1].replace(/<[^>]*>/g, '').trim();
        if (productName) break;
      }
    }
    console.log('[Myntra Scraper] Product name:', productName);
    
    // Extract price - Myntra uses pdp-price or script JSON
    let price = "";
    const pricePatterns = [
      /<span[^>]*class="[^"]*pdp-price[^"]*"[^>]*>.*?₹\s*([\d,]+)/s,
      /<strong[^>]*class="[^"]*pdp-price[^"]*"[^>]*>.*?₹\s*([\d,]+)/s,
      /"price"\s*:\s*"?₹?\s*([\d,]+)"?/,
      /<span[^>]*class="[^"]*pdp-discount-price[^"]*"[^>]*>.*?₹\s*([\d,]+)/s,
    ];
    
    for (const pattern of pricePatterns) {
      const match = htmlContent.match(pattern);
      if (match) {
        price = '₹' + match[1];
        console.log('[Myntra Scraper] Price found:', price);
        break;
      }
    }
    
    // Extract compare at price (MRP)
    let compareAtPrice = "";
    const comparePatterns = [
      /<span[^>]*class="[^"]*pdp-mrp[^"]*"[^>]*>.*?₹\s*([\d,]+)/s,
      /<s[^>]*>.*?₹\s*([\d,]+)/s,
      /<del[^>]*>.*?₹\s*([\d,]+)/s,
      /"mrp"\s*:\s*"?₹?\s*([\d,]+)"?/,
    ];
    
    for (const pattern of comparePatterns) {
      const match = htmlContent.match(pattern);
      if (match) {
        compareAtPrice = '₹' + match[1];
        console.log('[Myntra Scraper] Compare price found:', compareAtPrice);
        break;
      }
    }
    
    // Extract description - Myntra uses product details sections
    let description = "";
    const descPatterns = [
      /<div[^>]*class="[^"]*pdp-product-description-content[^"]*"[^>]*>(.*?)<\/div>/s,
      /<div[^>]*class="[^"]*pdp-description[^"]*"[^>]*>(.*?)<\/div>/s,
      /<div[^>]*class="[^"]*product-description[^"]*"[^>]*>(.*?)<\/div>/s,
    ];
    
    for (const pattern of descPatterns) {
      const match = htmlContent.match(pattern);
      if (match) {
        description = match[1].trim();
        if (description.length > 50) break;
      }
    }
    
    // Extract images from Myntra's image viewer or JSON data
    const images: string[] = [];
    
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
    
    const uniqueImages = Array.from(new Set(images)).slice(0, 10);
    console.log('[Myntra Scraper] Images extracted:', uniqueImages.length);
    
    // Extract size options if available
    const sizePattern = /<button[^>]*class="[^"]*size-buttons-[^"]*"[^>]*>([^<]+)<\/button>/gi;
    const sizes: string[] = [];
    let sizeMatch;
    while ((sizeMatch = sizePattern.exec(htmlContent)) !== null) {
      const size = sizeMatch[1].trim();
      if (size && !sizes.includes(size)) {
        sizes.push(size);
      }
    }
    
    // Extract brand
    let brand = "";
    const brandPatterns = [
      /<div[^>]*class="[^"]*pdp-title[^"]*"[^>]*><h1[^>]*class="[^"]*pdp-name[^"]*"[^>]*>([^<]+)/s,
      /"brand"\s*:\s*"([^"]+)"/,
    ];
    
    for (const pattern of brandPatterns) {
      const match = htmlContent.match(pattern);
      if (match) {
        brand = match[1].trim();
        if (brand) break;
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
