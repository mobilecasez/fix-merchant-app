import { launchBrowser } from "./browser";
import { ScrapedProductData } from "./types";
import { cleanProductName, ensureCompareAtPrice, parseWeight, estimateWeight } from "./helpers";

export async function scrapeFlipkart(html: string, url: string): Promise<ScrapedProductData> {
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36",
    );
    
    // Use domcontentloaded instead of networkidle2 for faster loading
    await page.goto(url, { 
      waitUntil: "domcontentloaded",
      timeout: 30000 
    });

    // Wait for content to load
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Save page HTML for debugging
    const pageHTML = await page.content();
    console.log('Flipkart: Page HTML length:', pageHTML.length);

    console.log('Flipkart: Starting to scrape product data...');

    const pageData = await page.evaluate(() => {
      // Log all available content for debugging
      console.log('Flipkart: Page title:', document.title);
      console.log('Flipkart: Body classes:', document.body.className);

      // Product name - try multiple selectors
      const productName =
        document.querySelector('.VU-ZEz')?.textContent?.trim() ||
        document.querySelector('.B_NuCI')?.textContent?.trim() ||
        document.querySelector('h1 span.VU-ZEz')?.textContent?.trim() ||
        document.querySelector('.yhB1nd')?.textContent?.trim() ||
        document.querySelector('h1')?.textContent?.trim() ||
        document.querySelector('span[class*="VU-"]')?.textContent?.trim() ||
        "";
      
      console.log('Flipkart: Product name found:', productName);
      
      // Description
      let descriptionHTML = "";
      const descDiv = document.querySelector('div._6VBbE3') || 
                      document.querySelector('._1mXcCf') ||
                      document.querySelector('._3WHvuP') ||
                      document.querySelector('div[class*="description"]');
      if (descDiv) {
        descriptionHTML = descDiv.innerHTML;
      }
      
      // Price - try all possible selectors and log what we find
      let price = "";
      
      // Method 1: Specific selectors (get only direct text content)
      const priceDiv1 = document.querySelector('div.Nx9bqj.CxhGGd');
      if (priceDiv1) {
        const priceText = priceDiv1.textContent?.trim() || "";
        // Extract only the price pattern
        const priceMatch = priceText.match(/₹[\d,]+/);
        if (priceMatch) {
          price = priceMatch[0];
          console.log('Flipkart: Price from Nx9bqj:', price);
        }
      }
      
      // Method 2: Alternative structures
      if (!price) {
        const priceDiv2 = document.querySelector('._30jeq3._16Jk6d') ||
                         document.querySelector('._30jeq3') ||
                         document.querySelector('._1vC4OE');
        if (priceDiv2) {
          const priceText = priceDiv2.textContent?.trim() || "";
          const priceMatch = priceText.match(/₹[\d,]+/);
          if (priceMatch) {
            price = priceMatch[0];
            console.log('Flipkart: Price from alternative:', price);
          }
        }
      }
      
      // Method 3: Search all elements for price pattern
      if (!price) {
        const pricePattern = /₹[\d,]+/;
        const allElements = Array.from(document.querySelectorAll('div, span'));
        
        for (const element of allElements) {
          // Get only the element's own text, not children
          const ownText = Array.from(element.childNodes)
            .filter(node => node.nodeType === Node.TEXT_NODE)
            .map(node => node.textContent)
            .join('');
          
          const match = ownText.match(pricePattern);
          if (match && ownText.length < 20) {
            price = match[0];
            console.log('Flipkart: Price from pattern search:', price);
            break;
          }
        }
      }
      
      console.log('Flipkart: Final price:', price);
      
      // Original price - try all possible selectors for strikethrough/original MRP
      let compareAtPrice = "";
      
      // Method 1: Specific strikethrough/original price selectors
      const originalDiv1 = document.querySelector('div.yRaY8j.ZYYwLA') ||
                           document.querySelector('div.yRaY8j') ||
                           document.querySelector('.Nx9bqj.yRaY8j');
      if (originalDiv1) {
        const originalText = originalDiv1.textContent?.trim() || "";
        const priceMatch = originalText.match(/₹[\d,]+/);
        if (priceMatch) {
          compareAtPrice = priceMatch[0];
          console.log('Flipkart: Original price from yRaY8j:', compareAtPrice);
        }
      }
      
      // Method 2: Look for any text-decoration strikethrough
      if (!compareAtPrice) {
        const strikethroughElements = Array.from(document.querySelectorAll('*')).filter(el => {
          const style = window.getComputedStyle(el);
          return style.textDecoration.includes('line-through');
        });
        
        for (const el of strikethroughElements) {
          const text = el.textContent?.trim() || '';
          const priceMatch = text.match(/₹[\d,]+/);
          if (priceMatch && text.length < 30) {
            compareAtPrice = priceMatch[0];
            console.log('Flipkart: Original price from computed strikethrough:', compareAtPrice);
            break;
          }
        }
      }
      
      // Method 3: Other common class selectors
      if (!compareAtPrice) {
        const originalDiv2 = document.querySelector('._3I9_wc._2p6lqe') ||
                            document.querySelector('._3auQ3N._1POkHg') ||
                            document.querySelector('._16Jk6d');
        if (originalDiv2) {
          const originalText = originalDiv2.textContent?.trim() || "";
          const priceMatch = originalText.match(/₹[\d,]+/);
          if (priceMatch) {
            compareAtPrice = priceMatch[0];
            console.log('Flipkart: Original price from alternative class:', compareAtPrice);
          }
        }
      }
      
      // Method 4: Look for del tags
      if (!compareAtPrice) {
        const strikethrough = document.querySelector('del');
        if (strikethrough) {
          const text = strikethrough.textContent?.trim() || '';
          const priceMatch = text.match(/₹[\d,]+/);
          if (priceMatch) {
            compareAtPrice = priceMatch[0];
            console.log('Flipkart: Original price from del tag:', compareAtPrice);
          }
        }
      }
      
      // Method 5: Search near the price element for any crossed-out text
      if (!compareAtPrice && price) {
        const priceParent = document.querySelector('div.Nx9bqj.CxhGGd')?.parentElement?.parentElement;
        if (priceParent) {
          const allTextInParent = priceParent.textContent || '';
          const allPricesInParent = allTextInParent.match(/₹[\d,]+/g);
          
          if (allPricesInParent && allPricesInParent.length >= 2) {
            // Find prices that are different from the current price
            const otherPrices = allPricesInParent.filter(p => p !== price);
            if (otherPrices.length > 0) {
              // Use the first different price found (likely the original)
              const candidatePrice = otherPrices[0];
              const candidateNum = parseFloat(candidatePrice.replace(/[^0-9]/g, ''));
              const currentNum = parseFloat(price.replace(/[^0-9]/g, ''));
              
              // Only use it if it's higher than current price (makes sense as MRP)
              if (candidateNum > currentNum) {
                compareAtPrice = candidatePrice;
                console.log('Flipkart: Original price from price parent container:', compareAtPrice);
              }
            }
          }
        }
      }
      
      console.log('Flipkart: Final compare price found on page:', compareAtPrice);

      // Extract warranty information
      let warranty = '';
      const warrantyRows = document.querySelectorAll('div.row');
      warrantyRows.forEach(row => {
        const text = row.textContent?.toLowerCase() || '';
        if (text.includes('warranty')) {
          warranty = row.textContent?.trim() || '';
          console.log('Flipkart: Warranty found:', warranty);
        }
      });
      
      // Also check in specifications table
      if (!warranty) {
        const specRows = document.querySelectorAll('tr');
        specRows.forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            const label = cells[0].textContent?.toLowerCase() || '';
            if (label.includes('warranty')) {
              warranty = row.textContent?.trim() || '';
              console.log('Flipkart: Warranty found in specs:', warranty);
            }
          }
        });
      }

      // Extract specifications including weight
      let weight = '';
      const specTables = document.querySelectorAll('table');
      specTables.forEach(table => {
        const rows = table.querySelectorAll('tr');
        rows.forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            const labelText = cells[0].textContent?.toLowerCase() || '';
            if (labelText.includes('weight')) {
              weight = cells[1].textContent?.trim() || '';
              console.log('Flipkart: Weight found:', weight);
            }
          }
        });
      });

      return { productName, description: descriptionHTML, price, compareAtPrice, weight, warranty };
    });

    // Extract images by clicking thumbnails and capturing high-resolution loaded images
    console.log('Flipkart: Starting image extraction...');
    
    // Debug: Log all elements that might be thumbnails
    const debugInfo = await page.evaluate(() => {
      const info: any = {
        allLists: [] as string[],
        allImagesWithRukminim: [] as any[],
        bodyClasses: document.body.className,
        containerClasses: [] as string[]
      };
      
      // Find all ul/ol elements
      const lists = document.querySelectorAll('ul, ol');
      lists.forEach(list => {
        const className = list.className;
        const childCount = list.children.length;
        if (childCount > 0) {
          info.allLists.push(`${list.tagName}.${className} (${childCount} children)`);
        }
      });
      
      // Find all rukminim images
      const rukminimImgs = document.querySelectorAll('img[src*="rukminim"]');
      rukminimImgs.forEach(img => {
        const imgEl = img as HTMLImageElement;
        info.allImagesWithRukminim.push({
          src: imgEl.src.substring(0, 100),
          width: imgEl.width,
          height: imgEl.height,
          className: imgEl.className,
          parentClass: imgEl.parentElement?.className || ''
        });
      });
      
      // Find containers with multiple images
      const divs = document.querySelectorAll('div');
      divs.forEach(div => {
        const imgs = div.querySelectorAll('img[src*="rukminim"]');
        if (imgs.length > 1) {
          info.containerClasses.push(`${div.className} (${imgs.length} images)`);
        }
      });
      
      return info;
    });
    
    console.log('Flipkart DEBUG - All lists:', JSON.stringify(debugInfo.allLists, null, 2));
    console.log('Flipkart DEBUG - All rukminim images:', JSON.stringify(debugInfo.allImagesWithRukminim, null, 2));
    console.log('Flipkart DEBUG - Containers with multiple images:', JSON.stringify(debugInfo.containerClasses, null, 2));
    
    // Try multiple thumbnail selectors
    const thumbnailSelectors = [
      'ul._75SRR9 li',
      '.QSCKDh.dLgFEE.col-5-12.mfzC0s li',
      '._2E2XRG li',
      'ul[class*="thumbnail"] li',
      'div[class*="thumbnails"] li',
      'ul li img[src*="rukminim"]',
      'li img[src*="rukminim"][src*="/128/"]',
      'div img[src*="rukminim"][src*="/128/"]'
    ];
    
    let thumbnailElements = null;
    let thumbnailCount = 0;
    let usedSelector = '';
    
    for (const selector of thumbnailSelectors) {
      console.log(`Flipkart: Trying selector: ${selector}`);
      thumbnailElements = await page.$$(selector);
      thumbnailCount = thumbnailElements.length;
      console.log(`Flipkart: Found ${thumbnailCount} elements with selector: ${selector}`);
      if (thumbnailCount > 0) {
        usedSelector = selector;
        break;
      }
    }
    
    const images: string[] = [];
    
    if (thumbnailCount > 0 && thumbnailElements) {
      console.log(`Flipkart: Will click ${thumbnailCount} thumbnails using selector: ${usedSelector}`);
      
      // Click each thumbnail and capture the high-res image that loads
      for (let i = 0; i < thumbnailCount; i++) {
        try {
          console.log(`Flipkart: Clicking thumbnail ${i + 1}/${thumbnailCount}`);
          
          // Click the thumbnail
          await thumbnailElements[i].click();
          console.log(`Flipkart: Click executed on thumbnail ${i + 1}`);
          
          // Wait for image to load
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          // Get the high-res image URL from the main display area
          const highResImage = await page.evaluate(() => {
            // Look for the main image display - try all possible selectors
            const mainImageSelectors = [
              'img[src*="rukminim"][src*="/832/"]',
              'img[src*="rukminim"][src*="/1000/"]',
              'img[src*="rukminim"][src*="/1200/"]',
              'img[src*="rukminim"][src*="/1400/"]',
              'img[src*="rukminim"][src*="/800/"]',
              '.CXW8mj img',
              '._3kidJX img',
              '.col-7-12 img',
              'div[class*="image"] img[src*="rukminim"]'
            ];
            
            for (const selector of mainImageSelectors) {
              const img = document.querySelector(selector) as HTMLImageElement;
              if (img && img.src && img.src.includes('rukminim')) {
                // Make sure it's a high-res image (not thumbnail)
                const hasHighRes = img.src.includes('/832/') || img.src.includes('/1000/') || 
                                   img.src.includes('/1200/') || img.src.includes('/1400/') || 
                                   img.src.includes('/1600/') || img.src.includes('/800/') ||
                                   img.src.includes('/640/') || img.src.includes('/416/');
                
                if (hasHighRes) {
                  console.log(`Found high-res with ${selector}: ${img.src.substring(0, 80)}`);
                  return img.src;
                }
              }
            }
            
            // Fallback: get the largest image on the page
            const allImgs = Array.from(document.querySelectorAll('img[src*="rukminim"]')) as HTMLImageElement[];
            let largestImgSrc = "";
            let maxSize = 0;
            
            allImgs.forEach(img => {
              const size = img.width * img.height;
              if (size > maxSize && img.src) {
                maxSize = size;
                largestImgSrc = img.src;
              }
            });
            
            if (largestImgSrc) {
              console.log(`Fallback - largest image: ${largestImgSrc.substring(0, 80)}`);
              return largestImgSrc;
            }
            
            return null;
          });
          
          if (highResImage && !images.includes(highResImage)) {
            images.push(highResImage);
            console.log(`Flipkart: ✓ Captured image ${images.length}: ${highResImage.substring(0, 100)}`);
          } else if (highResImage) {
            console.log(`Flipkart: Image already captured, skipping duplicate`);
          } else {
            console.log(`Flipkart: ✗ No high-res image found after clicking thumbnail ${i + 1}`);
          }
          
        } catch (error) {
          console.log(`Flipkart: Error clicking thumbnail ${i + 1}:`, error);
        }
      }
    } else {
      console.log('Flipkart: No thumbnails found with any selector, trying direct image extraction');
    }
    
    // Fallback: if no images captured, get what's on the page
    if (images.length === 0) {
      console.log('Flipkart: Fallback - extracting all images from page');
      const fallbackImages = await page.evaluate(() => {
        const imgs: string[] = [];
        const allImages = document.querySelectorAll('img[src*="rukminim"]');
        console.log(`Total rukminim images on page: ${allImages.length}`);
        
        allImages.forEach((img, index) => {
          const src = (img as HTMLImageElement).src;
          console.log(`Image ${index + 1}: ${src.substring(0, 100)}`);
          
          // Get any image that's not a tiny thumbnail
          if (src && !src.includes('/128/128/') && !src.includes('/112/112/') && 
              !src.includes('/64/64/') && !src.includes('/56/56/')) {
            imgs.push(src);
            console.log(`  -> Added to results`);
          }
        });
        return imgs;
      });
      
      console.log(`Fallback found ${fallbackImages.length} images`);
      images.push(...fallbackImages);
    }
    
    const uniqueImages = Array.from(new Set(images));
    console.log(`Flipkart: ===== FINAL RESULT: ${uniqueImages.length} unique images =====`);
    uniqueImages.forEach((img, idx) => {
      console.log(`Final Image ${idx + 1}: ${img}`);
    });

    const { productName, description, price, compareAtPrice, weight, warranty } = pageData;

    console.log('Flipkart: Extracted data:', { productName, price, imageCount: uniqueImages.length, weight, warranty });

    // Add warranty to description if found
    let finalDescription = description;
    if (warranty) {
      finalDescription += `<div class="warranty-info"><h3>Warranty Information</h3><p>${warranty}</p></div>`;
    }

    // Parse weight or estimate
    let weightParsed = parseWeight(weight);
    if (!weightParsed.value) {
      console.log('Flipkart: No weight found, estimating based on product name');
      weightParsed = estimateWeight(productName);
    }

    // Ensure compare at price (add 20% if missing)
    const finalCompareAtPrice = ensureCompareAtPrice(price, compareAtPrice);

    return {
      productName: cleanProductName(productName),
      description: finalDescription,
      price,
      compareAtPrice: finalCompareAtPrice,
      images: uniqueImages,
      vendor: "Flipkart",
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
    console.error("Error during Flipkart scraping:", error);
    return {
      productName: "",
      description: "",
      price: "",
      images: [],
      vendor: "Flipkart",
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
