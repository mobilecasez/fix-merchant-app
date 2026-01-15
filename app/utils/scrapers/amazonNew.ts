import { parse } from 'node-html-parser';
import { launchBrowser } from "./browser";
import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice } from "./helpers";

export async function scrapeAmazonNew(html: string, url: string): Promise<any> {
  let browser;
  try {
    console.log('[Amazon New Scraper] Starting scrape for:', url);
    browser = await launchBrowser();
    const page = await browser.newPage();
    
    // Set headers like in the article
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36",
    );
    
    await page.setExtraHTTPHeaders({
      'accept-language': 'en-US,en;q=0.9',
      'accept-encoding': 'gzip, deflate, br',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    });

    await page.setViewport({ width: 1920, height: 1080 });

    console.log('[Amazon New Scraper] Navigating to URL...');
    await page.goto(url, { 
      waitUntil: "networkidle2",
      timeout: 60000 
    });
    
    console.log('[Amazon New Scraper] Page loaded successfully');

    // Get the HTML content
    const htmlContent = await page.content();
    
    // Parse with node-html-parser
    const root = parse(htmlContent);
    
    // Extract data according to article
    const extractedData: any = {};
    
    // 1. Title - from h1#title
    try {
      const titleElement = root.querySelector('#title');
      extractedData.title = titleElement?.text?.trim() || null;
      console.log('[Amazon New Scraper] Title:', extractedData.title?.substring(0, 50) + '...');
    } catch (error) {
      console.log('[Amazon New Scraper] Could not extract title');
      extractedData.title = null;
    }
    
    // 2. Description - from #feature-bullets
    try {
      const descElement = root.querySelector('#feature-bullets');
      extractedData.description = descElement?.innerHTML || null;
      console.log('[Amazon New Scraper] Description extracted:', !!extractedData.description);
    } catch (error) {
      console.log('[Amazon New Scraper] Could not extract description');
      extractedData.description = null;
    }
    
    // 3. Price - from span.a-price
    try {
      const priceElement = root.querySelector('span.a-price');
      const priceSpan = priceElement?.querySelector('span');
      extractedData.price = priceSpan?.text?.trim() || null;
      console.log('[Amazon New Scraper] Price:', extractedData.price);
    } catch (error) {
      console.log('[Amazon New Scraper] Could not extract price');
      extractedData.price = null;
    }
    
    // 4. Compare at price (strikethrough price)
    try {
      let comparePrice = null;
      
      // Try first selector
      const strikeElement = root.querySelector('span[data-a-strike="true"] span.a-offscreen');
      if (strikeElement) {
        comparePrice = strikeElement.text?.trim();
      }
      
      // Try second selector if first fails
      if (!comparePrice) {
        const textPriceElement = root.querySelector('.a-text-price .a-offscreen');
        if (textPriceElement) {
          comparePrice = textPriceElement.text?.trim();
        }
      }
      
      extractedData.compareAtPrice = comparePrice;
      
      // Use logic from existing amazon.ts - add 20% if missing
      if (extractedData.price && !extractedData.compareAtPrice) {
        extractedData.compareAtPrice = ensureCompareAtPrice(extractedData.price, '');
      }
      
      console.log('[Amazon New Scraper] Compare at price:', extractedData.compareAtPrice);
    } catch (error) {
      console.log('[Amazon New Scraper] Could not extract compare at price');
      extractedData.compareAtPrice = null;
    }
    
    // 5. Extract product specs/details (for SKU, Barcode, etc.)
    try {
      const specs: any = {};
      const specRows = root.querySelectorAll('tr.a-spacing-small');
      
      for (const row of specRows) {
        const spanTags = row.querySelectorAll('span');
        if (spanTags.length >= 2) {
          const key = spanTags[0].text?.trim() || '';
          const value = spanTags[1].text?.trim() || '';
          if (key && value) {
            specs[key] = value;
          }
        }
      }
      
      extractedData.specs = specs;
      console.log('[Amazon New Scraper] Specs extracted:', Object.keys(specs).length, 'items');
      
      // Try to find SKU and Barcode from specs
      extractedData.sku = specs['Item model number'] || specs['Model Number'] || null;
      extractedData.barcode = specs['UPC'] || specs['EAN'] || specs['ASIN'] || null;
      
    } catch (error) {
      console.log('[Amazon New Scraper] Could not extract specs');
      extractedData.specs = {};
      extractedData.sku = null;
      extractedData.barcode = null;
    }
    
    // 6. Variants - Check for variation options (size, color, etc.)
    try {
      const variants: any[] = [];
      
      // Look for twister variations
      const variationElements = root.querySelectorAll('#twister .a-button-text');
      
      if (variationElements.length > 0) {
        console.log('[Amazon New Scraper] Found', variationElements.length, 'variation options');
        
        // For now, just log that variants exist
        // Full variant extraction would require clicking each option and re-scraping
        extractedData.hasVariants = true;
        extractedData.variantCount = variationElements.length;
      } else {
        extractedData.hasVariants = false;
        extractedData.variantCount = 0;
      }
      
      extractedData.variants = variants;
      
    } catch (error) {
      console.log('[Amazon New Scraper] Could not extract variants');
      extractedData.variants = [];
      extractedData.hasVariants = false;
    }
    
    // Return the JSON
    console.log('[Amazon New Scraper] ========== EXTRACTED JSON ==========');
    console.log(JSON.stringify(extractedData, null, 2));
    console.log('[Amazon New Scraper] ====================================');
    
    return extractedData;
    
  } catch (error) {
    console.error("[Amazon New Scraper] Error during scraping:", error);
    throw error;
  } finally {
    if (browser) {
      console.log('[Amazon New Scraper] Closing browser...');
      await browser.close().catch((err) => {
        console.error('[Amazon New Scraper] Error closing browser:', err);
      });
    }
  }
}
