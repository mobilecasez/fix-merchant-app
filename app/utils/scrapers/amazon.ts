import { launchBrowser } from "./browser";
import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice, parseWeight, estimateWeight } from "./helpers";

export async function scrapeAmazon(html: string, url: string): Promise<ScrapedProductData> {
  let browser;
  try {
    console.log('[Amazon Scraper] Starting scrape for:', url);
    browser = await launchBrowser();
    const page = await browser.newPage();
    
    // Better anti-detection
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    
    // Set extra headers to look more like a real browser
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    });

    // Set viewport
    await page.setViewport({ width: 1920, height: 1080 });

    console.log('[Amazon Scraper] Navigating to URL...');
    // Navigate with longer timeout and domcontentloaded instead of networkidle2
    await page.goto(url, { 
      waitUntil: "domcontentloaded",
      timeout: 45000 
    });
    
    console.log('[Amazon Scraper] Page loaded, waiting for product title...');
    // Wait a bit for dynamic content
    await page.waitForSelector('#productTitle', { timeout: 15000 }).catch(() => {
      console.log('[Amazon Scraper] productTitle not found, continuing anyway');
    });

    const pageData = await page.evaluate(() => {
      const productName =
        document.querySelector("#productTitle")?.textContent?.trim() || "";
      const description =
        document.querySelector("#feature-bullets")?.innerHTML || "";
      const price =
        document.querySelector('.a-price[data-a-color="price"] .a-offscreen')?.textContent?.trim() ||
        document.querySelector(".a-price-whole")?.textContent?.trim() ||
        "";
      const compareAtPrice =
        document.querySelector('span[data-a-strike="true"] span.a-offscreen')?.textContent?.trim() ||
        document.querySelector(".a-text-price .a-offscreen")?.textContent?.trim() ||
        "";

      let weight = '';
      let dimensions = '';

      const findDetail = (label: string) => {
        const ths = Array.from(document.querySelectorAll('th'));
        const th = ths.find(el => el.textContent.trim().toLowerCase().includes(label));
        if (th && th.nextElementSibling) {
          return th.nextElementSibling.textContent.trim();
        }

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
        return '';
      };

      weight = findDetail('item weight') || '';
      dimensions = findDetail('product dimensions') || '';
      const warranty = findDetail('warranty') || findDetail('manufacturer warranty') || '';

      const scripts = Array.from(document.querySelectorAll("script"));
      const colorImagesScript = scripts.find((script) =>
        script.textContent?.includes("colorImages"),
      );

      let images: string[] = [];
      if (colorImagesScript) {
        const scriptContent = colorImagesScript.textContent || "";
        const hiResRegex = /"hiRes":"(.*?)"/g;
        let match;
        const foundImages = new Set<string>();
        while ((match = hiResRegex.exec(scriptContent)) !== null) {
          if (match[1]) {
            foundImages.add(match[1]);
          }
        }
        images = Array.from(foundImages);
      }

      return { productName, description, price, compareAtPrice, images, weight, dimensions, warranty };
    });

    const { productName, description, price, compareAtPrice, images, weight, dimensions, warranty } = pageData;

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
