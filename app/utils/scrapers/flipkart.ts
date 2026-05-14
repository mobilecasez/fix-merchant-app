import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice, parseWeight, estimateWeight } from "./helpers";
import { parseWithGemini, MANUAL_HTML_REQUIRED } from "./generic";

export async function scrapeFlipkart(html: string, url: string): Promise<ScrapedProductData | typeof MANUAL_HTML_REQUIRED> {
  try {
    let htmlContent = html;
    let isManualHtml = false;

    // Only fetch if HTML parameter is not provided or is too small
    if (!html || html.length < 10000) {
      
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
        
        // Try to use the provided HTML parameter as fallback
        if (html && html.length > 10000) {
          htmlContent = html;
        } else if (response.status === 529 || response.status === 403 || response.status === 503) {
          // If 529 or 403 (anti-bot) and no HTML fallback, try Puppeteer
          return await scrapeFlipkartWithPuppeteer(url);
        } else {
          throw new Error(`Failed to fetch Flipkart page: ${response.status}`);
        }
      } else {
        htmlContent = await response.text();
        
        // Check if we got a CAPTCHA or error page despite 200 status
        if (htmlContent.includes('Access Denied') || 
            htmlContent.includes('Robot or human') || 
            htmlContent.length < 5000) {
          
          // Try to use the provided HTML parameter as fallback
          if (html && html.length > 10000) {
            htmlContent = html;
            isManualHtml = true;
          } else {
            return MANUAL_HTML_REQUIRED; // Force manual HTML instead of slow broken Puppeteer
          }
        }
      }
    } else {
      isManualHtml = true;
    }
    
    // Use Gemini AI for Flipkart to guarantee perfect variant and pricing extraction
    const parsedData = await parseWithGemini(htmlContent, url);
    return parsedData;
    
  } catch (error) {
    console.error('[Flipkart Scraper] Error:', error);
    return MANUAL_HTML_REQUIRED;
  }
}

