import puppeteer from "puppeteer";
import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice, parseWeight, estimateWeight } from "./helpers";

export async function scrapeAliExpress(html: string, url: string): Promise<ScrapedProductData> {
  let browser;
  try {
    browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36",
    );
    await page.goto(url, { waitUntil: "networkidle2" });

    const pageData = await page.evaluate(() => {
      const productName =
        document.querySelector('.product-title-text')?.textContent?.trim() ||
        document.querySelector('h1')?.textContent?.trim() || "";
      
      const description =
        document.querySelector('.product-description')?.innerHTML ||
        document.querySelector('.detail-desc')?.innerHTML || "";
      
      const priceElement = 
        document.querySelector('.product-price-value') ||
        document.querySelector('.price-current');
      const price = priceElement?.textContent?.trim() || "";
      
      const originalPriceElement =
        document.querySelector('.product-price-original') ||
        document.querySelector('.price-original');
      const compareAtPrice = originalPriceElement?.textContent?.trim() || "";

      // Extract images
      const images: string[] = [];
      const imageElements = document.querySelectorAll('.images-view-item img, .magnifier-image');
      imageElements.forEach(img => {
        const src = img.getAttribute('src') || img.getAttribute('data-src');
        if (src && !src.includes('icon') && !src.includes('logo')) {
          // Get high-res version if available
          const highResSrc = src.replace(/_\d+x\d+\./, '_640x640.');
          images.push(highResSrc);
        }
      });

      // Try to get specifications
      let weight = '';
      let warranty = '';
      const specItems = document.querySelectorAll('.product-prop-item, .specification-item');
      specItems.forEach(item => {
        const text = item.textContent?.toLowerCase() || '';
        if (text.includes('weight')) {
          weight = item.textContent?.trim() || '';
        }
        if (text.includes('warranty') || text.includes('guarantee')) {
          warranty = item.textContent?.trim() || '';
        }
      });

      return { productName, description, price, compareAtPrice, images, weight, warranty };
    });

    const { productName, description, price, compareAtPrice, images, weight, warranty } = pageData;

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
    const finalCompareAtPrice = ensureCompareAtPrice(price, compareAtPrice);

    return {
      productName: cleanProductName(productName),
      description: finalDescription,
      price,
      compareAtPrice: finalCompareAtPrice,
      images: Array.from(new Set(images)).filter(img => img && img.trim() !== ''),
      vendor: "AliExpress",
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
    console.error("Error during AliExpress scraping:", error);
    return {
      productName: "",
      description: "",
      price: "",
      images: [],
      vendor: "AliExpress",
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
