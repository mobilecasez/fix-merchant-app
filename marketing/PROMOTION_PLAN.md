# ShopFlix AI — Promotion & Growth Master Plan

> Prepared June 2026. All market facts below were verified by live web research (sources inline).
> Companion files: [app-store-listing.md](app-store-listing.md) (listing copy + image briefs) and [cowork-playbook.md](cowork-playbook.md) (autonomous execution missions for Cowork).

---

## 1. Executive summary — the wedge

**Feed apps get products INTO Google. ShopFlix AI gets the STORE APPROVED by Google — and gets suspended accounts back.**

The market splits into two clusters, and ShopFlix sits in the gap between them:

| Cluster | Examples | Reviews | What they do | What they CAN'T do |
|---|---|---|---|---|
| Feed apps (saturated) | Simprosys (4.9★, ~4,300), AdNabu (4.8★, ~714), DataFeedWatch ($64/mo) | thousands | Feed syntax, channel sync | Storefront trust signals — the cause of 90%+ of suspensions |
| Compliance scanners (embryonic, all < 6 months old) | ClearCheck (5 reviews), ComplianceGuard AI (3 reviews), Complify (0), GMC Store Readiness Scanner (0) | **8 combined** | Scan & report | **Fix anything** — all are scan-only |

**Nobody on the App Store offers what ShopFlix already has:** (a) one-click auto-fix that *creates* policy pages, footer links, and contact info via the Admin API; (b) AI-drafted suspension appeal letters; (c) AI image compliance fixing; (d) suspension-category diagnosis with a prioritized recovery checklist. Today those four things are only sold by human agencies at $149–$720.

**Demand is enormous and chronic:** ~11.7M GMC accounts were suspended in 2024; from a reviewed cohort of 1,000 suspensions, >90% were "Misrepresentation" (StubGroup, 2025 state-of-suspensions report). Shopify Community and Google's Merchant Center forum show continuous new suspension threads through 2026.

**The window:** the scanner category went 0 → 5 apps between Dec 2025 and Apr 2026. Review-count leadership is winnable in months. Expect a funded competitor to add auto-fix within 6–12 months — review velocity now matters more than feature breadth.

---

## 2. Positioning & messaging house

**One-liner (everywhere):**
> ShopFlix AI scans your Shopify store the way Google's review does — then fixes what it finds in one click, and writes your reinstatement appeal if you're suspended.

**Against feed apps (comparison content, ads, Reddit):**
> Your feed app did its job. Google still suspended you — because the problem is your *store*, not your feed. Misrepresentation suspensions come from missing policies, thin contact info, price mismatches, and fake-urgency widgets. That's what we fix.

**Crisis message-match (H1s, ad headlines, blog titles):** mirror Google's suspension email verbatim — merchants literally search the email subject line:
> "Your Google Merchant Center account is suspended." Here's exactly what to do next.

