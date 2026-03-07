import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice, parseWeight, estimateWeight } from "./helpers";

export async function scrapeAmazon(html: string, url: string): Promise<ScrapedProductData> {
  try {
    console.log('[Amazon Scraper] Starting scrape for:', url);
    
    // Detect Amazon domain for domain-specific handling
    const domain = url.includes('amazon.in') ? 'IN' : 
                   url.includes('amazon.co.uk') ? 'UK' : 
                   url.includes('amazon.ca') ? 'CA' : 
                   url.includes('amazon.de') ? 'DE' : 'COM';
    console.log('[Amazon Scraper] Detected Amazon domain:', domain);
    
    let htmlContent = "";
    let fetchSuccessful = false;
    
    // STEP 1: Try fast HTTP request first (works ~30% of the time)
    console.log('[Amazon Scraper] 🚀 Attempting fast HTTP request...');
    try {
      await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
      
      const response = await fetch(url, {
        headers: {
          'accept-language': 'en-US,en;q=0.9',
          'accept-encoding': 'gzip, deflate, br',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': 'none',
          'sec-fetch-user': '?1',
          'upgrade-insecure-requests': '1',
        },
      });
      
      if (response.ok) {
        htmlContent = await response.text();
        console.log('[Amazon Scraper] ✓ HTTP request successful, HTML length:', htmlContent.length);
        
        // Verify it has price elements
        const hasPriceElements = (
          /<span[^>]*class="[^"]*a-price-symbol[^"]*"/i.test(htmlContent) ||
          /<span[^>]*class="[^"]*a-price-whole[^"]*"/i.test(htmlContent) ||
          /<span[^>]*class="[^"]*apex[-]?pricetopay[^"]*"/i.test(htmlContent) ||
          /<div[^>]*id="corePriceDisplay[^"]*"/i.test(htmlContent)
        );
        
        // Check for CAPTCHA or blocking
        const isBlocked = (
          htmlContent.includes('Type the characters you see in this picture') ||
          htmlContent.includes('Enter the characters you see below') ||
          htmlContent.includes('To discuss automated access to Amazon data please contact') ||
          htmlContent.toLowerCase().includes('robot check') ||
          htmlContent.length < 10000 ||
          !hasPriceElements
        );
        
        if (!isBlocked) {
          console.log('[Amazon Scraper] ✅ HTTP fetch SUCCESS - valid HTML with price elements');
          fetchSuccessful = true;
        } else {
          console.log('[Amazon Scraper] ⚠️ HTTP fetch blocked or CAPTCHA detected');
          htmlContent = ""; // Clear blocked HTML
        }
      } else {
        console.log(`[Amazon Scraper] ❌ HTTP error: ${response.status} ${response.statusText}`);
      }
    } catch (httpError) {
      console.log('[Amazon Scraper] ❌ HTTP request failed:', httpError);
    }
    
    // STEP 2: If HTTP failed, try manual HTML from user (if provided)
    if (!fetchSuccessful && html && html.length > 10000) {
      console.log('[Amazon Scraper] 📋 Checking provided manual HTML...');
      const hasPriceElements = (
        /<span[^>]*class="[^"]*a-price-symbol[^"]*"/i.test(html) ||
        /<span[^>]*class="[^"]*a-price-whole[^"]*"/i.test(html) ||
        /<span[^>]*class="[^"]*apex[-]?pricetopay[^"]*"/i.test(html) ||
        /<div[^>]*id="corePriceDisplay[^"]*"/i.test(html)
      );
      
      if (hasPriceElements) {
        console.log('[Amazon Scraper] ✅ Using provided manual HTML (valid)');
        htmlContent = html;
        fetchSuccessful = true;
      } else {
        console.log('[Amazon Scraper] ⚠️ Provided HTML invalid or missing price elements');
      }
    }
    
    // STEP 3: If still no valid HTML, use enhanced Puppeteer stealth mode with retries
    if (!fetchSuccessful) {
      console.log('[Amazon Scraper] 🤖 Attempting enhanced Puppeteer stealth mode with retry logic...');
      let lastError: Error | null = null;
      const maxRetries = 3;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`[Amazon Scraper] 🔄 Stealth Puppeteer attempt ${attempt}/${maxRetries}...`);
          const puppeteerHTML = await scrapeAmazonWithPuppeteerStealth(url, attempt);
          
          if (puppeteerHTML && puppeteerHTML.length > 10000) {
            console.log('[Amazon Scraper] ✓ Puppeteer fetched HTML, length:', puppeteerHTML.length);
            
            // Verify Puppeteer HTML has price elements
            const puppeteerHasPriceElements = (
              /<span[^>]*class="[^"]*a-price-symbol[^"]*"/i.test(puppeteerHTML) ||
              /<span[^>]*class="[^"]*a-price-whole[^"]*"/i.test(puppeteerHTML) ||
              /<span[^>]*class="[^"]*apex[-]?pricetopay[^"]*"/i.test(puppeteerHTML) ||
              /<div[^>]*id="corePriceDisplay[^"]*"/i.test(puppeteerHTML)
            );
            
            // Check for CAPTCHA
            const isCaptcha = (
              puppeteerHTML.includes('Type the characters you see in this picture') ||
              puppeteerHTML.includes('Enter the characters you see below') ||
              puppeteerHTML.toLowerCase().includes('robot check')
            );
            
            console.log('[Amazon Scraper] Puppeteer result - Has price elements:', puppeteerHasPriceElements, ', Is CAPTCHA:', isCaptcha);
            
            if (puppeteerHasPriceElements && !isCaptcha) {
              htmlContent = puppeteerHTML;
              fetchSuccessful = true;
              console.log(`[Amazon Scraper] ✅ Stealth Puppeteer SUCCESS on attempt ${attempt}`);
              break;
            } else {
              console.log(`[Amazon Scraper] ⚠️ Attempt ${attempt}: HTML fetched but blocked/invalid, retrying...`);
              if (attempt < maxRetries) {
                const backoffDelay = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
                console.log(`[Amazon Scraper] ⏳ Waiting ${backoffDelay}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, backoffDelay));
              }
            }
          } else {
            throw new Error('Puppeteer returned insufficient HTML');
          }
        } catch (puppeteerError) {
          lastError = puppeteerError as Error;
          console.error(`[Amazon Scraper] ❌ Attempt ${attempt} failed:`, puppeteerError);
          
          if (attempt < maxRetries) {
            const backoffDelay = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
            console.log(`[Amazon Scraper] ⏳ Waiting ${backoffDelay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
          }
        }
      }
      
      // If all automatic methods failed
      if (!fetchSuccessful) {
        console.error('[Amazon Scraper] ❌ All automatic methods failed after', maxRetries, 'Puppeteer attempts');
        console.error('[Amazon Scraper] 📋 Manual HTML paste required as last resort');
        throw new Error(`Amazon auto-scraping failed after ${maxRetries} attempts. Please use manual HTML paste. Error: ${lastError?.message || 'Unknown error'}`);
      }
    }
    
    console.log('[Amazon Scraper] Final HTML length before parsing:', htmlContent.length);
    console.log('[Amazon Scraper] Proceeding to parse HTML...');

    return await parseAmazonHTML(htmlContent, url, domain);
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
async function parseAmazonHTML(htmlContent: string, url: string, domain: string = 'COM'): Promise<ScrapedProductData> {

    // Extract product data using regex patterns from HTML
    console.log('[Amazon Scraper] Extracting product data from HTML...');
    console.log('[Amazon Scraper] Domain:', domain);
    
    // Extract product name from title span - multiple fallback patterns
    let productName = "";
    
    // Pattern 1: Standard productTitle id
    const nameMatch1 = htmlContent.match(/<span[^>]*id="productTitle"[^>]*>(.*?)<\/span>/s);
    if (nameMatch1) {
      productName = nameMatch1[1].replace(/<[^>]*>/g, '').trim();
    }
    
    // Pattern 2: Look for title in page title tag as fallback
    if (!productName) {
      const titleMatch = htmlContent.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch) {
        productName = titleMatch[1]
          .replace(/: [^:]+$/, '') // Remove trailing site info
          .replace(/- Amazon\.(com|in|co\.uk|ca|de|fr|it)/i, '')
          .trim();
      }
    }
    
    // Pattern 3: Look for og:title meta tag
    if (!productName) {
      const ogTitleMatch = htmlContent.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i);
      if (ogTitleMatch) {
        productName = ogTitleMatch[1].trim();
      }
    }
    
    console.log('[Amazon Scraper] Product name:', productName);
    
    // Extract description from feature bullets - multiple patterns
    let description = "";
    
    // Pattern 1: Standard feature-bullets id
    const descMatch1 = htmlContent.match(/<div[^>]*id="feature-bullets"[^>]*>(.*?)<\/div>/s);
    if (descMatch1) {
      description = descMatch1[1];
    }
    
    // Pattern 2: Look for feature div with class
    if (!description) {
      const descMatch2 = htmlContent.match(/<div[^>]*id="featurebullets_feature_div"[^>]*>([\s\S]{0,5000}?)<\/div>/i);
      if (descMatch2) {
        description = descMatch2[1];
      }
    }
    
    // Pattern 3: Look for attributes table
    if (!description) {
      const descMatch3 = htmlContent.match(/<div[^>]*id="productDescription"[^>]*>([\s\S]{0,3000}?)<\/div>/i);
      if (descMatch3) {
        description = descMatch3[1];
      }
    }
    
    console.log('[Amazon Scraper] Description length:', description.length);
    
    // Extract price - look for a-price-whole or a-offscreen inside a-price span
    let price = "";
    
    console.log('[Amazon Scraper] ========================================');
    console.log('[Amazon Scraper] Starting price extraction...');
    
    // Detect currency symbol based on domain for validation
    const expectedCurrency = domain === 'IN' ? '₹' : domain === 'UK' ? '£' : domain === 'CA' ? 'CA$' : '$';
    console.log('[Amazon Scraper] Expected currency symbol:', expectedCurrency);
    
    // DEBUG: Check for price-related classes
    const hasPriceSymbol = htmlContent.includes('a-price-symbol');
    const hasPriceWhole = htmlContent.includes('a-price-whole');
    const hasPriceFraction = htmlContent.includes('a-price-fraction');
    console.log('[Amazon Scraper] DEBUG: Price classes found:', { hasPriceSymbol, hasPriceWhole, hasPriceFraction });
    
    // Pattern 1: Look for apex-pricetopay-accessibility-label (most reliable for amazon.com)
    console.log('[Amazon Scraper] Attempting Pattern 1: apex-pricetopay-accessibility-label...');
    const apexLabelMatch = htmlContent.match(/<span[^>]*id="apex-pricetopay-accessibility-label"[^>]*>\s*([\$₹£€][\d,]+\.\d{2})/i);
    if (apexLabelMatch) {
      price = apexLabelMatch[1].trim();
      console.log('[Amazon Scraper] ✓ Found price in apex-pricetopay-accessibility-label (BEST):', price);
    } else {
      console.log('[Amazon Scraper] ✗ Pattern 1 (apex-pricetopay-accessibility-label) did not match');
    }
    
    // Pattern 2: Look for split price structure within apex-pricetopay-value
    if (!price) {
      console.log('[Amazon Scraper] Attempting Pattern 2: apex-pricetopay split format...');
      const apexSplitMatch = htmlContent.match(/apex-pricetopay-value[\s\S]{0,200}?aria-hidden="true"[\s\S]{0,100}?<span[^>]*class="[^"]*a-price-symbol[^"]*"[^>]*>([^<]+)<\/span>[\s\S]{0,50}?<span[^>]*class="[^"]*a-price-whole[^"]*"[^>]*>([^<]+)<[\s\S]{0,100}?<span[^>]*class="[^"]*a-price-fraction[^"]*"[^>]*>([^<]+)<\/span>/i);
      if (apexSplitMatch) {
        const symbol = apexSplitMatch[1].trim();
        const whole = apexSplitMatch[2].replace(/<[^>]*>/g, '').trim();
        const fraction = apexSplitMatch[3].trim();
        price = `${symbol}${whole}.${fraction}`;
        console.log('[Amazon Scraper] ✓ Found price in apex-pricetopay split format:', price);
      } else {
        console.log('[Amazon Scraper] ✗ Pattern 2 (apex-pricetopay split) did not match');
      }
    }
    
    // Pattern 3: Generic split price structure (a-price-symbol + a-price-whole + a-price-fraction)
    // This handles amazon.com format with nested decimal span: <span class="a-price-whole">75<span class="a-price-decimal">.</span></span>
    if (!price) {
      console.log('[Amazon Scraper] Attempting Pattern 3: Generic split price format...');
      
      // Updated regex to capture content including nested spans in a-price-whole
      const splitPriceMatch = htmlContent.match(/<span[^>]*class="[^"]*a-price-symbol[^"]*"[^>]*>([^<]+)<\/span>[\s\S]{0,50}?<span[^>]*class="[^"]*a-price-whole[^"]*"[^>]*>([\s\S]*?)<\/span>[\s\S]{0,50}?<span[^>]*class="[^"]*a-price-fraction[^"]*"[^>]*>([^<]+)<\/span>/i);
      
      if (splitPriceMatch) {
        const symbol = splitPriceMatch[1].trim();
        // Strip all HTML tags from whole number (handles nested decimal span)
        const whole = splitPriceMatch[2].replace(/<[^>]*>/g, '').trim();
        const fraction = splitPriceMatch[3].trim();
        price = `${symbol}${whole}.${fraction}`;
        console.log('[Amazon Scraper] ✓ Found price in generic split format:', price);
        console.log('[Amazon Scraper]   - Symbol:', symbol);
        console.log('[Amazon Scraper]   - Whole:', whole);
        console.log('[Amazon Scraper]   - Fraction:', fraction);
      } else {
        console.log('[Amazon Scraper] ✗ Pattern 3 (generic split) did not match');
        
        // Try to find individual parts to debug
        const symbolMatch = htmlContent.match(/<span[^>]*class="[^"]*a-price-symbol[^"]*"[^>]*>([^<]+)<\/span>/i);
        const wholeMatch = htmlContent.match(/<span[^>]*class="[^"]*a-price-whole[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
        const fractionMatch = htmlContent.match(/<span[^>]*class="[^"]*a-price-fraction[^"]*"[^>]*>([^<]+)<\/span>/i);
        console.log('[Amazon Scraper] DEBUG individual parts:', {
          symbol: symbolMatch ? symbolMatch[1] : 'not found',
          wholeRaw: wholeMatch ? wholeMatch[1].substring(0, 50) : 'not found',
          wholeCleaned: wholeMatch ? wholeMatch[1].replace(/<[^>]*>/g, '').trim() : 'not found',
          fraction: fractionMatch ? fractionMatch[1] : 'not found'
        });
      }
    }
    
    // Pattern 4: Look for corePriceDisplay or apexPriceToPay with a-offscreen (amazon.in format)
    if (!price) {
      console.log('[Amazon Scraper] Attempting Pattern 4: corePriceDisplay a-offscreen...');
      const corePriceMatch = htmlContent.match(/<div[^>]*(?:id="corePriceDisplay|class="[^"]*apex.*?price)[^>]*>[\s\S]{0,500}?<span[^>]*class="[^"]*a-offscreen[^"]*"[^>]*>\s*([^<]+)\s*<\/span>/i);
      if (corePriceMatch && !corePriceMatch[0].includes('data-a-strike')) {
        const extractedPrice = corePriceMatch[1].trim();
        // Only use if it's not empty or just whitespace and contains a digit
        if (extractedPrice && extractedPrice.length > 1 && /\d/.test(extractedPrice)) {
          price = extractedPrice;
          console.log('[Amazon Scraper] ✓ Found price in corePriceDisplay/apex a-offscreen:', price);
        } else {
          console.log('[Amazon Scraper] ✗ Pattern 4 matched but price was empty or invalid:', extractedPrice);
        }
      } else {
        console.log('[Amazon Scraper] ✗ Pattern 4 (corePriceDisplay a-offscreen) did not match');
      }
    }
    
    // Pattern 5: Look for a-price-whole class (visible price on page) - but not in strikes
    if (!price) {
      console.log('[Amazon Scraper] Attempting Pattern 5: a-price-whole...');
      // Find all a-price-whole matches
      const allPriceWholeMatches = htmlContent.matchAll(/<span[^>]*class="[^"]*a-price-whole[^"]*"[^>]*>([^<]+)<\/span>/g);
      
      for (const match of allPriceWholeMatches) {
        // Get context around the match to check if it's a strike-through price
        const matchIndex = match.index || 0;
        const contextStart = Math.max(0, matchIndex - 300);
        const contextEnd = Math.min(htmlContent.length, matchIndex + 300);
        const context = htmlContent.substring(contextStart, contextEnd);
        
        // Skip if this price is inside a strike-through (compare at price)
        if (!context.includes('data-a-strike="true"') && !context.includes('a-text-price')) {
          price = match[1].replace(/<[^>]*>/g, '').trim();
          console.log('[Amazon Scraper] ✓ Found price in a-price-whole:', price);
          break;
        } else {
          console.log('[Amazon Scraper] ✗ Skipped strike-through price:', match[1].trim());
        }
      }
    }
    
    // Pattern 6: If not found, try a-offscreen (but NOT inside data-a-strike which is compare price)
    if (!price) {
      console.log('[Amazon Scraper] Attempting Pattern 6: a-offscreen...');
      const offscreenMatch = htmlContent.match(/<span[^>]*class="[^"]*a-price[^"]*"[^>]*>[\s\S]*?<span[^>]*class="[^"]*a-offscreen[^"]*"[^>]*>([^<]+)<\/span>/);
      if (offscreenMatch) {
        // Make sure this isn't the compare at price and contains a digit
        const fullMatch = offscreenMatch[0];
        const extractedPrice = offscreenMatch[1].trim();
        if (!fullMatch.includes('data-a-strike') && /\d/.test(extractedPrice) && extractedPrice.length > 1) {
          price = extractedPrice;
          console.log('[Amazon Scraper] ✓ Found price in a-offscreen:', price);
        } else {
          console.log('[Amazon Scraper] ✗ Pattern 6 matched but price was invalid:', extractedPrice);
        }
      } else {
        console.log('[Amazon Scraper] ✗ Pattern 6 (a-offscreen) did not match');
      }
    }
    
    // Pattern 7: Look for price_inside_buybox_priceblock with currency symbol
    if (!price) {
      console.log('[Amazon Scraper] Attempting Pattern 7: buybox...');
      const buyboxMatch = htmlContent.match(/<span[^>]*id="[^"]*price[^"]*"[^>]*>\s*[\$₹£€]?([\d,]+(?:\.[\d]{2})?)/i);
      if (buyboxMatch) {
        price = buyboxMatch[0].trim();
        console.log('[Amazon Scraper] ✓ Found price in buybox:', price);
      } else {
        console.log('[Amazon Scraper] ✗ Pattern 7 (buybox) did not match');
      }
    }
    
    // Pattern 8: Look for price in JSON-LD structured data
    if (!price) {
      console.log('[Amazon Scraper] Attempting Pattern 8: JSON-LD...');
      const jsonLdMatch = htmlContent.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
      if (jsonLdMatch) {
        for (const jsonBlock of jsonLdMatch) {
          try {
            const jsonContent = jsonBlock.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
            const data = JSON.parse(jsonContent);
            if (data.offers && (data.offers.price || data.offers.lowPrice)) {
              const priceValue = data.offers.price || data.offers.lowPrice;
              const currency = data.offers.priceCurrency || expectedCurrency;
              price = currency + priceValue;
              console.log('[Amazon Scraper] ✓ Found price in JSON-LD:', price);
              break;
            }
          } catch (e) {
            // Skip invalid JSON
            console.log('[Amazon Scraper] ✗ Failed to parse JSON-LD block');
          }
        }
        if (!price) {
          console.log('[Amazon Scraper] ✗ Pattern 8 (JSON-LD) did not find price');
        }
      } else {
        console.log('[Amazon Scraper] ✗ Pattern 8 (JSON-LD) no JSON-LD found');
      }
    }
    
    // Pattern 9: Broad search for any price-like pattern with currency
    if (!price) {
      console.log('[Amazon Scraper] Attempting Pattern 9: Broad currency search...');
      // Require at least one digit - use positive lookahead to ensure there's a digit
      const broadPriceMatch = htmlContent.match(/([\$₹£€]\s*(?=.*\d)[\d,]+(?:\.[\d]{2})?)/);
      if (broadPriceMatch) {
        price = broadPriceMatch[1].trim();
        console.log('[Amazon Scraper] ✓ Found price (broad pattern):', price);
      } else {
        console.log('[Amazon Scraper] ✗ Pattern 9 (broad) did not match');
      }
    }
    
    console.log('[Amazon Scraper] Final extracted price:', price);
    console.log('[Amazon Scraper] ========================================');
    
    // Extract compare at price
    const compareMatch = htmlContent.match(/<span[^>]*data-a-strike="true"[^>]*>.*?<span[^>]*class="[^"]*a-offscreen[^"]*"[^>]*>(.*?)<\/span>/s);
    const compareAtPrice = compareMatch ? compareMatch[1].trim() : "";
    
    // Extract weight - try multiple patterns with comprehensive debugging
    let weight = "";
    let weightUnit = "kg";
    
    console.log('[Amazon Scraper] ========================================');
    console.log('[Amazon Scraper] Starting weight extraction...');
    
    // Debug: Find ALL weight mentions in the page
    const allWeightMentions = htmlContent.match(/weight[^<>]{0,100}/gi);
    if (allWeightMentions && allWeightMentions.length > 0) {
      console.log(`[Amazon Scraper] Found ${allWeightMentions.length} weight mentions in HTML:`);
      allWeightMentions.slice(0, 10).forEach((mention, i) => {
        console.log(`  ${i + 1}. ${mention.substring(0, 80)}`);
      });
    } else {
      console.log('[Amazon Scraper] ⚠️ NO weight mentions found in HTML at all!');
    }
    
    // Pattern 1: Ultra-aggressive - find any number followed by weight unit
    const ultraBroadMatch = htmlContent.match(/([\d.]+)\s*(pounds?|lbs?|kg|kilograms?|grams?|g|oz|ounces?)(?:\s|<|&)/i);
    if (ultraBroadMatch && !weight) {
      const weightValue = ultraBroadMatch[1];
      const unit = ultraBroadMatch[2].toLowerCase();
      console.log('[Amazon Scraper] ✓ Found weight (Ultra Broad):', weightValue, unit);
      
      weight = weightValue;
      if (unit.includes('pound') || unit.includes('lb')) {
        weightUnit = "lb";
      } else if (unit.includes('kg') || unit.includes('kilogram')) {
        weightUnit = "kg";
      } else if (unit.includes('oz') || unit.includes('ounce')) {
        weight = (parseFloat(weightValue) / 16).toFixed(2);
        weightUnit = "lb";
      } else if (unit === 'g' || unit === 'grams' || unit === 'gram') {
        weightUnit = "g";
      }
    }
    
    // Pattern 2: Look for weight with context (item/product/shipping)
    if (!weight) {
      const contextWeightMatch = htmlContent.match(/(?:item|product|shipping|package)[\s:]*weight[^<>]*?[:>\s]+([\d.]+)\s*(pounds?|lbs?|kg|kilograms?|g|grams?|oz|ounces?)/i);
      if (contextWeightMatch) {
        const weightValue = contextWeightMatch[1];
        const unit = contextWeightMatch[2].toLowerCase();
        console.log('[Amazon Scraper] ✓ Found weight (Context):', weightValue, unit);
        
        weight = weightValue;
        if (unit.includes('pound') || unit.includes('lb')) {
          weightUnit = "lb";
        } else if (unit.includes('kg') || unit.includes('kilogram')) {
          weightUnit = "kg";
        } else if (unit.includes('oz') || unit.includes('ounce')) {
          weight = (parseFloat(weightValue) / 16).toFixed(2);
          weightUnit = "lb";
        } else if (unit.includes('g') || unit.includes('gram')) {
          weightUnit = "g";
        }
      }
    }
    
    // Pattern 3: Look in structured data / JSON
    if (!weight) {
      const jsonPatterns = [
        /"item_weight"\s*:\s*"([^"]+)"/i,
        /"weight"\s*:\s*"([^"]+)"/i,
        /"packageWeight"\s*:\s*"([^"]+)"/i
      ];
      
      for (const pattern of jsonPatterns) {
        const jsonMatch = htmlContent.match(pattern);
        if (jsonMatch) {
          const weightText = jsonMatch[1].trim();
          console.log('[Amazon Scraper] ✓ Found weight (JSON):', weightText);
          
          const poundsMatch = weightText.match(/([\d.]+)\s*(?:pounds?|lbs?)/i);
          const kgMatch = weightText.match(/([\d.]+)\s*(?:kg|kilograms?)/i);
          const gramsMatch = weightText.match(/([\d.]+)\s*(?:g|grams?)(?!\s*(?:kg|kilograms?))/i);
          const ozMatch = weightText.match(/([\d.]+)\s*(?:oz|ounces?)/i);
          
          if (poundsMatch) {
            weight = poundsMatch[1];
            weightUnit = "lb";
            break;
          } else if (kgMatch) {
            weight = kgMatch[1];
            weightUnit = "kg";
            break;
          } else if (ozMatch) {
            weight = (parseFloat(ozMatch[1]) / 16).toFixed(2);
            weightUnit = "lb";
            break;
          } else if (gramsMatch) {
            weight = gramsMatch[1];
            weightUnit = "g";
            break;
          }
        }
      }
    }
    
    // Pattern 4: Look in HTML table structures
    if (!weight) {
      const tablePatterns = [
        /<th[^>]*>(?:Item|Product|Shipping|Package)\s*Weight[^<]*<\/th>\s*<td[^>]*>([^<]+)/i,
        /<tr[^>]*>.*?(?:Item|Product|Shipping|Package)\s*Weight.*?<td[^>]*>([^<]+)/i
      ];
      
      for (const pattern of tablePatterns) {
        const tableMatch = htmlContent.match(pattern);
        if (tableMatch) {
          const weightText = tableMatch[1].replace(/<[^>]*>/g, '').trim();
          console.log('[Amazon Scraper] ✓ Found weight (Table):', weightText);
          
          const poundsMatch = weightText.match(/([\d.]+)\s*(?:pounds?|lbs?)/i);
          const kgMatch = weightText.match(/([\d.]+)\s*(?:kg|kilograms?)/i);
          const gramsMatch = weightText.match(/([\d.]+)\s*(?:g|grams?)(?!\s*(?:kg|kilograms?))/i);
          const ozMatch = weightText.match(/([\d.]+)\s*(?:oz|ounces?)/i);
          
          if (poundsMatch) {
            weight = poundsMatch[1];
            weightUnit = "lb";
            break;
          } else if (kgMatch) {
            weight = kgMatch[1];
            weightUnit = "kg";
            break;
          } else if (ozMatch) {
            weight = (parseFloat(ozMatch[1]) / 16).toFixed(2);
            weightUnit = "lb";
            break;
          } else if (gramsMatch) {
            weight = gramsMatch[1];
            weightUnit = "g";
            break;
          }
        }
      }
    }
    
    console.log('[Amazon Scraper] Final extracted weight:', weight, weightUnit);
    console.log('[Amazon Scraper] ========================================');
    
    // Extract dimensions
    const dimensionsMatch = htmlContent.match(/Product Dimensions[:\s]*<\/span>.*?<span[^>]*>(.*?)<\/span>/si);
    const dimensions = dimensionsMatch ? dimensionsMatch[1].replace(/<[^>]*>/g, '').trim() : "";
    
    // Extract what's in the box
    const whatsInBoxMatch = htmlContent.match(/(?:What'?s? in the [Bb]ox|Whats in the Box)[:\s]*<\/span>.*?<span[^>]*>(.*?)<\/span>/si);
    const whatsInBox = whatsInBoxMatch ? whatsInBoxMatch[1].replace(/<[^>]*>/g, '').trim() : "";
    
    // Extract warranty
    const warrantyMatch = htmlContent.match(/(?:Warranty|Manufacturer Warranty)[:\s]*<\/span>.*?<span[^>]*>(.*?)<\/span>/si);
    const warranty = warrantyMatch ? warrantyMatch[1].replace(/<[^>]*>/g, '').trim() : "";

    // Extract high-res images from colorImages array inside ImageBlockATF
    console.log('[Amazon Scraper] ========================================');
    console.log('[Amazon Scraper] Starting image extraction...');
    console.log('[Amazon Scraper] HTML length:', htmlContent.length);
    
    const foundImages: string[] = [];
    
    // Method 1: Find the colorImages.initial array by locating start position and counting brackets
    // This approach handles nested objects with multiple } brackets correctly
    const colorImagesStartMatch = htmlContent.match(/['"']colorImages['"']\s*:\s*\{\s*['"']initial['"']\s*:\s*\[/);
    
    if (colorImagesStartMatch && colorImagesStartMatch.index !== undefined) {
      console.log('[Amazon Scraper] ✓ Found colorImages.initial start position');
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
        if (imageUrl && imageUrl !== 'null' && imageUrl.startsWith('http')) {
          foundImages.push(imageUrl);
          console.log(`[Amazon Scraper] ✓ Added hiRes ${foundImages.length}: ${imageUrl.substring(0, 80)}...`);
        }
      }
      console.log(`[Amazon Scraper] Total hiRes matches found: ${matchCount}, valid images: ${foundImages.length}`);
    }
    
    // Method 2: Fallback - Look for large images in data attributes or img tags
    if (foundImages.length === 0) {
      console.log('[Amazon Scraper] colorImages.initial not found, trying fallback methods...');
      
      // Try data-old-hires attribute
      const dataOldHiresRegex = /data-old-hires="([^"]+)"/g;
      let match;
      while ((match = dataOldHiresRegex.exec(htmlContent)) !== null) {
        if (match[1] && match[1].startsWith('http')) {
          foundImages.push(match[1]);
          console.log(`[Amazon Scraper] ✓ Found image in data-old-hires`);
        }
      }
      
      // Try data-a-dynamic-image attribute
      if (foundImages.length === 0) {
        const dynamicImageRegex = /data-a-dynamic-image="([^"]+)"/g;
        while ((match = dynamicImageRegex.exec(htmlContent)) !== null) {
          try {
            const decoded = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
            const imageUrls = Object.keys(JSON.parse(`{${decoded}}`));
            imageUrls.forEach(url => {
              if (url.startsWith('http')) {
                foundImages.push(url);
                console.log(`[Amazon Scraper] ✓ Found image in data-a-dynamic-image`);
              }
            });
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
      
      // Try og:image meta tags
      if (foundImages.length === 0) {
        const ogImageRegex = /<meta[^>]*property="og:image"[^>]*content="([^"]+)"/gi;
        while ((match = ogImageRegex.exec(htmlContent)) !== null) {
          if (match[1] && match[1].startsWith('http')) {
            foundImages.push(match[1]);
            console.log(`[Amazon Scraper] ✓ Found image in og:image meta tag`);
          }
        }
      }
    }
    
    console.log(`[Amazon Scraper] Total images extracted: ${foundImages.length}`);
    console.log('[Amazon Scraper] ========================================');
    
    const images = Array.from(new Set(foundImages)); // Remove duplicates
    console.log(`[Amazon Scraper] Final: ${images.length} unique high-res images`);
    console.log(`[Amazon Scraper] Title: ${productName?.substring(0, 50)}...`);
    console.log(`[Amazon Scraper] Price: ${price}`);
    console.log(`[Amazon Scraper] Images: ${images.length}`);

    let finalDescription = description;
    if (dimensions) {
        finalDescription += `<p>Dimensions: ${dimensions}</p>`;
    }
    if (whatsInBox) {
        finalDescription += `<div class="whats-in-box"><h3>What's in the Box</h3><p>${whatsInBox}</p></div>`;
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
    
    // Post-process: Ensure prices have currency symbols
    // If price is just a number without symbol, add the appropriate currency based on domain
    let finalPrice = price;
    let finalComparePrice = finalCompareAtPrice;
    
    if (price && /^[\d,]+(?:\.[\d]{2})?$/.test(price.trim())) {
      // Price is just a number, add currency symbol
      const currencySymbol = domain === 'IN' ? '₹' : 
                            domain === 'UK' ? '£' : 
                            domain === 'CA' ? 'CA$' : 
                            domain === 'DE' ? '€' : '$';
      finalPrice = `${currencySymbol}${price}`;
      console.log(`[Amazon Scraper] Added currency symbol to price: ${finalPrice}`);
    }
    
    if (finalComparePrice && /^[\d,]+(?:\.[\d]{2})?$/.test(finalComparePrice.trim())) {
      // Compare price is just a number, add currency symbol
      const currencySymbol = domain === 'IN' ? '₹' : 
                            domain === 'UK' ? '£' : 
                            domain === 'CA' ? 'CA$' : 
                            domain === 'DE' ? '€' : '$';
      finalComparePrice = `${currencySymbol}${finalComparePrice}`;
      console.log(`[Amazon Scraper] Added currency symbol to compare price: ${finalComparePrice}`);
    }

    const result = {
      productName: cleanProductName(productName),
      description: finalDescription,
      price: finalPrice,
      compareAtPrice: finalComparePrice,
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

    console.log('[Amazon Scraper] ========================================');
    console.log('[Amazon Scraper] FINAL EXTRACTED DATA (JSON):');
    console.log(JSON.stringify({
      productName: result.productName,
      price: result.price,
      compareAtPrice: result.compareAtPrice,
      imageCount: result.images.length,
      weight: result.weight,
      weightUnit: result.weightUnit,
      descriptionLength: result.description.length
    }, null, 2));
    console.log('[Amazon Scraper] RAW PRICE VALUE:', finalPrice);
    console.log('[Amazon Scraper] RAW COMPARE PRICE:', finalComparePrice);
    console.log('[Amazon Scraper] ========================================');

    return result;
}

// Enhanced Puppeteer with stealth mode and human-like behavior
async function scrapeAmazonWithPuppeteerStealth(url: string, attemptNumber: number = 1): Promise<string> {
  console.log(`[Amazon Stealth] 🚀 Launching stealth browser (attempt ${attemptNumber})...`);
  
  try {
    // Use puppeteer-extra with stealth plugin
    const puppeteerExtra = await import('puppeteer-extra');
    const StealthPlugin = await import('puppeteer-extra-plugin-stealth');
    
    // Add stealth plugin to evade detection
    puppeteerExtra.default.use(StealthPlugin.default());
    
    console.log('[Amazon Stealth] ✓ Stealth plugin loaded');
    
    const browser = await puppeteerExtra.default.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-web-security',
        '--window-size=1920,1080',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    });

    const page = await browser.newPage();
    console.log('[Amazon Stealth] ✓ New page created');
    
    // Set realistic viewport with slight randomization
    const viewportWidth = 1920 + Math.floor(Math.random() * 100 - 50);
    const viewportHeight = 1080 + Math.floor(Math.random() * 100 - 50);
    await page.setViewport({ 
      width: viewportWidth, 
      height: viewportHeight,
      deviceScaleFactor: 1,
      hasTouch: false,
      isLandscape: true,
    });
    console.log(`[Amazon Stealth] ✓ Viewport set: ${viewportWidth}x${viewportHeight}`);
    
    // Set extra headers that mimic real browser
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    });
    
    // Override navigator properties to appear more human
    await page.evaluateOnNewDocument(() => {
      // Override the navigator.webdriver property
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
      
      // Override plugins to make it look real
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      
      // Override languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
    });
    console.log('[Amazon Stealth] ✓ Navigator properties overridden');

    // Add random delay before navigation (1-3 seconds)
    const preNavDelay = 1000 + Math.floor(Math.random() * 2000);
    console.log(`[Amazon Stealth] ⏳ Waiting ${preNavDelay}ms before navigation...`);
    await new Promise(resolve => setTimeout(resolve, preNavDelay));

    console.log('[Amazon Stealth] 🌐 Navigating to:', url);
    
    // Navigate with longer timeout
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    console.log('[Amazon Stealth] ✓ Page loaded');

    // Random delay after page load (2-4 seconds) to mimic human reading time
    const postLoadDelay = 2000 + Math.floor(Math.random() * 2000);
    console.log(`[Amazon Stealth] ⏳ Waiting ${postLoadDelay}ms for dynamic content...`);
    await new Promise(resolve => setTimeout(resolve, postLoadDelay));
    
    // Simulate human-like behavior: random scrolling
    console.log('[Amazon Stealth] 🖱️ Simulating human scrolling...');
    await page.evaluate(() => {
      // Scroll down slowly like a human
      const scrollHeight = Math.floor(Math.random() * 500) + 300;
      window.scrollBy({
        top: scrollHeight,
        left: 0,
        behavior: 'smooth'
      });
    });
    await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 400));
    
    // Scroll back up a bit
    await page.evaluate(() => {
      window.scrollBy({
        top: -100,
        left: 0,
        behavior: 'smooth'
      });
    });
    await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 300));
    
    // Try to handle cookie consent if present
    console.log('[Amazon Stealth] 🍪 Checking for cookie consent...');
    try {
      const cookieButton = await page.$('input[name="accept"]');
      if (cookieButton) {
        console.log('[Amazon Stealth] ✓ Found cookie consent, clicking...');
        await cookieButton.click();
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (e) {
      console.log('[Amazon Stealth] No cookie consent found or already accepted');
    }
    
    // Move mouse randomly to appear more human
    console.log('[Amazon Stealth] 🖱️ Simulating mouse movement...');
    const mouseX = Math.floor(Math.random() * viewportWidth);
    const mouseY = Math.floor(Math.random() * viewportHeight);
    await page.mouse.move(mouseX, mouseY);
    await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));
    
    // Wait for price elements with multiple selectors
    console.log('[Amazon Stealth] 🔍 Waiting for price elements...');
    try {
      await Promise.race([
        page.waitForSelector('#corePriceDisplay_desktop_feature_div', { timeout: 8000 }),
        page.waitForSelector('#apex_desktop', { timeout: 8000 }),
        page.waitForSelector('.a-price', { timeout: 8000 }),
        page.waitForSelector('#priceblock_ourprice', { timeout: 8000 }),
        page.waitForSelector('[data-a-strike="true"]', { timeout: 8000 }),
      ]);
      console.log('[Amazon Stealth] ✓ Price elements found!');
    } catch (e) {
      console.log('[Amazon Stealth] ⚠️ Price elements not found within timeout, continuing anyway...');
    }

    // Final wait before extraction
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get the HTML content
    const html = await page.content();
    console.log('[Amazon Stealth] ✓ Extracted HTML, length:', html.length);
    
    // Check if we got blocked (CAPTCHA detection)
    if (html.includes('Type the characters you see') || html.includes('Enter the characters you see below')) {
      console.log('[Amazon Stealth] ❌ CAPTCHA detected in response');
    } else {
      console.log('[Amazon Stealth] ✓ No CAPTCHA detected');
    }

    await browser.close();
    console.log('[Amazon Stealth] ✓ Browser closed successfully');

    return html;
  } catch (error) {
    console.error('[Amazon Stealth] ❌ Error:', error);
    throw error;
  }
}
