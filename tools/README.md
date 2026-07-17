# Store-prospecting scanner (`prospect.cjs`)

Finds the **best outreach leads** from a list of Shopify stores: it reads only public
data (homepage, `/products.json`, policy pages), scores each store's **Google Merchant
Center suspension risk**, estimates store age + size, and extracts the **public contact
email** — then ranks them so you contact the highest-need stores first.

No AI, no database, no Shopify login — just HTTP. Safe to run anywhere with Node 18+.

## 1. Get a store list
The scanner needs domains to check. Export them from a Shopify-store directory:
- **Store Leads** (storeleads.app) — filter by platform = Shopify, country, and
  **"created" date < 1 year** + low product count for the small/new segment.
- **BuiltWith**, **Commerce Inspector**, or **PublicWWW** also work.

Paste the domains into `tools/prospects.txt` (one per line).

## 2. Run it
```bash
node tools/prospect.cjs                         # reads tools/prospects.txt
node tools/prospect.cjs store1.com store2.com   # or pass domains directly
node tools/prospect.cjs --max-age 365 --max-products 300   # keep only small/new stores
```

Output: a ranked console summary + `tools/prospect-report.csv`
(`domain, riskScore, riskLevel, products, ageDays, contactEmail, topIssues`).
Highest risk = best lead (most to gain from a free scan / the app).

## 3. Outreach — keep it compliant
The emails are **public business addresses** for **B2B** outreach. Do it the right way so
it helps rather than gets you blacklisted:
- **Personalize** — reference the store's actual top issue from the report.
- **Lead with value** — "your refund policy isn't linked in the footer, a common GMC
  suspension trigger — here's a free scan."
- **Include a clear opt-out**, send from a real monitored inbox, **modest volume**, and
  prefer **US** recipients (CAN-SPAM permits compliant B2B cold email; EU/Canada are
  stricter under GDPR/CASL).
- Don't blast — small, targeted batches to the highest-risk stores convert better and
  protect your domain reputation.
