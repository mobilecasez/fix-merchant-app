// Common types for all scrapers
export interface ScrapedProductData {
  productName: string;
  description: string;
  price: string;
  compareAtPrice: string;
  images: string[];
  vendor: string;
  productType: string;
  tags: string;
  costPerItem: string;
  sku: string;
  barcode: string;
  weight: string;
  weightUnit: string;
  options: Array<{ name: string; values: string }>;
  variants: Array<{
    title: string;
    price: string;
    sku: string;
    barcode: string;
    quantity: string;
  }>;
}

export type ScraperFunction = (html: string, url: string) => Promise<ScrapedProductData | string>;
