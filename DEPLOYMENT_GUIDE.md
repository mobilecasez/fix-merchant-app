# ShopFlix AI - Deployment Guide

Complete step-by-step guide to deploy your Shopify app to production.

## Phase 1: Pre-Deployment Checklist

### 1.1 Verify All Features
- [ ] Rating functionality works (submit rating, dismiss banner)
- [ ] Video tutorial plays on "Watch Tutorial" button click
- [ ] Quota counter displays and updates correctly
- [ ] All pages load without errors
- [ ] Database migrations applied successfully

### 1.2 Environment Setup
- [ ] `.env` file configured with all required variables:
  ```
  SHOPIFY_API_KEY=<your_api_key>
  SHOPIFY_API_SECRET=<your_api_secret>
  SHOPIFY_APP_URL=https://<your-app-url>
  SESSION_SECRET=<strong_random_string>
  DATABASE_URL=file:./prod.db
  ```

### 1.3 Assets Verification
- [ ] Video file in `/public/ShopFlixAI.mp4` (11MB)
- [ ] Screenshots ready in `/Screenshots/` folder
- [ ] Logo and branding assets in `/public/`
- [ ] All CSS files compiled correctly

---

## Phase 2: Build for Production

### 2.1 Clean Build
```bash
cd "/Users/rishisamadhiya/Desktop/Files/Personal/Shopify Apps/fix-merchant-center-app"

# Clear previous builds
rm -rf build/

# Install dependencies
npm install

# Run type checking
npx tsc --noEmit

# Build the app
npm run build
```

### 2.2 Verify Build Output
```bash
# Check build directory
ls -lh build/

# Verify bundle sizes (should be reasonable)
ls -lh build/client/assets/*.js | head -10
```

---

## Phase 3: Deploy to Shopify

### 3.1 Using Shopify CLI (Recommended)

#### Option A: Deploy to Shopify Hosting (Easiest)
```bash
# This will automatically deploy to Shopify's servers
shopify app deploy

# Follow the CLI prompts:
# 1. Select the app from your Partner Account
# 2. Confirm deployment
# 3. Wait for deployment to complete
```

#### Option B: Deploy to Custom Server

If you want to host on your own server:

1. **Build the app for production:**
   ```bash
   npm run build
   ```

2. **Start production server:**
   ```bash
   # Set environment to production
   export NODE_ENV=production
   
   # Ensure database migrations are applied
   npx prisma migrate deploy
   
   # Start the server
   npm start
   ```

