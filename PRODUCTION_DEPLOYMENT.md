# Production Deployment Guide

## Environment Variables Configuration

### Required Variables

Create a `.env` file in production with the following variables:

```bash
# Shopify App Credentials (from Partner Dashboard)
SHOPIFY_API_KEY=your_api_key_here
SHOPIFY_API_SECRET=your_api_secret_here

# Production App URL (IMPORTANT: Update after deployment)
SHOPIFY_APP_URL=https://your-production-domain.com

# OAuth Scopes
SCOPES=read_products,write_products,read_locations

# Database (PostgreSQL recommended for production)
DATABASE_URL=postgresql://user:password@host:5432/database

# Session Encryption
ENCRYPTION_STRING=generate_random_32_char_string_here

# Node Environment
NODE_ENV=production

# AI Services (Required for AI features)
OPENAI_API_KEY=sk-your_openai_key
GOOGLE_AI_API_KEY=your_google_ai_key

# Optional: Error Tracking
SENTRY_DSN=your_sentry_dsn_here

# Optional: Email Service (for notifications)
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_USER=your_email@example.com
SMTP_PASSWORD=your_email_password
```

## Pre-Deployment Checklist

### 1. Update App Configuration

**shopify.app.toml**
- [ ] Update `application_url` to production URL
- [ ] Update `redirect_urls` with production URLs
- [ ] Verify `api_version` is current
- [ ] Confirm all required `scopes` are listed

### 2. Database Setup

**For PostgreSQL (Recommended):**
```bash
# Install PostgreSQL client
npm install pg

# Update DATABASE_URL in .env
DATABASE_URL=postgresql://user:password@host:5432/database

# Run migrations
npx prisma migrate deploy

# Seed subscription plans
node seed-subscription-plans.js
```

**For SQLite (Development Only):**
```bash
DATABASE_URL=file:./prisma/dev.sqlite
```

### 3. Security Configuration

**Generate Encryption String:**
```bash
# Generate a secure random string
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Update Environment Variables:**
```bash
ENCRYPTION_STRING=<generated_string>
NODE_ENV=production
```

### 4. API Keys Setup

**OpenAI API:**
1. Go to https://platform.openai.com/api-keys
2. Create new API key
3. Add to `OPENAI_API_KEY`

**Google AI API:**
1. Go to https://makersuite.google.com/app/apikey
2. Create API key
3. Add to `GOOGLE_AI_API_KEY`

### 5. Build Application

```bash
# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Build for production
npm run build
```

## Deployment Options

### Option 1: Railway (Recommended - Easiest)

1. **Install Railway CLI:**
```bash
npm i -g @railway/cli
```

2. **Login and Initialize:**
```bash
railway login
railway init
```

3. **Add Environment Variables:**
```bash
railway variables set SHOPIFY_API_KEY=your_key
railway variables set SHOPIFY_API_SECRET=your_secret
# ... add all variables
```

4. **Deploy:**
```bash
railway up
```

5. **Get Production URL:**
```bash
railway domain
# Note this URL and update SHOPIFY_APP_URL
```

6. **Update App URL:**
```bash
railway variables set SHOPIFY_APP_URL=https://your-app.up.railway.app
```

### Option 2: Fly.io

1. **Install Flyctl:**
```bash
curl -L https://fly.io/install.sh | sh
```

2. **Launch App:**
```bash
fly launch
```

3. **Set Secrets:**
```bash
fly secrets set SHOPIFY_API_KEY=your_key
fly secrets set SHOPIFY_API_SECRET=your_secret
# ... add all secrets
```

4. **Deploy:**
```bash
fly deploy
```

### Option 3: Heroku

1. **Create App:**
```bash
heroku create your-app-name
```

2. **Add PostgreSQL:**
```bash
heroku addons:create heroku-postgresql:essential-0
```

3. **Set Environment Variables:**
```bash
heroku config:set SHOPIFY_API_KEY=your_key
heroku config:set SHOPIFY_API_SECRET=your_secret
# ... add all variables
```

4. **Deploy:**
```bash
git push heroku main
```

### Option 4: Docker Deployment

1. **Build Image:**
```bash
docker build -t product-import-pro .
```

2. **Run Container:**
```bash
docker run -p 3000:3000 \
  -e SHOPIFY_API_KEY=your_key \
  -e SHOPIFY_API_SECRET=your_secret \
  -e DATABASE_URL=postgresql://... \
  product-import-pro
```

## Post-Deployment Steps

### 1. Update Shopify Partner Dashboard

1. Go to https://partners.shopify.com/
2. Navigate to Apps → Your App
3. Update App URL to production URL
4. Update OAuth redirect URLs
5. Save changes

### 2. Update shopify.app.toml

```toml
# Update these values
application_url = "https://your-production-url.com"

