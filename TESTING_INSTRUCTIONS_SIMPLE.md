# ShopFlix AI - Testing Instructions

## Prerequisites
- Development store with admin access
- Product URLs from supported platforms for testing

## Test Flow (15 minutes)

### 1. Installation & Onboarding (2 min)
1. Install app from Partners dashboard
2. Grant requested permissions (read/write products)
3. You'll see the Dashboard with usage stats showing 0/2 free products

### 2. Import First Product (3 min)
1. Click "Import Product" in navigation
2. Paste any Amazon product URL (e.g., amazon.com, amazon.in, amazon.co.uk)
3. Click "Fetch Product Data"
4. Wait 30-60 seconds - AI will:
   - Extract product details (title, price, images)
   - Generate SEO-optimized description with bold keywords
   - Auto-categorize product
   - Find matching images
5. Review the generated data (editable)
6. Click "Create Product in Store"
7. Success! Product is now in your Shopify store

### 3. Test Other Platforms (5 min)
Try importing from different sources to verify multi-platform support:

**eBay:** Any product URL from ebay.com
**Walmart:** Any product URL from walmart.com
**AliExpress:** Any product URL from aliexpress.com
**Flipkart (India):** Any product URL from flipkart.com

Each import should complete in 30-60 seconds with AI-generated descriptions.

### 4. Free Trial Limit (2 min)
1. After importing 2 products, you'll see "Trial Limit Reached" 
2. Click "View Plans"
3. Verify 5 pricing tiers are displayed:
   - Starter: $4.99/month (20 products)
   - Basic: $9.99/month (50 products)
   - Professional: $17.99/month (100 products)
   - Advanced: $24.99/month (150 products)
   - Enterprise: $99/month (999 products)

### 5. Subscription & Usage (3 min)
1. Select "Starter Plan" ($4.99)
2. Approve test charge in Shopify billing
3. Return to app - now showing 0/20 products used
4. Import another product (any platform URL)
5. Dashboard updates to 1/20 products used
6. Check "Usage Analytics" tab - shows daily import history

## Key Features to Verify
✅ AI generates unique, SEO-optimized descriptions (not copied)
✅ Product images are high-resolution and properly imported
✅ Categorization is accurate (uses Shopify's taxonomy)
✅ Billing integrates with Shopify's native subscription system
✅ Usage tracking is accurate across billing cycles
✅ All 11 platforms work (Amazon, eBay, Walmart, AliExpress, Flipkart, Temu, JD.com, Taobao, Coupang, Shopee, MercadoLibre)

## Expected Behavior
- ✅ Import completes in 30-60 seconds
- ✅ If scraping fails, AI extracts data automatically (no error shown to user)
- ✅ All fields are editable before creating product
- ✅ Free trial allows exactly 2 imports across all plans
- ✅ Subscription charges appear in Shopify billing
- ✅ Usage resets monthly on billing anniversary

## Support
For any issues during testing:
- Email: support@shopflixai.com
- Website: https://shopflixai.com
