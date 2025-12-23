# ShopFlix AI - Local Testing Guide

## 🎯 Testing Setup

You now have **two separate app configurations**:

### 1. **Production App** (Linked to Railway)
- **Config File**: `shopify.app.shopflix-ai.toml`
- **App Name**: ShopFlix AI
- **URL**: https://fix-merchant-center-production.up.railway.app
- **Status**: Deployed on Railway, used by actual customers
- **Use When**: Testing production changes after deployment

### 2. **Dev App** (Local Testing - NEW)
- **Config File**: `shopify.app.dev.toml`
- **App Name**: ShopFlix AI Dev
- **URL**: http://localhost:3000
- **Status**: Running on your local machine only
- **Use When**: Testing new features, debugging, development

---

## 🚀 How to Run Local Dev App

### Step 1: Start the Dev Server

```bash
cd /Users/rishisamadhiya/Desktop/Files/Personal/Shopify\ Apps/fix-merchant-center-app
shopify app dev --config-name=dev
```

**What this does:**
- Starts local dev server on http://localhost:3000
- Uses the `shopify.app.dev.toml` configuration
- Creates a NEW Shopify app called "ShopFlix AI Dev"
- Links to your LOCAL machine (not Railway)

### Step 2: Install on Dev Store

When you run the command, Shopify CLI will:
1. Create a new test app in your organization
2. Show you installation link for your dev store
3. Install the app on your dev store
4. The new app will appear as "ShopFlix AI Dev" (separate from the production one)

### Step 3: Test Your Changes

- Open the app in your dev store
- Test the new dashboard design
- Test new features
- Make changes to code, auto-reload works
- No effect on production Railway version!

---

## 📋 What's Different Between Apps

| Aspect | Production App | Dev App |
|--------|---|---|
| **Config File** | shopify.app.shopflix-ai.toml | shopify.app.dev.toml |
| **App Name** | ShopFlix AI | ShopFlix AI Dev |
| **URL** | Railway production | localhost:3000 |
| **Client ID** | 85d12decc346b5ec3cdfebacdce7f290 | *Will be assigned* |
| **Environment** | Production | Development |
| **Changes Affect** | Real customers | Only your dev store |
| **Data** | Separate database | Separate database |

---

## 🔄 Switching Between Apps

### To Run Production Version (Railway)
```bash
shopify app dev --config-name=shopflix-ai
```

### To Run Development Version (Local)
```bash
shopify app dev --config-name=dev
```

### To Run Default Version
```bash
shopify app dev
```

---

## 🎨 Testing the New Dashboard

Now you can safely test the new dashboard without affecting the production app:

1. **Start dev server**
   ```bash
   shopify app dev --config-name=dev
   ```

2. **Install the app**
   - Follow the CLI prompts
   - Install "ShopFlix AI Dev" on your dev store

3. **Test features**
   - View the new modern dashboard
   - Test AI product import
   - Try platform showcase
   - Test getting started guide
   - Verify responsive design

4. **Make changes**
   - Edit CSS, React components, etc.
   - Auto-reload picks up changes
   - No production impact

---

## 📝 Benefits of This Setup

✅ **Isolation** - Dev app completely separate from production
✅ **Safety** - No risk to production Railway app
✅ **Testing** - Full testing without affecting customers
✅ **Development** - Quick iteration with auto-reload
✅ **Debugging** - Easy to debug issues locally
✅ **Clean Separation** - Production and dev data separate

---

## ⚠️ Important Notes

1. **Database**: Dev app uses separate database from production
2. **Credentials**: Dev app has different client ID than production
3. **Data**: Any test data in dev app is isolated
4. **Users**: Only you can see dev app on your dev store
5. **Cost**: No additional costs for test app

---

## 🔗 Useful Commands

```bash
# Run dev version
shopify app dev --config-name=dev

# Build for production
npm run build

# Check config
shopify app info --config-name=dev

# Reset configuration
shopify app dev --reset --config-name=dev

# View production config
shopify app info --config-name=shopflix-ai
```

---

## 📱 Dev Store Access

Your dev store: **quickstart-8d0b502f.myshopify.com**

After running dev server:
1. Admin URL: https://quickstart-8d0b502f.myshopify.com/admin
2. Find installed apps
3. You'll see both apps (ShopFlix AI and ShopFlix AI Dev)
4. Click "ShopFlix AI Dev" to test local changes

---

## ✅ Testing Checklist

- [ ] Start dev server: `shopify app dev --config-name=dev`
- [ ] Install ShopFlix AI Dev on dev store
- [ ] View new dashboard design
- [ ] Test hero section
- [ ] Test quick stats
- [ ] Test platform showcase
- [ ] Test feature highlights
- [ ] Test getting started guide
- [ ] Test product import
- [ ] Test on mobile (responsive design)
- [ ] Make code changes and verify auto-reload
- [ ] Check console for errors

---

## 🎯 Next Steps

1. **Start dev server**
   ```bash
   shopify app dev --config-name=dev
   ```

2. **Install the dev app**
   - Follow the prompts from the CLI

3. **Test the new dashboard**
   - Verify all sections appear correctly
   - Check responsive design
   - Test interactions

4. **Report any issues**
   - Found a bug? Fix it locally first
   - No production impact
   - When ready, deploy to Railway

---

**Status**: ✅ Ready to test locally!
**Dev App Config**: shopify.app.dev.toml
**Production App Config**: shopify.app.shopflix-ai.toml

🚀 **Start testing now with zero impact on production!**
