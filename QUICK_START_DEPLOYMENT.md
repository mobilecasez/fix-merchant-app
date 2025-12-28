# ShopFlix AI - Step-by-Step Deployment Instructions

## Overview
This document provides exact steps to deploy ShopFlix AI to your Shopify store.

---

## STEP 1: Prepare Your Environment (5 minutes)

### 1.1 Verify Prerequisites
```bash
# Check Node.js (should be v18+)
node --version

# Check Shopify CLI
shopify --version

# If Shopify CLI not installed:
npm install -g @shopify/cli@latest
```

### 1.2 Create Production Environment File
```bash
# Copy template
cp .env.example .env

# Edit .env with your production values
nano .env
```

**Required variables:**
```
SHOPIFY_API_KEY=<from Partner Dashboard>
SHOPIFY_API_SECRET=<from Partner Dashboard>
SHOPIFY_APP_URL=https://<your-production-domain>
SESSION_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
DATABASE_URL=file:./prod.db
```

---

## STEP 2: Build the App (3 minutes)

### 2.1 Using Automated Script (Easiest)
```bash
cd "/Users/rishisamadhiya/Desktop/Files/Personal/Shopify Apps/fix-merchant-center-app"

# Run the deployment script
./deploy.sh

# Follow the interactive prompts
```

### 2.2 Manual Build Process
```bash
# 1. Install dependencies
npm install

# 2. Type checking
npx tsc --noEmit

# 3. Run production build
npm run build

# 4. Verify build output
ls -lh build/
```

**Expected output:**
```
✓ TypeScript compilation successful
✓ Assets compiled
✓ Server bundle ready
✓ Client bundle ready
```

---

## STEP 3: Test Before Deployment (10 minutes)

### 3.1 Test Locally (Optional)
```bash
# Start development server
npm run dev

# Open http://localhost:3000 in browser
# Test all features:
# ✓ Rating system works
# ✓ Video tutorial plays
# ✓ Product import works
# ✓ Quota tracking displays
```

