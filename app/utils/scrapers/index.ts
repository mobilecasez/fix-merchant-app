import { ScraperFunction } from "./types";
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

// Platform detection and scraper mapping
export function getScraper(url: string): ScraperFunction | null {
  const urlLower = url.toLowerCase();
  
  // Amazon (all domains)
  if (urlLower.includes("amazon.")) {
    return scrapeAmazon;
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
  
  // Flipkart
  if (urlLower.includes("flipkart.com")) {
    return scrapeFlipkart;
  }
  
  // No matching scraper found
  return null;
}
