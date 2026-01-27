# Railway PostgreSQL Setup - Final Steps

## ✅ What We've Done

1. ✅ Installed PostgreSQL locally (Homebrew)
2. ✅ Created local database `shopflix_dev`
3. ✅ Updated schema.prisma to use PostgreSQL
4. ✅ Created fresh PostgreSQL migrations
5. ✅ Seeded subscription plans locally
6. ✅ Tested locally - everything works!
7. ✅ Pushed code to GitHub
8. ✅ Deployed to Railway

## 🎯 What You Need To Do Now (5 minutes)

### Step 1: Link PostgreSQL Database to Your App

1. Go to Railway: https://railway.app/project/25a65c19-fdc6-4f32-89bd-7f6033c2cf9a

2. You should see TWO services:
   - **Your app service** (shopflix-ai or web)
   - **PostgreSQL** (the database you just added)

3. Click on your **app service** (NOT the PostgreSQL service)

4. Click **"Variables"** tab

5. Find the `DATABASE_URL` variable (currently it might be pointing to SQLite)

6. **Delete the old DATABASE_URL** or click "Edit"

7. Click **"+ New Variable"** → **"Add Reference"**

8. Select your **PostgreSQL** service from the dropdown

9. Select **`DATABASE_URL`** from the variable list

10. Click **"Add"**

This will automatically set your app's DATABASE_URL to:
```
postgresql://postgres:password@postgres.railway.internal:5432/railway
```

### Step 2: Run Database Migrations on Railway

Railway will automatically run migrations when it builds. But to be safe, run:

```bash
railway run npx prisma migrate deploy
```

This ensures all tables are created in the Railway PostgreSQL database.

### Step 3: Seed Subscription Plans on Railway

```bash
railway run node seed-subscription-plans.js
```

This will add the 6 subscription plans to your production database.

### Step 4: Restart Your App

After linking the DATABASE_URL:

```bash
railway up --detach
```

Or use the Railway dashboard to restart the service.

### Step 5: Verify It's Working

Check Railway logs:
```bash
railway logs
```

Look for:
- ✅ "Prisma schema loaded"
- ✅ "Database migrations applied"
- ✅ No errors about database connection

## 🔍 Verify Data Persists

1. **Test the billing flow:**
   - Subscribe to a plan
   - Check Railway logs - should see database insert

2. **Deploy again:**
   ```bash
   railway up --detach
   ```

3. **Check if subscription still exists:**
   - Go to your app
   - The subscription should still be there ✅

## 🚨 Troubleshooting

### Error: "Can't reach database server"

**Cause:** DATABASE_URL not linked properly

**Fix:**
1. Go to Railway app service
2. Variables tab
3. Make sure DATABASE_URL is a **Reference** to PostgreSQL service
4. NOT a manual string

### Error: "The table does not exist"

**Cause:** Migrations not run

**Fix:**
```bash
railway run npx prisma migrate deploy
```

### Want to Check the Database?

```bash
# Connect to Railway PostgreSQL
railway run psql $DATABASE_URL

# List tables
\dt

# Check subscription plans
SELECT name, price FROM "SubscriptionPlan";

# Exit
\q
```

## 📊 Railway PostgreSQL Dashboard

You can also view your database in Railway:

1. Go to your project
2. Click **PostgreSQL** service
3. Click **"Data"** tab
4. Browse tables and data visually

## ✅ Success Checklist

- [ ] PostgreSQL service added to Railway project
- [ ] DATABASE_URL linked to app service (as Reference)
- [ ] Migrations run: `railway run npx prisma migrate deploy`
- [ ] Data seeded: `railway run node seed-subscription-plans.js`
- [ ] App restarted/redeployed
- [ ] Tested subscription creation
- [ ] Deployed again and verified data persists

## 🎉 Done!

Your app now uses PostgreSQL on both:
- **Local:** `postgresql://localhost:5432/shopflix_dev`
- **Production:** `postgresql://postgres.railway.internal:5432/railway`

No more data loss on deployments! 🚀

---

**Next:** Test the billing flow and watch your data persist across deployments.
