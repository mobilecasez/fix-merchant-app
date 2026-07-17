# Morning Report — Overnight Build (3 features)

**Status: all three features built, typechecked, built, and deployed live to Railway (`shopflix-ai` prod).**
Deploy `fa8297ac` → SUCCESS. App serving 200, cron routes gated (401). New DB tables auto-created via `prisma db push` on deploy.

---

## 1. Dashboard feature cards ✅
`app/routes/app._index.tsx` — added 3 cards to the existing `.feature-cards-grid` (now 6 total, 2 rows):
- 💰 **Price Radar & Profit** → `/app/price-radar`
- 🎯 **AI Google Ads** → `/app/ad-campaigns`
- 🚀 **Protect & Grow** → `/app/growth`

Reused the existing `.feature-card` CSS classes, so styling matches the original 3 cards exactly.

## 2. Price Radar → auto-updating Best-Sellers collection ✅
- **UI card + button** on `/app/price-radar` (above Import Sessions): "Create collection" → posts `create_bestseller_collection`. Shows created/refreshed result. Disabled without `read_orders`.
- **`app/utils/bestseller-collection.server.ts`** — `refreshBestSellerCollection(admin, shop)`: ranks last-30-day products by **delivered revenue − attributed Google Ads spend** (best sellers *net of ad cost*), tags the top 20 with `shopflix-best-seller` (via `tagsAdd`/`tagsRemove`, diffed so drop-outs get untagged), then creates a **smart collection** (rule `TAG = shopflix-best-seller`, `sortOrder: BEST_SELLING`) and publishes it to the Online Store. Idempotent create-or-refresh.
- **`app/routes/api.cron.bestseller-refresh.tsx`** — CRON_SECRET-gated monthly endpoint; loops every `BestSellerCollection` and re-ranks/re-tags so the collection **self-maintains**.
- **`.github/workflows/bestseller-refresh.yml`** — schedule `0 4 1 * *` (1st of month). See action item #2.
- Uses existing `write_products` scope — **no new merchant re-consent** for this feature.

## 3. Owner-only Admin analytics page ✅
- **`app/routes/app.admin.tsx`** (`/app/admin`) — KPI row (installs, active-30d, paying, ads-connected, reports, scans, campaigns, best-seller collections), an **installed-stores table** (store name, `.myshopify` domain, **email**, plan, install date, last-active, activity count), a **per-store detail panel** with counts + a full **activity timeline**, and a **global recent-activity feed**.
- Data = distinct offline `Session` shops (installs) + `AppSettings.createdAt` (install-date proxy) + live `shop { name email }` via `unauthenticated.admin` (cached into `AppSettings.storeDetails.__meta`, capped at 30 live fetches/load). Activity is **derived** from every shop-keyed table (reports, scans, price jobs, applied prices, imports, ads, monitor, reviews, subscription) **merged with** the new `ActivityEvent` log.
- **`app/utils/admin-access.server.ts`** — gate. `requireAppAdmin` → 404 for non-admins. Allowlist via `ADMIN_EMAILS` (default: `zsellr.in@gmail.com,mobilecasez.in@gmail.com`) and/or `ADMIN_SHOPS`. Nav link ("Admin") shows only when `session.shop ∈ ADMIN_SHOPS`.
- **`app/utils/activity.server.ts`** — `logActivity()` best-effort logger. Instrumented on profit-advisor runs + best-seller collection creation; everything else is derived, so the timeline is complete from day one.
- **Schema** (`prisma/schema.prisma`): new `ActivityEvent` + `BestSellerCollection` models.

---

## ⚠️ Action items for you
1. **Access the Admin page**: works by URL (`/app/admin`) for the default admin emails. To (a) show the **"Admin" nav link** and (b) lock it to your store, set on Railway: `ADMIN_SHOPS=<your-store>.myshopify.com` (and/or `ADMIN_EMAILS=<your login email>`). If you get a 404, your Shopify login email isn't in the default list — set `ADMIN_EMAILS`.
2. **Activate the monthly schedule**: the cron endpoint is live, but GitHub Actions runs from **GitHub**, not Railway. Commit + push `.github/workflows/bestseller-refresh.yml` (reuses your existing `APP_URL` + `CRON_SECRET` secrets). Until then nothing triggers it monthly — the button-created collection still works, it just won't auto-refresh. (I did **not** commit/push — you deploy via `railway up`.)
3. Still pending from before (unchanged): App Store **screenshots** upload (files on your Desktop `~/Desktop/ShopFlix-Listing-Screenshots/`), **category appeal** (→ Advertising), and the **Google Analytics ID** for the listing.

## Decisions I made (autonomously, per overnight mode)
- Best-seller ranking = revenue − ad spend (so ad-money-losing "best sellers" are excluded), top 20, 30-day window.
- Monthly cron on the 1st (matches "changes automatically" without over-refreshing).
- Admin gate defaults to your known emails so it works out-of-the-box for you and nobody else.
- Kept instrumentation light (2 explicit `logActivity` calls) + derived the rest, to minimize risk to existing routes.
