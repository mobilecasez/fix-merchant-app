import { launchBrowser } from "./browser";
import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice, parseWeight, estimateWeight } from "./helpers";

export async function scrapeAmazon(html: string, url: string): Promise<ScrapedProductData> {
  let browser;
  try {
    console.log('[Amazon Scraper] Starting scrape for:', url);
    browser = await launchBrowser();
    const page = await browser.newPage();
    
    // Better anti-detection with realistic headers
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36",
    );
    
    // Set extra headers to look more like a real browser
    await page.setExtraHTTPHeaders({
      'accept-language': 'en-US,en;q=0.9',
      'accept-encoding': 'gzip, deflate, br',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    });

    // Set viewport
    await page.setViewport({ width: 1920, height: 1080 });

    console.log('[Amazon Scraper] Navigating to URL...');
    // Navigate with networkidle2 to ensure all content is loaded
    await page.goto(url, { 
      waitUntil: "networkidle2",
      timeout: 60000 
    });
    
    console.log('[Amazon Scraper] Page loaded successfully');

    // Get the full HTML content for regex extraction
    const htmlContent = await page.content();

    const pageData = await page.evaluate(() => {
      // Extract title from h1#title (as per article)
      const productName = document.querySelector('#title')?.textContent?.trim() || "";
      
      // Extract description
      const description = document.querySelector("#feature-bullets")?.innerHTML || "";
      
      // Extract price from span.a-price (as per article)
      const priceElement = document.querySelector("span.a-price");
      const price = priceElement?.querySelector("span")?.textContent?.trim() || "";
      
      // Extract compare at price
      const compareAtPrice =
        document.querySelector('span[data-a-strike="true"] span.a-offscreen')?.textContent?.trim() ||
        document.querySelector(".a-text-price .a-offscreen")?.textContent?.trim() ||
        "";

      let weight = '';
      let dimensions = '';

      const findDetail = (label: string) => {
        // Look in product details table
        const ths = Array.from(document.querySelectorAll('th'));
        const th = ths.find(el => el.textContent?.trim().toLowerCase().includes(label));
        if (th && th.nextElementSibling) {
          return th.nextElementSibling.textContent?.trim();
        }

        // Look in detail bullets
        const listItems = Array.from(document.querySelectorAll('#detailBullets_feature_div .a-list-item'));
        for (const item of listItems) {
            const text = item.textContent?.trim().toLowerCase();
            if (text?.includes(label)) {
                const spans = item.querySelectorAll('span');
                if (spans.length > 1) {
                    return spans[spans.length - 1].textContent?.trim();
                }
            }
        }
        
        // Look in product details specs table (tr.a-spacing-small as per article)
        const specs = Array.from(document.querySelectorAll("tr.a-spacing-small"));
        for (const spec of specs) {
          const spanTags = spec.querySelectorAll("span");
          if (spanTags.length >= 2) {
            const labelText = spanTags[0].textContent?.trim().toLowerCase();
            if (labelText?.includes(label)) {
              return spanTags[1].textContent?.trim();
            }
          }
        }
        
        return '';
      };

      weight = findDetail('item weight') || '';
      dimensions = findDetail('product dimensions') || '';
      const warranty = findDetail('warranty') || findDetail('manufacturer warranty') || '';

      return { productName, description, price, compareAtPrice, weight, dimensions, warranty };
    });

    // Extract high-res images using regex on full HTML (as per Scrapingdog article)
    // Pattern: "hiRes":"image_url"
    const hiResRegex = /"hiRes":"(.+?)"/g;
    const foundImages = new Set<string>();
    
    let match;
    while ((match = hiResRegex.exec(htmlContent)) !== null) {
      if (match[1] && match[1] !== 'null') {
        foundImages.add(match[1]);
      }
    }
    
    const images = Array.from(foundImages);
    console.log(`[Amazon Scraper] Extracted ${images.length} high-res images`);

    const { productName, description, price, compareAtPrice, weight, dimensions, warranty } = pageData;
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
  } finally {
    if (browser) {
      console.log('[Amazon Scraper] Closing browser...');
      await browser.close().catch((err) => {
        console.error('[Amazon Scraper] Error closing browser:', err);
      });
    }
  }
}
