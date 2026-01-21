import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice, parseWeight, estimateWeight } from "./helpers";

export async function scrapeWalmart(html: string, url: string): Promise<ScrapedProductData> {
  try {
    console.log('[Walmart Scraper] Starting scrape for:', url);
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
      if (html && html.length > 10000) {
        return await parseWalmartHTML(html, url);
      }
      throw new Error(`Failed to fetch Walmart page: ${response.status}`);
    }
    
    const htmlContent = await response.text();
    console.log('[Walmart Scraper] Page fetched successfully, HTML length:', htmlContent.length);
    
    // Check for CAPTCHA or bot detection
    if (htmlContent.includes('Robot or human') || htmlContent.includes('BogleWeb') || htmlContent.length < 20000) {
      console.log('[Walmart Scraper] CAPTCHA detected, using provided HTML fallback');
      if (html && html.length > 10000) {
        return await parseWalmartHTML(html, url);
      }
      throw new Error('Walmart CAPTCHA detected - unable to scrape');
    }
    
    return await parseWalmartHTML(htmlContent, url);
  } catch (error) {
    console.error('[Walmart Scraper] Error:', error);
    return {
      productName: "",
      description: "",
      price: "",
      images: [],
      vendor: "Walmart",
      productType: "",
      tags: "",
      compareAtPrice: "",
      costPerItem: "",
      sku: "",
      barcode: "",
      weight: "",
      weightUnit: "lb",
      options: [],
      variants: [],
    };
  }
}

async function parseWalmartHTML(htmlContent: string, url: string): Promise<ScrapedProductData> {
  try {
    console.log('[Walmart Scraper] Parsing HTML...');
    
    // Extract product name
    let productName = "";
    const namePatterns = [
      /<h1 itemprop="name"[^>]*>(.*?)<\/h1>/s,
      /<h1[^>]*class="[^"]*prod-ProductTitle[^"]*"[^>]*>(.*?)<\/h1>/s,
      /<h1[^>]*>(.*?)<\/h1>/s
    ];
    
    for (const pattern of namePatterns) {
      const match = htmlContent.match(pattern);
      if (match) {
        productName = match[1].replace(/<[^>]*>/g, '').trim();
        if (productName) break;
      }
    }
    console.log('[Walmart Scraper] Product name:', productName);
    
    // Extract price
    let price = "";
    const pricePatterns = [
      /<span itemprop="price"[^>]*content="([^"]+)"/,
      /<span[^>]*class="[^"]*price-characteristic[^"]*"[^>]*>(.*?)<\/span>/s,
      /\$[\d,]+\.?\d*/
    ];
    
    for (const pattern of pricePatterns) {
      const match = htmlContent.match(pattern);
      if (match) {
        price = match[1] || match[0];
        price = price.replace(/<[^>]*>/g, '').trim();
        if (price.includes('$')) break;
      }
    }
    console.log('[Walmart Scraper] Price:', price);
    
    // Extract compare at price
    let compareAtPrice = "";
    const comparePatterns = [
      /<span[^>]*class="[^"]*was-price[^"]*"[^>]*>(.*?)<\/span>/s,
      /<span[^>]*class="[^"]*strikethrough[^"]*"[^>]*>(.*?)<\/span>/s
    ];
    
    for (const pattern of comparePatterns) {
      const match = htmlContent.match(pattern);
      if (match) {
        compareAtPrice = match[1].replace(/<[^>]*>/g, '').trim();
        if (compareAtPrice.includes('$')) break;
      }
    }
    
    // Extract description
    let description = "";
    const descPatterns = [
      /<div[^>]*class="[^"]*about-desc[^"]*"[^>]*>(.*?)<\/div>/s,
      /<div[^>]*data-testid="product-description"[^>]*>(.*?)<\/div>/s
    ];
    
    for (const pattern of descPatterns) {
      const match = htmlContent.match(pattern);
      if (match) {
        description = match[1].trim();
        if (description.length > 50) break;
      }
    }
    
    // Extract images
    const images: string[] = [];
    
    // Pattern 1: Product images from asr/ad directories (actual product photos)
    const imgPattern = /https:\/\/i5\.walmartimages\.com\/(asr|ad|seo)\/[a-f0-9-]+\.jpg/gi;
    const imgMatches = htmlContent.match(imgPattern);
    if (imgMatches) {
      imgMatches.forEach(imgUrl => {
        const cleanUrl = imgUrl.split('?')[0]; // Remove query params
        if (!images.includes(cleanUrl)) {
          images.push(cleanUrl);
        }
      });
    }
    
    const uniqueImages = Array.from(new Set(images)).slice(0, 10);
    console.log('[Walmart Scraper] Images extracted:', uniqueImages.length);
    
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
      sku: "",
      barcode: "",
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
