# 🚀 Production Deployment Quick Checklist

Use this checklist when deploying to production.

## Pre-Deployment

- [ ] Run `npm run generate:env` to generate secure keys
- [ ] Update `.env` with all production values
- [ ] Run `npm run precheck` to validate configuration
- [ ] Choose hosting platform (Railway/Fly.io/Heroku)
- [ ] Set up production database (PostgreSQL)

## Environment Variables

Copy and update these in your hosting platform:

```bash
SHOPIFY_API_KEY=           # From Partner Dashboard
SHOPIFY_API_SECRET=        # From Partner Dashboard
SHOPIFY_APP_URL=           # Set after first deployment
DATABASE_URL=              # PostgreSQL connection string
ENCRYPTION_STRING=         # Generated via npm run generate:env
NODE_ENV=production
OPENAI_API_KEY=            # From platform.openai.com
GOOGLE_AI_API_KEY=         # From makersuite.google.com
```

## Deployment Steps

### 1. Initial Deploy

**Railway:**
```bash
railway login
railway init
railway up
railway domain  # Note the URL
```

**Fly.io:**
```bash
fly launch
fly deploy
fly info  # Note the URL
```

**Heroku:**
```bash
heroku create your-app-name
heroku addons:create heroku-postgresql
git push heroku main
heroku info  # Note the URL
```

### 2. Update App URL

```bash
# Set SHOPIFY_APP_URL to your production URL
railway variables set SHOPIFY_APP_URL=https://your-app.up.railway.app
# OR
fly secrets set SHOPIFY_APP_URL=https://your-app.fly.dev
# OR
heroku config:set SHOPIFY_APP_URL=https://your-app.herokuapp.com
```

### 3. Database Setup

```bash
# Apply migrations
npm run db:migrate

# Seed subscription plans
npm run db:seed
```

### 4. Update Shopify Partner Dashboard

- [ ] Go to https://partners.shopify.com/
- [ ] Navigate to Apps → Your App
- [ ] Update "App URL" to production URL
- [ ] Update OAuth redirect URLs:
  - `https://your-url.com/auth/callback`
  - `https://your-url.com/auth/shopify/callback`
  - `https://your-url.com/api/auth/callback`
- [ ] Save changes

### 5. Update shopify.app.toml

Copy `shopify.app.production.toml` to `shopify.app.toml` and update:

```toml
application_url = "https://your-production-url.com"

[auth]
redirect_urls = [
  "https://your-production-url.com/auth/callback",
  "https://your-production-url.com/auth/shopify/callback",
  "https://your-production-url.com/api/auth/callback"
]
```

## Testing

- [ ] Install app on test store
- [ ] Test authentication flow
- [ ] Test product import (at least 3 platforms)
- [ ] Test trial activation (2 free products)
- [ ] Test subscription purchase
- [ ] Test billing confirmation callback
- [ ] Test upgrade/downgrade
- [ ] Verify webhooks fire on uninstall
- [ ] Check usage analytics dashboard
- [ ] Test AI features (if keys configured)

## Legal Documents

Before submission to App Store:

- [ ] Review and customize `PRIVACY_POLICY.md`
- [ ] Review and customize `TERMS_OF_SERVICE.md`
- [ ] Host these documents publicly or add to app
- [ ] Update contact information in both documents
- [ ] Add your company address

## App Store Submission

- [ ] Complete app listing in Partner Dashboard
- [ ] Upload app icon (1024x1024px)
- [ ] Add 5-10 screenshots
- [ ] Write compelling description
- [ ] Set pricing (already configured)
- [ ] Add privacy policy URL
- [ ] Add support email/URL
- [ ] Submit for review

## Monitoring Setup

- [ ] Set up error tracking (Sentry)
- [ ] Configure uptime monitoring
- [ ] Set up log aggregation
- [ ] Create alerts for:
  - High error rates
  - Slow response times
  - Failed billing charges
  - Database connection issues

## Post-Launch

- [ ] Monitor error logs for first 24 hours
- [ ] Watch for support requests
- [ ] Track installation metrics
- [ ] Gather user feedback
- [ ] Plan first update

## Quick Commands Reference

```bash
# Generate secure keys
npm run generate:env

# Validate before deployment
npm run precheck

# Build for production
npm run prod:build

# Database operations
npm run db:migrate
npm run db:seed
npm run db:setup  # Both migrate + seed

# Production start
npm run prod:start
```

## Emergency Rollback

If something goes wrong:

```bash
# Railway
railway rollback

# Fly.io  
fly releases
fly rollback <version>

# Heroku
heroku releases
heroku rollback v<number>

# Database
psql $DATABASE_URL < backup.sql
```

## Support Contacts

- **Shopify Partner Support**: https://partners.shopify.com/support
- **Railway Support**: https://railway.app/help
- **Fly.io Support**: https://fly.io/docs
- **Heroku Support**: https://help.heroku.com

---

## Estimated Timeline

- **Environment Setup**: 15 minutes
- **Initial Deployment**: 10 minutes
- **Configuration**: 15 minutes
- **Testing**: 30 minutes
- **Legal Review**: 2 hours
- **App Store Submission**: 1 hour

**Total**: ~4-5 hours for complete production deployment

---

**Last Updated**: December 15, 2025

For detailed instructions, see:
- [PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md) - Complete guide
- [BILLING_INTEGRATION.md](./BILLING_INTEGRATION.md) - Billing details
- [APP_STORE_SUBMISSION_CHECKLIST.md](./APP_STORE_SUBMISSION_CHECKLIST.md) - Launch requirements
