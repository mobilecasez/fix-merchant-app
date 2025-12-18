import { launchBrowser } from "./browser";
import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice, parseWeight, estimateWeight } from "./helpers";

export async function scrapeTemu(html: string, url: string): Promise<ScrapedProductData> {
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36",
    );
    await page.goto(url, { waitUntil: "networkidle2" });

    // Wait for dynamic content to load
    await new Promise(resolve => setTimeout(resolve, 3000));

    const pageData = await page.evaluate(() => {
      const productName =
        document.querySelector('h1[class*="title"]')?.textContent?.trim() ||
        document.querySelector('[class*="ProductTitle"]')?.textContent?.trim() || "";
      
      const descriptionElement =
        document.querySelector('[class*="description"]') ||
        document.querySelector('[class*="ProductDesc"]');
      const description = descriptionElement?.innerHTML || "";
      
      const priceElement = 
        document.querySelector('[class*="price"][class*="current"]') ||
        document.querySelector('[class*="Price"]');
      const price = priceElement?.textContent?.trim() || "";
      
      const originalPriceElement =
        document.querySelector('[class*="price"][class*="original"]') ||
        document.querySelector('[class*="LineThrough"]');
      const compareAtPrice = originalPriceElement?.textContent?.trim() || "";

      // Extract images
      const images: string[] = [];
      const imageElements = document.querySelectorAll('[class*="ProductImage"] img, [class*="gallery"] img');
      imageElements.forEach(img => {
        const src = img.getAttribute('src') || img.getAttribute('data-src');
        if (src && !src.includes('icon') && !src.includes('logo')) {
          images.push(src);
        }
      });

      // Try to extract weight from description or specs
      let weight = '';
      let warranty = '';
      const allText = document.body.textContent || '';
      const weightMatch = allText.match(/weight[:\s]+([0-9.]+\s*[a-zA-Z]+)/i);
      if (weightMatch) {
        weight = weightMatch[1];
      }
      const warrantyMatch = allText.match(/warranty[:\s]+([^\n.]+)/i);
      if (warrantyMatch) {
        warranty = warrantyMatch[1];
      }

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
      vendor: "Temu",
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
    console.error("Error during Temu scraping:", error);
    return {
      productName: "",
      description: "",
      price: "",
      images: [],
      vendor: "Temu",
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
