import { launchBrowser } from "./browser";
import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice, parseWeight, estimateWeight } from "./helpers";

export async function scrapeEbay(html: string, url: string): Promise<ScrapedProductData> {
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36",
    );
    await page.goto(url, { waitUntil: "networkidle2" });

    console.log('eBay: Starting to scrape product data...');

    const pageData = await page.evaluate(() => {
      const productName =
        document.querySelector('h1.x-item-title__mainTitle')?.textContent?.trim() ||
        document.querySelector('.it-ttl')?.textContent?.trim() ||
        document.querySelector('h1')?.textContent?.trim() || "";
      
      console.log('eBay: Product name found:', productName);
      
      const descriptionElement =
        document.querySelector('#viTabs_0_panel') ||
        document.querySelector('.item-description') ||
        document.querySelector('#desc_div');
      const description = descriptionElement?.innerHTML || "";
      
      const priceElement = 
        document.querySelector('.x-price-primary span') ||
        document.querySelector('#prcIsum') ||
        document.querySelector('.x-price-primary') ||
        document.querySelector('[itemprop="price"]');
      const price = priceElement?.textContent?.trim() || priceElement?.getAttribute('content') || "";
      
      console.log('eBay: Price found:', price);
      
      const originalPriceElement =
        document.querySelector('.x-price-approx__price') ||
        document.querySelector('.strikethrough') ||
        document.querySelector('.x-price-secondary');
      const compareAtPrice = originalPriceElement?.textContent?.trim() || "";

      // Extract images - only from product gallery, not related products
      const images: string[] = [];
      
      // Method 1: Main image from the product image carousel
      const mainImage = document.querySelector('#icImg');
      if (mainImage) {
        const src = mainImage.getAttribute('src');
        if (src) {
          const highResSrc = src.replace(/s-l\d+/, 's-l1600');
          images.push(highResSrc);
          console.log('eBay: Main image found:', highResSrc);
        }
      }
      
      // Method 2: Thumbnail images from product gallery only (not related products)
      // Target only the main product image gallery container
      const galleryContainer = document.querySelector('#vi_main_img_fs') || 
                               document.querySelector('.ux-image-carousel') ||
                               document.querySelector('.vi-image-gallery');
      
      if (galleryContainer) {
        const thumbnails = galleryContainer.querySelectorAll('img');
        thumbnails.forEach(img => {
          const src = img.getAttribute('src') || img.getAttribute('data-src');
          if (src && !src.includes('s-l64') && !src.includes('icon') && !src.includes('logo')) {
            const highResSrc = src.replace(/s-l\d+/, 's-l1600');
            images.push(highResSrc);
          }
        });
        console.log('eBay: Gallery images found:', thumbnails.length);
      }
      
      // Method 3: Picture panel thumbnails (only from main product area)
      const picPanel = document.querySelector('#vi_main_img_fs ul');
      if (picPanel) {
        const picturePanelImgs = picPanel.querySelectorAll('img');
        picturePanelImgs.forEach(img => {
          const src = img.getAttribute('src');
          if (src && !src.includes('s-l64') && !src.includes('icon')) {
            const highResSrc = src.replace(/s-l\d+/, 's-l1600');
            images.push(highResSrc);
          }
        });
      }
      
      // Method 4: Extract from image data script (only for main product)
      // Look specifically for the image data within the product details area
      const scripts = Array.from(document.querySelectorAll('script'));
      const imageScript = scripts.find(script => {
        const content = script.textContent || '';
        return content.includes('"fsImgList"') || content.includes('"DEFAULT_IMAGE"');
      });
      
      if (imageScript && images.length < 3) { // Only use if we haven't found enough images
        const content = imageScript.textContent || '';
        // More specific regex to target main product images only
        const match = content.match(/"fsImgList":\s*\[(.*?)\]/);
        if (match && match[1]) {
          const urlMatches = match[1].match(/https:\/\/i\.ebayimg\.com\/images\/[^"]+/g);
          if (urlMatches) {
            urlMatches.forEach(url => {
              if (!url.includes('s-l64') && !url.includes('icon')) {
                images.push(url.replace(/s-l\d+/, 's-l1600'));
              }
            });
          }
        }
      }

      console.log('eBay: Total unique product images found:', new Set(images).size);

      // Extract specifications
      let weight = '';
      const specs = document.querySelectorAll('.ux-labels-values__labels-content, .attrLabels, [data-testid="ux-labels-values"]');
      specs.forEach(label => {
        const text = label.textContent?.toLowerCase() || '';
        if (text.includes('weight')) {
          const valueElement = label.nextElementSibling;
          if (valueElement) {
            weight = valueElement.textContent?.trim() || '';
            console.log('eBay: Weight found:', weight);
          }
        }
      });
      
      // Try item specifics table
      if (!weight) {
        const itemSpecifics = document.querySelectorAll('.ux-layout-section-evo__item');
        itemSpecifics.forEach(item => {
          const label = item.querySelector('.ux-textspans--BOLD');
          const value = item.querySelector('.ux-textspans:not(.ux-textspans--BOLD)');
          if (label && value) {
            const labelText = label.textContent?.toLowerCase() || '';
            if (labelText.includes('weight')) {
              weight = value.textContent?.trim() || '';
              console.log('eBay: Weight found in specifics:', weight);
            }
          }
        });
      }

      // Extract warranty information
      let warranty = '';
      const allSpecs = document.querySelectorAll('.ux-labels-values__labels-content, .attrLabels, [data-testid="ux-labels-values"]');
      allSpecs.forEach(label => {
        const text = label.textContent?.toLowerCase() || '';
        if (text.includes('warranty')) {
          const valueElement = label.nextElementSibling;
          if (valueElement) {
            warranty = valueElement.textContent?.trim() || '';
            console.log('eBay: Warranty found:', warranty);
          }
        }
      });

      return { productName, description, price, compareAtPrice, images, weight, warranty };
    });

    const { productName, description, price, compareAtPrice, images, weight, warranty } = pageData;

    console.log('eBay: Extracted data:', { productName, price, imageCount: images.length, weight, warranty });

    // Add warranty to description if found
    let finalDescription = description;
    if (warranty) {
      finalDescription += `<div class="warranty-info"><h3>Warranty Information</h3><p>${warranty}</p></div>`;
    }

    // Parse weight or estimate
    let weightParsed = parseWeight(weight);
    if (!weightParsed.value) {
      console.log('eBay: No weight found, estimating based on product name');
      weightParsed = estimateWeight(productName);
    }

    // Ensure compare at price (add 20% if missing)
    console.log('eBay: Price before ensureCompareAtPrice:', price);
    console.log('eBay: CompareAtPrice before ensureCompareAtPrice:', compareAtPrice);
    const finalCompareAtPrice = ensureCompareAtPrice(price, compareAtPrice);
    console.log('eBay: Final compareAtPrice after ensureCompareAtPrice:', finalCompareAtPrice);

    return {
      productName: cleanProductName(productName),
      description: finalDescription,
      price,
      compareAtPrice: finalCompareAtPrice,
      images: Array.from(new Set(images)).filter(img => img && img.trim() !== ''),
      vendor: "eBay",
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
    console.error("Error during eBay scraping:", error);
    return {
      productName: "",
      description: "",
      price: "",
      images: [],
      vendor: "eBay",
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
