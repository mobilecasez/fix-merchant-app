/**
 * Currency conversion utility
 * Converts prices from source currency to target currency using live exchange rates
 */

// Currency symbol to code mapping
const CURRENCY_SYMBOLS: Record<string, string> = {
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '₹': 'INR',
  '₨': 'INR',
  'Rs': 'INR',
  'Rs.': 'INR',
  '₱': 'PHP',
  '₩': 'KRW',
  '฿': 'THB',
  'R$': 'BRL',
  'A$': 'AUD',
  'C$': 'CAD',
  'CA$': 'CAD',
  'NZ$': 'NZD',
  'HK$': 'HKD',
  'S$': 'SGD',
  'kr': 'SEK',
  'zł': 'PLN',
  '₪': 'ILS',
  'CHF': 'CHF',
  'R': 'ZAR',
  'MXN': 'MXN',
  'AED': 'AED',
  'SAR': 'SAR',
};

// Currency code to symbol mapping (reverse lookup)
const CURRENCY_CODE_TO_SYMBOL: Record<string, string> = {
  'USD': '$',
  'EUR': '€',
  'GBP': '£',
  'JPY': '¥',
  'INR': '₹',
  'PHP': '₱',
  'KRW': '₩',
  'THB': '฿',
  'BRL': 'R$',
  'AUD': 'A$',
  'CAD': 'CA$',
  'NZD': 'NZ$',
  'HKD': 'HK$',
  'SGD': 'S$',
  'SEK': 'kr',
  'PLN': 'zł',
  'ILS': '₪',
  'CHF': 'CHF',
  'ZAR': 'R',
  'MXN': 'MXN',
  'AED': 'AED',
  'SAR': 'SAR',
};

// Currency code patterns (for text like "INR 1000" or "USD 50")
const CURRENCY_CODES = ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD', 'MXN', 'BRL', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'THB', 'PHP', 'KRW', 'AED', 'SAR', 'ZAR'];

// Domain to currency mapping for common e-commerce sites
const DOMAIN_CURRENCY_MAP: Record<string, string> = {
  'amazon.com': 'USD',
  'amazon.ca': 'CAD',
  'amazon.co.uk': 'GBP',
  'amazon.de': 'EUR',
  'amazon.fr': 'EUR',
  'amazon.it': 'EUR',
  'amazon.es': 'EUR',
  'amazon.in': 'INR',
  'amazon.co.jp': 'JPY',
  'amazon.com.au': 'AUD',
  'walmart.com': 'USD',
  'target.com': 'USD',
  'ebay.com': 'USD',
  'ebay.co.uk': 'GBP',
  'flipkart.com': 'INR',
  'myntra.com': 'INR',
  'ajio.com': 'INR',
  'meesho.com': 'INR',
  'snapdeal.com': 'INR',
  'alibaba.com': 'USD',
  'aliexpress.com': 'USD',
};

/**
 * Detect currency code from price string or website URL
 */
export function detectCurrency(price: string, url?: string): string {
  console.log('[Currency Detection] Starting detection...');
  console.log('[Currency Detection] Price string:', price);
  console.log('[Currency Detection] URL:', url);
  
  // Priority 1: Check for explicit currency codes (INR 1000, USD 50, etc.)
  for (const code of CURRENCY_CODES) {
    // Check for patterns like "INR 1000", "INR1000", "1000 INR"
    const codeRegex = new RegExp(`\\b${code}\\b|${code}(?=\\d)|(?<=\\d)${code}`, 'i');
    if (codeRegex.test(price)) {
      console.log(`[Currency Detection] ✓ Found currency code "${code}" in price`);
      return code.toUpperCase();
    }
  }
  
  // Priority 2: Check for currency symbols in price string
  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (price.includes(symbol)) {
      console.log(`[Currency Detection] ✓ Found symbol "${symbol}" → ${code}`);
      return code;
    }
  }
  
  console.log('[Currency Detection] No currency found in price string');
  
  // Priority 3: Try to detect from URL domain (fallback only)
  if (url) {
    try {
      const domain = new URL(url).hostname.toLowerCase();
      console.log('[Currency Detection] Checking domain:', domain);
      
      for (const [siteDomain, currency] of Object.entries(DOMAIN_CURRENCY_MAP)) {
        if (domain.includes(siteDomain)) {
          console.log(`[Currency Detection] ✓ Domain match "${siteDomain}" → ${currency} (fallback)`);
          return currency;
        }
      }
      
      console.log('[Currency Detection] No domain match found');
    } catch (e) {
      console.warn('[Currency Detection] Invalid URL:', e);
    }
  }
  
  // Default to USD
  console.log('[Currency Detection] Using default: USD');
  return 'USD';
}

