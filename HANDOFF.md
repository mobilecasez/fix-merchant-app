# HANDOFF — decisions & follow-ups for Rishi (night of 11–12 Jul 2026)

Everything below is working and deployed; these are the items that need YOUR call or a one-time action.

## 0. 🚨 GMC outreach emails are ALL failing — Brevo IP allowlist (blocker, action needed)
The 5x/day GMC outreach cron (`send_emails.py`) is sending **0** emails. Every real attempt fails with:
`SMTPAuthenticationError: (525, 5.7.1 Unauthorized IP address)`
This is Brevo rejecting SMTP from this host's IP — nothing to do with the script or the queue. As of **2026-07-13** the whole outreach stage is dead until fixed. Fix in the Brevo dashboard: **SMTP & API → Authorized IPs** — either add this machine's current public IP to the allowlist, or disable IP restrictions. Nothing else is broken: 37 stores sit emailable and un-contacted, and because every attempt logs as `failed` (not `sent`), no owner was wrongly marked contacted — they'll all send once the IP is authorized.

## 1. Unlock REAL product costs (5-minute action, big payoff)
The new breakeven-ROAS engine reads Shopify's per-variant **"Cost per item"** — but the production app is missing the `read_inventory` scope, so it currently falls back to the assumed-% setting (default 50%, editable in Price Radar → costs panel).
To unlock real costs: add `read_inventory` to `scopes` in `shopify.app.production.toml` → run `shopify app deploy` → approve the new permission in your store admin. The code already fetches it (guarded) — it lights up automatically, no redeploy needed after approval.
Note: the hard "Margin Impossible" verdict (product excluded from ALL ad campaigns) only ever fires on REAL costs — assumptions can flag, never convict.

## 2. Weekly digest email — check your inbox
A test digest was sent tonight (manual trigger). Scheduled for **Mondays 09:00 IST** via GitHub Actions (`weekly-digest.yml`, pushed to the repo — uses the same `APP_URL`/`CRON_SECRET` repo secrets as the monitor cron, so nothing to configure). Merchants can opt out via the checkbox in Price Radar → costs panel or the unsubscribe link in the email.

## 3. Decision needed: should the grid P&L subtract product cost?
Today "Profit/Loss" everywhere = revenue − ads − shipping − RTO (COGS **not** subtracted — consistent with how it's always been). The new contribution margin/breakeven ROAS live alongside it in the AI report. If you want the grid itself to show true net (revenue − COGS − ads − ship − RTO), say the word — it changes every number merchants have gotten used to, so I didn't flip it unilaterally.

## 4. Still pending from before
- **Rotate the Gemini API key** (was pasted in chat) — Google AI Studio → new key → update `GOOGLE_GEMINI_API_KEY` on Railway.
- Minor known caveat: on ranges >90 days, per-product ROAS compares full-range revenue with spend capped at ~3× the sync window (flagged in review as low-impact; fine on the default 30-day view).

## 5. What shipped tonight (short version — details in MORNING-REPORT.md)
- COGS + contribution margin + breakeven ROAS per product (real Shopify cost when scope allows, assumed-% fallback, both labeled).
- New **MARGIN_IMPOSSIBLE** screen with four safety guards (real-cost-only, no ship-estimate convictions, sales-mix check for multi-variant products, basket-carrier exemption) — convicted products are excluded from every ad campaign including the catch-all.
- Out-of-stock products (tracked, oversell-off, zero stock, no orders) excluded from campaigns, with honest notes about what could/couldn't be excluded.
- Weekly profit digest email + opt-out + idempotent re-runs.
- GDPR shop-redact now cleans up ALL Price-Radar-era tables (it was missing 10 models).
- 19 review findings fixed before deploy (24-agent adversarial review).
