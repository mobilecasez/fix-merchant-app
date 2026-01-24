import { ScraperFunction, ScrapedProductData } from "./types";
import { scrapeAmazon } from "./amazon";
import { scrapeWalmart } from "./walmart";
import { scrapeEbay } from "./ebay";
import { scrapeAliExpress } from "./aliexpress";
import { scrapeTemu } from "./temu";
import { scrapeShopee } from "./shopee";
import { scrapeCoupang } from "./coupang";
import { scrapeMercadoLibre } from "./mercadolibre";
import { scrapeJD } from "./jd";
import { scrapeTaobao } from "./taobao";
import { scrapeFlipkart } from "./flipkart";
import { scrapeGeneric, MANUAL_HTML_REQUIRED } from "./generic";

// Timeout wrapper to prevent hanging scrapers
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutError));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

// Wrapper for scrapers with timeout
function createTimeoutScraper(scraper: ScraperFunction, timeoutMs: number = 60000): ScraperFunction {
  return async (html: string, url: string): Promise<ScrapedProductData> => {
    try {
      const result = await withTimeout(
        scraper(html, url),
        timeoutMs,
        `Scraper timeout after ${timeoutMs}ms`
      );
      if (typeof result === 'string') {
        throw new Error(result);
      }
      return result;
    } catch (error) {
      console.error(`[Scraper Timeout] Error: ${error}`);
      throw error;
    }
  };
}

// Platform detection and scraper mapping
export function getScraper(url: string): ScraperFunction | null {
  const urlLower = url.toLowerCase();
  
  // Amazon (all domains) - with 60s timeout
  if (urlLower.includes("amazon.")) {
    return createTimeoutScraper(scrapeAmazon, 60000);
  }
  
  // Taobao
  if (urlLower.includes("taobao.com")) {
    return scrapeTaobao;
  }
  
  // JD.com
  if (urlLower.includes("jd.com")) {
    return scrapeJD;
  }
  
  // Temu
  if (urlLower.includes("temu.com")) {
    return scrapeTemu;
  }
  
  // Walmart
  if (urlLower.includes("walmart.com")) {
    return scrapeWalmart;
  }
  
  // eBay
  if (urlLower.includes("ebay.")) {
    return scrapeEbay;
  }
  
  // Shopee
  if (urlLower.includes("shopee.")) {
    return scrapeShopee;
  }
  
  // MercadoLibre
  if (urlLower.includes("mercadolibre.") || urlLower.includes("mercadolivre.")) {
    return scrapeMercadoLibre;
  }
  
  // Coupang
  if (urlLower.includes("coupang.com")) {
    return scrapeCoupang;
  }
  
  // AliExpress
  if (urlLower.includes("aliexpress.")) {
    return scrapeAliExpress;
  }
  
  // Flipkart - with 60s timeout
  if (urlLower.includes("flipkart.com")) {
    return createTimeoutScraper(scrapeFlipkart, 60000);
  }
  
  // Alibaba
  if (urlLower.includes("alibaba.com")) {
    // Note: Alibaba doesn't have a specific scraper yet, will use generic
    return createTimeoutScraper(scrapeGeneric as ScraperFunction, 60000);
  }
  
  // Generic scraper for all other URLs (with 60s timeout)
  // This handles any e-commerce site not explicitly supported above
  console.log('[Scraper Router] Using generic scraper for:', url);
  return createTimeoutScraper(scrapeGeneric as ScraperFunction, 60000);
}

// Export MANUAL_HTML_REQUIRED flag for use in routes
export { MANUAL_HTML_REQUIRED };
