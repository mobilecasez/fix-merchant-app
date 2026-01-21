import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice, parseWeight, estimateWeight } from "./helpers";

export async function scrapeFlipkart(html: string, url: string): Promise<ScrapedProductData> {
  try {
    console.log('[Flipkart Scraper] Starting scrape for:', url);
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
    
    if (!response.ok) {
      console.log(`[Flipkart Scraper] HTTP error: ${response.status}`);
      if (html && html.length > 10000) {
        console.log('[Flipkart Scraper] Using provided HTML as fallback');
        return await parseFlipkartHTML(html, url);
      }
      throw new Error(`Failed to fetch Flipkart page: ${response.status}`);
    }
    
    let htmlContent = await response.text();
    console.log('[Flipkart Scraper] Page fetched successfully, HTML length:', htmlContent.length);
    
    return await parseFlipkartHTML(htmlContent, url);
  } catch (error) {
    console.error('[Flipkart Scraper] Error:', error);
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
        const cleanUrl = imgUrl.split('>')[0].split('<')[0].split('"')[0].split("'")[0];\n        \n        // Convert to high-res by changing dimensions
        let highResUrl = cleanUrl;
        // Replace small dimensions with large ones
        highResUrl = highResUrl.replace(/\\/128\\/128\\//, '/832/832/');
        highResUrl = highResUrl.replace(/\\/416\\/416\\//, '/832/832/');
        highResUrl = highResUrl.replace(/\\/200\\/200\\//, '/832/832/');
        highResUrl = highResUrl.replace(/\\/312\\/312\\//, '/832/832/');
        
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
