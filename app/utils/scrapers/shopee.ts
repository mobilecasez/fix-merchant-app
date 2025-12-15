import puppeteer from "puppeteer";
import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice, parseWeight, estimateWeight } from "./helpers";

export async function scrapeShopee(html: string, url: string): Promise<ScrapedProductData> {
  let browser;
  try {
    browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36",
    );
    await page.goto(url, { waitUntil: "networkidle2" });

    // Wait for dynamic content
    await new Promise(resolve => setTimeout(resolve, 3000));

    const pageData = await page.evaluate(() => {
      const productName =
        document.querySelector('[class*="product-name"]')?.textContent?.trim() ||
        document.querySelector('span[class*="_44qnta"]')?.textContent?.trim() || "";
      
      const descriptionElement =
        document.querySelector('[class*="product-detail"]') ||
        document.querySelector('[class*="description"]');
      const description = descriptionElement?.innerHTML || "";
      
      const priceElement = 
        document.querySelector('[class*="price"]') ||
        document.querySelector('[class*="_3n5NQx"]');
      const price = priceElement?.textContent?.trim() || "";
      
      const originalPriceElement =
        document.querySelector('[class*="original-price"]') ||
        document.querySelector('[class*="_1w9jLI"]');
      const compareAtPrice = originalPriceElement?.textContent?.trim() || "";

      // Extract images
      const images: string[] = [];
      const imageElements = document.querySelectorAll('[class*="product-image"] img, ._1-VKTR img, ._17JVQS img');
      imageElements.forEach(img => {
        const src = img.getAttribute('src') || img.getAttribute('data-src');
        if (src && !src.includes('icon')) {
          // Get high-res version
          const highResSrc = src.replace(/_tn$/, '');
          images.push(highResSrc);
        }
      });

      // Extract specifications
      let weight = '';
      let warranty = '';
      const specs = document.querySelectorAll('[class*="product-detail"] div, table tr');
      specs.forEach(spec => {
        const text = spec.textContent?.toLowerCase() || '';
        if (text.includes('weight')) {
          weight = spec.textContent?.trim() || '';
        }
        if (text.includes('warranty')) {
          warranty = spec.textContent?.trim() || '';
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
      vendor: "Shopee",
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
    console.error("Error during Shopee scraping:", error);
    return {
      productName: "",
      description: "",
      price: "",
      images: [],
      vendor: "Shopee",
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
