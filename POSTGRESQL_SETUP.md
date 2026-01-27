# PostgreSQL Setup Guide for Railway

## Why PostgreSQL?

**Problem:** SQLite stores data in a local file. Railway containers have **ephemeral filesystems** - every deployment wipes the filesystem clean, losing all your data.

**Solution:** PostgreSQL is a separate database service that persists data across all deployments.

---

## Step-by-Step Setup

### 1. Add PostgreSQL to Your Railway Project

1. Go to your Railway project: https://railway.app/project/25a65c19-fdc6-4f32-89bd-7f6033c2cf9a
2. Click **"+ New"** button
3. Select **"Database"** → **"PostgreSQL"**
4. Railway will automatically provision a PostgreSQL database

### 2. Connect Your App to PostgreSQL

Railway automatically creates these environment variables in the PostgreSQL service:
- `PGHOST`
- `PGPORT`
- `PGUSER`
- `PGPASSWORD`
- `PGDATABASE`
- `DATABASE_URL` (the connection string)

**Link the database to your app:**

1. Go to your app service (the main web service)
2. Click **"Variables"** tab
3. Click **"+ New Variable"** → **"Add Reference"**
4. Select the PostgreSQL service
5. Choose **`DATABASE_URL`** from the dropdown
6. Save

This will automatically set `DATABASE_URL` in your app to point to the PostgreSQL database.

### 3. Deploy the Updated Schema

Once the `DATABASE_URL` is set:

```bash
# Push the code (schema.prisma already updated to postgresql)
git push

# Railway will automatically:
# 1. Build your app
# 2. Run prisma generate
# 3. Run prisma migrate deploy (if you have migrations)
# 4. Start the app
railway up --detach
```

### 4. Run Database Migrations

After deployment, you need to create the tables:

**Option A: Automatic (Railway CLI)**
```bash
# Railway will run this during build if you have a build script
# Make sure your package.json has:
# "build": "prisma generate && prisma migrate deploy && remix vite:build"
```

**Option B: Manual (One-time)**
```bash
# Connect to your Railway project and run migration
railway run npx prisma migrate deploy
```

**Option C: Create Initial Migration**
```bash
# Generate a migration from your current schema
npx prisma migrate dev --name initial_migration

# Then deploy
git add . && git commit -m "feat: Add initial PostgreSQL migration" && git push
railway up --detach
```

### 5. Seed Your Database (Optional)

If you want to add initial data (subscription plans, etc.):

```bash
railway run npx prisma db seed
```

Or add a seed script to `package.json`:
```json
{
  "prisma": {
    "seed": "node prisma/seed.js"
  }
}
```

---

## Verify It's Working

1. **Check Railway Logs:**
   ```bash
   railway logs
   ```
   Look for: `Database connection successful` or similar Prisma messages

2. **Check Database:**
   ```bash
   # Open PostgreSQL console
   railway run psql $DATABASE_URL

   # List tables
   \dt

   # Check a table
   SELECT * FROM "SubscriptionPlan";

   # Exit
   \q
   ```

3. **Test in App:**
   - Create a subscription
   - Deploy again: `railway up --detach`
   - Check if the data persists ✅

---

## Troubleshooting

### Error: "Can't reach database server"

**Solution:** Make sure you've added the `DATABASE_URL` reference from PostgreSQL service to your app service.

### Error: "The table `Session` does not exist"

**Solution:** Run migrations:
```bash
railway run npx prisma migrate deploy
```

### Error: "SSL connection required"

**Solution:** Update `DATABASE_URL` to include SSL:
```env
DATABASE_URL="postgresql://user:pass@host:port/db?sslmode=require"
```

Railway usually handles this automatically.

### Want to Reset Database?

```bash
# WARNING: This deletes all data!
railway run npx prisma migrate reset --force
```

---

## Migration Checklist

- [x] Updated `prisma/schema.prisma` to use `postgresql`
- [ ] Added PostgreSQL service to Railway project
- [ ] Linked `DATABASE_URL` from PostgreSQL to app service
- [ ] Pushed code to Railway
- [ ] Ran migrations: `railway run npx prisma migrate deploy`
- [ ] Verified data persists after deployment
- [ ] Seeded initial data (subscription plans)

---

## Next Steps

After PostgreSQL is set up:

1. **Remove SQLite files** (optional cleanup):
   ```bash
   git rm prisma/dev.db* .gitignore
   git commit -m "chore: Remove SQLite database files"
   ```

2. **Update `.env.example`** (if you have one):
   ```env
   DATABASE_URL="postgresql://user:pass@localhost:5432/dbname"
   ```

3. **Test the billing flow** - your subscription data will now persist! 🎉

---

## Benefits

✅ **Data persists** across all deployments  
✅ **Better performance** for production apps  
✅ **Scalable** - can handle more connections  
✅ **ACID compliant** - data integrity guaranteed  
✅ **Backups** - Railway automatically backs up PostgreSQL  

---

## Railway PostgreSQL Features

- **Automatic Backups:** Daily backups retained for 7 days
- **Metrics:** Monitor CPU, memory, disk usage
- **Logs:** View PostgreSQL query logs
- **Scaling:** Can upgrade to larger database instances
- **Connection Pooling:** Available for high-traffic apps

---

Need help? Check Railway docs: https://docs.railway.app/databases/postgresql