**Vocabulary to use everywhere** (top demand keywords, autocomplete-verified): *misrepresentation* (the #1 term — only 7 competing apps in App Store search), *merchant center suspension*, *GMC*, *products disapproved*, *appeal*, *reinstatement*, *pending initial review*.

**Compliance guardrails for ALL public copy** (Shopify listing rules 4.3.3/4.3.4/4.3.7 — violations get listings rejected):
- ❌ No statistics or data claims in the App Store listing (the 11.7M number is for blog/social only)
- ❌ No "best / only / #1 / guaranteed reinstatement"
- ❌ No testimonials in the listing
- ✅ Phrase capabilities, not outcomes: "drafts your appeal letter" not "gets you reinstated"

---

## 3. Product levers that ARE marketing (do these first)

These product changes directly feed the App Store ranking algorithm (which since 2023 weighs *post-search engagement and traction* over keywords) and conversion:

1. **CRITICAL — Free plan can't experience the core value.** Free = 2 credits, but a Basic scan costs 10. A new install hits a paywall before the "aha" moment, which kills the engagement signal the ranking algorithm rewards. **Fix: give every new install one free Basic scan** (one-time grant of 10 credits, or make the first Basic scan free). Time-to-first-value is the single highest-leverage conversion lever.
2. **Add a "Suspension Rescue" one-time SKU ($39–$79):** Deep Scan + Suspension Recovery + appeal letter as a panic-mode bundle. Proof it works: ComplianceGuard sells a $149/7-day "Rescue Pass"; GMBJet charges $497 flat; Fiverr gigs start at $25. Anchor pricing copy against the $497 agency, never against $5 feed apps.
3. **Free public scan page (lead magnet):** a no-login page on your site — enter store URL → top 3 issues + grade; full report requires install. `runMonitoringScan()` already does this server-side. This captures crisis-Google-search traffic that agencies currently monetize.
4. **"Official app mismatch" check:** the official Google & YouTube app's multi-week sync stalls create feed-vs-storefront price mismatches — a documented suspension trigger (a Google forum thread blames the official app for *causing* a misrepresentation suspension). Your live-store reconciliation architecture already supports comparing feed values vs. storefront. Marquee feature: *"We catch the mismatches the official Google app creates."*
5. **Review-moment asks (never incentivized):** trigger a neutral in-app review prompt at peak-delight moments — right after a successful auto-fix run or a completed appeal letter. NEVER offer credits/discounts for reviews (Partner Program Agreement violation → app delisting risk). The existing rating banner is fine; add the post-fix moment.
6. **Built for Shopify badge = the biggest visibility lever** (+49% installs within 14 days per Shopify's own data). Requirements: 50 net installs from paid-plan shops, 5+ reviews, admin Web Vitals at p75 (LCP ≤ 2.5s, CLS ≤ 0.1, INP ≤ 200ms over 28 days/100+ calls). **Audit the embedded app's performance now** so the 28-day measurement window is clean when install volume arrives.
7. **Published check count:** competitors advertise "38 checks." Count yours across Basic+Advanced+Deep and publish "60+ checks Google runs on your store" (use your real number) on the website/blog — NOT in the App Store listing (no stats rule).
8. **Plan-name collision:** the "Basic" plan ($9.99) collides with the "Basic scan" — confusing in support and copy. Consider renaming plans (e.g., Starter/Growth/Pro/Scale) at the next pricing touch.

---

## 4. Proof points to manufacture (weeks 1–6)

The wedge needs evidence. In priority order:

1. **mobilecasez.com case study #1** — your own store: before/after scan screenshots, issues found, fixes applied. Honest framing: "built by a merchant who got suspended."
2. **5–10 documented reinstatement case studies** with before/after GMC screenshots + days-to-reinstatement. Source candidates from free scans offered in forums (see playbook Mission A3).
3. **Live video: one-click fix** creating policy pages/footer links/contact info in real time (~90 seconds, screen recording).
4. **Image Fixer before/afters** — watermarked/promo-text image → clean white background grid.
5. **The appeal-letter template** — publish a real (anonymized) template in a blog post; your app writes these, and "GMC appeal letter example" has proven search demand.

---

## 5. Channel strategy (ranked by research) + 12-week roadmap

Ranked by effort vs. expected impact for the first 100–1,000 installs:

| # | Channel | Effort | Impact | Key rule |
|---|---|---|---|---|
| 1 | Shopify Community forums | LOW | HIGH | No app links in replies; signature/profile does the selling |
| 2 | Reddit (r/shopify, r/PPC, r/googleads, r/ecommerce) | MED | HIGH | 90/10 rule; comment-first; always disclose; ban risk is real |
| 3 | Content SEO + free scan tool | MED-HIGH | HIGH (compounding) | Target the crisis keyword set agencies already monetize |
| 4 | ASO + reviews flywheel | LOW-MED | HIGH | Engagement-based ranking; reviews from genuine support moments |
| 5 | Shopify App Store ads | LOW | MED ($) | First-price auction — you pay your full bid; start $1–5 research CPCs |
| 6 | Launch platforms (Product Hunt, Indie Hackers, directories) | LOW | LOW-MED (spike) | See cowork-playbook Mission E |
| 7 | Facebook groups (Shopify Entrepreneurs ~117k) + Discord (Talk Shop) | MED | MED | Go through admins — buy/negotiate sanctioned posts, don't guerrilla post |
| 8 | Agency/affiliate program (25–30% recurring) | MED | MED-HIGH (6mo+) | Pitch PPC freelancers + Fiverr GMC fixers to white-label your scan |
| 9 | YouTube collabs + own demo videos | MED | MED | Target Shopify-SEO/dropshipping channels, not suspension agencies (competitors) |
| 10 | Newsletters (Shopifreaks, DTC) | LOW | LOW-MED | Pitch the category-formation story |

### 12-week roadmap

**Weeks 1–2 — Foundation**
- Ship listing upgrade (copy + assets per [app-store-listing.md](app-store-listing.md))
- Product: free first Basic scan; review-moment prompt
- Set up Shopify Community profile (signature) + aged Reddit account begins helpful-comment history
- Publish case study #1 (mobilecasez) on a simple blog
- Set up the demo dev store with seeded issues (also required for listing review)

**Weeks 3–4 — Community presence**
- Daily Shopify Community patrol (15 min/day — playbook Mission A)
- Reddit: continue karma building; zero promotion yet
- Publish pillar post #1: "Why 90% of Shopify GMC suspensions are Misrepresentation — the full self-audit checklist"
- Free public scan page live
- Offer "free scan for first 20 stores" on Shopify Community Ask-and-Offer board → seeds case studies + first reviews

**Weeks 5–6 — First spike**
- Reddit teardown post: "I analyzed 50 suspended Shopify stores — the 7 things Google's misrepresentation bot actually checks" (no links; app mentioned only when asked)
- Publish pillar post #2: "How long does a GMC appeal take" (3–7 day reviews, 7-day cool-downs, 1–3 attempts — every thread asks this; it sells the appeal-letter feature: "you may only get 1–3 appeals — make the letter count")
- YouTube video #1: screen recording of a real scan + one-click fix
- Directory drumbeat continues (one/week: Uneed → Fazier → Peerlist → MicroLaunch — playbook E1); X/LinkedIn build-in-public threads ongoing (playbook E4) to bank 200+ genuine supporters for Product Hunt

**Weeks 7–8 — Compounding + launch prep**
- Newsletter pitches (Shopifreaks, DTC) with the category-formation angle
- At ~10 reviews: turn on App Store ads — research phase, $1–5 broad CPCs on 10+ terms
- Prepare Product Hunt assets (thumbnail, 4–6 gallery images, 30–90s video, maker first-comment story)
- **Product Hunt launches in weeks 8–12, gated on 10+ Shopify reviews + 2–3 named case studies** (PH traffic is non-merchant; its value is the badge/backlinks/partner inbound, and it converts on social proof — full runbook in playbook E2). Show HN once, free-scanner/data angle only (E3)

**Weeks 9–12 — Compounding**
- Programmatic SEO: one page per suspension reason/policy mirroring your scan's issue taxonomy
- Dropshipper-segment content ("suspended AGAIN after reinstatement — breaking the loop") — the most-suspended, most-willing-to-pay cohort; maps to the Monitoring upsell
- Concentrate ad spend on exact-match winners from research phase
- At ~100 installs: launch affiliate program (25–30% recurring via Rewardful); begin agency outreach with case studies
- FB group admin partnerships (sanctioned posts/AMAs)

---

## 6. Content/SEO plan

**Pillar pages (one per crisis phrase family; always include "Shopify" in the title):**
1. "Google Merchant Center suspended for Misrepresentation — the Shopify fix" *(head term)*
2. "Merchant Center suspension appeal — template + how long it takes"
3. "Products disapproved in Google Merchant Center — Shopify troubleshooting"
4. "Google Merchant Center stuck in pending initial review"

**Interactive asset:** "GMC Misrepresentation Checklist for Shopify" — competitors' checklists are static PDFs; yours ends with "run this checklist automatically" → free scan CTA.

**15 proven content topics** (forum-thread density verified): suspension reasons explained · appeal timelines/cool-downs · misrepresentation checklist · appeal letter template · new-store warm-up before connecting GMC · why dropshippers get suspended · all-products-disapproved diagnosis · GTIN/MPN missing identifiers on Shopify · feed-vs-page price mismatch · products not showing on Google Shopping · pending initial review · missing shipping value error · Google Shopping image requirements (→ Image Fixer) · suspended-again loop · official Google & YouTube app vs. compliance (why the official app can still get you suspended).

**YouTube:** 8+ competing videos rank for "fix google merchant center misrepresentation" with template/checklist hooks — all talking-head. A real screen-recording of ShopFlix scanning a suspended store and auto-fixing flagged issues outperforms them.

**SEO note:** never target bare "GMC" in Google (dominated by General Medical Council + GMC trucks); always pair with "merchant center / Google / Shopify / misrepresentation." Inside the App Store, "GMC" is unambiguous and valuable.

---

## 7. KPIs & measurement (weekly — Cowork Mission H)

| Metric | Source | Target trajectory |
|---|---|---|
| App Store search rank for the 5 terms | apps.shopify.com incognito searches | Page 1 for "misrepresentation" + "merchant center suspension" by week 6 |
| Review count & rating (yours + 5 competitors') | app listing pages | 10 reviews by week 8, 25 by week 12 — category leadership = ~30 |
| Installs (free→paid conversion) | Partner Dashboard | Track free-scan→paid upgrade % |
| Free public scans run | your DB | Lead-magnet health |
| Pillar-page impressions/clicks | Search Console | Compounding from week 6 |
| Ad CPI vs. plan LTV | App Store ads dashboard | CPI < 1 month of Professional ($17.99) initially |
| Built-for-Shopify progress | Partner Dashboard | 50 paid installs + 5 reviews + Web Vitals green |

---

## 8. Risks & guardrails

1. **Review-policy violations are existential** — incentivized reviews can delist the app. Never trade credits/discounts for reviews. Cowork must never DM-solicit reviews.
2. **Reddit bans are permanent** — 90/10 rule, comment history first, disclosure always ("I build a tool in this space"). One removed post = stop and reassess.
3. **Listing rejection** — no stats, superlatives, testimonials, pricing-in-images (credits count as pricing — crop credit badges from screenshots). Rules 4.4.4/4.4.5 (real UI, no near-duplicate images) actively enforced.
4. **Outcome promises** — never "guaranteed reinstatement"; Google decides appeals, not us. Phrase as capability. This also protects against angry-merchant reviews.
5. **Competitor response** — ClearCheck/ComplianceGuard adding auto-fix is the main threat. Counter: review velocity + case studies + the appeal-letter/image-fixer combo they don't have.
6. **Agencies are competitors AND partners** — StubGroup/FeedArmy types monetize the same keywords. Don't pitch them; pitch the *small* PPC freelancers and Fiverr fixers who can white-label your scan.

---

## 9. Asset inventory

| Asset | Where | Status |
|---|---|---|
| App Store listing copy (name, subtitle, intro, details, bullets, search terms, pricing copy) | [app-store-listing.md](app-store-listing.md) | Ready to paste |
| Icon + feature image + 6 screenshot briefs with AI prompts & capture instructions | [app-store-listing.md](app-store-listing.md) | Briefs ready; capture via demo store |
| Demo video script + review-submission screencast requirements | [app-store-listing.md](app-store-listing.md) | Script ready |
| Cowork missions (community, Reddit, content, launches, partners, metrics) | [cowork-playbook.md](cowork-playbook.md) | Ready to execute |
| Case study #1 (mobilecasez) | blog (to create) | Material exists in scan history |