### 3.2 Prepare Test Store
1. Go to [Shopify Partners Dashboard](https://partners.shopify.com)
2. Create a new development store if needed
3. Note your test store URL (e.g., `quickstart-xxxxx.myshopify.com`)

---

## STEP 4: Deploy Using Shopify CLI (Easiest - 5 minutes)

### 4.1 Initial Deployment
```bash
# Make sure you're in the app directory
cd "/Users/rishisamadhiya/Desktop/Files/Personal/Shopify Apps/fix-merchant-center-app"

# Run deployment
shopify app deploy

# Follow the prompts:
# 1. Select your organization
# 2. Select or create your app
# 3. Confirm deployment
# 4. Wait for completion (2-5 minutes)
```

### 4.2 What Happens During Deployment
- ✓ App code uploaded to Shopify
- ✓ Shopify assigns a URL to your app
- ✓ App becomes accessible on test store
- ✓ Webhook endpoints registered

### 4.3 After Successful Deployment
```
✓ Deployment successful!
✓ App URL: https://[your-app-id].shopifyapps.com
✓ App installed on: quickstart-xxxxx.myshopify.com
```

---

## STEP 5: Configure Your App in Partner Dashboard (15 minutes)

### 5.1 Go to Partner Dashboard
1. Visit [https://partners.shopify.com](https://partners.shopify.com)
2. Select **Apps**
3. Click on **ShopFlix AI**
4. Go to **App Setup**

### 5.2 Fill App Information
```
✓ App name: ShopFlix AI
✓ Description: 
  "AI-powered Shopify app for importing products from external URLs,
   tracking compliance with Google Merchant Center, and optimizing
   product listings with AI-powered rewriting."
✓ Support email: your-email@example.com
✓ Support website: (optional)
```

### 5.3 Add Branding
1. Go to **Branding** section
2. Upload logo: Select from `/public/logo-ai-modern.svg`
3. Dimensions: 512x512px minimum
4. Save

### 5.4 Configure Pricing
1. Go to **Pricing** section
2. Set up your plans:
   ```
   Plan 1 - Free Trial
   └─ $0/month
   └─ Features: 2 product imports

   Plan 2 - Starter
   └─ $4.99/month
   └─ Features: 20 product imports

   Plan 3 - Basic
   └─ $9.99/month
   └─ Features: 50 product imports

   Plan 4 - Professional
   └─ $17.99/month
   └─ Features: 100 product imports

   Plan 5 - Advanced
   └─ $24.99/month
   └─ Features: 500 product imports

   Plan 6 - Enterprise
   └─ $99/month
   └─ Features: Unlimited imports
   ```
3. Set billing cycle: **Monthly**
4. Save

### 5.5 Add Screenshots (for App Store)
1. Go to **Listing** section
2. Add 3-5 screenshots from `/Screenshots/` folder
3. Add captions:
   ```
   Screenshot 1: "Dashboard - Track quota and monitor store health"
   Screenshot 2: "Product Import - Easily import from external URLs"
   Screenshot 3: "Video Tutorial - Get started in minutes"
   ```
4. Save

---

## STEP 6: Install on Your Test Store (5 minutes)

### 6.1 Install the App
1. Go to your test store: `https://quickstart-xxxxx.myshopify.com`
2. In Shopify Admin, go to **Settings → Apps and integrations**
3. Click **App and sales channel settings**
4. Search for **ShopFlix AI**
5. Click **Install app**
6. Grant permissions
7. You're in!

### 6.2 Test the App
1. ✓ Verify dashboard loads
2. ✓ Click "Watch Tutorial" button → Video should play
3. ✓ Click star ratings → Should submit and show thank you
4. ✓ Click "Dismiss" on review banner → Should disappear
5. ✓ Click "Go to Product Replica" → Should navigate
6. ✓ Try importing a product from Amazon or Flipkart
7. ✓ Verify quota counter updates

---

## STEP 7: Submit to App Store (Optional - 10 minutes)

Only if you want your app listed in the Shopify App Store:

### 7.1 Create App Listing
1. In Partner Dashboard, go to **Apps → ShopFlix AI**
2. Click **Listing**
3. Click **Create an app listing**

### 7.2 Fill in Details
```
✓ Category: Choose "Shopping" or "Sales and conversion"
✓ Description: (detailed description of features)
✓ Screenshots: (5 best screenshots)
✓ Support email: your-email@example.com
✓ Privacy policy: https://your-domain/PRIVACY_POLICY.md
✓ Terms of service: https://your-domain/TERMS_OF_SERVICE.md
✓ Support URL: your-domain.com/support
```

### 7.3 Submit for Review
1. Click **Submit for review**
2. Shopify will review (1-2 weeks)
3. You'll receive email with decision

### 7.4 If Changes Needed
1. Make required changes
2. Upload new version
3. Resubmit for review

---

## STEP 8: Go Live (1 minute)

### 8.1 Approval Received
Once Shopify approves:
- ✓ App appears in Shopify App Store
- ✓ Merchants can install via App Store
- ✓ You receive a Partner fee (80% of revenue)

### 8.2 Monitor Installations
1. Go to Partner Dashboard
2. Select **ShopFlix AI**
3. View **Analytics** dashboard:
   - Total installations
   - Active subscriptions
   - Revenue
   - User reviews and ratings

---

## STEP 9: Production Maintenance (Ongoing)

### 9.1 Update App
When you make changes:
```bash
# 1. Test locally
npm run dev

# 2. Build
npm run build

# 3. Deploy
shopify app deploy

# 4. New version automatically available to users
```

### 9.2 Monitor Performance
```bash
# Check app metrics daily
# Go to Partner Dashboard → Analytics

# Monitor user reviews
# Respond to any issues promptly

# Track bugs
# Use server logs and error tracking
```

### 9.3 Regular Updates
- Update dependencies: `npm update`
- Security audits: `npm audit fix`
- Performance optimization
- Feature releases

---

## Deployment Checklist

Before each deployment:
- [ ] All code committed to git
- [ ] `npm run build` succeeds
- [ ] TypeScript errors: 0
- [ ] Tested on development store
- [ ] Database migrations ready
- [ ] Environment variables set
- [ ] Video and assets in place
- [ ] No console errors in dev tools

---

## Troubleshooting

### App Won't Deploy
```bash
# Clear build cache
rm -rf build/ node_modules/.vite

# Reinstall and rebuild
npm install
npm run build
```

### App Crashes After Deploy
```bash
# Check logs in Partner Dashboard
# Settings → API Credentials → Recent Requests

# Or check terminal output during deploy
shopify app deploy --verbose
```

### Video Not Loading
```bash
# Verify video in public directory
ls -lh public/ShopFlixAI.mp4

# Verify file permissions
chmod 644 public/ShopFlixAI.mp4

# Test URL
curl -I https://your-app.shopifyapps.com/ShopFlixAI.mp4
# Should return HTTP 200
```

### Database Issues
```bash
# Check migration status
npx prisma migrate status

# View database
npx prisma studio

# Backup production database
cp prod.db prod.db.backup.$(date +%Y%m%d)
```

---

## Support Resources

- **Shopify Partner Dashboard**: https://partners.shopify.com
- **Shopify App Development Docs**: https://shopify.dev/docs/apps
- **Remix Documentation**: https://remix.run/docs
- **Prisma Documentation**: https://www.prisma.io/docs
- **Shopify API Reference**: https://shopify.dev/api/admin-rest

---

## Success Metrics

After launch, monitor:
- Total installations
- Active daily users
- Subscription conversion rate
- Revenue generated
- Average user rating
- Support requests

---

## Timeline Summary

| Step | Time | Notes |
|------|------|-------|
| Prepare environment | 5 min | Set up .env file |
| Build app | 3 min | npm run build |
| Test locally | 10 min | Optional but recommended |
| Deploy | 5 min | shopify app deploy |
| Configure listing | 15 min | Add branding, screenshots |
| Install on test store | 5 min | Verify functionality |
| Submit to App Store | 10 min | Optional |
| **Total** | **~50 min** | **Or 40 min if skipping App Store** |

---

## Questions?

For detailed information on any step, refer to **DEPLOYMENT_GUIDE.md**

Good luck with your ShopFlix AI launch! 🚀
