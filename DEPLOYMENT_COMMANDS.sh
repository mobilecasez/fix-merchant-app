#!/bin/bash
# ShopFlix AI - Deployment Commands Quick Reference
# Copy and paste these commands directly into your terminal

# ============================================================================
# STEP 1: PREPARE ENVIRONMENT
# ============================================================================

# Navigate to app directory
cd "/Users/rishisamadhiya/Desktop/Files/Personal/Shopify Apps/fix-merchant-center-app"

# Create .env file (if not exists)
cp .env.example .env

# Edit with your credentials (nano, vim, or open in VS Code)
nano .env
# You need to set:
#   SHOPIFY_API_KEY=<your_key>
#   SHOPIFY_API_SECRET=<your_secret>
#   SHOPIFY_APP_URL=https://<your-domain>
#   SESSION_SECRET=<generate_random>

# ============================================================================
# STEP 2: BUILD THE APP
# ============================================================================

# Option A: AUTOMATED (Recommended)
./deploy.sh

# Option B: MANUAL
npm install
npx tsc --noEmit
npm run build

# ============================================================================
# STEP 3: DEPLOY TO SHOPIFY
# ============================================================================

# Deploy using Shopify CLI
shopify app deploy

# Or deploy with verbose output (for debugging)
shopify app deploy --verbose

# ============================================================================
# STEP 4: TEST LOCALLY (Optional)
# ============================================================================

# Start development server
npm run dev

# Server runs on http://localhost:3000
# Test all features before deploying

# ============================================================================
# STEP 5: CONFIGURE IN PARTNER DASHBOARD
# ============================================================================

# 1. Go to https://partners.shopify.com
# 2. Click Apps → ShopFlix AI
# 3. Go to App Setup → Branding
# 4. Upload logo from: public/logo-ai-modern.svg
# 5. Go to Pricing
# 6. Configure 6 plans:
#    - Free Trial: $0 (2 imports)
#    - Starter: $4.99 (20 imports)
#    - Basic: $9.99 (50 imports)
#    - Professional: $17.99 (100 imports)
#    - Advanced: $24.99 (500 imports)
#    - Enterprise: $99 (Unlimited)

# ============================================================================
# STEP 6: INSTALL ON TEST STORE
# ============================================================================

# 1. Go to test store: https://quickstart-xxxxx.myshopify.com
# 2. Admin → Apps and integrations → App and sales channel settings
# 3. Search for ShopFlix AI
# 4. Install app and grant permissions

# ============================================================================
# STEP 7: VERIFY INSTALLATION
# ============================================================================

# Test in browser:
# ✓ Dashboard loads
# ✓ Click "Watch Tutorial" → Video plays
# ✓ Click stars → Rating submitted
# ✓ Click "Dismiss" → Banner disappears
# ✓ Click "Go to Product Replica" → Navigates
# ✓ Try importing a product
# ✓ Verify quota counter updates

# ============================================================================
# STEP 8: SUBMIT TO APP STORE (Optional)
# ============================================================================

# 1. Go to Partner Dashboard → Apps → ShopFlix AI
# 2. Click Listing → Create an app listing
# 3. Fill in:
#    - Category: Shopping
#    - Description: (detailed description)
#    - Screenshots: (5 best screenshots from /Screenshots/)
#    - Support email: your-email@example.com
#    - Privacy policy: https://your-domain/PRIVACY_POLICY.md
#    - Terms: https://your-domain/TERMS_OF_SERVICE.md
# 4. Click "Submit for review"
# 5. Wait for Shopify approval (1-2 weeks)

# ============================================================================
# STEP 9: PRODUCTION MONITORING
# ============================================================================

# Check app status
shopify app info

# View recent deployments
shopify app deploy --list

# Monitor Partner Dashboard for:
# ✓ Total installations
# ✓ Active users
# ✓ Revenue
# ✓ User reviews

# ============================================================================
# STEP 10: FUTURE UPDATES
# ============================================================================

# When you make changes:
npm run build
shopify app deploy

# New version automatically available to all users

# ============================================================================
# TROUBLESHOOTING COMMANDS
# ============================================================================

# Clear build cache and rebuild
rm -rf build/ node_modules/.vite
npm install
npm run build

# Check TypeScript errors
npx tsc --noEmit

# Check Prisma migrations
npx prisma migrate status

# Reset database (⚠️ WARNING: DATA LOSS!)
npx prisma migrate reset

# View database
npx prisma studio

# Verify video file
ls -lh public/ShopFlixAI.mp4
curl -I http://localhost:3000/ShopFlixAI.mp4

# ============================================================================
# VERIFICATION CHECKLIST
# ============================================================================

# Before deployment, verify:
# □ npm run build succeeds
# □ npx tsc --noEmit returns no errors
# □ public/ShopFlixAI.mp4 exists
# □ .env file has all required variables
# □ Shopify CLI installed: shopify version
# □ Database migrations ready: npx prisma migrate status

# ============================================================================
# DEPLOYMENT TIME ESTIMATES
# ============================================================================

# Preparation (env setup):        5 minutes
# Build:                          3 minutes  
# Deploy to Shopify:              5-10 minutes
# Configure listing:              15 minutes
# Test on store:                  10 minutes
# ─────────────────────────────────
# Total to live:                  ~40 minutes

# App Store review (optional):    1-2 weeks

# ============================================================================
# HELP & RESOURCES
# ============================================================================

# View deployment guide
cat DEPLOYMENT_GUIDE.md

# View quick start guide
cat QUICK_START_DEPLOYMENT.md

# View deployment summary
cat DEPLOYMENT_SUMMARY.txt

# Shopify Partner Dashboard
open https://partners.shopify.com

# Shopify App Development Docs
open https://shopify.dev/docs/apps

# ============================================================================
# YOU'RE ALL SET! 🚀
# ============================================================================

# Your app is ready to go live!
# 
# Choose your deployment option:
# 1. AUTOMATED: ./deploy.sh
# 2. MANUAL: npm run build && shopify app deploy
# 3. GUIDED: Read QUICK_START_DEPLOYMENT.md
#
# Good luck with your ShopFlix AI launch! 🎉
