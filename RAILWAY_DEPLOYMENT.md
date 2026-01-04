# Railway Deployment Guide - ShopFlixAI

## Prerequisites
- Railway account (https://railway.app)
- GitHub repository connected (already done: mobilecasez/fix-merchant-app)
- Shopify app credentials

## Step 1: Add PostgreSQL Database to Railway

1. Go to your Railway project "ShopFlixAI"
2. Click "+ New Service"
3. Select "PostgreSQL"
4. Railway will automatically add it to your project

## Step 2: Configure Environment Variables

After adding PostgreSQL, set these environment variables in your Railway project:

### Required Variables:

```
# Shopify API Credentials
SHOPIFY_API_KEY=2c65115880221c91a310482a43be0355
SHOPIFY_API_SECRET=a17b3423313852c02c332f81e1685547
SCOPES=write_products,read_products,read_script_tags,write_script_tags

# Google Gemini API Key
GOOGLE_GEMINI_API_KEY=AIzaSyAqnrP-b2epwan7GVTmtAknQedQ106clxo

# Database URL (Railway will provide this automatically from PostgreSQL service)
# Format: postgresql://user:password@host:port/database
# This will be auto-populated by Railway when you link the PostgreSQL service

# App URL (You'll get this from Railway after first deploy)
# Format: https://shopflix-ai-production.up.railway.app
SHOPIFY_APP_URL=https://YOUR_RAILWAY_APP_URL.up.railway.app

# Shopify Dev Store
SHOPIFY_DEV_STORE=quickstart-8d0b502f.myshopify.com

# Node Environment
NODE_ENV=production
```

## Step 3: Connect GitHub Repository

1. In Railway dashboard, go to your ShopFlixAI project
2. Click "Connect GitHub"
3. Select the repository: `mobilecasez/fix-merchant-app`
4. Choose branch: `main`
5. Enable automatic deployments

## Step 4: Link PostgreSQL to App

1. In your ShopFlixAI project, click on your app service
2. Click "Variables" tab
3. Copy the DATABASE_URL from PostgreSQL service (Railway does this automatically)
4. The DATABASE_URL should be auto-populated

## Step 5: Deploy

Option A: Automatic (Recommended)
- Push code to GitHub main branch
- Railway will automatically build and deploy

Option B: Manual
- Go to Railway dashboard
- Click "Deploy" button on your app service
- Watch the deployment logs

## Step 6: Update Shopify App Settings

After first successful deployment:

1. Get your Railway app URL from the deployment logs
2. Update Shopify app configuration:
   - Go to Shopify Partner Dashboard
   - Update App URL to: `https://your-railway-app-url.up.railway.app`
   - Update Redirect URLs

## Deployment Checklist

- [ ] PostgreSQL database added to Railway
- [ ] All environment variables configured
- [ ] GitHub repository connected
- [ ] DATABASE_URL linked from PostgreSQL
- [ ] SHOPIFY_APP_URL environment variable set
- [ ] First deployment successful
- [ ] Logs show "Ready" status
- [ ] App accessible via Railway URL
- [ ] Shopify app configuration updated with new URL
- [ ] Database migrations ran successfully (check logs for "prisma db push")
- [ ] Subscription plans seeded (check logs for seed completion)

## Monitoring

After deployment:
1. Go to Railway dashboard
2. Select your app service
3. Click "Logs" tab to view real-time logs
4. Monitor for any errors during startup

## Database Initialization

The app will automatically:
1. Detect PostgreSQL database from DATABASE_URL
2. Run `prisma generate` - generates Prisma client
3. Run `prisma db push` - applies schema to PostgreSQL
4. Run seed script - creates subscription plans

**Note**: Development uses SQLite (file:./dev.db), but schema automatically uses PostgreSQL when DATABASE_URL points to a PostgreSQL instance.

## Troubleshooting

**Issue: "DATABASE_URL not set"**
- Solution: Make sure PostgreSQL service is linked and DATABASE_URL environment variable is set

**Issue: "Port already in use"**
- Solution: App listens on port 3000 (HOST=0.0.0.0). Railway handles this automatically.

**Issue: Build failing**
- Check build logs in Railway dashboard
- Ensure Node.js version is compatible (18+)
- Check that all dependencies are in package.json

**Issue: App crashing after deploy**
- Check logs for "prisma db push" errors
- Verify DATABASE_URL is correctly set
- Check that all required environment variables are present

## Important Notes

1. **Database**: PostgreSQL on Railway (not SQLite)
2. **Build Time**: First build may take 10-15 minutes due to Chromium dependencies
3. **Start Command**: `npm run docker-start` 
   - This runs: `prisma generate && prisma db push --accept-data-loss && node seed-subscription-plans.js && npm start`
4. **Health Checks**: Railway performs automatic health checks
5. **Logs**: All logs visible in Railway dashboard in real-time

## Security

- Never commit `.env` file to Git (it's in .gitignore)
- All sensitive variables stored in Railway environment
- SHOPIFY_API_SECRET never exposed to client
- All database credentials managed by Railway

---

**Version**: v1.0.0-production
**Last Updated**: January 4, 2026
**Status**: Ready for Production Deployment
