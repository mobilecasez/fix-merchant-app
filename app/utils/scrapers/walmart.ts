import { launchBrowser } from "./browser";
import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice, parseWeight, estimateWeight } from "./helpers";

export async function scrapeWalmart(html: string, url: string): Promise<ScrapedProductData> {
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    
    // Anti-detection measures
    await page.evaluateOnNewDocument(() => {
      // Override the navigator.webdriver property
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
      
      // Mock plugins to appear more like a real browser
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      
      // Mock languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
    });
    
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    
    await page.setViewport({ width: 1920, height: 1080 });
    
    await page.goto(url, { waitUntil: "networkidle2" });

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
      const imageElements = document.querySelectorAll('[data-testid="media-thumbnail"] img, .hover-zoom-hero-image');
      imageElements.forEach(img => {
        const src = img.getAttribute('src') || img.getAttribute('data-src');
        if (src && !src.includes('icon')) {
          // Get high-res version
          const highResSrc = src.split('?')[0]; // Remove query params for higher quality
          images.push(highResSrc);
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
  } catch (error) {
    console.error("Error during Walmart scraping:", error);
    return {
      productName: "",
      description: "",
      price: "",
      images: [],
      vendor: "Walmart",
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
      await browser.close();
    }
  }
}