[auth]
redirect_urls = [
  "https://your-production-url.com/auth/callback",
  "https://your-production-url.com/auth/shopify/callback",
  "https://your-production-url.com/api/auth/callback"
]
```

### 3. Test Production Environment

- [ ] Install app on test store
- [ ] Test authentication flow
- [ ] Test product import from each platform
- [ ] Test subscription activation
- [ ] Test billing flow (trial and paid)
- [ ] Test upgrade/downgrade
- [ ] Verify webhooks are working
- [ ] Check error logging

### 4. Configure Monitoring

**Sentry (Error Tracking):**
```bash
npm install @sentry/remix
```

Add to `entry.server.tsx`:
```typescript
import * as Sentry from "@sentry/remix";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
});
```

### 5. Set Up Cron Jobs (Optional)

For monthly billing cycle resets, set up a cron job or use:

**Railway:**
```bash
railway cron add "0 0 * * *" "node scripts/reset-monthly-usage.js"
```

**Heroku:**
```bash
heroku addons:create scheduler:standard
# Configure in Heroku dashboard
```

## Production URLs Structure

Your app needs these URLs configured:

```
https://your-domain.com/                    # Main app
https://your-domain.com/auth/callback       # OAuth callback
https://your-domain.com/app                 # App interface
https://your-domain.com/app/billing-callback # Billing return
https://your-domain.com/webhooks/*          # Webhook endpoints
```

## SSL/HTTPS Configuration

- All hosting providers (Railway, Fly.io, Heroku) provide automatic HTTPS
- Custom domains require SSL certificate (usually automatic)
- Shopify requires HTTPS for all app URLs

## Database Migrations in Production

**Safe Migration Process:**
```bash
# 1. Backup database first
pg_dump $DATABASE_URL > backup.sql

# 2. Test migrations locally
npx prisma migrate dev

# 3. Apply to production
npx prisma migrate deploy

# 4. Verify
npx prisma db pull
```

## Performance Optimization

### 1. Database Indexing
Already configured in `schema.prisma`:
```prisma
@@index([shop])
@@index([shop, date])
```

### 2. Caching (Optional)
Consider adding Redis for:
- Session storage
- Rate limiting
- Product cache

### 3. CDN (Optional)
Use Cloudflare or similar for:
- Static asset delivery
- DDoS protection
- Performance optimization

## Scaling Considerations

### Database Connection Pooling
```bash
# Add to DATABASE_URL
?connection_limit=10&pool_timeout=10
```

### Worker Processes
```bash
# Set in deployment config
WEB_CONCURRENCY=2
```

## Rollback Plan

If deployment fails:

1. **Railway:**
```bash
railway rollback
```

2. **Heroku:**
```bash
heroku rollback
```

3. **Database:**
```bash
# Restore from backup
psql $DATABASE_URL < backup.sql
```

## Security Hardening

- [ ] Enable rate limiting
- [ ] Set up CORS properly
- [ ] Use secure session configuration
- [ ] Enable CSP headers
- [ ] Regular dependency updates
- [ ] Monitor for vulnerabilities

## Health Checks

Create `/health` endpoint:
```typescript
// app/routes/health.tsx
export function loader() {
  return json({ status: "ok", timestamp: new Date().toISOString() });
}
```

Configure health checks in hosting platform.

## Support & Monitoring

### Set Up Alerts For:
- Error rate spikes
- Response time degradation
- Database connection issues
- API rate limit warnings
- Billing failures

### Log Aggregation
Consider services like:
- Papertrail
- Loggly
- Datadog

## Final Checklist

- [ ] All environment variables set
- [ ] Database migrated and seeded
- [ ] App URL updated in Partner Dashboard
- [ ] shopify.app.toml updated
- [ ] SSL/HTTPS working
- [ ] OAuth flow tested
- [ ] Webhooks verified
- [ ] Billing integration tested
- [ ] Error tracking configured
- [ ] Monitoring set up
- [ ] Backup strategy in place
- [ ] Documentation updated

## Going Live

Once everything is tested:

1. Update app status to "Public" in Partner Dashboard
2. Submit for App Store review
3. Monitor logs closely for first 24 hours
4. Have support team ready

## Emergency Contacts

- Shopify Partner Support: https://partners.shopify.com/support
- Railway Support: https://railway.app/help
- Your hosting provider support

---

**Ready for Production!** 🚀

For questions, refer to:
- BILLING_INTEGRATION.md
- APP_STORE_SUBMISSION_CHECKLIST.md
- Shopify documentation
