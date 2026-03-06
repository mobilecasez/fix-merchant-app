import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice, parseWeight, estimateWeight } from "./helpers";

export async function scrapeFlipkart(html: string, url: string): Promise<ScrapedProductData> {
  try {
    console.log('[Flipkart Scraper] Starting scrape for:', url);
    console.log('[Flipkart Scraper] HTML parameter provided:', !!html, 'Length:', html?.length || 0);
    
    let htmlContent = html;
    
    // Only fetch if HTML parameter is not provided or is too small
    if (!html || html.length < 10000) {
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
      
      // Check if we hit anti-bot protection (529 or similar errors)
      if (!response.ok) {
        console.log(`[Flipkart Scraper] HTTP error: ${response.status} ${response.statusText}`);
        
        // Try to use the provided HTML parameter as fallback
        if (html && html.length > 10000) {
          console.log('[Flipkart Scraper] Using provided HTML as fallback');
          htmlContent = html;
        } else if (response.status === 529 || response.status === 403 || response.status === 503) {
          // If 529 or 403 (anti-bot) and no HTML fallback, try Puppeteer
          console.log('[Flipkart Scraper] Anti-bot detected, falling back to Puppeteer...');
          return await scrapeFlipkartWithPuppeteer(url);
        } else {
          throw new Error(`Failed to fetch Flipkart page: ${response.status}`);
        }
      } else {
        htmlContent = await response.text();
        console.log('[Flipkart Scraper] Page fetched successfully, HTML length:', htmlContent.length);
        
        // Check if we got a CAPTCHA or error page despite 200 status
        if (htmlContent.includes('Access Denied') || 
            htmlContent.includes('Robot or human') || 
            htmlContent.length < 5000) {
          console.log('[Flipkart Scraper] CAPTCHA/Bot detection page detected');
          
          // Try to use the provided HTML parameter as fallback
          if (html && html.length > 10000) {
            console.log('[Flipkart Scraper] Using provided HTML parameter as fallback');
            htmlContent = html;
          } else {
            console.log('[Flipkart Scraper] Falling back to Puppeteer...');
            return await scrapeFlipkartWithPuppeteer(url);
          }
        }
      }
    } else {
      console.log('[Flipkart Scraper] Using provided HTML parameter (already fetched)');
    }
    
    return await parseFlipkartHTML(htmlContent, url);
  } catch (error) {
    console.error('[Flipkart Scraper] Error:', error);
    
    // Try to use provided HTML parameter as last resort before Puppeteer
    if (html && html.length > 10000) {
      console.log('[Flipkart Scraper] Attempting to parse provided HTML as last resort...');
      try {
        return await parseFlipkartHTML(html, url);
      } catch (parseError) {
        console.error('[Flipkart Scraper] Parse error:', parseError);
      }
    }
    
    // Final fallback: try Puppeteer
    console.log('[Flipkart Scraper] Attempting Puppeteer as final fallback...');
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
    
    console.log('[Flipkart Puppeteer] Navigating to URL...');
    await page.goto(url, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    // Wait for dynamic content to load
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log('[Flipkart Puppeteer] Extracting product data from DOM...');
    
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
        console.log('[Flipkart Puppeteer] Found star rating, searching for prices after it...');
        
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
                  console.log('[Flipkart Puppeteer] Found prices after rating - MRP:', mrp, 'Price:', price);
                  break;
                }
              }
            }
          }
        }
      }
      
      // Fallback: If star rating method didn't work, try text-based search
      if (!price) {
        console.log('[Flipkart Puppeteer] Star rating method failed, using fallback...');
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
    
    console.log('[Flipkart Puppeteer] Extracted:', {
      name: productData.productName,
      price: productData.price,
      mrp: productData.mrp,
      images: productData.images.length
    });
    
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
    
    // Extract prices - Flipkart shows selling price and MRP (original price)
    let price = "";
    let compareAtPrice = "";
    
    console.log('[Flipkart Scraper] ========================================');
    console.log('[Flipkart Scraper] Starting price extraction...');
    
    // SMART STRATEGY: Find star rating first, then look for prices AFTER it
    // This avoids capturing prices from ads that appear before the product details
    
    // Pattern 1: Find star rating SVG (14x14 with green star #008042)
    // Then capture the FIRST strikethrough price and selling price AFTER the rating
    const starRatingPattern = /<svg[^>]+width="14"[^>]+height="14"[^>]*>[\s\S]*?<path[^>]+fill[^>]*#008042[^>]*>[\s\S]*?<\/svg>/i;
    const starMatch = htmlContent.match(starRatingPattern);
    
    if (starMatch) {
      console.log('[Flipkart Scraper] ✓ Found star rating anchor');
      
      // Get the HTML content AFTER the star rating
      const starIndex = htmlContent.indexOf(starMatch[0]);
      const contentAfterRating = htmlContent.substring(starIndex);
      
      // Now look for the first price pattern after the rating
      const priceAfterRatingPattern = /text-decoration-line:\s*line-through[^>]*>([0-9,]+)<\/[^>]+>[\s\S]{0,150}?₹\s*([0-9,]+)/i;
      const priceMatch = contentAfterRating.match(priceAfterRatingPattern);
      
      if (priceMatch) {
        const mrp = priceMatch[1];
        const sellingPrice = priceMatch[2];
        
        console.log('[Flipkart Scraper] ✓ Found prices AFTER star rating:');
        console.log('[Flipkart Scraper]   MRP (strikethrough):', mrp);
        console.log('[Flipkart Scraper]   Selling price:', sellingPrice);
        
        price = '₹' + sellingPrice;
        compareAtPrice = '₹' + mrp;
      }
    }
    
    // Pattern 2: Fallback - Look for GREEN discount (#008042) if star rating not found
    if (!price) {
      console.log('[Flipkart Scraper] Star rating not found, trying green discount pattern...');
      const greenDiscountPattern = /#008042[^>]*>[\s\S]{0,300}?(\d+)%[\s\S]{0,300}?text-decoration-line:\s*line-through[^>]*>([0-9,]+)<\/[^>]+>[\s\S]{0,150}?₹\s*([0-9,]+)/i;
      const greenMatch = htmlContent.match(greenDiscountPattern);
    
      if (greenMatch) {
        const discount = greenMatch[1];
        const mrp = greenMatch[2];
        const sellingPrice = greenMatch[3];
        
        console.log('[Flipkart Scraper] ✓ Found price with green discount:');
        console.log('[Flipkart Scraper]   Discount:', discount + '%');
        console.log('[Flipkart Scraper]   MRP (strikethrough):', mrp);
        console.log('[Flipkart Scraper]   Selling price:', sellingPrice);
        
        price = '₹' + sellingPrice;
        compareAtPrice = '₹' + mrp;
      }
    }
    
    // Pattern 3: Last resort - discount percentage followed by prices (tightened range)
    if (!price) {
      console.log('[Flipkart Scraper] Trying discount pattern fallback...');
      const discountPattern = /(\d+)%<\/[^>]+>[\s\S]{0,150}?text-decoration-line:\s*line-through[^>]*>([0-9,]+)<\/[^>]+>[\s\S]{0,80}?₹\s*([0-9,]+)/i;
      const discountMatch = htmlContent.match(discountPattern);
      
      if (discountMatch) {
        const discount = discountMatch[1];
        const mrp = discountMatch[2];
        const sellingPrice = discountMatch[3];
        
        console.log('[Flipkart Scraper] ✓ Found price group with discount pattern:');
        console.log('[Flipkart Scraper]   Discount:', discount + '%');
        console.log('[Flipkart Scraper]   MRP (strikethrough):', mrp);
        console.log('[Flipkart Scraper]   Selling price:', sellingPrice);
        
        price = '₹' + sellingPrice;
        compareAtPrice = '₹' + mrp;
      }
    }
    
    // Pattern 3: Strikethrough followed by price (last resort fallback)
    if (!price) {
      console.log('[Flipkart Scraper] Trying strikethrough + price pattern...');
      const strikeAndPricePattern = /text-decoration-line:\s*line-through[^>]*>([0-9,]+)<\/[^>]+>[\s\S]{0,80}?₹\s*([0-9,]+)/i;
      const strikeMatch = htmlContent.match(strikeAndPricePattern);
      
      if (strikeMatch) {
        const mrp = strikeMatch[1];
        const sellingPrice = strikeMatch[2];
        
        console.log('[Flipkart Scraper] ✓ Found strikethrough + price:');
        console.log('[Flipkart Scraper]   MRP (strikethrough):', mrp);
        console.log('[Flipkart Scraper]   Selling price:', sellingPrice);
        
        price = '₹' + sellingPrice;
        compareAtPrice = '₹' + mrp;
      }
    }
    
    // Pattern 4: Class-based extraction (final fallback)
    if (!price) {
      console.log('[Flipkart Scraper] Trying class-based extraction...');
      
      const pricePatterns = [
        /<div class="Nx9bqj CxhGGd"[^>]*>(.*?)<\/div>/s,
        /<div class="_30jeq3 _16Jk6d"[^>]*>(.*?)<\/div>/s,
        /<div class="_30jeq3"[^>]*>(.*?)<\/div>/s,
      ];
      
      for (const pattern of pricePatterns) {
        const patternMatch = htmlContent.match(pattern);
        if (patternMatch) {
          const priceNum = patternMatch[1].match(/₹?([\d,]+)/);
          if (priceNum) {
            price = '₹' + priceNum[1];
            console.log('[Flipkart Scraper] ✓ Price from class pattern:', price);
            break;
          }
        }
      }
      
      // Try to find compare at price separately
      const comparePatterns = [
        /<div class="yRaY8j ZYYwLA"[^>]*>(.*?)<\/div>/s,
        /<div class="yRaY8j"[^>]*>(.*?)<\/div>/s,
        /<div class="_3I9_wc _2p6lqe"[^>]*>(.*?)<\/div>/s,
      ];
      
      for (const pattern of comparePatterns) {
        const patternMatch = htmlContent.match(pattern);
        if (patternMatch) {
          const compareNum = patternMatch[1].match(/₹?([\d,]+)/);
          if (compareNum) {
            compareAtPrice = '₹' + compareNum[1];
            console.log('[Flipkart Scraper] ✓ Compare price from class pattern:', compareAtPrice);
            break;
          }
        }
      }
    }
    
    console.log('[Flipkart Scraper] Final prices - Selling:', price, 'MRP:', compareAtPrice);
    console.log('[Flipkart Scraper] ========================================');
    
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
        const cleanUrl = imgUrl.split('>')[0].split('<')[0].split('"')[0].split("'")[0];
        
        // Convert to high-res by changing dimensions
        let highResUrl = cleanUrl;
        // Replace small dimensions with large ones
        highResUrl = highResUrl.replace(/\/128\/128\//, '/832/832/');
        highResUrl = highResUrl.replace(/\/416\/416\//, '/832/832/');
        highResUrl = highResUrl.replace(/\/200\/200\//, '/832/832/');
        highResUrl = highResUrl.replace(/\/312\/312\//, '/832/832/');
        
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
