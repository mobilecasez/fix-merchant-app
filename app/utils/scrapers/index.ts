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
import { scrapeMyntra } from "./myntra";

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
      return await withTimeout(
        scraper(html, url),
        timeoutMs,
        `Scraper timeout after ${timeoutMs}ms`
      );
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
  
  // Myntra - with 60s timeout
  if (urlLower.includes("myntra.com")) {
    return createTimeoutScraper(scrapeMyntra, 60000);
  }
  
  // No matching scraper found
  return null;
}