/**
 * Get live exchange rate from source currency to target currency
 * Uses exchangerate-api.com (free tier: 1500 requests/month)
 */
async function getExchangeRate(from: string, to: string): Promise<number> {
  try {
    const response = await fetch(`https://api.exchangerate-api.com/v4/latest/${from}`);
    
    if (!response.ok) {
      console.warn(`[Currency] Failed to fetch exchange rate: ${response.status}`);
      return 1; // Return 1 to avoid breaking price display
    }
    
    const data = await response.json();
    const rate = data.rates[to];
    
    if (!rate) {
      console.warn(`[Currency] No exchange rate found for ${from} -> ${to}`);
      return 1;
    }
    
    console.log(`[Currency] Exchange rate ${from} -> ${to}: ${rate}`);
    return rate;
  } catch (error) {
    console.error('[Currency] Error fetching exchange rate:', error);
    return 1; // Return 1 to avoid breaking price display
  }
}

/**
 * Convert price from source currency to target currency
 */
export async function convertPrice(
  price: string,
  sourceCurrency: string,
  targetCurrency: string
): Promise<string> {
  console.log('[Currency Conversion] Converting price:', price);
  console.log('[Currency Conversion] From:', sourceCurrency, 'To:', targetCurrency);
  
  // If currencies are the same, no conversion needed - return original price with symbol
  if (sourceCurrency === targetCurrency) {
    console.log('[Currency Conversion] Same currency, no conversion needed');
    // Ensure the price has a currency symbol
    const numericPrice = parseFloat(price.replace(/[^0-9.]/g, ''));
    if (isNaN(numericPrice)) {
      return price;
    }
    
    // If price already has a symbol, return it as is
    const hasSymbol = /[^\d\s.,]/.test(price);
    if (hasSymbol) {
      return price;
    }
    
    // Add currency symbol if missing
    const symbol = CURRENCY_CODE_TO_SYMBOL[targetCurrency] || targetCurrency + ' ';
    return `${symbol}${numericPrice.toFixed(2)}`;
  }
  
  // Extract numeric value from price
  const numericPrice = parseFloat(price.replace(/[^0-9.]/g, ''));
  
  if (isNaN(numericPrice) || numericPrice === 0) {
    console.warn('[Currency] Invalid price value:', price);
    return price;
  }
  
  console.log('[Currency Conversion] Numeric value extracted:', numericPrice);
  
  // Get exchange rate
  const rate = await getExchangeRate(sourceCurrency, targetCurrency);
  
  // Convert price
  const convertedPrice = numericPrice * rate;
  
  console.log(`[Currency Conversion] Calculation: ${numericPrice} × ${rate} = ${convertedPrice.toFixed(2)}`);
  
  // Get target currency symbol
  const targetSymbol = CURRENCY_CODE_TO_SYMBOL[targetCurrency] || targetCurrency + ' ';
  const formattedPrice = `${targetSymbol}${convertedPrice.toFixed(2)}`;
  
  console.log(`[Currency Conversion] Result: ${sourceCurrency} ${numericPrice} → ${formattedPrice}`);
  
  // Return with currency symbol
  return formattedPrice;
}

/**
 * Convert product prices (price and compareAtPrice) from source to target currency
 */
export async function convertProductPrices(
  price: string,
  compareAtPrice: string,
  sourceCurrency: string,
  targetCurrency: string
): Promise<{ price: string; compareAtPrice: string }> {
  // If currencies are the same, no conversion needed
  if (sourceCurrency === targetCurrency) {
    return { price, compareAtPrice };
  }
  
  console.log(`[Currency] Converting prices from ${sourceCurrency} to ${targetCurrency}`);
  
  // Convert both prices in parallel
  const [convertedPrice, convertedCompareAtPrice] = await Promise.all([
    convertPrice(price, sourceCurrency, targetCurrency),
    compareAtPrice ? convertPrice(compareAtPrice, sourceCurrency, targetCurrency) : Promise.resolve('')
  ]);
  
  return {
    price: convertedPrice,
    compareAtPrice: convertedCompareAtPrice
  };
}
