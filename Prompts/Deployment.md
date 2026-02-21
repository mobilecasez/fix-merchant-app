# ShopFlix AI - Complete Deployment Guide

**Last Updated:** February 21, 2026  
**Version:** 2.0 - Separated Dev & Production Workflows

---

## ⚠️ CRITICAL: Read This First

**This guide has TWO completely separate deployment workflows:**

1. **🟢 DEVELOPMENT (Local Testing)** - Use `shopify.app.dev.toml` and local PostgreSQL
2. **🔴 PRODUCTION (Railway)** - Use `shopify.app.production.toml` and Railway PostgreSQL

**NEVER mix these configurations!** Each environment has its own:
- TOML configuration file
- Shopify Client ID and Secret
- Database URL
- App URL
- Environment variables

**🔐 Note on Credentials:** 
This guide uses placeholders like `shpss_[your_secret]` and `AIza[your_key]` for sensitive values. To get actual credentials:
- **Dev API Secret**: Run `shopify app env show` (or check `.env` file)
- **Production API Secret**: Run `shopify app env show --config shopify.app.production.toml`
- **Gemini API Key**: Get from [Google AI Studio](https://aistudio.google.com/app/apikey)

---

## Table of Contents

1. [Environment Overview](#environment-overview)
2. [🟢 Development Deployment (Local)](#-development-deployment-local)
3. [🔴 Production Deployment (Railway)](#-production-deployment-railway)
4. [Common Issues & Solutions](#common-issues--solutions)
5. [Verification Checklist](#verification-checklist)

---

## Environment Overview

### 🟢 Development Environment

| Component | Value |
|-----------|-------|
| **TOML File** | `shopify.app.dev.toml` (default when running `shopify app dev`) |
| **Client ID** | `adbe221d4ee5000b41a21b0117444917` |
| **App URL** | `http://localhost:3000` (via Cloudflare tunnel) |
| **Database** | `postgresql://rishisamadhiya@localhost:5432/shopflix_dev` |
| **Environment File** | `.env` (local) |
| **Test Store** | `quickstart-8d0b502f.myshopify.com` |
| **Purpose** | Local testing before production deployment |

### 🔴 Production Environment

| Component | Value |
|-----------|-------|
| **TOML File** | `shopify.app.production.toml` (specify with `--config` flag) |
| **Client ID** | `85d12decc346b5ec3cdfebacdce7f290` |
| **App URL** | `https://shopflixai-production.up.railway.app` |
| **Database** | Railway PostgreSQL (internal: `postgres.railway.internal:5432`) |
| **Environment Variables** | Railway dashboard or CLI |
| **Test Store** | `zsellr.myshopify.com` |
| **Purpose** | Live production app for real merchants |

---

## 🟢 Development Deployment (Local)

### Step 1: Verify Development Configuration Files

#### 1.1 Check `shopify.app.dev.toml`

**File:** `shopify.app.dev.toml`

```toml
# ShopFlix AI - Local Development Configuration
# This is for local testing only - separate from the production Railway app

client_id = "adbe221d4ee5000b41a21b0117444917"
name = "ShopFlix AI Dev"
application_url = "http://localhost:3000"
embedded = true

[access_scopes]
scopes = "read_products,write_products"

[build]
automatically_update_urls_on_dev = true

[webhooks]
api_version = "2024-07"

  [[webhooks.subscriptions]]
  topics = [ "app/uninstalled" ]
  uri = "/webhooks/app/uninstalled"

  [[webhooks.subscriptions]]
  topics = [ "app/scopes_update" ]
  uri = "/webhooks/app/scopes_update"

[auth]
redirect_urls = [
  "http://localhost:3000/auth/callback",
  "http://localhost:3000/auth/shopify/callback",
  "http://localhost:3000/api/auth/callback"
]

[pos]
embedded = false
```

**⚠️ DO NOT CHANGE** the `client_id` - it's for development only.

#### 1.2 Check `.env` (Local Environment)

**File:** `.env`

```env
SHOPIFY_APP_URL="http://localhost:3000"
SHOPIFY_API_KEY="adbe221d4ee5000b41a21b0117444917"
SHOPIFY_API_SECRET="shpss_[your_dev_secret_here]"
SCOPES="write_products,read_products"
DATABASE_URL="postgresql://rishisamadhiya@localhost:5432/shopflix_dev"
GOOGLE_GEMINI_API_KEY="AIza[your_gemini_api_key_here]"
```

**✅ Verify:**
- `SHOPIFY_API_KEY` matches `client_id` in `shopify.app.dev.toml`
- `DATABASE_URL` points to local PostgreSQL database
- `SHOPIFY_APP_URL` is `http://localhost:3000`

### Step 2: Start Local Development Server

#### 2.1 Ensure Local PostgreSQL is Running

```bash
# Check if PostgreSQL is running
psql -U rishisamadhiya -d shopflix_dev -c "SELECT 1;"

# If not running, start it:
brew services start postgresql@16
```

#### 2.2 Start Shopify Dev Server

```bash
# Clean any previous dev sessions (optional)
shopify app dev clean

# Start development server
shopify app dev
```

**Expected Output:**
```
✅ Ready, watching for changes in your app

Preview URL: https://quickstart-8d0b502f.myshopify.com/admin/oauth/redirect_from_cli?client_id=adbe221d4ee5000b41a21b0117444917
GraphiQL URL: http://localhost:3457/graphiql
Tunnel URL: https://[random].trycloudflare.com
```

### Step 3: Test the Development App

1. **Open Preview URL** from terminal output
2. **Install app** on `quickstart-8d0b502f.myshopify.com`
3. **Test features:**
   - Add product replica
   - Test AI scraping
   - Verify billing (if applicable)
4. **Check logs** in terminal for any errors

### Step 4: Make Changes and Test

**Hot Reload is Enabled:**
- Edit any `.tsx` file
- Save the file
- Refresh browser to see changes
- Check terminal for build errors

---

## 🔴 Production Deployment (Railway)

### Prerequisites

Before deploying to production:

✅ **App working locally** (test thoroughly in dev first)  
✅ **Railway CLI installed** (`railway --version`)  
✅ **Railway account** linked (`railway whoami`)  
✅ **GitHub repository** up to date  
✅ **All changes committed** to `main` branch

### Step 1: Verify Production Configuration Files

#### 1.1 Check `shopify.app.production.toml`

**File:** `shopify.app.production.toml`

```toml
# Production App Configuration - ShopFlix AI
# Learn more: https://shopify.dev/docs/apps/tools/cli/configuration

client_id = "85d12decc346b5ec3cdfebacdce7f290"
name = "ShopFlix AI"
application_url = "https://shopflixai-production.up.railway.app"
embedded = true

[build]
automatically_update_urls_on_dev = false

[webhooks]
api_version = "2024-07"

[webhooks.privacy_compliance]
customer_deletion_url = "https://shopflixai-production.up.railway.app/webhooks/customers/redact"
customer_data_request_url = "https://shopflixai-production.up.railway.app/webhooks/customers/data_request"
shop_deletion_url = "https://shopflixai-production.up.railway.app/webhooks/shop/redact"

  [[webhooks.subscriptions]]
  topics = [ "app/scopes_update" ]
  uri = "/webhooks/app/scopes_update"

  [[webhooks.subscriptions]]
  topics = [ "app/uninstalled" ]
  uri = "/webhooks/app/uninstalled"

  [[webhooks.subscriptions]]
  topics = [ "app_subscriptions/update" ]
  uri = "/webhooks/app-subscriptions-update"

[access_scopes]
scopes = "read_products,write_products"

[auth]
redirect_urls = [
  "https://shopflixai-production.up.railway.app/auth/callback",
  "https://shopflixai-production.up.railway.app/auth/shopify/callback",
  "https://shopflixai-production.up.railway.app/api/auth/callback"
]

[pos]
embedded = false
```

**⚠️ CRITICAL:** All URLs must be `https://shopflixai-production.up.railway.app`

#### 1.2 Verify `app/shopify.server.ts`

**File:** `app/shopify.server.ts`

```typescript
const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July24,
  scopes: ["read_products", "write_products"],
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing: undefined, // Manual billing via GraphQL
  future: {
    unstable_newEmbeddedAuthStrategy: false, // MUST be false for production
    removeRest: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});
```

**✅ Verify:**
- `unstable_newEmbeddedAuthStrategy: false` (traditional OAuth)
- `distribution: AppDistribution.AppStore`
- All values come from environment variables

### Step 2: Get Production Credentials from Shopify

#### 2.1 Get API Secret for Production App

```bash
shopify app env show --config shopify.app.production.toml
```

**Expected Output:**
```
SHOPIFY_API_KEY=85d12decc346b5ec3cdfebacdce7f290
SHOPIFY_API_SECRET=shpss_[your_production_secret_here]
SCOPES=read_products,write_products
```

**📝 COPY** the `SHOPIFY_API_SECRET` value - you'll need it for Railway.

### Step 3: Configure Railway Environment Variables

#### 3.1 Verify Railway Variables

```bash
# Check all Railway environment variables
railway variables
```

**Required Variables:**

| Variable | Value | How to Set |
|----------|-------|------------|
| `SHOPIFY_API_KEY` | `85d12decc346b5ec3cdfebacdce7f290` | `railway variables --set SHOPIFY_API_KEY=85d12decc346b5ec3cdfebacdce7f290` |
| `SHOPIFY_API_SECRET` | `shpss_[from_step_2.1]` | `railway variables --set SHOPIFY_API_SECRET=shpss_[value_from_step_2.1]` |
| `SHOPIFY_APP_URL` | `https://shopflixai-production.up.railway.app` | `railway variables --set SHOPIFY_APP_URL=https://shopflixai-production.up.railway.app` |
| `DATABASE_URL` | (automatically set by Railway) | No action needed |
| `GOOGLE_GEMINI_API_KEY` | `AIza[your_gemini_key]` | `railway variables --set GOOGLE_GEMINI_API_KEY=AIza[your_key]` |
| `NODE_ENV` | `production` | `railway variables --set NODE_ENV=production` |

####3.2 Set Variables (If Missing or Incorrect)

```bash
# Set production API secret (CRITICAL - must match Shopify Partner Dashboard)
railway variables --set SHOPIFY_API_SECRET=shpss_[value_from_step_2.1]

# Set production app URL
railway variables --set SHOPIFY_APP_URL=https://shopflixai-production.up.railway.app

# Set production API key
railway variables --set SHOPIFY_API_KEY=85d12decc346b5ec3cdfebacdce7f290

# Set Google Gemini API key
railway variables --set GOOGLE_GEMINI_API_KEY=AIza[your_gemini_key]
```

**⚠️ CRITICAL:** After setting variables, Railway will automatically redeploy.

### Step 4: Deploy to Shopify Partner Dashboard

#### 4.1 Deploy Configuration

```bash
# Deploy production configuration to Shopify Partner Dashboard
shopify app deploy --config shopify.app.production.toml --force
```

**Expected Output:**
```
╭─ info ───────────────────────────────────────────────────────────────────────╮
│  Using shopify.app.production.toml for default values:                       │
│    • Org:             zSellr Enterprises LLP                                 │
│    • App:             ShopFlix AI                                            │
╰──────────────────────────────────────────────────────────────────────────────╯

Releasing a new app version as part of ShopFlix AI

╭─ success ────────────────────────────────────────────────────────────────────╮
│  New version released to users.                                              │
│  shopflix-ai-8 (or higher)                                                   │
╰──────────────────────────────────────────────────────────────────────────────╯
```

**📝 Note:** The version number (shopflix-ai-8) will increment with each deployment.

### Step 5: Deploy Code to Railway

#### 5.1 Ensure Code is Committed and Pushed

```bash
# Check for uncommitted changes
git status

# If there are changes, commit them:
git add -A
git commit -m "Production release: [describe changes]"
git push origin main
```

#### 5.2 Deploy to Railway

```bash
# Option 1: Manual upload (recommended for immediate deployment)
railway up --detach

# Option 2: Let Railway auto-deploy from GitHub (slower)
# Just push to main, Railway will detect and deploy
```

**Expected Output:**
```
  Indexed
  Compressed [====================] 100%
  Uploaded
  Build Logs: https://railway.com/project/[PROJECT_ID]/service/[SERVICE_ID]?id=[DEPLOYMENT_ID]
```

#### 5.3 Monitor Deployment

```bash
# Wait for build to complete (usually 2-3 minutes)
sleep 120

# Check if app is running
railway logs --tail 50
```

**Expected Log Output:**
```
[shopify-api/INFO] version 11.14.1, environment Remix
[remix-serve] http://localhost:8080 (http://0.0.0.0:8080)
```

**✅ Good signs:**
- `remix-serve` started
- No error messages
- `200` HTTP status codes

**❌ Bad signs:**
- `401 Unauthorized` on webhooks = Wrong API secret
- `500 Internal Server Error` = Check app errors
- App not starting = Check Railway logs for errors

### Step 6: Verify Production Deployment

#### 6.1 Test Direct Access

```bash
# Test if Railway app is responding
curl -I https://shopflixai-production.up.railway.app
```

**Expected Response:**
```
HTTP/2 200
content-type: text/html; charset=utf-8
```

#### 6.2 Test via Shopify Admin

1. **Go to test store**: https://admin.shopify.com/store/zsellr/apps
2. **Click on ShopFlix AI**
3. **App should load** without errors

**If you see blank screen or errors:**
- Check Railway logs: `railway logs --tail 100`
- Verify environment variables: `railway variables | grep SHOPIFY`
- Check Shopify Partner Dashboard: App version deployed?

#### 6.3 Test Core Functionality

On the production app:

1. ✅ **Add Product Replica** - Try scraping an Amazon URL
2. ✅ **AI Fallback** - Test with URL that triggers CAPTCHA
3. ✅ **Billing** - Verify subscription plans load
4. ✅ **No Console Errors** - Check browser console (F12)

### Step 7: Monitor Production

#### 7.1 Check Railway Logs

```bash
# Follow live logs
railway logs

# Get last 100 lines
railway logs --tail 100

# Search for errors
railway logs --tail 500 | grep -i error
```

#### 7.2 Check Webhook Delivery

1. Go to **Shopify Partner Dashboard** → **ShopFlix AI** → **Configuration** → **Webhooks**
2. Scroll to **Webhook subscriptions**
3. Check **Recent deliveries** - should show `200 OK`

**If webhooks showing 401:**
- `SHOPIFY_API_SECRET` is incorrect in Railway
- Run: `shopify app env show --config shopify.app.production.toml`
- Update Railway: `railway variables --set SHOPIFY_API_SECRET=[correct_value]`

---

## Common Issues & Solutions

### Issue 1: "ErrorResponseImpl { status: 200 }" in Production

**Symptom:** Blank screen, only App Bridge script loads

**Cause:** Authentication configuration mismatch

**Solution:**
```bash
# 1. Verify API secret matches
shopify app env show --config shopify.app.production.toml

# 2. Update Railway if different
railway variables --set SHOPIFY_API_SECRET=[value_from_step_1]

# 3. Redeploy
railway redeploy --yes
```

### Issue 2: "401 Unauthorized" on Webhooks

**Symptom:** Railway logs show `POST /webhooks/app/uninstalled 401`

**Cause:** `SHOPIFY_API_SECRET` in Railway doesn't match Shopify Partner Dashboard

**Solution:**
```bash
# Get correct secret
shopify app env show --config shopify.app.production.toml

# Update Railway
railway variables --set SHOPIFY_API_SECRET=shpss_[correct_value]

# Railway will auto-redeploy
```

### Issue 3: AI Scraping Not Working in Production

**Symptom:** "No HTML available for AI fallback" error

**Cause:** Code was clearing HTML when CAPTCHA detected (FIXED in commit e4728de)

**Verification:**
```bash
# Check if latest code is deployed
git log --oneline -1
# Should show: e4728de fix: Keep HTML for AI fallback even when CAPTCHA detected

# If not, deploy:
git pull origin main
railway up --detach
```

### Issue 4: Railway Showing 503 Error

**Symptom:** `Error 503 error:0A000126:SSL routines::unexpected eof while reading`

**Cause:** Railway edge cache (Varnish CDN) infrastructure issue - NOT your app

**Solution:**
```bash
# Test if app is actually running
railway logs --tail 20

# If app is running (you see remix-serve), wait 5-10 minutes
# Railway edge cache will refresh automatically

# Test multiple times:
for i in {1..5}; do
  curl -s -o /dev/null -w "Status: %{http_code}\n" https://shopflixai-production.up.railway.app
  sleep 5
done

# If getting mix of 200 and 503, it's edge cache issue
# Access via Shopify admin will work fine
```

### Issue 5: Local Dev Using Production Config

**Symptom:** `shopify app dev` using wrong client ID

**Cause:** Wrong TOML file being used

**Solution:**
```bash
# Verify shopify.app.toml (symlink or default) points to dev config
cat shopify.app.toml | grep client_id
# Should show: adbe221d4ee5000b41a21b0117444917

# If showing production ID (85d12de...), you have wrong default
# Shopify CLI uses shopify.app.toml as default

# Create shopify.app.toml as copy of dev config:
cp shopify.app.dev.toml shopify.app.toml

# Or always specify config explicitly:
shopify app dev --config shopify.app.dev.toml
```

---

## Verification Checklist

### 🟢 Development Environment Checklist

Before starting dev work:

- [ ] `shopify.app.dev.toml` has client_id: `adbe221d4ee5000b41a21b0117444917`
- [ ] `.env` has `SHOPIFY_API_KEY=adbe221d4ee5000b41a21b0117444917`
- [ ] `.env` has `DATABASE_URL=postgresql://...localhost:5432/shopflix_dev`
- [ ] `.env` has `SHOPIFY_APP_URL=http://localhost:3000`
- [ ] Local PostgreSQL database `shopflix_dev` exists
- [ ] `shopify app dev` starts successfully
- [ ] Preview URL contains `client_id=adbe221d4ee5000b41a21b0117444917`
- [ ] App installs on `quickstart-8d0b502f.myshopify.com`
- [ ] All features work locally

### 🔴 Production Environment Checklist

Before deploying to production:

**Configuration:**
- [ ] `shopify.app.production.toml` has client_id: `85d12decc346b5ec3cdfebacdce7f290`
- [ ] All URLs in production TOML are `https://shopflixai-production.up.railway.app`
- [ ] `app/shopify.server.ts` has `unstable_newEmbeddedAuthStrategy: false`

**Railway Variables:**
- [ ] `SHOPIFY_API_KEY=85d12decc346b5ec3cdfebacdce7f290`
- [ ] `SHOPIFY_API_SECRET=shpss_[from_step_2.1]`
- [ ] `SHOPIFY_APP_URL=https://shopflixai-production.up.railway.app`
- [ ] `GOOGLE_GEMINI_API_KEY` is set
- [ ] `DATABASE_URL` is set by Railway

**Deployment:**
- [ ] Latest code committed and pushed to GitHub `main` branch
- [ ] `shopify app deploy --config shopify.app.production.toml --force` successful
- [ ] New version released (shopflix-ai-X)
- [ ] `railway up --detach` completed
- [ ] Railway logs show `remix-serve http://localhost:8080`

**Verification:**
- [ ] `curl -I https://shopflixai-production.up.railway.app` returns `200 OK`
- [ ] App loads via Shopify admin: https://admin.shopify.com/store/zsellr/apps
- [ ] Add product replica works
- [ ] AI scraping works (test with Amazon URL)
- [ ] No console errors in browser (F12)
- [ ] Webhooks showing 200 OK in Partner Dashboard

---

## Command Quick Reference

### Development Commands

```bash
# Start local dev server
shopify app dev

# Clean dev session and restart
shopify app dev clean
shopify app dev

# Check local database
psql -U rishisamadhiya -d shopflix_dev -c "\dt"

# View dev app configuration
shopify app env show
```

### Production Commands

```bash
# Get production credentials
shopify app env show --config shopify.app.production.toml

# Deploy to Shopify Partner Dashboard
shopify app deploy --config shopify.app.production.toml --force

# Deploy code to Railway
railway up --detach

# Check Railway environment variables
railway variables

# Set Railway environment variable
railway variables --set KEY=value

# Check Railway logs
railway logs --tail 100

# Redeploy on Railway (without code changes)
railway redeploy --yes

# Check Railway service status
railway status

# Test production app
curl -I https://shopflixai-production.up.railway.app
```

### Git Commands

```bash
# Check status
git status

# Commit all changes
git add -A
git commit -m "Description of changes"

# Push to GitHub
git push origin main

# Sync dev branch with main
git checkout dev
git merge main
git push origin dev
git checkout main

# View recent commits
git log --oneline -10
```

---

## Environment Variables Reference

### Local Development (.env)

```env
SHOPIFY_APP_URL=http://localhost:3000
SHOPIFY_API_KEY=adbe221d4ee5000b41a21b0117444917
SHOPIFY_API_SECRET=shpss_[your_dev_secret]
SCOPES=write_products,read_products
DATABASE_URL=postgresql://rishisamadhiya@localhost:5432/shopflix_dev
GOOGLE_GEMINI_API_KEY=AIza[your_gemini_key]
```

### Production (Railway)

```env
SHOPIFY_APP_URL=https://shopflixai-production.up.railway.app
SHOPIFY_API_KEY=85d12decc346b5ec3cdfebacdce7f290
SHOPIFY_API_SECRET=shpss_[from_shopify_app_env_show]
DATABASE_URL=(automatically set by Railway PostgreSQL)
GOOGLE_GEMINI_API_KEY=AIza[your_gemini_key]
NODE_ENV=production
```

---

## Important Notes

### DO NOT:
- ❌ Use production credentials in development
- ❌ Use development credentials in production
- ❌ Commit `.env` files to Git
- ❌ Mix TOML configurations between environments
- ❌ Deploy to production without testing locally first
- ❌ Change `unstable_newEmbeddedAuthStrategy` to `true` in production (causes errors)

### ALWAYS:
- ✅ Test changes in development first
- ✅ Use `--config shopify.app.production.toml` for production
- ✅ Verify Railway environment variables before deploying
- ✅ Check Railway logs after deployment
- ✅ Commit and push code before deploying to Railway
- ✅ Keep dev and main Git branches synchronized

---

## Support & Troubleshooting

If you encounter issues not covered in this guide:

1. **Check Railway logs:** `railway logs --tail 200`
2. **Check Shopify Partner Dashboard:** Configuration → Webhooks → Recent deliveries
3. **Verify environment variables:** `railway variables | grep SHOPIFY`
4. **Compare with working config:** Review this guide's checklists
5. **Test locally first:** `shopify app dev` should always work before production

**Last successful deployment:** February 21, 2026  
**Current production version:** shopflix-ai-7+  
**Status:** ✅ All systems operational
