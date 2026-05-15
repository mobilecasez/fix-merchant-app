import { ScrapedProductData } from "./types";
import { parseWithGemini, MANUAL_HTML_REQUIRED } from "./generic";

export async function scrapeFlipkart(html: string, url: string): Promise<ScrapedProductData | typeof MANUAL_HTML_REQUIRED> {
  try {
    let htmlContent = html;
    let isManualHtml = false;

    // Only fetch if HTML parameter is not provided or is too small
    if (!html || html.length < 10000) {
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
          'accept-language': 'en-US,en;q=0.9',
        },
      });
      
      // Check if we hit anti-bot protection (529 or similar errors)
      if (!response.ok) {
        return MANUAL_HTML_REQUIRED; // Force manual HTML instead of slow broken Puppeteer
      } else {
        htmlContent = await response.text();
        
        // Check if we got a CAPTCHA or error page despite 200 status
        if (htmlContent.includes('Access Denied') || 
            htmlContent.includes('Robot or human') || 
            htmlContent.length < 5000) {
          return MANUAL_HTML_REQUIRED; // Force manual HTML
        }
      }
    } else {
      isManualHtml = true;
    }
    
    // Use Gemini AI for Flipkart to guarantee perfect variant and pricing extraction
    const parsedData = await parseWithGemini(htmlContent, url);
    return parsedData;
    
  } catch (error) {
    console.error('[Flipkart Scraper] Error:', error);
    return MANUAL_HTML_REQUIRED;
  }
}

