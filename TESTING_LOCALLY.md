# How to Test Locally Without Affecting Production

## Problem
- Your production app (ShopFlix AI) is deployed on Railway
- Running `shopify app dev` locally would change the URLs to localhost
- This would break the production Railway app temporarily

## Solution: Create a Separate Development App

You have 3 options:

### ✅ OPTION 1: Use `--reset` Flag (Recommended for Quick Testing)

```bash
shopify app dev --reset
```

**What it does:**
- Creates a TEMPORARY new app just for this dev session
- App is linked to localhost:3000
- Does NOT modify your production app config
- After you close the dev server, the temp app can be removed

**Steps:**
1. Run: `shopify app dev --reset`
2. Shopify CLI will ask which app/org to use
3. You can select or create a new test app
4. Test your changes locally
5. When done, stop the server (Ctrl+C)
6. The temporary app won't interfere with production

---

### ✅ OPTION 2: Manually Create a New App in Partners Dashboard

1. Go to https://partners.shopify.com
2. Create a NEW app called "ShopFlix AI Dev"
3. Copy the new Client ID
4. Create a new config file: `shopify.app.shopflix-ai-dev.toml`
5. Paste the Client ID in the new config
6. Run: `shopify app dev --config=shopflix-ai-dev`

**Benefits:**
- Permanent separate dev app
- Easy to switch between dev and production
- Complete isolation

---

### ✅ OPTION 3: Remove the Dev Config and Use Existing Production Config

The simplest approach:

```bash
# Just run dev normally - it will use the default config
# The CLI is smart about localhost development
shopify app dev
```

**How it works:**
- Shopify CLI automatically handles localhost development
- When you run `shopify app dev`, it uses localhost:3000 for testing
- But it doesn't permanently change the production config file
- The URLs revert when you stop the dev server

---

## 🚀 RECOMMENDED: Use Option 1 (Reset Flag)

This is the easiest and safest for your situation:

```bash
cd "/Users/rishisamadhiya/Desktop/Files/Personal/Shopify Apps/fix-merchant-center-app"
shopify app dev --reset
```

**Why this works:**
✅ No production app modification
✅ Creates temporary dev app automatically  
✅ Perfect for testing new features
✅ Safe - production app untouched
✅ Easy cleanup after testing

**When prompted:**
- Select your organization: `zSellr Pvt Ltd`
- Create or select a dev/test app

---

## 📋 Quick Start

```bash
# Navigate to your app directory
cd "/Users/rishisamadhiya/Desktop/Files/Personal/Shopify Apps/fix-merchant-center-app"

# Start dev server with reset (creates temp test app)
shopify app dev --reset

# Or, start dev server normally (uses smart localhost detection)
shopify app dev

# The app will be available on:
# - Local: http://localhost:3000
# - Dev store: https://quickstart-8d0b502f.myshopify.com/admin
```

---

## ⚠️ Important Notes

1. **URL Changes Are Temporary**: When you use `shopify app dev`, any URL changes are temporary and for local development only

2. **Production App Remains Unchanged**: Your production `shopify.app.shopflix-ai.toml` stays as-is (pointing to Railway)

3. **Auto-Revert**: When you stop the dev server, everything reverts (if using --reset or default dev)

4. **No Customer Impact**: Your production Railway app continues to serve real customers unaffected

---

## Next Step

Try this command:

```bash
shopify app dev --reset
```

This will:
1. Create a temporary dev app
2. Link it to localhost:3000
3. Let you test locally
4. Keep production app untouched
