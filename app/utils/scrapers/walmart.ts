import { launchBrowser } from "./browser";
import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice, parseWeight, estimateWeight } from "./helpers";

export async function scrapeWalmart(html: string, url: string): Promise<ScrapedProductData> {
  let browser;
  try {
    console.log('[Walmart Scraper] Starting scrape for:', url);
    browser = await launchBrowser();
    const page = await browser.newPage();
    
    // Set realistic viewport
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Set comprehensive headers to avoid detection
    await page.setExtraHTTPHeaders({
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': 'https://www.walmart.com/',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
    });
    
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    
    // Add random delay before navigation
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
    
    await page.goto(url, { waitUntil: "networkidle0", timeout: 45000 });
    
    // Wait for content to load
    await page.waitForSelector('h1', { timeout: 10000 }).catch(() => console.log('[Walmart] No h1 found'));
    
    // Add small delay to let dynamic content load
    await new Promise(resolve => setTimeout(resolve, 2000));

    const pageData = await page.evaluate(() => {
      const productName =
        document.querySelector('h1[itemprop="name"]')?.textContent?.trim() ||
        document.querySelector('h1')?.textContent?.trim() || "";
      
      // Check for CAPTCHA or bot detection
      const bodyText = document.body.textContent || '';
      if (bodyText.includes('Robot or Human') || bodyText.includes('BogleWeb')) {
        console.log('[Walmart] CAPTCHA detected in page content');
        return { productName: 'CAPTCHA_DETECTED', description: '', price: '', wasPrice: '', images: [], weight: '', warranty: '' };
      }
      
      const descriptionElement =
        document.querySelector('.about-desc') ||
        document.querySelector('[data-testid="product-description"]');
      const description = descriptionElement?.innerHTML || "";
      
      const priceElement = 
        document.querySelector('[itemprop="price"]') ||
        document.querySelector('.price-characteristic');
      const price = priceElement?.getAttribute('content') || priceElement?.textContent?.trim() || "";
      
      const wasPrice = 
        document.querySelector('.was-price .visuallyhidden')?.textContent?.trim() || "";

      // Extract images - multiple strategies
      const images: string[] = [];
      
      // Strategy 1: Media thumbnails
      const thumbnails = document.querySelectorAll('[data-testid="media-thumbnail"] img');
      thumbnails.forEach(img => {
        const src = img.getAttribute('src') || img.getAttribute('data-src');
        if (src && src.includes('i5.walmartimages.com')) {
          const highResSrc = src.split('?')[0];
          if (!images.includes(highResSrc)) {
            images.push(highResSrc);
          }
        }
      });
      
      // Strategy 2: All Walmart CDN images
      const allImages = document.querySelectorAll('img[src*="i5.walmartimages.com"]');
      allImages.forEach(img => {
        const src = img.getAttribute('src');
        if (src && !src.includes('icon') && !src.includes('logo') && !src.includes('badge')) {
          const highResSrc = src.split('?')[0];
          if (!images.includes(highResSrc)) {
            images.push(highResSrc);
          }
        }
      });
      
      // Strategy 3: Look for image URLs in script tags or JSON
      const scripts = document.querySelectorAll('script');
      scripts.forEach(script => {
        const content = script.textContent || '';
        const imgMatches = content.match(/https:\/\/i5\.walmartimages\.com\/[^"'\s]+\.(jpg|jpeg|png|webp)/gi);
        if (imgMatches) {
          imgMatches.forEach(url => {
            const cleanUrl = url.split('?')[0];
            if (!cleanUrl.includes('icon') && !cleanUrl.includes('logo') && !images.includes(cleanUrl)) {
              images.push(cleanUrl);
            }
          });
        }
      });

      // Extract specifications
      let weight = '';
      let warranty = '';
      const specs = document.querySelectorAll('.spec-row, [data-testid="specification-row"]');
      specs.forEach(row => {
        const label = row.querySelector('.spec-name, [data-testid="spec-label"]');
        const value = row.querySelector('.spec-value, [data-testid="spec-value"]');
        if (label && value) {
          const labelText = label.textContent?.toLowerCase() || '';
          if (labelText.includes('weight')) {
            weight = value.textContent?.trim() || '';
          }
          if (labelText.includes('warranty')) {
            warranty = value.textContent?.trim() || '';
          }
        }
      });

      return { productName, description, price, wasPrice, images, weight, warranty };
    });

    const { productName, description, price, wasPrice, images, weight, warranty } = pageData;
    
    // Check if CAPTCHA was detected
    if (productName === 'CAPTCHA_DETECTED') {
      console.log('[Walmart Scraper] CAPTCHA page detected - cannot scrape');
      await browser.close();
      throw new Error('Walmart CAPTCHA detected - please try again later');
    }
    
    console.log('[Walmart Scraper] Product name:', productName);
    console.log('[Walmart Scraper] Images extracted:', images.length);

    // Add warranty to description if found
    let finalDescription = description;
    if (warranty) {
      finalDescription += `<div class="warranty-info"><h3>Warranty Information</h3><p>${warranty}</p></div>`;
    }

    // Parse weight or estimate
    let weightParsed = parseWeight(weight);
    if (!weightParsed.value) {
      weightParsed = estimateWeight(productName);
    }

    // Ensure compare at price (add 20% if missing)
    const finalCompareAtPrice = ensureCompareAtPrice(price, wasPrice);

    await browser.close();

    return {
      productName: cleanProductName(productName),
      description: finalDescription,
      price,
      compareAtPrice: finalCompareAtPrice,
      images: Array.from(new Set(images)).filter(img => img && img.trim() !== ''),
      vendor: "Walmart",
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
  } catch (error: any) {
    console.error('[Walmart Scraper] Error:', error.message);
    if (browser) {
      await browser.close();
    }
    throw error;
  }
}
