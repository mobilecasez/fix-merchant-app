import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice, parseWeight, estimateWeight } from "./helpers";

export async function scrapeAmazon(html: string, url: string): Promise<ScrapedProductData> {
  try {
    console.log('[Amazon Scraper] Starting scrape for:', url);
    
    // Use proven headers that bypass Amazon's anti-scraping protection
    console.log('[Amazon Scraper] Fetching page with HTTP request...');
    
    // Use a random delay to mimic human behavior
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
    
    const response = await fetch(url, {
      headers: {
        'accept-language': 'en-US,en;q=0.9',
        'accept-encoding': 'gzip, deflate, br',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      },
    });
    
    if (!response.ok) {
      console.log(`[Amazon Scraper] HTTP error: ${response.status} ${response.statusText}`);
      // If fetch fails, try to use the provided HTML parameter as fallback
      if (html && html.length > 10000) {
        console.log('[Amazon Scraper] Using provided HTML as fallback');
        const htmlContent = html;
        return await parseAmazonHTML(htmlContent, url);
      }
      throw new Error(`Failed to fetch Amazon page: ${response.status}`);
    }
    
    let htmlContent = await response.text();
    console.log('[Amazon Scraper] Page fetched successfully, HTML length:', htmlContent.length);
    
    // Check for CAPTCHA or bot detection
    if (htmlContent.includes('Type the characters you see in this picture') || 
        htmlContent.includes('Enter the characters you see below') ||
        htmlContent.includes('To discuss automated access to Amazon data please contact') ||
        htmlContent.toLowerCase().includes('robot check') ||
        htmlContent.length < 10000) {  // Very small page is likely CAPTCHA
      console.log('[Amazon Scraper] CAPTCHA/Bot detection page detected');
      
      // Try to use the provided HTML parameter as fallback
      if (html && html.length > 10000) {
        console.log('[Amazon Scraper] Using provided HTML parameter as fallback');
        htmlContent = html;
      } else {
        throw new Error('Amazon is showing CAPTCHA. The scraper was detected as a bot.');
      }
    }

    return await parseAmazonHTML(htmlContent, url);
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
  }
}

// Extract parsing logic into a separate function
async function parseAmazonHTML(htmlContent: string, url: string): Promise<ScrapedProductData> {

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
    console.log('[Amazon Scraper] HTML length:', htmlContent.length);
    
    const foundImages: string[] = [];
    
    // Find ImageBlockATF function
    const imageBlockMatch = htmlContent.match(/P\.when\(['"]A['"]\)\.register\(['"]ImageBlockATF['"]\s*,\s*function[^]*?'colorImages':\s*{\s*'initial':\s*(\[[\s\S]*?\])\s*\}/m);
    
    if (imageBlockMatch && imageBlockMatch[1]) {
      console.log('[Amazon Scraper] Found colorImages.initial array in ImageBlockATF');
      const colorImagesArray = imageBlockMatch[1];
      console.log('[Amazon Scraper] colorImages array length:', colorImagesArray.length);
      console.log('[Amazon Scraper] colorImages array preview:', colorImagesArray.substring(0, 500));
      
      // Extract all hiRes URLs from this array
      const hiResRegex = /"hiRes"\s*:\s*"([^"]+)"/g;
      let match;
      let matchCount = 0;
      
      while ((match = hiResRegex.exec(colorImagesArray)) !== null) {
        matchCount++;
        const imageUrl = match[1];
        console.log(`[Amazon Scraper] Found hiRes match ${matchCount}: ${imageUrl}`);
        if (imageUrl && imageUrl !== 'null' && imageUrl.startsWith('http')) {
          foundImages.push(imageUrl);
          console.log(`[Amazon Scraper] ✓ Added hiRes ${foundImages.length}: ${imageUrl}`);
        } else {
          console.log(`[Amazon Scraper] ✗ Skipped invalid hiRes: ${imageUrl}`);
        }
      }
      console.log(`[Amazon Scraper] Total hiRes matches found: ${matchCount}, valid images: ${foundImages.length}`);
    } else {
      console.log('[Amazon Scraper] Could not find colorImages in ImageBlockATF');
      console.log('[Amazon Scraper] HTML snippet (first 1000 chars):', htmlContent.substring(0, 1000));
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
}
