# ShopFlix AI — Cowork Execution Playbook

> This file is written FOR an autonomous Cowork session with Chrome access. Each mission is self-contained: goal → exact steps → templates → hard rules → what to report back. Run ONE mission per session unless told otherwise. Strategy context lives in [PROMOTION_PLAN.md](PROMOTION_PLAN.md); listing copy/assets in [app-store-listing.md](app-store-listing.md).

## Standing rules (apply to EVERY mission — violations can get the app delisted or accounts banned)

1. **Always disclose affiliation** when mentioning the app anywhere: "I build ShopFlix AI, a tool in this space" (or the platform's equivalent). Never astroturf, never fake being a neutral merchant.
2. **Never solicit or incentivize reviews.** No DMs asking for reviews. No credits/discounts for reviews. (Shopify Partner Program violation → delisting.)
3. **Lead with genuinely useful help.** The product mention is secondary or absent; profiles/signatures do the selling.
4. **One warning = full stop.** If a mod removes a post or warns, stop activity on that platform and report back — do not retry or argue.
5. **Never paste merchant store URLs or scan results publicly** without their explicit permission in-thread.
6. **No outcome promises** anywhere: "drafts your appeal," never "gets you reinstated."
7. **Report format (end of every mission):** what was done (links), responses/metrics observed, anything blocked or risky, suggested next step.

---

## Mission 0 — Account & profile setup (run once, first)

1. **Shopify Community** (community.shopify.com): create/log into the account. Set profile bio: "Founder of ShopFlix AI — Google Merchant Center compliance & suspension recovery for Shopify ([app store link])". Add the signature if the account level allows it. Read the pinned Code of Conduct once: key rules — no contact info in replies, no bare app links in answers, announcements only on the "Ask and Offer" board.
2. **Reddit**: log into the brand-adjacent personal account (aged accounts only — a brand-new account that posts links gets shadow-banned). Join: r/shopify, r/ecommerce, r/PPC, r/googleads, r/SaaS, r/EntrepreneurRideAlong. **Read each subreddit's sidebar rules and note them in the report** (rule pages could not be fetched programmatically during research — manual verification required before any posting).
3. **X/Twitter + LinkedIn**: ensure the founder profile mentions ShopFlix AI with link.
4. Bookmark for weekly metrics (Mission H): the 5 App Store search URLs, competitor listing pages (list in Mission H).

---

## Mission A — Shopify Community patrol (recurring: daily, 15 min)

**Goal:** become the most helpful GMC-suspension answerer on the forum; the signature/profile converts.

**Steps:**
1. Search these queries, sort by newest, open threads from the last 48h with 0–3 replies:
   - `https://community.shopify.com/search?q=merchant%20center%20suspended`
   - `https://community.shopify.com/search?q=misrepresentation`
   - `https://community.shopify.com/search?q=products%20disapproved%20google`
   - `https://community.shopify.com/search?q=merchant%20center%20pending%20review`
2. For each: write a **specific diagnostic answer** using the 5-point checklist template below, personalized to whatever the OP shared (if they posted their URL, eyeball the store's footer/policies/contact page in a new tab and reference what you actually see).
3. **Do NOT link the app in the reply.** Do not post contact info. The profile does the selling.

**Answer template (adapt, never paste verbatim twice):**
> Misrepresentation suspensions are almost always store-level, not feed-level. Five things Google's review checks that trip most Shopify stores: (1) footer links to Privacy / Refund / Shipping / Terms / Contact visible on every page; (2) contact page with at least two of email / phone / physical address; (3) feed price exactly matching the product page price (currency apps often break this); (4) no fake-urgency widgets (countdown timers, "only 2 left" apps) — Google's bot reads these as deceptive; (5) policy pages with real substance, not 3-line placeholders. Fix all five before appealing — you only get a limited number of appeal attempts and rejected ones trigger cool-downs. [Then 1–2 sentences specific to their thread.]

**Monthly (not more):** one post on the **"Ask and Offer"** board — either the definitive checklist guide or a "free store scan for the first 20 stores in this thread" offer (deliver scans manually, ask happy merchants if their before/after may be used as a case study — never ask for reviews).

**Report:** threads answered (links), any replies/upvotes, merchants who engaged, case-study candidates.

---

## Mission B — Reddit (two phases — DO NOT skip phase 1)

**Phase 1 (weeks 1–3, recurring): karma & history building.** Goal: ≥ 90% of account activity is non-promotional (the 90/10 norm; mods check history).
1. Daily 10 min: sort r/shopify + r/PPC + r/googleads by new; answer 2–3 GMC/Google-Shopping questions helpfully with ZERO product mentions. Same diagnostic style as Mission A.
2. Search Reddit weekly for `merchant center suspended` (all subreddits, sort: new) and answer those too.
3. Track in the report: comments made, karma gained, any subreddit-specific promo rules observed (weekly promo megathreads, "no tools" rules, etc.).

**Phase 2 (week 4+, only after history exists):**
1. **The teardown post** (r/shopify or r/ecommerce, whichever rules allow): title `I analyzed 50 suspended Shopify stores — the 7 things Google's misrepresentation bot actually checks`. Body: genuinely useful breakdown (use the scan taxonomy: footer links, contact info, price mismatch, policy substance, fake scarcity, structured-data contradictions, image violations). **No links. No app name in the post.** Mention the app ONLY if asked in comments, with disclosure.
2. **Founder post** (r/SaaS / r/EntrepreneurRideAlong / r/indiehackers-adjacent): "I built an app that scans your Shopify store like Google's suspension bot — roast it." Honest build story, disclosure, link only where rules allow.
3. Comment-first conversion (ongoing): when an OP posts their suspended store URL, give a personalized mini-audit in the comment; end with one line: `(Disclosure: I build a GMC compliance tool — happy to run a full scan if useful.)`

**Hard rules:** never DM-pitch; never post the same content to two subs the same week; if a post is removed, stop posting (commenting can continue) and report.

---

## Mission C — App Store listing execution (run once + quarterly review)

1. In the Shopify Partner Dashboard → the app → Distribution/Listing: paste every field from [app-store-listing.md](app-store-listing.md) §1–9. **Verify the live character counters** (especially subtitle ~62 and details 500) and report the actual limits shown.
2. Build the demo dev store per §11 (seeded issues), run all three scans, leave results populated.
3. Capture the 6 screenshots per §10.3 protocol — real UI, 1600×900, **crop all credit badges**, no two alike. Assemble feature image per §10.2.
4. Upload assets; set demo store URL deep-linked to scan results; attach review screencast + test credentials (§10.5).
5. Submit for review. Report: submission confirmation, any field-limit mismatches, any review feedback.

---

## Mission D — Content publishing (recurring: 1 piece/week)

Publish on the marketing site/blog (create a simple blog if none exists — even /pages/ on a separate domain works; NOT on the app listing).

**Order of publication (from PROMOTION_PLAN §6):**
1. Case study #1: mobilecasez.com before/after (week 1)
2. Pillar: "Google Merchant Center suspended for Misrepresentation — the Shopify fix" — include the real appeal-letter template (week 2)
3. Interactive "GMC Misrepresentation Checklist for Shopify" ending in the free-scan CTA (week 3)
4. Pillar: "How long does a GMC appeal take — reviews, cool-downs, and your 1–3 attempts" (week 4)
5. Then one topic/week from the 15-topic list in PROMOTION_PLAN §6.

**SEO rules:** always include "Shopify" in titles; target one crisis phrase per page; mirror the suspension-email phrasing as an H1 where natural; internal-link every post to the free scan page. Stats (11.7M, 90% misrepresentation) are allowed and encouraged HERE (cite StubGroup) — just never in the App Store listing.

**Report:** URL published, target keyword, indexing status (submit to Search Console).

---

## Mission E — Launch platforms (research-verified mechanics, June 2026)

**Master sequencing (evidence-based):** App Store rank — the only channel with real buyer intent — is driven by recent reviews + install velocity. Launch-platform traffic is mostly non-merchants and converts on social proof. Therefore: **(1)** weeks 0–4 Shopify-native foundation (Missions A–D) until ~10 honest reviews exist → **(2)** weeks 2–8 directory drumbeat, one per week → **(3)** weeks 8–12 Product Hunt → **(4)** Show HN once, anytime, data-angle only → **(5)** Indie Hackers monthly forever → **(6)** Built for Shopify badge is the real "tier-2 launch" (+49% installs/14 days — beats every external platform) → **(7)** AppSumo deferred 6+ months, only with hard credit caps.

### E1 — Directory drumbeat (weeks 2–8, one per week, ~2h each; value = dofollow backlinks + small supporter graph)

| Order | Platform | Mechanics | Cost |
|---|---|---|---|
| 1 | **Uneed** (uneed.best) | 20–30 products/day launch at 12:00 AM PST; top-3 daily get badge + ~7.4K-subscriber newsletter mention; permanent listing + lifetime backlink regardless | Free queue, or $30–40 to pick your date — pay it |
| 2 | **Fazier** (fazier.com) | PH-style 24h daily launches, manually moderated, top-3 daily badge, DR ~81 dofollow | Free if you add their badge to your site; $39 premium |
| 3 | **Peerlist Launchpad** | **Mondays only** (12:00am–11:59pm UTC); must launch from an INDIVIDUAL founder profile (company avatars banned); zero tolerance for DM upvote-begging | Free |
| 4 | **MicroLaunch** | Month-long launch window, no 24h sprint; micro-SaaS audience | Free |
| 5 | BetaList | Only if framed as "recently launched"; own domain required; free review takes weeks, paid is refunded on rejection | Optional |

Expected per directory: 50–500 visits, 0–10 installs, one permanent backlink. Don't over-invest.

### E2 — Product Hunt (weeks 8–12, ONLY once 10+ Shopify reviews + 2–3 named case studies exist)

**Reality check:** only ~10% of launches get "featured" (homepage); non-featured ≈ quiet day. PH audience = founders/marketers, not merchants — the prize is the badge, backlinks, newsletter pickup, and partner inbound. Proof Shopify apps can win: Chargeflow hit #1 Product of the Day (Sept 2025, 498 upvotes).

**Runbook:**
1. **Self-launch** (no hunter — PH confirms zero algorithmic advantage; PAYING a hunter or for traffic = permanent ban risk).
2. Schedule **12:01 AM PST**; Tue–Thu for max traffic if contending, weekend for an easier badge.
3. Assets: high-contrast thumbnail; 4–6 gallery images (reuse listing screenshots); **30–90s demo video** (every #1 in a 15-launch study had one); maker first comment = honest origin story ("my own store got suspended — I built the tool I needed"), what it does, how to try it free.
4. Tagline options (pick one):
   - `Fix Google Merchant Center suspensions in one click`
   - `Scan your Shopify store the way Google does — then auto-fix what fails`
5. Supporter outreach (the 200+ genuine X/LinkedIn followers built via E4): message "we're live, would love your honest feedback" — **say "check it out," NEVER "upvote"** (coordinated-upvote detection: first 4h hide counts + track velocity; votes from accounts <1yr old count ~1/10th).
6. Maker stays in comments all day answering everything (comment density now outweighs raw upvotes).
7. Same-day cross-post on X + LinkedIn (3-post campaign format, E4).

**Expected if featured top-5:** 2,000–10,000 visitors, 1–3% signups, fewer real installs; ~70% traffic decay by day 2. Plan it as a social-proof harvest, not an install spike.

### E3 — Show HN (once, anytime; cost ≈ zero, expectations low)

Shopify-app Show HNs historically max out at 4–28 points — a commercial app pitch will sink. The ONLY viable angles:
- `Show HN: I built a crawler that audits Shopify stores the way Google Merchant Center does` — linking the **free no-signup scan tool** (must be tryable without signup, posted from a personal account).
- Or a data write-up: "What actually triggers GMC suspensions: data from N store scans."
Hard rules: never ask anyone to upvote/comment (HN flags voting rings); answer every comment technically; mention the paid app only if asked.

### E4 — X/Twitter + LinkedIn build-in-public (start week 2, ongoing — this feeds E2)

Audience = Shopify partner/dev ecosystem (affiliates, agencies, PH supporters), not suspended merchants. Formats that work (from analysis of ~3K viral SaaS launches — 3–5 post campaigns, not single posts):
1. **Receipts thread:** "This store had 47 disapproved products. Here's the scan, the 6 fixes, and the reinstatement email — 11 days." (use real case studies, with permission)
2. **Data thread:** "We scanned N Shopify stores like Google does. Top 5 reasons GMC suspends them — #1 is the footer."
3. **LinkedIn carousel:** "Anatomy of a GMC appeal letter that worked."
Tags: @ShopifyDevs, #ShopifyDevs, #shopifypartners, #buildinpublic. Goal: 200+ genuine followers before PH day. No engagement pods, no fake revenue screenshots.

### E5 — Indie Hackers (monthly, evergreen)

1. Create the product page in the IH products directory now (optionally Stripe-verified).
2. **Comment usefully for 1–2 weeks first** — the anti-spam filter throttles accounts under ~10 karma.
3. Post monthly with real numbers only: "My Shopify GMC-suspension app passed $X MRR — what worked," pricing-experiment write-ups, the suspension-checklist teardown. Norm: "treat it like a room, not a launch channel."

### E6 — AppSumo (deferred 6+ months — decision gate, not a task)

Credits-based AI app = riskiest lifetime-deal shape (LTD buyers consume Gemini/Puppeteer costs forever). Only consider after subscription pricing is validated AND AI unit costs are measured. If ever done: "Lifetime Pro, hard-capped at X credits/month (not banked)," $49–79 price point, knowing: rev share = you keep ~95% on net-new / ~70% on existing AppSumo customers; pulling the listing within 120 days can void payments. Expect a cash spike + permanent support/COGS tail.

---

## Mission F — Facebook groups & Discord (recurring: weekly, via admins)

1. Join: "Shopify Entrepreneurs" (HeyCarson, ~117k), Nick Peroni's "Ecom Empires" (~94k), Spocket's dropshipping community (~54k); Discord: "Talk Shop", Mavenport.
2. **Do not link-drop.** Week 1–2: answer GMC questions helpfully (Mission A style).
3. **Admin route:** message each group's admin: offer (a) a free extended scan for members as an exclusive perk, (b) a sponsored/sanctioned post or AMA — HeyCarson sells promo slots; ask pricing. Report quotes back before committing spend.
4. Weekly value post where rules allow: "This week's most common GMC rejection I've seen + the 2-minute fix."

---

## Mission G — Partners & affiliates (start ~week 9, after case studies exist)

1. Stand up the affiliate program (Rewardful or PartnerStack), 25–30% recurring (matches Tidio/Stamped benchmarks).
2. Outreach list to build in a sheet (20+ each): (a) Fiverr/Upwork sellers offering "fix GMC suspension" gigs ($25–$100 — they can white-label the scan as their audit tool); (b) small Google Ads/PPC freelancers & micro-agencies; (c) Shopify agencies in the Partner Directory; (d) mid-size YouTubers covering Shopify SEO/dropshipping (NOT suspension agencies — they're competitors).
3. Email template (personalize the first line per recipient):
   > Subject: white-label store scan for your GMC clients
   > Hi [name] — saw your [gig/video/post] on [specific thing]. I build ShopFlix AI, a Shopify app that scans stores the way Google's review does and auto-fixes compliance issues (policy pages, footer links, contact info) plus drafts reinstatement appeals. Two ideas: (1) use it as your audit step — takes the manual checking off your plate; (2) 25–30% recurring on anyone you refer. Want a free account to test on a client store?
4. Track in a sheet: contacted / replied / testing / live. Report weekly counts.

---

## Mission H — Weekly metrics report (recurring: every Monday)

Collect and report in one table:
1. **App Store rank** — incognito search on apps.shopify.com for each: `google merchant center`, `merchant center suspension`, `misrepresentation`, `gmc`, `google shopping fix`; record ShopFlix position (or absent) + page-1 leader.
2. **Reviews** — count + rating for ShopFlix and competitors: ClearCheck (`apps.shopify.com/gmc-compliance-tool`), ComplianceGuard AI (`apps.shopify.com/complianceguard-ai`), Complify (`apps.shopify.com/complify`), GMC Store Readiness Scanner (`apps.shopify.com/gmc-store-readiness-scanner`), ShieldKit Google Merchant Fix, Merchant Guard. Flag any that shipped auto-fix/appeal features (our moat).
3. **Installs / conversions** — from the Partner Dashboard.
4. **Content** — Search Console clicks/impressions for pillar pages; free-scan page usage.
5. **Community** — threads answered, Reddit karma, replies received, case-study pipeline count.
6. One paragraph: what's working, what to change next week.
