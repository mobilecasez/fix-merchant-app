import puppeteer from "puppeteer";
import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice, parseWeight, estimateWeight } from "./helpers";

export async function scrapeMercadoLibre(html: string, url: string): Promise<ScrapedProductData> {
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
        document.querySelector('.ui-pdp-title')?.textContent?.trim() ||
        document.querySelector('h1')?.textContent?.trim() || "";
      
      const descriptionElement =
        document.querySelector('.ui-pdp-description') ||
        document.querySelector('.item-description');
      const description = descriptionElement?.innerHTML || "";
      
      const priceElement = 
        document.querySelector('.andes-money-amount__fraction') ||
        document.querySelector('.price-tag-fraction');
      const price = priceElement?.textContent?.trim() || "";
      
      const originalPriceElement =
        document.querySelector('.andes-money-amount--previous') ||
        document.querySelector('.price-tag-amount');
      const compareAtPrice = originalPriceElement?.textContent?.trim() || "";

      // Extract images
      const images: string[] = [];
      const imageElements = document.querySelectorAll('.ui-pdp-gallery__figure img, .ui-pdp-image');
      imageElements.forEach(img => {
        const src = img.getAttribute('src') || img.getAttribute('data-src');
        if (src && !src.includes('icon')) {
          // Get high-res version
          const highResSrc = src.replace(/-I\.jpg/, '-O.jpg');
          images.push(highResSrc);
        }
      });

      // Extract specifications
      let weight = '';
      let warranty = '';
      const specs = document.querySelectorAll('.ui-pdp-specs__table__column');
      specs.forEach(spec => {
        const label = spec.querySelector('.ui-pdp-specs__table__column-title')?.textContent?.toLowerCase() || '';
        if (label.includes('weight') || label.includes('peso')) {
          const value = spec.querySelector('.ui-pdp-specs__table__column-value');
          if (value) {
            weight = value.textContent?.trim() || '';
          }
        }
        if (label.includes('warranty') || label.includes('garantía')) {
          const value = spec.querySelector('.ui-pdp-specs__table__column-value');
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
      vendor: "MercadoLibre",
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
    console.error("Error during MercadoLibre scraping:", error);
    return {
      productName: "",
      description: "",
      price: "",
      images: [],
      vendor: "MercadoLibre",
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
