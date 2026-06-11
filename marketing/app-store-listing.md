# ShopFlix AI — Shopify App Store Listing Kit

> Ready-to-paste copy + asset briefs. Character limits verified against shopify.dev (June 2026):
> name ≤ 30 · subtitle ~62 (practitioner-verified — confirm the live counter in the Partner Dashboard) · intro = 100 · details = 500 · bullets ≤ 80 each · search terms = 5 max · integrations ≤ 6.
>
> **Hard listing rules (rejections):** no statistics/data claims · no "best/only/first/#1" · no testimonials · no pricing in ANY image (⚠️ credit badges in our UI count — crop them) · every image must primarily show real app UI (4.4.4) · no two near-identical images (4.4.5) · no Shopify logos · subtitle must read as value, not keyword stuffing (4.4.1).

---

## 1. App name (≤ 30 chars — brand first, per Shopify guidance)

**Recommended:** `ShopFlix: GMC Suspension Fix` *(28 chars — carries "GMC", "suspension", "fix": the 3 highest intent-to-competition keywords)*

Alternatives:
- `ShopFlix AI: GMC Compliance` *(27)*
- `ShopFlix: Merchant Center Fix` *(29)*

## 2. Subtitle / app card tagline (~62 chars)

**Recommended:** `Fix Google Merchant Center errors & appeal suspensions` *(54 chars — value summary, carries the full "Google Merchant Center" phrase)*

Alternative (exactly at the 62 limit — use only if the counter allows): `Fix Google Merchant Center issues & recover suspended accounts`

## 3. App introduction (100 chars)

`Get products approved on Google. Scan your store, fix GMC issues in one click & appeal suspensions.` *(99 chars)*

## 4. App details (500 chars — verify counter on paste)

Recommended (483 chars — leads with the wedge + keywords, includes AI import):

```
Google approves stores, not just feeds. ShopFlix AI scans your storefront the way Google's review does — policies, contact info, product data, images & trust signals — then fixes issues in one click. Suspended? It diagnoses the cause, builds a fix checklist, and drafts your reinstatement appeal. Plus: import products from Amazon, eBay & AliExpress with AI-written SEO descriptions and categories, ready to sell. Always-on monitoring alerts you before issues become suspensions.
```

Alternative (490 chars — import-first):

```
Import products from Amazon, eBay, AliExpress & any URL in a few clicks — ShopFlix AI auto-writes SEO descriptions, assigns categories, and makes each listing Google Merchant Center-ready. It also scans your storefront like Google's review does — policies, contact info, product data, images & trust signals — and fixes issues in one click. Suspended? It diagnoses the cause, builds a fix checklist, and drafts your reinstatement appeal. Always-on monitoring catches new issues early.
```

## 5. Feature bullets (≤ 80 chars each)

1. `Basic, Advanced & Deep scans find what blocks Google approval` *(61)*
2. `One-click AI fixes: policy pages, footer links, contact info` *(60)*
3. `Suspension Recovery: diagnosis, fix checklist & appeal letter draft` *(67)*
4. `AI Image Fixer: clean white backgrounds, no watermarks or promo text` *(68)*
5. `Always-on monitoring emails you only when a new issue appears` *(61)*
6. `AI product import: paste a URL, get a complete Shopify product` *(62)*

## 6. Search terms (exactly 5 — complete words)

```
google merchant center
merchant center suspension
misrepresentation
gmc compliance
google shopping fix
```

Rationale: "misrepresentation" has **7** competing apps; "suspension" ~15, all under 40 reviews; "google merchant center" (959 results) is the volume term where no page-1 app positions on compliance. Deliberately NOT using "google shopping feed" (2,853 apps, incumbents with 4,000+ reviews).

## 6b. Web search content (Google SEO for the listing page)

These fields control how the apps.shopify.com listing appears in GOOGLE results — the 2am crisis search, not App Store search.

**Title tag (≤60 chars):**
```
Fix Google Merchant Center Suspension & Misrepresentation
```
*(57 chars — matches both top crisis families. Alternate, 56: `Google Merchant Center Suspension Fix for Shopify Stores`)*

