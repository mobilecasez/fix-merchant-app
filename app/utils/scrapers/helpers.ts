// Utility functions for scraper data enhancement

/**
 * Clean product name by removing special characters like **, ~~, etc.
 * Makes the title professional and removes spam-like formatting.
 */
export function cleanProductName(productName: string): string {
  if (!productName) return '';
  
  return productName
    // Remove markdown-style formatting: **, ~~, __, etc.
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/~~/g, '')
    .replace(/__/g, '')
    .replace(/``/g, '')
    // Remove excessive punctuation
    .replace(/!{2,}/g, '!')
    .replace(/\?{2,}/g, '?')
    // Clean up extra spaces
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Return the original compare-at price if it exists (strikethrough/original price on page).
 * Only add 20% markup to price if compare-at price is missing.
 */
export function ensureCompareAtPrice(price: string, compareAtPrice: string): string {
  // If original price exists on the page (strikethrough), use it
  if (compareAtPrice && compareAtPrice.trim() !== '') {
    console.log('Compare-at price found on page:', compareAtPrice);
    return compareAtPrice;
  }
  
  // Only if original price is missing, calculate 20% markup
  console.log('Compare-at price missing, calculating 20% markup');
  const numericPrice = parseFloat(price.replace(/[^0-9.]/g, ''));
  if (!isNaN(numericPrice) && numericPrice > 0) {
    // Add 20% markup
    const comparePrice = numericPrice * 1.2;
    // Format with same currency symbol if present
    const currencyMatch = price.match(/[^\d\s.,]+/);
    const currencySymbol = currencyMatch ? currencyMatch[0] : '';
    return `${currencySymbol}${comparePrice.toFixed(2)}`;
  }
  
  return '';
}

/**
 * Parse weight from text and return value + unit
 */
export function parseWeight(weight: string): { value: string; unit: string } {
  if (!weight) {
    return { value: '', unit: 'kg' };
  }

  const weightMatch = weight.match(/([0-9.]+)\s*([a-zA-Z]+)?/);
  if (!weightMatch) {
    return { value: '', unit: 'kg' };
  }

  const value = parseFloat(weightMatch[1]);
  const unit = (weightMatch[2] || '').toLowerCase();
  
  let weightUnit = 'kg';
  
  if (unit.includes('gram') && !unit.includes('kilogram')) {
    weightUnit = 'g';
  } else if (unit.includes('kilogram') || unit === 'kg') {
    weightUnit = 'kg';
  } else if (unit.includes('pound') || unit === 'lb' || unit === 'lbs') {
    weightUnit = 'lb';
  } else if (unit.includes('ounce') || unit === 'oz') {
    weightUnit = 'oz';
  } else if (unit === 'g') {
    weightUnit = 'g';
  }
  
  return { value: value.toString(), unit: weightUnit };
}

/**
 * Estimate weight based on product title if weight is missing
 * This provides reasonable defaults for common product categories
 */
export function estimateWeight(productName: string): { value: string; unit: string } {
  const nameLower = productName.toLowerCase();
  
  // Electronics
  if (nameLower.includes('phone') || nameLower.includes('mobile')) {
    return { value: '200', unit: 'g' };
  }
  if (nameLower.includes('tablet') || nameLower.includes('ipad')) {
    return { value: '500', unit: 'g' };
  }
  if (nameLower.includes('laptop') || nameLower.includes('notebook')) {
    return { value: '2', unit: 'kg' };
  }
  if (nameLower.includes('headphone') || nameLower.includes('earphone') || nameLower.includes('earbud')) {
    return { value: '100', unit: 'g' };
  }
  if (nameLower.includes('watch') || nameLower.includes('smartwatch')) {
    return { value: '50', unit: 'g' };
  }
  if (nameLower.includes('speaker')) {
    return { value: '500', unit: 'g' };
  }
  if (nameLower.includes('charger') || nameLower.includes('adapter')) {
    return { value: '100', unit: 'g' };
  }
  if (nameLower.includes('cable') || nameLower.includes('cord')) {
    return { value: '50', unit: 'g' };
  }
  
  // Clothing & Accessories
  if (nameLower.includes('shirt') || nameLower.includes('tshirt') || nameLower.includes('t-shirt')) {
    return { value: '200', unit: 'g' };
  }
  if (nameLower.includes('pants') || nameLower.includes('jeans') || nameLower.includes('trouser')) {
    return { value: '500', unit: 'g' };
  }
  if (nameLower.includes('jacket') || nameLower.includes('coat')) {
    return { value: '800', unit: 'g' };
  }
  if (nameLower.includes('shoe') || nameLower.includes('sneaker') || nameLower.includes('boot')) {
    return { value: '600', unit: 'g' };
  }
  if (nameLower.includes('bag') || nameLower.includes('backpack')) {
    return { value: '400', unit: 'g' };
  }
  if (nameLower.includes('wallet') || nameLower.includes('purse')) {
    return { value: '150', unit: 'g' };
  }
  if (nameLower.includes('hat') || nameLower.includes('cap')) {
    return { value: '100', unit: 'g' };
  }
  if (nameLower.includes('sunglass') || nameLower.includes('glasses')) {
    return { value: '50', unit: 'g' };
  }
  
  // Home & Kitchen
  if (nameLower.includes('mug') || nameLower.includes('cup')) {
    return { value: '300', unit: 'g' };
  }
  if (nameLower.includes('plate') || nameLower.includes('dish')) {
    return { value: '400', unit: 'g' };
  }
  if (nameLower.includes('bottle')) {
    return { value: '200', unit: 'g' };
  }
  if (nameLower.includes('pillow')) {
    return { value: '500', unit: 'g' };
  }
  if (nameLower.includes('blanket')) {
    return { value: '1', unit: 'kg' };
  }
  
  // Toys & Games
  if (nameLower.includes('toy') || nameLower.includes('game')) {
    return { value: '300', unit: 'g' };
  }
  if (nameLower.includes('puzzle')) {
    return { value: '400', unit: 'g' };
  }
  if (nameLower.includes('doll') || nameLower.includes('figure')) {
    return { value: '200', unit: 'g' };
  }
  
  // Books & Media
  if (nameLower.includes('book')) {
    return { value: '400', unit: 'g' };
  }
  
  // Beauty & Personal Care
  if (nameLower.includes('cream') || nameLower.includes('lotion')) {
    return { value: '100', unit: 'g' };
  }
  if (nameLower.includes('shampoo') || nameLower.includes('conditioner')) {
    return { value: '300', unit: 'g' };
  }
  if (nameLower.includes('perfume') || nameLower.includes('cologne')) {
    return { value: '100', unit: 'g' };
  }
  
  // Jewelry
  if (nameLower.includes('ring') || nameLower.includes('necklace') || nameLower.includes('bracelet') || nameLower.includes('earring')) {
    return { value: '20', unit: 'g' };
  }
  
  // Sports & Outdoors
  if (nameLower.includes('ball')) {
    return { value: '500', unit: 'g' };
  }
  if (nameLower.includes('dumbbell') || nameLower.includes('weight')) {
    return { value: '5', unit: 'kg' };
  }
  
  // Default fallback - small package
  return { value: '200', unit: 'g' };
}
