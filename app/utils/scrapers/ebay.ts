import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice, parseWeight, estimateWeight } from "./helpers";

export async function scrapeEbay(html: string, url: string): Promise<ScrapedProductData> {
  try {
    console.log('[eBay Scraper] Starting scrape for:', url);
    console.log('[eBay Scraper] Fetching page with HTTP request...');
    
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
    
    const response = await fetch(url, {
      headers: {
        'accept-language': 'en-US,en;q=0.9',
        'accept-encoding': 'gzip, deflate, br',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      },
    });
    
    if (!response.ok) {
      console.log(`[eBay Scraper] HTTP error: ${response.status}`);
      if (html && html.length > 10000) {
        return await parseEbayHTML(html, url);
      }
      throw new Error(`Failed to fetch eBay page: ${response.status}`);
    }
    
    const htmlContent = await response.text();
    console.log('[eBay Scraper] Page fetched successfully, HTML length:', htmlContent.length);
    
    return await parseEbayHTML(htmlContent, url);
  } catch (error) {
    console.error('[eBay Scraper] Error:', error);
    return {
      productName: "",
      description: "",
      price: "",
      images: [],
      vendor: "eBay",
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

async function parseEbayHTML(htmlContent: string, url: string): Promise<ScrapedProductData> {
  try {
    console.log('[eBay Scraper] Parsing HTML...');
    
    // Extract product name
    let productName = "";
    const namePatterns = [
      /<h1 class="x-item-title__mainTitle"[^>]*>(.*?)<\/h1>/s,
      /<h1 class="it-ttl"[^>]*>(.*?)<\/h1>/s,
      /<h1[^>]*>(.*?)<\/h1>/s
    ];
    
    for (const pattern of namePatterns) {
      const match = htmlContent.match(pattern);
      if (match) {
        productName = match[1].replace(/<[^>]*>/g, '').trim();
        if (productName) break;
      }
    }
    console.log('[eBay Scraper] Product name:', productName);
    
    // Extract price
    let price = "";
    const pricePatterns = [
      /<span class="x-price-primary"[^>]*>.*?<span[^>]*>(.*?)<\/span>/s,
      /<span id="prcIsum"[^>]*>(.*?)<\/span>/s,
      /<span itemprop="price"[^>]*>(.*?)<\/span>/s,
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
    console.log('[eBay Scraper] Price:', price);
    
    // Extract compare at price
    let compareAtPrice = "";
    const comparePatterns = [
      /<span class="x-price-approx__price"[^>]*>(.*?)<\/span>/s,
      /<span class="strikethrough"[^>]*>(.*?)<\/span>/s,
      /<span class="x-price-secondary"[^>]*>(.*?)<\/span>/s
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
      /<div id="viTabs_0_panel"[^>]*>(.*?)<\/div>/s,
      /<div class="item-description"[^>]*>(.*?)<\/div>/s,
      /<div id="desc_div"[^>]*>(.*?)<\/div>/s
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
    
    // Pattern 1: Main image
    const mainImgMatch = htmlContent.match(/<img[^>]+id="icImg"[^>]+src="([^"]+)"/);
    if (mainImgMatch) {
      const highRes = mainImgMatch[1].replace(/s-l\d+/, 's-l1600');
      images.push(highRes);
    }
    
    // Pattern 2: Gallery images
    const galleryPattern = /https:\/\/i\.ebayimg\.com\/images\/g\/[A-Za-z0-9_~-]+\/s-l\d+\.(jpg|webp|png)/g;
    const galleryMatches = htmlContent.match(galleryPattern);
    if (galleryMatches) {
      galleryMatches.forEach(imgUrl => {
        if (!imgUrl.includes('s-l64')) {
          // Clean URL and convert to high-res
          const cleanUrl = imgUrl.split('>')[0].split('<')[0].split('"')[0];
          const highRes = cleanUrl.replace(/s-l\d+/, 's-l1600');
          if (!images.includes(highRes)) {
            images.push(highRes);
          }
        }
      });
    }
    
    const uniqueImages = Array.from(new Set(images)).slice(0, 10);
    console.log('[eBay Scraper] Images extracted:', uniqueImages.length);
    
    // Extract weight
    let weight = "";
    let weightUnit = "lb";
    const weightPatterns = [
      /(?:Item Weight|Weight|Shipping Weight)[:\s]*<\/[^>]+>.*?<[^>]+>(.*?)<\/[^>]+>/si,
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
          console.log('[eBay Scraper] Weight found:', weight, weightUnit);
          break;
        }
      }
    }
    
    // Final weight handling
    let finalWeight = weight;
    let finalWeightUnit = weightUnit;
    
    if (!weight) {
      console.log('[eBay Scraper] No weight found, estimating');
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
      vendor: "eBay",
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
    console.error('[eBay Scraper] Parse error:', error);
    throw error;
  }
}
