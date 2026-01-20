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
    
    // Extract price - look for a-price-whole or a-offscreen inside a-price span
    let price = "";
    
    // Pattern 1: Look for a-price-whole class (visible price on page)
    const priceWholeMatch = htmlContent.match(/<span[^>]*class="[^"]*a-price-whole[^"]*"[^>]*>([^<]+)<\/span>/);
    if (priceWholeMatch) {
      price = priceWholeMatch[1].replace(/<[^>]*>/g, '').trim();
      console.log('[Amazon Scraper] Found price in a-price-whole:', price);
    }
    
    // Pattern 2: If not found, try a-offscreen (but NOT inside data-a-strike which is compare price)
    if (!price) {
      const offscreenMatch = htmlContent.match(/<span[^>]*class="[^"]*a-price[^"]*"[^>]*>[\s\S]*?<span[^>]*class="[^"]*a-offscreen[^"]*"[^>]*>([^<]+)<\/span>/);
      if (offscreenMatch) {
        // Make sure this isn't the compare at price
        const fullMatch = offscreenMatch[0];
        if (!fullMatch.includes('data-a-strike')) {
          price = offscreenMatch[1].trim();
          console.log('[Amazon Scraper] Found price in a-offscreen:', price);
        }
      }
    }
    
    console.log('[Amazon Scraper] Final Price:', price);
    
    // Extract compare at price
    const compareMatch = htmlContent.match(/<span[^>]*data-a-strike="true"[^>]*>.*?<span[^>]*class="[^"]*a-offscreen[^"]*"[^>]*>(.*?)<\/span>/s);
    const compareAtPrice = compareMatch ? compareMatch[1].trim() : "";
    
    // Extract weight - try multiple patterns
    let weight = "";
    let weightUnit = "kg";
    
    // Pattern 1: Look for weight in JSON data (most reliable)
    const jsonWeightMatch = htmlContent.match(/"item_weight"\s*:\s*"([^"]+)"/i);
    if (jsonWeightMatch) {
      const weightText = jsonWeightMatch[1].trim();
      console.log('[Amazon Scraper] Found weight (JSON):', weightText);
      
      const poundsMatch = weightText.match(/([\d.]+)\s*(?:pounds?|lbs?)/i);
      const kgMatch = weightText.match(/([\d.]+)\s*(?:kg|kilograms?)/i);
      const gramsMatch = weightText.match(/([\d.]+)\s*(?:g|grams?)(?!\s*(?:kg|kilograms?))/i);
      const ozMatch = weightText.match(/([\d.]+)\s*(?:oz|ounces?)/i);
      
      if (poundsMatch) {
        weight = poundsMatch[1];
        weightUnit = "lb";
      } else if (kgMatch) {
        weight = kgMatch[1];
        weightUnit = "kg";
      } else if (ozMatch) {
        weight = (parseFloat(ozMatch[1]) / 16).toFixed(2);
        weightUnit = "lb";
      } else if (gramsMatch) {
        weight = gramsMatch[1];
        weightUnit = "g";
      }
    }
    
    // Pattern 2: Look for "Item Weight" or "Product Weight" in product details
    if (!weight) {
      const weightMatch1 = htmlContent.match(/(?:Item Weight|Product Weight|Shipping Weight)[:\s]*<\/span>.*?<span[^>]*>(.*?)<\/span>/si);
      if (weightMatch1) {
        const weightText = weightMatch1[1].replace(/<[^>]*>/g, '').trim();
        console.log('[Amazon Scraper] Found weight (Pattern 2):', weightText);
        
        const poundsMatch = weightText.match(/([\d.]+)\s*(?:pounds?|lbs?)/i);
        const kgMatch = weightText.match(/([\d.]+)\s*(?:kg|kilograms?)/i);
        const gramsMatch = weightText.match(/([\d.]+)\s*(?:g|grams?)(?!\s*(?:kg|kilograms?))/i);
        const ozMatch = weightText.match(/([\d.]+)\s*(?:oz|ounces?)/i);
        
        if (poundsMatch) {
          weight = poundsMatch[1];
          weightUnit = "lb";
        } else if (kgMatch) {
          weight = kgMatch[1];
          weightUnit = "kg";
        } else if (ozMatch) {
          weight = (parseFloat(ozMatch[1]) / 16).toFixed(2);
          weightUnit = "lb";
        } else if (gramsMatch) {
          weight = gramsMatch[1];
          weightUnit = "g";
        }
      }
    }
    
    // Pattern 3: Look in product details table
    if (!weight) {
      const weightMatch2 = htmlContent.match(/<th[^>]*>(?:Item Weight|Product Weight|Shipping Weight)<\/th>[\s\S]*?<td[^>]*>(.*?)<\/td>/i);
      if (weightMatch2) {
        const weightText = weightMatch2[1].replace(/<[^>]*>/g, '').trim();
        console.log('[Amazon Scraper] Found weight (Pattern 3):', weightText);
        
        const poundsMatch = weightText.match(/([\d.]+)\s*(?:pounds?|lbs?)/i);
        const kgMatch = weightText.match(/([\d.]+)\s*(?:kg|kilograms?)/i);
        const gramsMatch = weightText.match(/([\d.]+)\s*(?:g|grams?)(?!\s*(?:kg|kilograms?))/i);
        const ozMatch = weightText.match(/([\d.]+)\s*(?:oz|ounces?)/i);
        
        if (poundsMatch) {
          weight = poundsMatch[1];
          weightUnit = "lb";
        } else if (kgMatch) {
          weight = kgMatch[1];
          weightUnit = "kg";
        } else if (ozMatch) {
          weight = (parseFloat(ozMatch[1]) / 16).toFixed(2);
          weightUnit = "lb";
        } else if (gramsMatch) {
          weight = gramsMatch[1];
          weightUnit = "g";
        }
      }
    }
    
    console.log('[Amazon Scraper] Extracted weight:', weight, weightUnit);
    
    console.log('[Amazon Scraper] Extracted weight:', weight, weightUnit);
    
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
    
    // Find the colorImages.initial array by locating start position and counting brackets
    // This approach handles nested objects with multiple } brackets correctly
    const colorImagesStartMatch = htmlContent.match(/['"']colorImages['"']\s*:\s*\{\s*['"']initial['"']\s*:\s*\[/);
    
    if (colorImagesStartMatch && colorImagesStartMatch.index !== undefined) {
      console.log('[Amazon Scraper] Found colorImages.initial start position');
      const startPos = colorImagesStartMatch.index + colorImagesStartMatch[0].length;
      
      // Count brackets to find where the array ends
      let bracketCount = 1; // We already have the opening [
      let endPos = startPos;
      
      while (bracketCount > 0 && endPos < htmlContent.length) {
        if (htmlContent[endPos] === '[') {
          bracketCount++;
        } else if (htmlContent[endPos] === ']') {
          bracketCount--;
        }
        endPos++;
      }
      
      // Extract just the colorImages.initial array content
      const colorImagesArray = htmlContent.substring(startPos - 1, endPos);
      console.log(`[Amazon Scraper] Extracted colorImages array, length: ${colorImagesArray.length}`);
      
      // Now extract hiRes URLs only from this array
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
      console.log('[Amazon Scraper] Could not find colorImages.initial start in HTML');
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

    // Use extracted weight or estimate if not found
    let finalWeight = weight;
    let finalWeightUnit = weightUnit;
    
    if (!weight) {
      console.log('[Amazon Scraper] No weight found, estimating based on product name');
      const weightParsed = estimateWeight(productName);
      finalWeight = weightParsed.value;
      finalWeightUnit = weightParsed.unit;
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
      weight: finalWeight,
      weightUnit: finalWeightUnit,
      options: [],
      variants: [],
    };
}
