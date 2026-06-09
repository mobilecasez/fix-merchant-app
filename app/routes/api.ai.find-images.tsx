import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { incrementProductUsage } from "../utils/billing.server";
import { parse } from "node-html-parser";

const BROWSER_HEADERS = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
};

const IMAGE_URL_REGEX = /https?:\/\/[^"'\s<>{}|\\^`\[\]]+?\.(?:jpg|jpeg|png|webp|avif)(?:\?[^"'\s<>]*)?/gi;

/** Extract and deduplicate image URLs from raw HTML */
function extractImageUrls(html: string, preferredDomains: string[] = []): string[] {
  const root = parse(html);

  // Gather from <img src>, <img data-src>, og:image meta, srcset, data-zoom-image, etc.
  const domImages: string[] = [];
  root.querySelectorAll('img').forEach((el: any) => {
    ['src', 'data-src', 'data-lazy-src', 'data-original', 'data-zoom-image', 'data-large-image'].forEach(attr => {
      const val = el.getAttribute(attr);
      if (val && (val.startsWith('http') || val.startsWith('//'))) {
        domImages.push(val.startsWith('//') ? 'https:' + val : val);
      }
    });
    // srcset
    const srcset = el.getAttribute('srcset') || el.getAttribute('data-srcset') || '';
    srcset.split(',').forEach((entry: string) => {
      const src = entry.trim().split(/\s+/)[0];
      if (src && src.startsWith('http')) domImages.push(src);
    });
  });

  root.querySelectorAll("meta[property='og:image'], meta[name='twitter:image']").forEach((el: any) => {
    const content = el.getAttribute('content');
    if (content && content.startsWith('http')) domImages.push(content);
  });

  // Regex pass on full HTML to catch JSON-embedded URLs
  const regexMatches = Array.from(html.matchAll(IMAGE_URL_REGEX)).map(m => m[0]);

  const allUrls = Array.from(new Set([...domImages, ...regexMatches]));

  // Filter out icons, tracking pixels, logos, SVGs, tiny images
  const filtered = allUrls.filter(url => {
    const lower = url.toLowerCase();
    if (lower.includes('.svg')) return false;
    if (lower.includes('icon') && !lower.includes('product')) return false;
    if (lower.includes('logo') && !lower.includes('product')) return false;
    if (lower.includes('pixel') || lower.includes('beacon') || lower.includes('track')) return false;
    if (lower.includes('1x1') || lower.includes('blank') || lower.includes('spacer')) return false;
    if (lower.includes('sprite')) return false;
    // Prefer images with size hints suggesting high resolution
    return true;
  });

  // Score: preferred domains first, then by URL length (longer usually = more parameters = specific image)
  const scored = filtered.map(url => {
    let score = 0;
    if (preferredDomains.some(d => url.includes(d))) score += 100;
    // Amazon high-res indicator
    if (url.match(/_SL\d{3,}_/) || url.match(/_AC_SL\d{3,}_/)) score += 50;
    if (url.includes('large') || url.includes('zoom') || url.includes('full') || url.includes('original')) score += 30;
    return { url, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .map(s => s.url)
    .slice(0, 20);
}

/** Upgrade Amazon image URL to highest resolution available */
function upgradeAmazonImageUrl(url: string): string {
  // Remove size/crop modifiers to get original high-res
  return url
    .replace(/\._[A-Z]{2}_\w+_\./g, '.')           // Remove _SX300_, _SY500_, etc.
    .replace(/\._[A-Z]+\d*_\w*_\./g, '.')           // Remove _AC_SL1500_ etc.
    .replace(/\/I\//g, '/I/')                        // Keep the path intact
    .replace(/\?.*$/, '');                            // Remove query string
}

/** Try fetching a URL with browser-like headers, return HTML or null */
async function safeFetch(url: string, timeoutMs = 12000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { headers: BROWSER_HEADERS, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Search Amazon and return HD product image URLs */
async function searchAmazonImages(query: string): Promise<string[]> {
  const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(query)}&ref=sr_pg_1`;
  const searchHtml = await safeFetch(searchUrl);
  if (!searchHtml) return [];

  // Extract ASINs from search result cards
  const asinMatches = Array.from(searchHtml.matchAll(/data-asin="([A-Z0-9]{10})"/g))
    .map(m => m[1])
    .filter(Boolean);

  const uniqueAsins = Array.from(new Set(asinMatches)).slice(0, 3);

  // Also extract images directly from search results page as fallback
  const searchImages = extractImageUrls(searchHtml, ['images-amazon', 'ssl-images-amazon', 'm.media-amazon']);

  if (uniqueAsins.length === 0) return searchImages.slice(0, 15);

  // Visit the first product page for highest quality images
  const productUrl = `https://www.amazon.com/dp/${uniqueAsins[0]}`;
  const productHtml = await safeFetch(productUrl, 15000);
  if (!productHtml) return searchImages.slice(0, 15);

  // Amazon stores image data in a JS object called "colorImages" or "imageGalleryData"
  const hiResMatches = Array.from(productHtml.matchAll(/"hiRes":"(https:[^"]+)"/g)).map(m => m[1]);
  const largeMatches = Array.from(productHtml.matchAll(/"large":"(https:[^"]+)"/g)).map(m => m[1]);
  const mainMatches  = Array.from(productHtml.matchAll(/"main":\{"(https:[^"]+)"/g)).map(m => m[1]);

  const amazonImages = Array.from(new Set([...hiResMatches, ...largeMatches, ...mainMatches]));

  if (amazonImages.length > 0) {
    return amazonImages.map(upgradeAmazonImageUrl).slice(0, 15);
  }

  // Fallback: regex extraction from product page
  const pageImages = extractImageUrls(productHtml, ['images-amazon', 'ssl-images-amazon', 'm.media-amazon']);
  return pageImages.slice(0, 15);
}

/** Search other major e-commerce sites */
async function searchEcommerceImages(query: string): Promise<string[]> {
  // Try Bing shopping tab (less restrictive than Google)
  const bingUrl = `https://www.bing.com/shop?q=${encodeURIComponent(query)}&FORM=SHOPTB`;
  const html = await safeFetch(bingUrl);
  if (!html) return [];
  return extractImageUrls(html).slice(0, 10);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const title  = url.searchParams.get('title')  || '';
  const brand  = url.searchParams.get('brand')  || '';

  if (!title) return json({ images: [], message: 'Product title is required.' }, { status: 400 });

  const searchQuery = brand ? `${brand} ${title}` : title;

  // Run Amazon + fallback search in parallel
  const [amazonImages, ecomImages] = await Promise.allSettled([
    searchAmazonImages(searchQuery),
    searchEcommerceImages(searchQuery),
  ]);

  const amazon  = amazonImages.status  === 'fulfilled' ? amazonImages.value  : [];
  const ecom    = ecomImages.status    === 'fulfilled' ? ecomImages.value    : [];

  // Merge, deduplicate, prefer Amazon results
  const merged = Array.from(new Set([...amazon, ...ecom])).slice(0, 20);

  if (merged.length === 0) {
    return json({
      images: [],
      message: 'No images could be found. The product website may be blocking automated access.',
    });
  }

  // Charge 1 credit
  await incrementProductUsage(session.shop);

  return json({
    images: merged,
    message: `Found ${merged.length} image(s) from online sources.`,
  });
}