**Meta description (~155 chars):**
```
Suspended or products disapproved? ShopFlix AI scans your Shopify store like Google does, fixes GMC issues in one click & drafts your reinstatement appeal.
```
*(155 chars — opens with the reader's situation; covers suspended + disapproved-products clusters. Alternate, 151: `Fix Google Merchant Center suspension & misrepresentation on Shopify. AI scans your store like Google's review, one-click fixes & appeal letter drafts.`)*

## 7. Integrations list (≤ 6)

`Google Merchant Center, Google Shopping, Gmail (alerts), Google Search Console` — list only what's real; minimum: `Google Merchant Center, Google Shopping`.

## 8. Categories

Primary: **Marketing > SEO** (where SearchPie/Booster live). Secondary: **Selling on other channels > Google**. Verify available picks in the dashboard.

## 9. Pricing display copy (plan descriptions in the listing)

| Plan | Price | Listing copy |
|---|---|---|
| Free | $0 | `2 credits to try AI fixes. Run your first store scan free.` *(pair with the free-first-scan product change)* |
| Starter | $4.99/mo | `20 credits/mo — scans, AI fixes & product imports` |
| Basic | $9.99/mo | `50 credits/mo — full scan suite + auto-fix + monitoring` |
| Professional | $17.99/mo | `100 credits/mo — everything + Deep suspension audits` |
| Advanced | $24.99/mo | `150 credits/mo — agencies & multi-issue recovery` |
| Enterprise | $99/mo | `999 credits/mo — high-volume stores & full automation` |

⚠️ Never put pricing/credit numbers inside images. Plan names: "Basic plan" vs "Basic scan" collision — consider renaming tiers later.

---

## 10. Visual assets

### 10.1 App icon — 1200×1200 PNG
- Logo artwork fills ~750px (max 900px) of canvas; keep a 75px outer margin empty; **square corners** (Shopify rounds them); **no text**, no screenshots, no Shopify marks.
- Concept: shield + checkmark over a stylized storefront, brand gradient `#1a4a5a → #2A5B6D` (the app's email-header gradient), white/light mark.
- AI-generation prompt:
  > Minimal flat vector app icon, a bold shield containing a checkmark merged with a small storefront awning silhouette, deep teal gradient background from #1a4a5a to #2A5B6D, white iconography, centered composition with generous empty margin on all sides, no text, no letters, modern SaaS icon style, crisp edges, 1:1
- Export 1200×1200, verify the mark stays inside the center 900px.

### 10.2 Feature image — 1600×900 (16:9)
- Must primarily show real app UI; do NOT repeat the subtitle text; no Shopify logos; no pricing.
- Concept: the GMC Compliance Fix page (3 scan cards + a results list with severity badges) on a clean teal-gradient backdrop, short headline top-left: **"Scan it like Google does. Fix it in one click."** (different wording than subtitle — required).
- Build: real screenshot (see capture protocol) placed on gradient in Figma/Canva; headline in Inter/SF Bold white.

### 10.3 Gallery screenshots — 6 × 1600×900 desktop (3–6 recommended; one mobile 900×1600 optional)

**Capture protocol (Cowork can do this in Chrome):**
1. Use the demo dev store (Section 11) with seeded issues; open the embedded app.
2. Set browser viewport so the app canvas exports at 16:9; capture WITHOUT browser chrome (use full-page screenshot of the iframe area, then crop to 1600×900).
3. **Crop/avoid any credit-count badges** ("10 Credits" etc. = pricing in images = rejection) and any real merchant PII.
4. Every screenshot must be a *different* screen/state — no near-duplicates (4.4.5).
5. Text overlay captions allowed if UI stays the primary content: caption bar ≤ 15% of height, brand teal background, white text.

| # | Screen (real UI) | Overlay caption |
|---|---|---|
| 1 | GMC Compliance Fix page: Basic/Advanced/Deep cards + scan results with severity badges | `See your store the way Google's review sees it` |
| 2 | An IssueCard mid-flow: issue → "Auto-Fix" → fixed state visible | `Fix compliance issues in one click` |
| 3 | Suspension Recovery: diagnosis + priority checklist + appeal letter in the rich-text editor | `Diagnose suspensions & draft your appeal` |
| 4 | Protect & Grow: Image Fixer panel with a before/after product image | `Make product images Google-compliant` |
| 5 | Monitoring panel: schedule config + "email only on new issues" state | `Catch new issues before Google does` |
| 6 | AI Product Import: URL pasted → extracted product fields | `Import any product with AI` |

### 10.4 Demo/promo video (optional but recommended) — 2–3 min
- Tone: promotional, not instructional; **raw screencast ≤ ~25% of runtime**; rest = motion graphics/captions.
- Script skeleton (90s version):
  1. (0–10s) Hook: the suspension email on screen — *"Your Google Merchant Center account is suspended."*
  2. (10–25s) Problem: "Your feed app did its job. The problem is your store."
  3. (25–55s) Scan montage (screencast budget): scan runs → issues found → one-click fix creates a policy page live.
  4. (55–75s) Suspension Recovery: checklist + appeal letter draft appears.
  5. (75–90s) Monitoring + logo + "ShopFlix AI on the Shopify App Store."

### 10.5 App-review submission package (gates approval)
- Screencast demonstrating onboarding + each scan + an auto-fix, English narration or subtitles (rule 4.5.3).
- Working test credentials in the review instructions (4.5.4).
- Demo store URL field: deep-link to the scan-results page (best-functionality page).

---

## 11. Demo dev store (required for review + screenshots)

Create a development store seeded with deliberate issues so scans show rich results:
- Remove footer policy links; delete the refund-policy page; strip contact info from the contact page.
- 3–5 products: one missing GTIN/MPN, one missing description, one with `compare_at_price ≤ price` (deceptive pricing), one with a watermarked image.
- Install the app → run all three scans → leave results populated for screenshots and the review team.
- Keep a second clean copy of one product to demo the Image Fixer before/after.

---

## 12. What is deliberately EXCLUDED from this listing (and why)

- ❌ "11.7M accounts suspended in 2024" — stats are forbidden in listings (4.3.3). Use on the blog/socials.
- ❌ "60+ checks" — same rule. Website/blog only.
- ❌ Merchant quotes — testimonials forbidden in listings (4.3.7). Use on the website.
- ❌ "Get reinstated" as a promise — Google decides appeals; phrase as capability ("drafts your appeal").
- ❌ Credit costs anywhere in images.
