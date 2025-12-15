# E-commerce Platform Scrapers

This directory contains modular scrapers for extracting product data from various e-commerce platforms.

## Architecture

### File Structure
- `types.ts` - Common TypeScript interfaces for all scrapers
- `index.ts` - Main entry point that routes URLs to appropriate scrapers
- `amazon.ts` - Amazon scraper (✅ COMPLETE & WORKING)
- `walmart.ts` - Walmart scraper (🚧 TODO)
- Other platform scrapers (🚧 TODO)

### How It Works

1. **URL Detection**: `getScraper(url)` in `index.ts` detects which platform the URL belongs to
2. **Scraper Selection**: Returns the appropriate scraper function for that platform
3. **Data Extraction**: Each scraper returns standardized `ScrapedProductData`

### Supported Platforms

| Platform | Status | File | Vendor Name |
|----------|--------|------|-------------|
| Amazon (all domains) | ✅ Complete | `amazon.ts` | Amazon |
| Walmart | ✅ Complete | `walmart.ts` | Walmart |
| eBay | ✅ Complete | `ebay.ts` | eBay |
| AliExpress | ✅ Complete | `aliexpress.ts` | AliExpress |
| Taobao | ✅ Complete | `taobao.ts` | Taobao |
| JD.com | ✅ Complete | `jd.ts` | JD.com |
| Temu | ✅ Complete | `temu.ts` | Temu |
| Shopee | ✅ Complete | `shopee.ts` | Shopee |
| Coupang | ✅ Complete | `coupang.ts` | Coupang |
| MercadoLibre | ✅ Complete | `mercadolibre.ts` | MercadoLibre |
| Flipkart | ✅ Complete | `flipkart.ts` | Flipkart |
| MercadoLibre | ✅ Complete | `mercadolibre.ts` | MercadoLibre |
| Coupang | ✅ Complete | `coupang.ts` | Coupang |

## Adding a New Scraper

### Step 1: Create Scraper File

Create a new file in `app/utils/scrapers/` (e.g., `ebay.ts`):

```typescript
import puppeteer from "puppeteer";
import { ScrapedProductData } from "./types";

export async function scrapeEbay(html: string, url: string): Promise<ScrapedProductData> {
  let browser;
  try {
    browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36",
    );
    await page.goto(url, { waitUntil: "networkidle2" });

    const pageData = await page.evaluate(() => {
      // Extract data using platform-specific selectors
      const productName = document.querySelector('#SELECTOR')?.textContent?.trim() || "";
      const description = document.querySelector('#SELECTOR')?.innerHTML || "";
      const price = document.querySelector('#SELECTOR')?.textContent?.trim() || "";
      
      // Extract images
      const images: string[] = [];
      // ... image extraction logic
      
      return { productName, description, price, images };
    });

    return {
      productName: pageData.productName,
      description: pageData.description,
      price: pageData.price,
      compareAtPrice: "",
      images: pageData.images,
      vendor: "eBay",
      productType: "",
      tags: "",
      costPerItem: "",
      sku: "",
      barcode: "",
      weight: "",
      weightUnit: "kg",
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
```

### Step 2: Register in Index

Update `index.ts` to include the new scraper:

```typescript
import { scrapeEbay } from "./ebay";

export function getScraper(url: string): ScraperFunction | null {
  const urlLower = url.toLowerCase();
  
  // ... existing platforms
  
  // eBay
  if (urlLower.includes("ebay.")) {
    return scrapeEbay;
  }
  
  // ... rest of platforms
}
```

### Step 3: Test

The scraper will automatically be used when a URL from that platform is detected.

## Data Structure

All scrapers must return `ScrapedProductData`:

```typescript
{
  productName: string;        // Product title
  description: string;        // HTML description
  price: string;             // Current price
  compareAtPrice: string;    // Original/compare price
  images: string[];          // Array of image URLs
  vendor: string;            // Platform name (e.g., "Amazon")
  productType: string;       // Product category/type
  tags: string;              // Comma-separated tags
  costPerItem: string;       // Cost per item
  sku: string;               // SKU code
  barcode: string;           // Barcode/GTIN
  weight: string;            // Numeric weight value
  weightUnit: string;        // kg, g, lb, or oz
  options: Array<{           // Product options (size, color, etc.)
    name: string;
    values: string;
  }>;
  variants: Array<{          // Product variants
    title: string;
    price: string;
    sku: string;
    barcode: string;
    quantity: string;
  }>;
}
```

## Important Notes

### Amazon Scraper (Reference Implementation)
The Amazon scraper is fully functional and serves as the reference implementation:
- ✅ Extracts product name, description, price
- ✅ Handles compare-at pricing
- ✅ Extracts high-resolution images
- ✅ Parses weight with proper unit detection (g, kg, lb, oz)
- ✅ Extracts dimensions and adds to description
- ✅ Robust error handling

### Best Practices
1. **Always use Puppeteer** for dynamic content loading
2. **Set proper User-Agent** to avoid blocking
3. **Handle errors gracefully** - return empty data structure on failure
4. **Log extraction steps** for debugging
5. **Extract high-resolution images** when available
6. **Parse units correctly** (weights, dimensions)
7. **Clean data** before returning (trim whitespace, validate numbers)

### Anti-Scraping Considerations
- Some platforms may block automated requests
- Consider adding delays between requests
- Rotate User-Agent strings if needed
- Respect robots.txt and rate limits
- Use residential proxies for difficult platforms

## Testing

Test your scraper with a real product URL:

```typescript
import { getScraper } from "./app/utils/scrapers.server";

const url = "https://example.com/product/123";
const scraper = getScraper(url);
if (scraper) {
  const data = await scraper("", url);
  console.log(data);
}
```

## Maintenance

When a platform updates their HTML structure:
1. Locate the affected scraper file
2. Update the selectors in the `page.evaluate()` function
3. Test with multiple product URLs
4. Update this README if needed
