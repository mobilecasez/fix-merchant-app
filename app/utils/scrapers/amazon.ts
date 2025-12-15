import puppeteer from "puppeteer";
import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice, parseWeight, estimateWeight } from "./helpers";

export async function scrapeAmazon(html: string, url: string): Promise<ScrapedProductData> {
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
    console.error("Error during Amazon scraping:", error);
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
      await browser.close();
    }
  }
}
