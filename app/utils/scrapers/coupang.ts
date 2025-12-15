import puppeteer from "puppeteer";
import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice, parseWeight, estimateWeight } from "./helpers";

export async function scrapeCoupang(html: string, url: string): Promise<ScrapedProductData> {
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
        document.querySelector('.prod-buy-header__title')?.textContent?.trim() ||
        document.querySelector('h1')?.textContent?.trim() || "";
      
      const descriptionElement =
        document.querySelector('.prod-description') ||
        document.querySelector('.product-detail');
      const description = descriptionElement?.innerHTML || "";
      
      const priceElement = 
        document.querySelector('.total-price strong') ||
        document.querySelector('.price');
      const price = priceElement?.textContent?.trim() || "";
      
      const originalPriceElement =
        document.querySelector('.origin-price') ||
        document.querySelector('.base-price');
      const compareAtPrice = originalPriceElement?.textContent?.trim() || "";

      // Extract images
      const images: string[] = [];
      const imageElements = document.querySelectorAll('.prod-image__item img, .product-image-thumb img');
      imageElements.forEach(img => {
        const src = img.getAttribute('src') || img.getAttribute('data-src');
        if (src && !src.includes('icon')) {
          images.push(src);
        }
      });

      // Extract specifications
      let weight = '';
      let warranty = '';
      const specs = document.querySelectorAll('.prod-attr-item');
      specs.forEach(spec => {
        const label = spec.querySelector('.prod-attr-label')?.textContent?.toLowerCase() || '';
        if (label.includes('weight') || label.includes('무게')) {
          const value = spec.querySelector('.prod-attr-value');
          if (value) {
            weight = value.textContent?.trim() || '';
          }
        }
        if (label.includes('warranty') || label.includes('보증')) {
          const value = spec.querySelector('.prod-attr-value');
          if (value) {
            warranty = value.textContent?.trim() || '';
          }
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
      vendor: "Coupang",
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
    console.error("Error during Coupang scraping:", error);
    return {
      productName: "",
      description: "",
      price: "",
      images: [],
      vendor: "Coupang",
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
