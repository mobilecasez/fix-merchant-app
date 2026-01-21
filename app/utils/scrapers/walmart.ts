import { launchBrowser } from "./browser";
import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice, parseWeight, estimateWeight } from "./helpers";

export async function scrapeWalmart(html: string, url: string): Promise<ScrapedProductData> {
  let browser;
  try {
    console.log('[Walmart Scraper] Starting scrape for:', url);
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36",
    );
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    const pageData = await page.evaluate(() => {
      const productName =
        document.querySelector('h1[itemprop="name"]')?.textContent?.trim() ||
        document.querySelector('h1')?.textContent?.trim() || "";
      
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

      // Extract images
      const images: string[] = [];
      const imageElements = document.querySelectorAll('[data-testid="media-thumbnail"] img, .hover-zoom-hero-image, img[src*="i5.walmartimages.com"]');
      imageElements.forEach(img => {
        const src = img.getAttribute('src') || img.getAttribute('data-src');
        if (src && src.includes('i5.walmartimages.com') && !src.includes('icon') && !src.includes('logo')) {
          // Get high-res version
          const highResSrc = src.split('?')[0]; // Remove query params for higher quality
          if (!images.includes(highResSrc)) {
            images.push(highResSrc);
          }
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