// Puppeteer fallback for when anti-bot blocks fetch()
async function scrapeFlipkartWithPuppeteer(url: string): Promise<ScrapedProductData> {
  const puppeteer = await import('puppeteer');
  let browser;
  
  try {
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
    
    await page.goto(url, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    // Wait for dynamic content to load
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    
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
      
      // Get body text for later use
      const bodyText = document.body.innerText;
      
      // SMART STRATEGY: Use star rating as anchor to avoid ad prices
      // 1. Find the star rating element (unique to main product)
      // 2. Look for the FIRST strikethrough price AFTER the rating
      // 3. Find the selling price near that strikethrough
      
      // Find star rating SVG (green star with #008042 fill)
      const starSvgs = Array.from(document.querySelectorAll('svg'));
      let ratingElement: Element | null = null;
      
      for (const svg of starSvgs) {
        const path = svg.querySelector('path[fill*="#008042"]');
        if (path && svg.getAttribute('width') === '14' && svg.getAttribute('height') === '14') {
          ratingElement = svg;
          break;
        }
      }
      
      // If we found the rating, search for prices AFTER it in the DOM
      if (ratingElement) {
        
        // Get all strikethrough elements
        const allStrikethroughs = Array.from(document.querySelectorAll('[style*="line-through"]'));
        
        // Filter: only those that come AFTER the rating element in DOM order
        const ratingPosition = Array.from(document.querySelectorAll('*')).indexOf(ratingElement);
        
        for (const strike of allStrikethroughs) {
          const strikePosition = Array.from(document.querySelectorAll('*')).indexOf(strike);
          
          // Only consider strikethroughs that come AFTER the rating
          if (strikePosition > ratingPosition) {
            const strikeText = strike.textContent?.trim() || '';
            const mrpMatch = strikeText.match(/([\d,]+)/);
            
            if (mrpMatch) {
              const mrpValue = parseInt(mrpMatch[1].replace(/,/g, ''));
              if (mrpValue > 500) { // Reasonable product price
                mrp = '₹' + mrpMatch[1];
                
                // Find selling price near this strikethrough
                let searchContainer = strike.parentElement;
                for (let i = 0; i < 5 && searchContainer; i++) {
                  const containerText = searchContainer.textContent || '';
                  const priceMatches = containerText.match(/₹\s*([\d,]+)/g);
                  
                  if (priceMatches) {
                    for (const priceText of priceMatches) {
                      const match = priceText.match(/₹\s*([\d,]+)/);
                      if (match && match[1] !== mrpMatch[1]) {
                        const priceValue = parseInt(match[1].replace(/,/g, ''));
                        const mrpVal = parseInt(mrpMatch[1].replace(/,/g, ''));
                        if (priceValue < mrpVal && priceValue > 500) {
                          price = '₹' + match[1];
                          break;
                        }
                      }
                    }
                  }
                  
                  if (price) break;
                  searchContainer = searchContainer.parentElement;
                }
                
                // If we found both prices, we're done
                if (mrp && price) {
                  break;
                }
              }
            }
          }
        }
      }
      
      // Fallback: If star rating method didn't work, try text-based search
      if (!price) {
        const textLines = bodyText.split('\n').map(l => l.trim()).slice(0, 100);
        
        for (let i = 0; i < textLines.length; i++) {
          const line = textLines[i];
          
          if (line.match(/^₹\s*[\d,]+$/) && !line.includes('Buy') && !line.includes('Pay')) {
            const priceMatch = line.match(/₹\s*([\d,]+)/);
            if (priceMatch) {
              const priceValue = parseInt(priceMatch[1].replace(/,/g, ''));
              if (priceValue > 500) {
                price = '₹' + priceMatch[1];
                break;
              }
            }
          }
        }
      }
      
      // Fallback 2: Text-based search (only first 100 lines)
      if (!price) {
        const textLines = bodyText.split('\n').map(l => l.trim()).slice(0, 100);
        
        for (let i = 0; i < textLines.length; i++) {
          const line = textLines[i];
          
          if (line.match(/^₹\s*[\d,]+$/) && !line.includes('Buy') && !line.includes('Pay')) {
            const priceMatch = line.match(/₹\s*([\d,]+)/);
            if (priceMatch) {
              const priceValue = parseInt(priceMatch[1].replace(/,/g, ''));
              if (priceValue > 500) {
                price = '₹' + priceMatch[1];
                break;
              }
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
    // =============================================
    // 1. PRODUCT NAME - Use <title> tag (most reliable, never changes)
    // =============================================
    let productName = "";
    
    // Strategy 1: <title> tag — "Product Name | Flipkart.com" or "Buy Product Name Online..."
    const titleMatch = htmlContent.match(/<title[^>]*>(.*?)<\/title>/si);
    if (titleMatch) {
      productName = titleMatch[1]
        .replace(/<[^>]*>/g, '')
        .replace(/\s*[\|–-]\s*Flipkart\.com.*$/i, '')
        .replace(/\s*Online at Best Price.*$/i, '')
        .replace(/^\s*Buy\s+/i, '')
        .replace(/\s*at\s+Flipkart.*$/i, '')
        .trim();
    }
    
    // Strategy 2: JSON-LD structured data
    let jsonLdData: any = null;
    const jsonLdMatches = htmlContent.match(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    if (jsonLdMatches) {
      for (const block of jsonLdMatches) {
        try {
          const jsonText = block.replace(/<script[^>]*>|<\/script>/gi, '').trim();
          const parsed = JSON.parse(jsonText);
          // Look for Product type
          if (parsed['@type'] === 'Product' || (Array.isArray(parsed['@graph']) && parsed['@graph'].find((g: any) => g['@type'] === 'Product'))) {
            jsonLdData = parsed['@type'] === 'Product' ? parsed : parsed['@graph'].find((g: any) => g['@type'] === 'Product');
            break;
          }
        } catch { /* skip invalid JSON-LD */ }
      }
    }
    
    // Use JSON-LD name if title extraction gave poor result
    if (jsonLdData?.name && (!productName || productName.length < 10)) {
      productName = jsonLdData.name;
    }
    
    // Strategy 3: og:title meta tag
    if (!productName || productName.length < 10) {
      const ogTitle = htmlContent.match(/<meta[^>]*property\s*=\s*["']og:title["'][^>]*content\s*=\s*["'](.*?)["']/i);
      if (ogTitle) {
        productName = ogTitle[1]
          .replace(/\s*[\|–-]\s*Flipkart\.com.*$/i, '')
          .replace(/\s*Online at Best Price.*$/i, '')
          .trim();
      }
    }
    
    // Strategy 4: Flipkart-specific class patterns (fallback)
    if (!productName || productName.length < 10) {
      const namePatterns = [
        /<span class="VU-ZEz">([\s\S]*?)<\/span>/,
        /<span class="B_NuCI">([\s\S]*?)<\/span>/,
        /<h1[^>]*>([\s\S]*?)<\/h1>/,
      ];
      for (const pattern of namePatterns) {
        const match = htmlContent.match(pattern);
        if (match) {
          const name = match[1].replace(/<[^>]*>/g, '').trim();
          if (name.length > productName.length) {
            productName = name;
            break;
          }
        }
      }
    }

    // =============================================
    // 2. PRICES - Multiple strategies, broadest patterns first
    // =============================================
    let price = "";
    let compareAtPrice = "";
    
    // Strategy 1: JSON-LD structured data (most reliable when available)
    if (jsonLdData?.offers) {
      const offers = Array.isArray(jsonLdData.offers) ? jsonLdData.offers[0] : jsonLdData.offers;
      if (offers?.price) {
        price = '₹' + offers.price.toString().replace(/[^\d,]/g, '');
      }
      if (offers?.highPrice && offers.highPrice !== offers.price) {
        compareAtPrice = '₹' + offers.highPrice.toString().replace(/[^\d,]/g, '');
      }
    }
    
    // Strategy 2: Find the main price section using star rating as anchor
    // The star rating is unique to the main product (not ads)
    if (!price) {
      const starRatingPattern = /<svg[^>]+width="14"[^>]+height="14"[^>]*>[\s\S]*?<path[^>]+fill[^>]*#008042[^>]*>[\s\S]*?<\/svg>/i;
      const starMatch = htmlContent.match(starRatingPattern);
      
      if (starMatch) {
        const starIndex = htmlContent.indexOf(starMatch[0]);
        // Search within 5000 chars after the star rating for prices
        const contentAfterRating = htmlContent.substring(starIndex, starIndex + 5000);
        
        // Look for MRP (strikethrough) — multiple formats
        const mrpPatterns = [
          /text-decoration(?:-line)?:\s*line-through[^>]*>(?:₹\s*)?([\d,]+)/i,
          /line-through[^>]*>(?:<[^>]*>)*\s*₹?\s*([\d,]+)/i,
        ];
        
        let mrpValue = '';
        for (const p of mrpPatterns) {
          const m = contentAfterRating.match(p);
          if (m) {
            mrpValue = m[1].replace(/,/g, '');
            if (parseInt(mrpValue) > 100) {
              compareAtPrice = '₹' + m[1];
              break;
            }
          }
        }
        
        // Look for selling price — any ₹X,XX,XXX that is NOT the MRP
        const priceRegex = /₹\s*([\d,]+)/g;
        const allPrices: RegExpExecArray[] = [];
        let priceExec: RegExpExecArray | null;
        while ((priceExec = priceRegex.exec(contentAfterRating)) !== null) {
          allPrices.push(priceExec);
        }
        for (const pm of allPrices) {
          const val = pm[1].replace(/,/g, '');
          const numVal = parseInt(val);
          // Must be > 100 (avoid small numbers), and different from MRP
          if (numVal > 100 && val !== mrpValue) {
            // If we have MRP, selling price should be less than MRP
            if (mrpValue && numVal < parseInt(mrpValue)) {
              price = '₹' + pm[1];
              break;
            } else if (!mrpValue) {
              price = '₹' + pm[1];
              break;
            }
          }
        }
        
        // If we found MRP but not selling price, the first ₹ amount may be the selling price
        if (compareAtPrice && !price) {
          for (const pm of allPrices) {
            const val = pm[1].replace(/,/g, '');
            if (parseInt(val) > 100 && val !== mrpValue) {
              price = '₹' + pm[1];
              break;
            }
          }
        }
      }
    }
    
    // Strategy 3: Look for price near discount percentage (e.g., "6% off")
    if (!price) {
      const discountSection = htmlContent.match(/(\d{1,2})%\s*off[\s\S]{0,500}/i);
      if (discountSection) {
        const section = discountSection[0];
        const discPriceRegex = /₹\s*([\d,]+)/g;
        const prices: RegExpExecArray[] = [];
        let discExec: RegExpExecArray | null;
        while ((discExec = discPriceRegex.exec(section)) !== null) {
          prices.push(discExec);
        }
        if (prices.length >= 1) {
          // First price is usually the selling price
          price = '₹' + prices[0][1];
        }
        // Look for MRP in strikethrough near discount
        const mrpMatch = section.match(/text-decoration(?:-line)?:\s*line-through[^>]*>(?:₹\s*)?([\d,]+)/i);
        if (mrpMatch) {
          compareAtPrice = '₹' + mrpMatch[1];
        }
      }
    }
    
    // Strategy 4: Broad price sweep — find ₹ amounts near strikethrough
    if (!price) {
      const strikePattern = /text-decoration(?:-line)?:\s*line-through[^>]*>(?:<[^>]*>)*\s*₹?\s*([\d,]+)[\s\S]{0,200}?₹\s*([\d,]+)/i;
      const strikeMatch = htmlContent.match(strikePattern);
      if (strikeMatch) {
        const mrp = parseInt(strikeMatch[1].replace(/,/g, ''));
        const sell = parseInt(strikeMatch[2].replace(/,/g, ''));
        if (mrp > 100 && sell > 100) {
          if (sell < mrp) {
            price = '₹' + strikeMatch[2];
            compareAtPrice = '₹' + strikeMatch[1];
          } else {
            price = '₹' + strikeMatch[1];
          }
        }
      }
    }
    
    // Strategy 5: Class-based extraction (Flipkart-specific, may break)
    if (!price) {
      const pricePatterns = [
        /<div class="Nx9bqj[^"]*"[^>]*>(.*?)<\/div>/s,
        /<div class="[^"]*CxhGGd[^"]*"[^>]*>(.*?)<\/div>/s,
        /<div class="_30jeq3[^"]*"[^>]*>(.*?)<\/div>/s,
      ];
      
      for (const pattern of pricePatterns) {
        const patternMatch = htmlContent.match(pattern);
        if (patternMatch) {
          const priceNum = patternMatch[1].match(/₹?\s*([\d,]+)/);
          if (priceNum && parseInt(priceNum[1].replace(/,/g, '')) > 100) {
            price = '₹' + priceNum[1];
            break;
          }
        }
      }
    }
    
    // Strategy 6: og:price meta tags
    if (!price) {
      const ogPrice = htmlContent.match(/<meta[^>]*property\s*=\s*["'](?:og:price:amount|product:price:amount)["'][^>]*content\s*=\s*["']([\d,.]+)["']/i);
      if (ogPrice) {
        price = '₹' + ogPrice[1];
      }
    }

    // =============================================
    // 3. DESCRIPTION - Multiple strategies
    // =============================================
    let description = "";
    
    // Strategy 1: JSON-LD description
    if (jsonLdData?.description) {
      description = jsonLdData.description;
    }
    
    // Strategy 2: og:description meta tag
    if (!description) {
      const ogDesc = htmlContent.match(/<meta[^>]*(?:property\s*=\s*["']og:description["']|name\s*=\s*["']description["'])[^>]*content\s*=\s*["']([\s\S]*?)["']/i);
      if (ogDesc) {
        description = ogDesc[1].trim();
      }
    }
    
    // Strategy 3: Flipkart-specific class patterns
    if (!description || description.length < 50) {
      const descPatterns = [
        /<div class="_6VBbE3"[^>]*>([\s\S]*?)<\/div>/,
        /<div class="_1mXcCf"[^>]*>([\s\S]*?)<\/div>/,
        /<div class="_3WHvuP"[^>]*>([\s\S]*?)<\/div>/,
      ];
      for (const pattern of descPatterns) {
        const match = htmlContent.match(pattern);
        if (match && match[1].trim().length > description.length) {
          description = match[1].trim();
        }
      }
    }
    
    // =============================================
    // 4. IMAGES - Extract from rukminim CDN
    // =============================================
    const images: string[] = [];
    const imagePattern = /https:\/\/rukminim[12]\.flixcart\.com\/image\/[^"'\s<>]+\.(jpg|jpeg|png|webp)/gi;
    const imageMatches = htmlContent.match(imagePattern);
    
    if (imageMatches) {
      imageMatches.forEach(imgUrl => {
        const cleanUrl = imgUrl.split('>')[0].split('<')[0].split('"')[0].split("'")[0];
        
        // Convert to high-res
        let highResUrl = cleanUrl
          .replace(/\/\d+\/\d+\//, '/832/832/');
        
        if (!images.includes(highResUrl) && !highResUrl.includes('/30/30/') && !highResUrl.includes('/24/24/')) {
          images.push(highResUrl);
        }
      });
    }
    
    const uniqueImages = Array.from(new Set(images)).slice(0, 10);
    
    // =============================================
    // 5. WEIGHT
    // =============================================
    let weight = "";
    let weightUnit = "kg";
    const weightPatterns = [
      /(?:Item Weight|Product Weight|Weight|Net Quantity)[:\s]*<\/td>\s*<td[^>]*>(.*?)<\/td>/si,
      /(?:weight|Weight)[:\s]*([\d.]+)\s*(kg|g|grams?|kilograms?|lbs?|pounds?)/i,
      // Flipkart specs: look for weight in specification tables
      />([\d.]+)\s*(kg|g)\s*<\/(?:td|li|div|span)/i,
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
          break;
        }
      }
    }
    
    // Estimate weight if not found
    let finalWeight = weight;
    let finalWeightUnit = weightUnit;
    if (!weight) {
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
