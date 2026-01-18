import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice, parseWeight, estimateWeight } from "./helpers";

export async function scrapeAmazon(html: string, url: string): Promise<ScrapedProductData> {
  try {
    console.log('[Amazon Scraper] Starting scrape for:', url);
    
    // NEW APPROACH: Use simple fetch with browser-like headers (much faster, less detectable)
    console.log('[Amazon Scraper] Fetching page with HTTP request...');
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://www.google.com/',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
      },
    });
    
    if (!response.ok) {
      console.log(`[Amazon Scraper] HTTP error: ${response.status} ${response.statusText}`);
      throw new Error(`Failed to fetch Amazon page: ${response.status}`);
    }
    
    const htmlContent = await response.text();
    console.log('[Amazon Scraper] Page fetched successfully, HTML length:', htmlContent.length);
    
    // Check for CAPTCHA or bot detection
    if (htmlContent.includes('Type the characters you see in this picture') || 
        htmlContent.includes('Enter the characters you see below') ||
        htmlContent.includes('To discuss automated access to Amazon data please contact') ||
        htmlContent.toLowerCase().includes('robot check')) {
      console.log('[Amazon Scraper] CAPTCHA/Bot detection page detected');
      throw new Error('Amazon is showing CAPTCHA. The scraper was detected as a bot.');
    }

    // Extract product data using regex patterns from HTML
    console.log('[Amazon Scraper] Extracting product data from HTML...');
    
    // Extract product name from title span
    const nameMatch = htmlContent.match(/<span[^>]*id="productTitle"[^>]*>(.*?)<\/span>/s);
    const productName = nameMatch ? nameMatch[1].replace(/<[^>]*>/g, '').trim() : "";
    console.log('[Amazon Scraper] Product name:', productName);
    
    // Extract description from feature bullets
    const descMatch = htmlContent.match(/<div[^>]*id="feature-bullets"[^>]*>(.*?)<\/div>/s);
    const description = descMatch ? descMatch[1] : "";
    
    // Extract price - look for a-price span
    const priceMatch = htmlContent.match(/<span[^>]*class="[^"]*a-price[^"]*"[^>]*>.*?<span[^>]*class="[^"]*a-offscreen[^"]*"[^>]*>(.*?)<\/span>/s);
    const price = priceMatch ? priceMatch[1].trim() : "";
    console.log('[Amazon Scraper] Price:', price);
    
    // Extract compare at price
    const compareMatch = htmlContent.match(/<span[^>]*data-a-strike="true"[^>]*>.*?<span[^>]*class="[^"]*a-offscreen[^"]*"[^>]*>(.*?)<\/span>/s);
    const compareAtPrice = compareMatch ? compareMatch[1].trim() : "";
    
    // Extract weight - look for "Item Weight" or "Product Weight"
    const weightMatch = htmlContent.match(/(?:Item Weight|Product Weight)[:\s]*<\/span>.*?<span[^>]*>(.*?)<\/span>/si);
    const weight = weightMatch ? weightMatch[1].replace(/<[^>]*>/g, '').trim() : "";
    
    // Extract dimensions
    const dimensionsMatch = htmlContent.match(/Product Dimensions[:\s]*<\/span>.*?<span[^>]*>(.*?)<\/span>/si);
    const dimensions = dimensionsMatch ? dimensionsMatch[1].replace(/<[^>]*>/g, '').trim() : "";
    
    // Extract warranty
    const warrantyMatch = htmlContent.match(/(?:Warranty|Manufacturer Warranty)[:\s]*<\/span>.*?<span[^>]*>(.*?)<\/span>/si);
    const warranty = warrantyMatch ? warrantyMatch[1].replace(/<[^>]*>/g, '').trim() : "";

    // Extract high-res images from colorImages array inside ImageBlockATF
    console.log('[Amazon Scraper] Looking for ImageBlockATF colorImages array...');
    
    const foundImages: string[] = [];
    
    // Find ImageBlockATF function
    const imageBlockMatch = htmlContent.match(/P\.when\(['"]A['"]\)\.register\(['"]ImageBlockATF['"]\s*,\s*function[^]*?'colorImages':\s*{\s*'initial':\s*(\[[\s\S]*?\])\s*\}/m);
    
    if (imageBlockMatch && imageBlockMatch[1]) {
      console.log('[Amazon Scraper] Found colorImages.initial array in ImageBlockATF');
      const colorImagesArray = imageBlockMatch[1];
      
      // Extract all hiRes URLs from this array
      const hiResRegex = /"hiRes"\s*:\s*"([^"]+)"/g;
      let match;
      
      while ((match = hiResRegex.exec(colorImagesArray)) !== null) {
        const imageUrl = match[1];
        if (imageUrl && imageUrl !== 'null' && imageUrl.startsWith('http')) {
          foundImages.push(imageUrl);
          console.log(`[Amazon Scraper] Extracted hiRes ${foundImages.length}: ${imageUrl}`);
        }
      }
    } else {
      console.log('[Amazon Scraper] Could not find colorImages in ImageBlockATF');
    }
    
    console.log(`[Amazon Scraper] Total images extracted: ${foundImages.length}`);
    
    const images = foundImages;
    console.log(`[Amazon Scraper] Extracted ${images.length} high-res images`);
    console.log(`[Amazon Scraper] Title: ${productName?.substring(0, 50)}...`);
    console.log(`[Amazon Scraper] Price: ${price}`);
    console.log(`[Amazon Scraper] Images: ${images.length}`);

    let finalDescription = description;
    if (dimensions) {
        finalDescription += `<p>Dimensions: ${dimensions}</p>`;
    }
    if (warranty) {
        finalDescription += `<div class="warranty-info"><h3>Warranty Information</h3><p>${warranty}</p></div>`;
    }

    // Parse weight or estimate
    let weightParsed = parseWeight(weight);
    if (!weightParsed.value) {
      console.log('Amazon: No weight found, estimating based on product name');
      weightParsed = estimateWeight(productName);
    }

    // Ensure compare at price (add 20% if missing)
    const finalCompareAtPrice = ensureCompareAtPrice(price, compareAtPrice);

    return {
      productName: cleanProductName(productName),
      description: finalDescription,
      price,
      compareAtPrice: finalCompareAtPrice,
      images: Array.from(new Set(images)).filter(img => img && img.trim() !== ''),
      vendor: "Amazon",
      productType: "",
      tags: "",
      costPerItem: "",
      sku: "",
      barcode: "",
      weight: weightParsed.value,
      weightUnit: weightParsed.unit,
      options: [],
      variants: [],
    };
  } catch (error) {
    console.error("[Amazon Scraper] Error during Amazon scraping:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[Amazon Scraper] Error details:", errorMessage);
    
    // Return empty data to trigger AI fallback
    return {
      productName: "",
      description: "",
      price: "",
      images: [],
      vendor: "Amazon",
      productType: "",
      tags: "",
      compareAtPrice: "",
      costPerItem: "",
      sku: "",
      barcode: "",
      weight: "",
      weightUnit: "",
      options: [],
      variants: [],
    };
  } catch (error) {
    console.error('[Amazon Scraper] Error during scraping:', error);
    throw error;
  }
}