3. **Update app URL in Shopify Partner Dashboard:**
   - Go to [Shopify Partner Dashboard](https://partners.shopify.com)
   - Select your app
   - Go to Configuration
   - Update "App URL" to your production domain
   - Update "Redirect URLs" to point to production

### 3.2 Post-Deployment Verification
```bash
# Test the deployed app
curl -I https://<your-production-domain>

# Check if the app loads
# Visit https://<your-production-domain> in browser
```

---

## Phase 4: Configure App Listing

### 4.1 In Shopify Partner Dashboard

1. **Go to your app → App Setup**

2. **Fill in App Information:**
   - **App name:** ShopFlix AI
   - **Description:** AI-powered Shopify app for importing products, checking compliance, and optimizing listings
   - **Support email:** your-email@example.com
   - **Support website:** your-website.com (optional)

3. **Add App Icon/Logo**
   - Go to Branding section
   - Upload logo from `/public/logo-ai-modern.svg` or PNG version
   - Use at least 512x512px for best quality

4. **Add Screenshots**
   - Go to Listing section
   - Upload screenshots from `/Screenshots/` folder
   - Add captions describing each feature:
     - Dashboard with quota tracking
     - Product import interface
     - Rating/feedback banner
     - Video tutorial

5. **Set Pricing Model:**
   - Go to Pricing
   - Choose pricing structure:
     - **Free Trial:** First 2 products (currently configured)
     - **Recurring Plans:** $4.99 - $99/month (based on your tiers)
   - Set billing cycle (monthly)

### 4.2 Configure Scopes
   - Your app already has scopes in `shopify.app.toml`
   - Required scopes:
     ```
     read_products
     write_products
     read_locations
     ```

### 4.3 Configure Webhooks
   - Already set up in your routes:
     - `app/uninstalled` - Handle app uninstall
     - `app/scopes_update` - Handle scope changes

---

## Phase 5: Submit for Review (App Store)

### 5.1 If Publishing to Shopify App Store

1. **Go to App Setup → Listing**
2. Click **"Create an app listing"**
3. Fill in required fields:
   - Category: Choose relevant category
   - Description (detailed)
   - Screenshots (3-5 recommended)
   - Support email
   - Privacy policy URL: `https://your-domain/PRIVACY_POLICY.md`
   - Terms of service URL: `https://your-domain/TERMS_OF_SERVICE.md`

4. Click **"Submit for Review"**
5. Wait for Shopify's review (typically 1-2 weeks)

### 5.2 Address Shopify Feedback
   - Monitor your email for review feedback
   - Make necessary changes
   - Resubmit if required

---

## Phase 6: Going Live

### 6.1 Release to Users
   - Once review is approved, your app appears in Shopify App Store
   - Users can discover and install from App Store

### 6.2 Monitor After Launch
   - Check app metrics in Partner Dashboard
   - Monitor error logs
   - Track installations and active users
   - Respond to user reviews

### 6.3 Production Monitoring
```bash
# Check server health
curl https://<your-domain>/health

# Monitor database
npx prisma studio

# View logs
tail -f /var/log/app.log
```

---

## Phase 7: Ongoing Maintenance

### 7.1 Regular Updates
- Keep dependencies updated: `npm update`
- Run security audits: `npm audit`
- Test before each deployment

### 7.2 Database Backups
```bash
# Backup production database
cp prod.db prod.db.backup.$(date +%Y%m%d)
```

### 7.3 Monitor Metrics
- Track user signups and activations
- Monitor quota usage patterns
- Review feature usage analytics
- Gather user feedback

---

## Troubleshooting

### Issue: App won't deploy
```bash
# Clear build cache and rebuild
rm -rf build/ node_modules/.vite
npm install
npm run build
```

### Issue: Database migrations fail
```bash
# Check migration status
npx prisma migrate status

# Reset database (WARNING: Data loss!)
npx prisma migrate reset

# Apply migrations manually
npx prisma migrate deploy
```

### Issue: Video/assets not loading
```bash
# Verify public directory is being served
curl https://your-domain/ShopFlixAI.mp4

# Check file permissions
ls -lh public/
chmod 644 public/*
```

### Issue: App crashes on startup
```bash
# Check environment variables
env | grep SHOPIFY

# Check logs
tail -100 /var/log/app.log

# Verify database connection
npx prisma db execute --stdin < test.sql
```

---

## Quick Deployment Checklist

- [ ] All tests passing (`npm run build` succeeds)
- [ ] Environment variables configured
- [ ] Database migrations applied
- [ ] Video and assets in `/public/`
- [ ] Screenshots prepared
- [ ] App listing created
- [ ] Privacy policy and ToS reviewed
- [ ] Support email configured
- [ ] Pricing tiers verified
- [ ] Deploy via Shopify CLI or custom server
- [ ] Test app installation on test store
- [ ] Monitor for 24 hours post-deployment
- [ ] Submit to App Store (optional)

---

## Support Resources

- [Shopify App Developer Documentation](https://shopify.dev/docs/apps)
- [Shopify CLI Documentation](https://shopify.dev/docs/shopify-cli)
- [Remix Documentation](https://remix.run/docs)
- [Shopify App Store Guidelines](https://shopify.dev/docs/apps/store)

---

## Contact & Support

For deployment issues:
1. Check Shopify Partner Dashboard for error logs
2. Review this guide's troubleshooting section
3. Contact Shopify Support through Partner Dashboard
