import { parse } from 'node-html-parser';
import { cleanProductName, ensureCompareAtPrice } from "./helpers";

export async function scrapeAmazonNew(html: string, url: string): Promise<any> {
  try {
    console.log('[Amazon New Scraper] Starting scrape for:', url);
    
    // Fetch HTML directly with proper headers (fast!)
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36',
        'accept-language': 'en-US,en;q=0.9',
        'accept-encoding': 'gzip, deflate, br',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch page: ${response.status}`);
    }

    const htmlContent = await response.text();
    console.log('[Amazon New Scraper] HTML fetched, parsing...');
    
    // Parse with node-html-parser
    const root = parse(htmlContent);
    
    // Extract data according to article
    const extractedData: any = {};
    
    // 1. Title - try multiple selectors
    try {
      const titleElement = root.querySelector('#title') || 
                          root.querySelector('#productTitle') ||
                          root.querySelector('h1.a-size-large');
      extractedData.title = titleElement?.text?.trim() || null;
      console.log('[Amazon New Scraper] Title:', extractedData.title?.substring(0, 50) + '...');
    } catch (error) {
      console.log('[Amazon New Scraper] Could not extract title');
      extractedData.title = null;
    }
    
    // 2. Description - try multiple selectors
    try {
      const descElement = root.querySelector('#feature-bullets') ||
                         root.querySelector('#featurebullets_feature_div') ||
                         root.querySelector('.a-unordered-list.a-vertical.a-spacing-mini');
      extractedData.description = descElement?.innerHTML || null;
      console.log('[Amazon New Scraper] Description extracted:', !!extractedData.description);
    } catch (error) {
      console.log('[Amazon New Scraper] Could not extract description');
      extractedData.description = null;
    }
    
    // 3. Price - try multiple selectors
    try {
      let price = null;
      
      // Try span.a-price first
      let priceElement = root.querySelector('span.a-price');
      if (priceElement) {
        const priceSpan = priceElement.querySelector('span.a-offscreen');
        price = priceSpan?.text?.trim();
      }
      
      // Try priceblock_ourprice
      if (!price) {
        priceElement = root.querySelector('#priceblock_ourprice');
        price = priceElement?.text?.trim();
      }
      
      // Try priceblock_dealprice
      if (!price) {
        priceElement = root.querySelector('#priceblock_dealprice');
        price = priceElement?.text?.trim();
      }
      
      // Try corePriceDisplay_desktop_feature_div
      if (!price) {
        priceElement = root.querySelector('.a-price.aok-align-center span.a-offscreen');
        price = priceElement?.text?.trim();
      }
      
      extractedData.price = price;
      console.log('[Amazon New Scraper] Price:', extractedData.price);
    } catch (error) {
      console.log('[Amazon New Scraper] Could not extract price');
      extractedData.price = null;
    }
    
    // 4. Compare at price (strikethrough price) - try multiple selectors
    try {
      let comparePrice = null;
      
      // Try span[data-a-strike="true"]
      let strikeElement = root.querySelector('span[data-a-strike="true"] span.a-offscreen');
      if (strikeElement) {
        comparePrice = strikeElement.text?.trim();
      }
      
      // Try .a-text-price
      if (!comparePrice) {
        const textPriceElement = root.querySelector('.a-text-price .a-offscreen');
        if (textPriceElement) {
          comparePrice = textPriceElement.text?.trim();
        }
      }
      
      // Try basis-price
      if (!comparePrice) {
        const basisPriceElement = root.querySelector('.basisPrice span.a-offscreen');
        if (basisPriceElement) {
          comparePrice = basisPriceElement.text?.trim();
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
    
    // 5. Extract product specs/details (for SKU, Barcode, etc.) - try multiple selectors
    try {
      const specs: any = {};
      
      // Try tr.a-spacing-small
      let specRows = root.querySelectorAll('tr.a-spacing-small');
      
      // Try .prodDetTable tr if first fails
      if (specRows.length === 0) {
        specRows = root.querySelectorAll('.prodDetTable tr');
      }
      
      // Try #productDetails_detailBullets_sections1 tr
      if (specRows.length === 0) {
        specRows = root.querySelectorAll('#productDetails_detailBullets_sections1 tr');
      }
      
      // Try #detailBullets_feature_div li
      if (specRows.length === 0) {
        const listItems = root.querySelectorAll('#detailBullets_feature_div .a-list-item');
        for (const item of listItems) {
          const text = item.text?.trim();
          if (text && text.includes(':')) {
            const parts = text.split(':');
            if (parts.length >= 2) {
              const key = parts[0].trim();
              const value = parts.slice(1).join(':').trim();
              specs[key] = value;
            }
          }
        }
      } else {
        // Parse rows
        for (const row of specRows) {
          const spanTags = row.querySelectorAll('span');
          if (spanTags.length >= 2) {
            const key = spanTags[0].text?.trim() || '';
            const value = spanTags[1].text?.trim() || '';
            if (key && value) {
              specs[key] = value;
            }
          } else {
            // Try th/td structure
            const th = row.querySelector('th');
            const td = row.querySelector('td');
            if (th && td) {
              const key = th.text?.trim() || '';
              const value = td.text?.trim() || '';
              if (key && value) {
                specs[key] = value;
              }
            }
          }
        }
      }
      
      extractedData.specs = specs;
      console.log('[Amazon New Scraper] Specs extracted:', Object.keys(specs).length, 'items');
      
      // Try to find SKU and Barcode from specs
      extractedData.sku = specs['Item model number'] || 
                         specs['Model Number'] || 
                         specs['Item Model Number'] ||
                         specs['Model'] ||
                         null;
      extractedData.barcode = specs['UPC'] || 
                             specs['EAN'] || 
                             specs['ASIN'] ||
                             specs['Item Part Number'] ||
                             null;
      
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
  }
}
