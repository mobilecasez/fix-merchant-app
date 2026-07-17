import type { LinksFunction, MetaFunction } from "@remix-run/node";
import siteStyles from "../website/site.css?url";

/**
 * shopflixai.com/features — SERVER-RENDERED marketing page for the profit-optimization +
 * AI Google Ads platform. Fully server-rendered (no client-only SPA fallback) so crawlers and
 * Google Ads get the complete HTML instantly. Self-contained styles; only borrows the self-hosted
 * fonts from site.css.
 */

const SITE = "https://shopflixai.com";
const APP = "https://apps.shopify.com/shopflix-ai";
const OG_IMAGE = `${SITE}/web-assets/app-scan.png`;

// ── Copy (kept in one place for easy iteration) ─────────────────────────────
const TITLE = "Shopify Profit Analytics & AI Google Ads | ShopFlix AI";
const DESCRIPTION =
  "See per-product profit, breakeven ROAS & real Google Ads spend on every product. Turn insights into live Performance Max campaigns in one click.";
const H1 = "Know your real profit. Then advertise only what makes money.";
const SUBHEAD =
  "ShopFlix AI analyses 100% of your Shopify catalogue — never a sample — for true per-product profit, margin and breakeven ROAS, then builds and launches optimised Google Ads Performance Max campaigns from the analysis.";

const FAQS: { q: string; a: string }[] = [
  { q: "How does ShopFlix AI calculate profit for each product?", a: "It uses your real Shopify cost-per-item combined with sessions, orders, conversion rate, actual attributed Google Ads spend, delivered revenue, and shipping plus RTO/return cost to compute per-product profit or loss, margin %, and contribution margin. Every product in your catalogue is analysed deterministically in code — nothing is sampled or skipped, and coverage is verified so no product is missed." },
  { q: "What is breakeven ROAS and does ShopFlix calculate it per product?", a: "Breakeven ROAS is the minimum return on ad spend a product needs before it starts losing money, calculated as 1 divided by its contribution margin. A store-wide breakeven ROAS is a fiction because a 55%-margin item and a 30%-margin item don't share a breakeven point. ShopFlix computes breakeven ROAS per product from your real Shopify unit cost, giving you the exact pause-or-scale anchor for every SKU, not a blended average." },
  { q: "Can ShopFlix create Google Ads or Performance Max campaigns automatically?", a: "Yes. The AI Google Ads Campaign Builder reads your profit report and designs a feed-only Performance Max structure — Core Winners, Hidden Gems, Testing, and Catch-all — with budget splits, a conversion-volume campaign ladder, a tROAS ladder, and search themes. One click creates the real campaigns in your Google Ads account, created paused for review. It hard-excludes ad bleeders, margin-impossible, and out-of-stock products from every campaign." },
  { q: "How is this different from TrueProfit, BeProfit, or Triple Whale?", a: "Those tools focus on store-wide net-profit dashboards. ShopFlix screens 100% of your catalogue into named action buckets, computes breakeven ROAS per product, and surfaces India-first per-product RTO/COD profit that most Western tools don't expose. Critically, it closes the loop: it turns a profit insight into a live Google Ads campaign in one click, rather than just reporting numbers." },
  { q: "Which of my Shopify products are losing money on ads?", a: "The AI Profit Advisor deterministically buckets every product into Ad Bleeders (spend but no sales), RTO Leaks, True Drains, Margin Impossible (real unit cost proves every sale loses money), Loss Leaders, and Zombies — plus upside buckets like Scale Winners, Hidden Gems, Raise Price, and Price Tests. Each recommendation cites the exact numbers and shows dual impact: revenue given up versus profit gained." },
  { q: "Does it account for RTO and COD returns for Indian stores?", a: "Yes. ShopFlix detects RTO and return cost per product, because a returned COD order eats forward shipping, reverse shipping, and the ad spend that acquired it. This India-first RTO/COD profit intelligence surfaces per-product losses that store-wide profit tools miss entirely, so you can see which products quietly bleed margin on every return." },
  { q: "Does ShopFlix still fix Google Merchant Center suspensions?", a: "Yes — that remains a core strength. It runs a free store scan against live Google Merchant Center policies and offers one-click fixes for policy pages, product feeds, contact info, and navigation, plus guidance for recovering from misrepresentation and other suspensions. You keep the compliance layer while gaining full profit and Google Ads optimization." },
  { q: "What Google Merchant Center problems can ShopFlix fix in one click?", a: "It generates and links the required policy pages (refund, privacy, terms, shipping and contact), fills missing feed attributes like GTIN, brand, condition and availability, researches barcodes for products that lack a GTIN, cleans images that break Merchant Center image policy, and repairs contact-info and navigation gaps that trigger 'untrustworthy store' flags. For accounts already suspended, it drafts a misrepresentation recovery plan targeting the exact fixes Google reviewers look for." },
  { q: "Can ShopFlix import products and write SEO product descriptions?", a: "Yes. Paste a product or supplier URL and ShopFlix AI builds a complete, Google-ready Shopify product — an SEO-optimized title and description, the correct Google product category, a researched GTIN, and cleaned images. You can import a single product or run a bulk 'process all' pass to rewrite and optimize hundreds of existing products at once, so your catalogue is both search-friendly and Merchant-Center-compliant." },
  { q: "Is the profit analysis based on real data or AI guessing?", a: "It is grounded entirely in your live Shopify and Google Ads data. The catalogue screening runs deterministically in code with guaranteed, verified coverage — never AI sampling and never stale AI world-knowledge (so no 'wait for launch' hallucinations). Every recommendation cites the exact contribution margin, breakeven ROAS, and profit numbers behind it, with a rich card-based PDF export." },
  { q: "My store was suspended for Misrepresentation even after I fixed everything — why?", a: "Because most scanners only check whether pages exist, while Misrepresentation is enforced on your business's identity and consistency — the layer below what a page-scanner reads. ShopFlix AI's Deep scan adds a Trust & Identity layer that catches the real triggers: a registered-agent / mail-drop business address, a brand name implying a country you don't operate in, a brand-new or privacy-masked domain, overseas fulfillment concealed behind a local identity, inconsistent name/address/phone (NAP), and contradictions between your own policy pages. Those are the signals that keep a 'clean' store suspended." },
  { q: "What is the Trust & Identity scan and what does it check?", a: "It is a deep, business-legitimacy audit that predicts Misrepresentation suspensions. It checks six things page-presence scanners miss: (1) whether your business address is a shared registered-agent / mass-incorporation mail-drop, (2) whether your brand name implies a location your address, phone, currency and domain don't support, (3) domain age and WHOIS privacy, (4) whether your shipping or terms text admits overseas fulfillment behind a domestic identity, (5) NAP consistency across your storefront, contact and legal pages versus Merchant Center, and (6) contradictions between your own policy pages. Each finding comes with plain-English evidence and remediation steps." },
  { q: "Can ShopFlix AI help get my Google Merchant Center account reinstated?", a: "Yes. After a Deep scan, the Suspension Recovery tool diagnoses the most likely policy violation from your latest results, builds a prioritized fix-before-you-appeal checklist with the same one-click fixes as the scan, and drafts a professional reinstatement request letter you can edit and paste into Google's appeal form. Because Misrepresentation appeals are limited, it deliberately guides you to fix the underlying identity issues first — appealing before they're resolved almost always gets rejected." },
  { q: "Does the scan check every product or just a sample?", a: "Every product. The Advanced product-feed audit runs deterministically over your whole catalogue — missing GTIN/MPN/brand identifiers, feed-versus-storefront-versus-schema price and availability mismatches, image-policy violations, and deceptive compare-at pricing — grouped by violation type so you can fix them in bulk. Nothing is sampled or skipped." },
  { q: "How does AI product import keep me Merchant-Center-compliant?", a: "When you import from a URL or supplier link, ShopFlix AI assembles a complete, Google-ready product: an SEO title and description, the correct Google product category, a researched GTIN/barcode so Shopping accepts it, and cleaned images that meet image policy. You can import one product or run a bulk pass to rewrite and optimize hundreds of existing products, so your catalogue is search-friendly and compliant from day one." },
];

export const meta: MetaFunction = () => [
  { title: TITLE },
  { name: "description", content: DESCRIPTION },
  { name: "keywords", content: "Google Merchant Center suspension fix, GMC misrepresentation suspension, merchant center reinstatement, why store suspended after fixing, trust and identity scan, registered agent address suspension, brand geography merchant center, concealed fulfillment dropshipping suspension, NAP consistency Shopify, domain age WHOIS privacy merchant center, contradictory policy pages, GMC feed disapproved fix, GTIN finder Shopify, Google product category, AI product import Shopify, bulk product description generator, Shopify compliance scan, Shopify profit analytics app, breakeven ROAS per product, AI Google Ads Shopify app, Performance Max campaign builder Shopify, which Shopify products lose money, AI profit advisor Shopify" },
  { name: "robots", content: "index, follow" },
  { tagName: "link", rel: "canonical", href: `${SITE}/features` },
  { property: "og:type", content: "website" },
  { property: "og:site_name", content: "ShopFlix AI" },
  { property: "og:url", content: `${SITE}/features` },
  { property: "og:title", content: TITLE },
  { property: "og:description", content: DESCRIPTION },
  { property: "og:image", content: OG_IMAGE },
  { property: "og:image:width", content: "1600" },
  { property: "og:image:height", content: "900" },
  { name: "twitter:card", content: "summary_large_image" },
  { name: "twitter:title", content: TITLE },
  { name: "twitter:description", content: DESCRIPTION },
  { name: "twitter:image", content: OG_IMAGE },
  {
    "script:ld+json": {
      "@context": "https://schema.org", "@type": "SoftwareApplication", name: "ShopFlix AI",
      applicationCategory: "BusinessApplication", operatingSystem: "Shopify", url: `${SITE}/features`,
      description: DESCRIPTION, offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
  },
  {
    "script:ld+json": {
      "@context": "https://schema.org", "@type": "FAQPage",
      mainEntity: FAQS.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
  },
  {
    "script:ld+json": {
      "@context": "https://schema.org", "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE },
        { "@type": "ListItem", position: 2, name: "Features", item: `${SITE}/features` },
      ],
    },
  },
  {
    "script:ld+json": {
      "@context": "https://schema.org", "@type": "VideoObject",
      name: "ShopFlix AI — Fix Google Merchant Center, import products & grow profit on Shopify",
      description: "A 30-second tour of ShopFlix AI: fix Google Merchant Center suspensions with a Trust & Identity deep scan, import products with AI, find real per-product profit, and launch Google Ads — all from one Shopify app.",
      thumbnailUrl: [`${SITE}/web-assets/promo-poster.jpg`],
      uploadDate: "2026-07-15",
      contentUrl: `${SITE}/web-assets/shopflix-promo.mp4`,
      duration: "PT34S",
    },
  },
];

export const links: LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "stylesheet", href: siteStyles }, // self-hosted Space Grotesk + JetBrains Mono @font-face
];

// ── Page ─────────────────────────────────────────────────────────────────────
export default function Features() {
  return (
    <div className="fx">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <Bg />
      <Header />
      <main>
        <Hero />
        <TrustStrip />
        <VideoShowcase />
        <ProfitAdvisorSection />
        <PriceRadarSection />
        <CampaignSection />
        <ProductImportSection />
        <ComplianceSection />
        <ComplianceGrid />
        <ScanParametersSection />
        <ScreenshotGallery />
        <Differentiators />
        <AppPricingSection />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

function Bg() {
  return <div className="fx-bg" aria-hidden="true"><span className="glow g1" /><span className="glow g2" /><span className="glow g3" /><div className="grid-lines" /></div>;
}

function Header() {
  return (
    <header className="fx-header">
      <div className="fx-wrap fx-headin">
        <a href="/" className="fx-logo" aria-label="ShopFlix AI home">
          <span className="fx-logomark">◆</span> ShopFlix<span className="fx-ai"> AI</span>
        </a>
        <nav className="fx-nav">
          <a href="/">Home</a>
          <a href="/#how">How it works</a>
          <a href="/blog">Blog</a>
          <a className="fx-btn fx-btn-primary fx-btn-sm" href={APP} target="_blank" rel="noopener">Install free</a>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="fx-hero fx-wrap">
      <div className="fx-eyebrow">Profit intelligence + AI Google Ads for Shopify</div>
      <h1 className="fx-h1">{H1}</h1>
      <p className="fx-sub">{SUBHEAD}</p>
      <div className="fx-cta-row">
        <a className="fx-btn fx-btn-primary fx-btn-lg" href={APP} target="_blank" rel="noopener">Install on Shopify — free</a>
        <a className="fx-btn fx-btn-ghost fx-btn-lg" href="#profit-advisor">See how it works ↓</a>
      </div>
      <div className="fx-hero-mock"><ProfitReportMock /></div>
    </section>
  );
}

function VideoShowcase() {
  return (
    <section className="fx-wrap fx-video" id="video">
      <div className="fx-feyebrow center">See it in action</div>
      <h2 className="fx-h2 center">Everything ShopFlix AI does — in 30 seconds</h2>
      <div className="fx-video-frame">
        <video controls playsInline preload="metadata" poster="/web-assets/promo-poster.jpg">
          <source src="/web-assets/shopflix-promo.mp4" type="video/mp4" />
        </video>
      </div>
    </section>
  );
}

function TrustStrip() {
  const chips = [
    "100% of products screened — never sampled",
    "Breakeven ROAS per product",
    "Actual Google Ads spend, not estimates",
    "Insight → live campaign in one click",
    "RTO & COD profit intelligence",
  ];
  return (
    <div className="fx-wrap fx-trust">
      {chips.map((c) => <span className="fx-trust-chip" key={c}><span className="fx-tick">✓</span>{c}</span>)}
    </div>
  );
}

// ── Feature sections ─────────────────────────────────────────────────────────
function Section({ id, eyebrow, title, body, bullets, mock, reverse }: { id: string; eyebrow: string; title: string; body: string; bullets: string[]; mock: React.ReactNode; reverse?: boolean }) {
  return (
    <section id={id} className={"fx-feature fx-wrap" + (reverse ? " rev" : "")}>
      <div className="fx-feature-text">
        <div className="fx-feyebrow">{eyebrow}</div>
        <h2 className="fx-h2">{title}</h2>
        <p className="fx-body">{body}</p>
        <ul className="fx-bullets">
          {bullets.map((b) => <li key={b}><span className="fx-b-tick">→</span><span dangerouslySetInnerHTML={{ __html: b }} /></li>)}
        </ul>
      </div>
      <div className="fx-feature-mock">{mock}</div>
    </section>
  );
}

function ProfitAdvisorSection() {
  return (
    <Section
      id="profit-advisor"
      eyebrow="AI Profit Advisor"
      title="Every product, screened for true profit"
      body="The Profit Advisor deterministically sorts your entire catalogue — in code, not by AI sampling — into named action buckets, then writes a specific, numbers-backed plan for each. Coverage is guaranteed: every product is analysed and accounted for."
      bullets={[
        "Named buckets: <strong>Ad Bleeders, Winners, Hidden Gems, RTO Leaks, Raise Price, Margin Impossible</strong> and more",
        "Per-product <strong>contribution margin & breakeven ROAS</strong> from your real Shopify cost-per-item",
        "A profit <strong>waterfall</strong> shows exactly where the money goes — ads, shipping, returns, net",
        "Every action cites the exact figures and a <strong>dual-number impact</strong> (revenue given up vs profit gained)",
        "Grounded in your live data — <strong>no stale AI guesses</strong> — with a rich PDF export",
      ]}
      mock={<ProfitReportMock />}
    />
  );
}

function PriceRadarSection() {
  return (
    <Section
      id="price-radar" reverse
      eyebrow="Price Radar"
      title="A profit-and-loss grid for every product"
      body="See the full economics of each product in one row — sessions, orders, conversion, actual ad spend, revenue, shipping + return cost, and the profit or loss it really makes. Then let AI research the competitive market price and apply it in one click."
      bullets={[
        "Cost, revenue and <strong>profit/loss</strong> per product, with margin %",
        "<strong>Actual attributed Google Ads spend</strong> — not sessions × CPC guesswork",
        "India-first <strong>RTO / COD cost</strong> detection so returns can't hide",
        "AI <strong>competitive price research</strong> per product — apply with one tap",
        "Price history, bulk actions and CSV export",
      ]}
      mock={<PriceRadarMock />}
    />
  );
}

function CampaignSection() {
  return (
    <Section
      id="ai-campaigns"
      eyebrow="AI Google Ads Campaign Builder"
      title="From profit report to live Performance Max — in one click"
      body="The Campaign Builder reads your profit report and designs an optimal feed-only Performance Max structure, then creates the real campaigns in your Google Ads account. Money-losing products are excluded automatically; every campaign is created paused for your review."
      bullets={[
        "Winners, Hidden Gems, Testing and catch-all — with <strong>budget splits & target ROAS</strong>",
        "A <strong>conversion-volume ladder</strong> so a small account is never over-split into learning-stuck campaigns",
        "<strong>Bleeders, margin-impossible and out-of-stock products excluded</strong> from every campaign",
        "Bucket-complete: <strong>all</strong> your winners and gems, never a 10-product sample",
        "Suggested daily budget — created <strong>paused</strong>, fully editable in Google Ads",
      ]}
      mock={<CampaignMock />}
    />
  );
}

function ProductImportSection() {
  return (
    <Section
      id="product-import" reverse
      eyebrow="AI Product Import & SEO"
      title="Fill your catalogue — and make every listing sell"
      body="Paste a product URL or drop in a supplier link and ShopFlix AI builds a complete, Google-ready Shopify product for you: an SEO title and description, the correct Google product category, a researched GTIN, and clean images — one product or your whole catalogue in bulk."
      bullets={[
        "Import from a <strong>URL or supplier</strong> — the AI writes a conversion-focused title & description",
        "<strong>GTIN research</strong> finds the real barcode so Google Shopping accepts the product",
        "Auto-assigns the correct <strong>Google product category</strong> and key attributes",
        "<strong>Image fixer</strong> cleans backgrounds and meets Merchant Center image rules",
        "<strong>Bulk 'process all'</strong> — optimise hundreds of existing products in one run",
      ]}
      mock={<ImportMock />}
    />
  );
}

function ComplianceSection() {
  return (
    <Section
      id="compliance"
      eyebrow="Google Merchant Center"
      title="Get approved on Google Shopping — and stay approved"
      body="Where ShopFlix AI started, and still excels. A free scan checks your store against live Google Merchant Center policies, pinpoints exactly what's getting your feed disapproved or your account suspended, and fixes most of it in one click — from missing policy pages to feed attributes and misrepresentation triggers."
      bullets={[
        "Free full-store scan graded against <strong>live GMC policies</strong>, with a readiness score",
        "One-click <strong>policy pages</strong> — refund, privacy, terms, shipping & contact — created and linked",
        "<strong>Product-feed fixes</strong>: GTIN, missing attributes, titles and image requirements",
        "Repairs <strong>contact info & navigation</strong> gaps that trigger 'untrustworthy store' flags",
        "<strong>Suspension recovery</strong>: guided misrepresentation appeals to get reinstated",
      ]}
      mock={<ComplianceMock />}
    />
  );
}

function ComplianceGrid() {
  const items = [
    { i: "📄", t: "Policy pages", b: "Refund, privacy, terms, shipping & contact pages generated and linked in your footer." },
    { i: "🏷️", t: "Feed attributes", b: "GTIN, brand, condition, availability and category filled so products aren't disapproved." },
    { i: "🖼️", t: "Image compliance", b: "Detects promotional overlays and background issues that violate image policy, and fixes them." },
    { i: "🔎", t: "GTIN research", b: "Finds the correct barcode for products missing one, the #1 cause of feed rejections." },
    { i: "🧭", t: "Trust signals", b: "Contact details, working navigation and store info that Google checks for legitimacy." },
    { i: "🛟", t: "Suspension recovery", b: "Misrepresentation and policy-violation appeals, with the exact fixes reviewers look for." },
  ];
  return (
    <section className="fx-wrap fx-cg">
      <div className="fx-feyebrow center">Google compliance, covered</div>
      <h2 className="fx-h2 center">Every common reason a Shopify store gets disapproved — handled</h2>
      <div className="fx-cg-grid">
        {items.map((it) => (
          <div className="fx-cg-card" key={it.t}>
            <span className="fx-cg-i" aria-hidden="true">{it.i}</span>
            <div className="fx-cg-t">{it.t}</div>
            <p>{it.b}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Differentiators() {
  const items = [
    { t: "Guaranteed coverage", b: "Every product is screened and accounted for in code — the report can't silently skip a product. You act on the whole catalogue, not a sample." },
    { t: "Real numbers, not AI guesses", b: "The analysis is grounded in your live Shopify and Google Ads data. The AI writes the plan; the facts come from your store." },
    { t: "Breakeven ROAS per product", b: "The one metric that turns 'is this ad worth it?' into a hard yes/no — computed from your real costs, for every product." },
    { t: "Insight that acts", b: "You don't just get a report. One click turns it into live, correctly-structured Google Ads campaigns — with the losers left out." },
    { t: "Built for returns", b: "RTO and COD cost intelligence that Western profit tools skip — essential for stores where returns quietly erase margin." },
    { t: "Safe by default", b: "Campaigns are created paused, prices only change on Apply, and everything stays inside your own Shopify and Google Ads accounts." },
  ];
  return (
    <section className="fx-wrap fx-diff">
      <div className="fx-feyebrow center">Why ShopFlix AI</div>
      <h2 className="fx-h2 center">Analytics tools tell you what happened.<br />ShopFlix AI tells you what to do — and does it.</h2>
      <div className="fx-diff-grid">
        {items.map((it) => (
          <div className="fx-diff-card" key={it.t}>
            <div className="fx-diff-t">{it.t}</div>
            <p>{it.b}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section className="fx-wrap fx-faq">
      <div className="fx-feyebrow center">FAQ</div>
      <h2 className="fx-h2 center">Questions merchants ask</h2>
      <div className="fx-faq-list">
        {FAQS.map((f) => (
          <details className="fx-faq-item" key={f.q}>
            <summary>{f.q}<span className="fx-faq-plus">+</span></summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="fx-wrap fx-final">
      <div className="fx-final-card">
        <h2 className="fx-h2">Find the profit hiding in your catalogue</h2>
        <p className="fx-body">Install free, scan your store, and see your first per-product profit report. Turn it into optimised Google Ads campaigns whenever you're ready.</p>
        <div className="fx-cta-row center">
          <a className="fx-btn fx-btn-primary fx-btn-lg" href={APP} target="_blank" rel="noopener">Install on Shopify — free</a>
          <a className="fx-btn fx-btn-ghost fx-btn-lg" href="/">Scan your store first</a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="fx-footer">
      <div className="fx-wrap fx-footin">
        <div className="fx-logo"><span className="fx-logomark">◆</span> ShopFlix<span className="fx-ai"> AI</span></div>
        <div className="fx-foot-links">
          <a href="/">Home</a><a href="/features">Features</a><a href="/blog">Blog</a>
          <a href={APP} target="_blank" rel="noopener">Shopify App Store</a>
        </div>
        <div className="fx-foot-copy">© {new Date().getFullYear()} ShopFlix AI · Profit analytics & AI Google Ads for Shopify</div>
      </div>
    </footer>
  );
}

// ── GMC / Trust & Identity deep-dive: every parameter the scan validates ──────
const SCAN_LAYERS = [
  { tier: "Basic scan", tag: "Store-level", items: ["Refund/return, privacy, terms & shipping policy pages", "Contact information & multiple contact channels", "Footer navigation & required policy links", "HTTPS / secure checkout", "Broken links & placeholder ('coming soon') content", "Business legitimacy & 'untrustworthy store' flags"] },
  { tier: "Advanced scan", tag: "Product feed", items: ["Missing GTIN / MPN / brand identifiers", "Price & availability: feed vs storefront vs schema", "Image compliance — promo overlays, watermarks, 500×500", "Deceptive 'compare-at' / fake sale pricing", "Out-of-stock products still advertised", "Per-product violations grouped for bulk one-click fixes"] },
  { tier: "Deep scan", tag: "Misrepresentation", items: ["Structured-data (JSON-LD) price/availability mismatch", "Hidden fees / checkout price mismatch", "Fake scarcity, countdown timers & deceptive apps", "Payment & trust-badge presence", "Social proof & legitimacy signals", "Full manual-review-style suspension audit"] },
  { tier: "Trust & Identity", tag: "New · suspension predictor", items: ["Registered-agent / mail-drop business addresses", "Brand-implied geography vs real address/phone/currency", "Domain age & WHOIS-privacy risk", "Overseas fulfillment concealed behind a local identity", "NAP consistency across storefront, contact & legal pages", "Contradictions between your own policy pages"] },
];
function ScanParametersSection() {
  return (
    <section className="fx-wrap fx-cg" id="scan-parameters">
      <div className="fx-feyebrow center">What the scan validates</div>
      <h2 className="fx-h2 center">Every parameter Google checks — mapped to a fix</h2>
      <p className="fx-body center" style={{ maxWidth: 720, margin: "12px auto 0" }}>Most tools only verify that a page <em>exists</em>. Suspensions come from the layer below that — whether your business is truthful and consistent. ShopFlix AI scans all four layers, so you fix the real cause before Google finds it.</p>
      <div className="fx-layers">
        {SCAN_LAYERS.map((l) => (
          <div className="fx-layer-card" key={l.tier}>
            <div className="fx-layer-head"><span className="fx-layer-name">{l.tier}</span><span className="fx-layer-tag">{l.tag}</span></div>
            <ul>{l.items.map((it) => <li key={it}><span className="fx-tick">✓</span>{it}</li>)}</ul>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Real product screenshots ──────────────────────────────────────────────────
const SHOTS = [
  { src: "/app-shots/1-fix-merchant-center-suspensions.png", t: "GMC Compliance Fix", b: "Store-level, product-feed & Trust & Identity findings in clean collapsible cards." },
  { src: "/app-shots/5-ai-product-import.png", t: "AI Product Import", b: "Paste a URL → a complete, Google-ready product with SEO copy, category & GTIN." },
  { src: "/app-shots/2-ai-profit-advisor.png", t: "AI Profit Advisor", b: "Per-product profit, margin & breakeven ROAS across your whole catalogue." },
  { src: "/app-shots/3-price-radar-pnl.png", t: "Price Radar", b: "Competitive price research with sessions, orders & ad-cost P&L per product." },
  { src: "/app-shots/4-google-ads-campaigns.png", t: "Google Ads Campaigns", b: "Turn the profit report into live Performance Max campaigns in one click." },
];
function ScreenshotGallery() {
  return (
    <section className="fx-wrap fx-shots" id="screenshots">
      <div className="fx-feyebrow center">Inside the app</div>
      <h2 className="fx-h2 center">See it working</h2>
      <div className="fx-shots-grid">
        {SHOTS.map((s, i) => (
          <figure className={"fx-shot" + (i === 0 ? " fx-shot-wide" : "")} key={s.src}>
            <img src={s.src} alt={s.t + " — ShopFlix AI"} loading="lazy" />
            <figcaption><strong>{s.t}.</strong> {s.b}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

// ── App pricing (home card style via site.css .plan) ──────────────────────────
const APP_PRICING = [
  { name: "Free", price: 0, tagline: "2 credits", flag: "No card required", features: ["First Basic store scan free", "2 credits for AI imports & fixes", "Full compliance scan preview", "Upgrade anytime"] },
  { name: "Starter", price: 4.99, tagline: "20 credits / month", features: ["20 credits every month", "AI product imports", "Basic + compliance scans", "One-click auto-fixes"] },
  { name: "Basic", price: 9.99, tagline: "50 credits / month", features: ["50 credits every month", "Basic + Advanced scans", "Auto-fixes & image fixer", "Store monitoring"] },
  { name: "Professional", price: 17.99, tagline: "100 credits / month", pop: true, flag: "Most popular", features: ["100 credits every month", "Full scan suite incl. Deep scan", "Trust & Identity misrepresentation audit", "Suspension Recovery + appeal letters"] },
  { name: "Advanced", price: 24.99, tagline: "150 credits / month", features: ["150 credits every month", "Everything at scale", "Image fixes & monitoring", "Priority processing"] },
  { name: "Enterprise", price: 99, tagline: "999 credits / month", features: ["999 credits every month", "For high-volume stores & agencies", "All features unlocked", "Dedicated support"] },
];
function AppPricingSection() {
  return (
    <section className="fx-wrap fx-pricing" id="pricing">
      <div className="fx-feyebrow center">Pricing</div>
      <h2 className="fx-h2 center">Plans for every store</h2>
      <p className="fx-body center" style={{ maxWidth: 640, margin: "12px auto 0" }}>Start free. Credits refresh monthly and cover scans, one-click fixes, AI imports and recovery. Prefer a one-off? <a href="/pricing" style={{ color: "var(--accent)" }}>See pay-per-scan pricing →</a></p>
      <div className="fx-plan-grid">
        {APP_PRICING.map((p) => (
          <div className={"card card-hover plan" + (p.pop ? " plan-pop" : "")} key={p.name} style={{ padding: 22 }}>
            {p.flag ? <div className="plan-flag" style={p.pop ? undefined : { background: "var(--panel2)", color: "var(--accent)", border: "1px solid var(--line-strong)" }}>{p.flag}</div> : null}
            <div style={{ fontWeight: 700, fontSize: 16 }}>{p.name}</div>
            <div className="mono" style={{ fontSize: 12, color: "var(--faint)", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 4 }}>{p.tagline}</div>
            <div className="plan-price"><b style={{ fontSize: 30 }}>${p.price}</b><span>{p.price === 0 ? "free forever" : "/ month"}</span></div>
            <ul>{p.features.map((f) => <li key={f}><span className="fx-tick" style={{ color: "var(--green)" }}>✓</span>{f}</li>)}</ul>
            <a className={"btn btn-block " + (p.pop ? "btn-primary" : "btn-ghost")} href={APP} target="_blank" rel="noopener" style={{ textAlign: "center", textDecoration: "none", marginTop: "auto" }}>{p.price === 0 ? "Install free" : "Choose " + p.name}</a>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── App "screenshot" mockups (light UI inside the dark page) ──────────────────
function WinFrame({ label, accent, children }: { label: string; accent?: string; children: React.ReactNode }) {
  return (
    <div className="mk">
      <div className="mk-bar">
        <span className="mk-dot" style={{ background: "#FF5F57" }} /><span className="mk-dot" style={{ background: "#FEBC2E" }} /><span className="mk-dot" style={{ background: "#28C840" }} />
        <span className="mk-title" style={accent ? { color: accent } : undefined}>{label}</span>
      </div>
      <div className="mk-body">{children}</div>
    </div>
  );
}

function ProfitReportMock() {
  const chips = [
    { n: 762, l: "Ad bleeders", c: "#B42318", bg: "#FDE8E8" },
    { n: 42, l: "Winners", c: "#067647", bg: "#E6F4EF" },
    { n: 49, l: "Hidden gems", c: "#6941C6", bg: "#F4EBFF" },
    { n: 7, l: "RTO leaks", c: "#B54708", bg: "#FEF0E6" },
    { n: 4, l: "Margin impossible", c: "#FEE2E2", bg: "#7F1D1D" },
  ];
  return (
    <WinFrame label="AI Profit Advisor" accent="#5B21B6">
      <div className="rp-hero">Your #1 product by revenue ranks #6 by profit — a ₹31k/mo gap.</div>
      <div className="rp-strip">
        <span className="rp-check">✓</span>
        <b>All 1,393 products screened</b>
        <span className="rp-strip-sub">· 400 analysed individually · ad spend: actual (Google Ads)</span>
      </div>
      <div className="rp-chips">
        {chips.map((c) => <span className="rp-chip" key={c.l} style={{ color: c.c, background: c.bg }}>{c.n} {c.l}</span>)}
      </div>
      <div className="rp-wf-label">Where the money went</div>
      <div className="rp-wf">
        <span style={{ flex: "0 0 20%", background: "#F97066" }} />
        <span style={{ flex: "0 0 4%", background: "#F7B267" }} />
        <span style={{ flex: "0 0 3%", background: "#B54708" }} />
        <span style={{ flex: 1, background: "#12B76A" }} />
      </div>
      <div className="rp-wf-legend"><span><i style={{ background: "#F97066" }} />ad spend</span><span><i style={{ background: "#F7B267" }} />shipping</span><span><i style={{ background: "#12B76A" }} />net profit ₹2.65L</span></div>
      <div className="rp-sec red">
        <div className="rp-sec-h"><span className="rp-sec-t">Pause / Cut Ads — bleeding ad spend</span><span className="rp-pill red">HIGH</span></div>
        <div className="rp-act"><b>iPhone 17 Pro Max Clear Case</b> — Pause ads immediately.<div className="rp-imp">+₹848/mo profit (₹848 spend saved vs ₹0 revenue lost)</div></div>
      </div>
      <div className="rp-sec green">
        <div className="rp-sec-h"><span className="rp-sec-t">Scale Winners — put budget behind what earns</span><span className="rp-pill green">HIGH</span></div>
        <div className="rp-act"><b>S23 Ultra Smart View Case</b> — Raise budget to ~₹200/day.<div className="rp-imp">+₹25,700/mo revenue at 7.2 ROAS</div></div>
      </div>
    </WinFrame>
  );
}

function PriceRadarMock() {
  const rows = [
    { t: "S23 Ultra Smart View Case", s: "347", o: "18", c: "5.2%", ad: "₹2,430", rev: "₹16,790", pf: "₹13,690", up: true },
    { t: "iPhone 17 Pro Max Clear Case", s: "205", o: "0", c: "0%", ad: "₹471", rev: "₹0", pf: "−₹471", up: false },
    { t: "UAG Monarch Pro Rugged", s: "129", o: "6", c: "4.6%", ad: "₹640", rev: "₹8,940", pf: "₹6,210", up: true },
    { t: "iPhone 16 Pro Leather Case", s: "22", o: "3", c: "13.6%", ad: "₹0", rev: "₹4,197", pf: "₹3,980", up: true },
    { t: "Galaxy S24 Ultra Silicone", s: "118", o: "0", c: "0%", ad: "₹360", rev: "₹0", pf: "−₹360", up: false },
  ];
  return (
    <WinFrame label="Price Radar" accent="#0E9384">
      <div className="pr-kpis">
        <div className="pr-kpi"><span className="pr-kpi-l">Revenue</span><span className="pr-kpi-v">₹3,49,901</span></div>
        <div className="pr-kpi"><span className="pr-kpi-l">Total cost</span><span className="pr-kpi-v">₹84,290</span></div>
        <div className="pr-kpi hi"><span className="pr-kpi-l">Profit</span><span className="pr-kpi-v" style={{ color: "#067647" }}>₹2,65,611</span></div>
      </div>
      <div className="pr-tbl">
        <div className="pr-tr pr-th"><span>Product</span><span>Sess.</span><span>Orders</span><span>Conv.</span><span>Ad spend</span><span>Revenue</span><span>Profit</span></div>
        {rows.map((r) => (
          <div className="pr-tr" key={r.t}>
            <span className="pr-name">{r.t}</span><span>{r.s}</span><span>{r.o}</span><span>{r.c}</span><span>{r.ad}</span><span>{r.rev}</span>
            <span className="pr-pf" style={{ color: r.up ? "#067647" : "#B42318" }}>{r.pf}</span>
          </div>
        ))}
      </div>
      <div className="pr-foot"><span className="pr-ai">✦ AI price research</span> · each row shows true profit after ads, shipping & returns</div>
    </WinFrame>
  );
}

function CampaignMock() {
  const camps = [
    { n: "Core Winners", pct: 65, tr: "5.2", p: "41 products", c: "#12B76A", bg: "#EDF8F2" },
    { n: "Hidden Gems", pct: 20, tr: "5.8", p: "45 products", c: "#7C3AED", bg: "#F6F0FE" },
    { n: "Testing", pct: 10, tr: "auto", p: "31 products", c: "#93700A", bg: "#FEF8EA" },
    { n: "Catch-all", pct: 5, tr: "auto", p: "everything else", c: "#64748B", bg: "#F3F5F8" },
  ];
  return (
    <WinFrame label="AI Google Ads Campaign Builder" accent="#5B21B6">
      <div className="cm-top"><span className="cm-budget">₹3,000<small>/day</small></span><span className="cm-suggest">✦ AI-suggested budget · 4 campaigns · created paused</span></div>
      <div className="cm-split">{camps.map((c) => <span key={c.n} style={{ flex: `0 0 ${c.pct}%`, background: c.c }} title={c.n} />)}</div>
      <div className="cm-cards">
        {camps.map((c) => (
          <div className="cm-card" key={c.n} style={{ borderTop: `3px solid ${c.c}` }}>
            <div className="cm-card-h"><span className="cm-card-n">PMax — {c.n}</span><span className="cm-tier" style={{ color: c.c, background: c.bg }}>{c.pct}%</span></div>
            <div className="cm-card-meta"><span>tROAS {c.tr}</span><span>{c.p}</span></div>
          </div>
        ))}
      </div>
      <div className="cm-note">🔍 search themes · bleeders, out-of-stock & margin-impossible products excluded automatically</div>
    </WinFrame>
  );
}

function ImportMock() {
  const did = ["SEO title", "Description", "Category", "GTIN", "Image"];
  return (
    <WinFrame label="AI Product Import" accent="#5B21B6">
      <div className="im-src"><span className="im-src-l">Import from</span><span className="im-src-url mono">supplier.com/products/uag-monarch-pro</span><span className="im-go">✦ Generate</span></div>
      <div className="im-card">
        <div className="im-thumb" aria-hidden="true">🖼️</div>
        <div className="im-fields">
          <div className="im-title">UAG Monarch Pro Rugged Case — MagSafe, Galaxy S24 Ultra</div>
          <div className="im-desc">Military-grade drop protection with a slim MagSafe-compatible build. Five-layer …</div>
          <div className="im-tags">
            <span className="im-tag">Google cat: <b>Phone Cases</b></span>
            <span className="im-tag">GTIN <b className="mono">810070863241</b></span>
            <span className="im-tag ok">✓ image cleaned</span>
          </div>
        </div>
      </div>
      <div className="im-did"><span className="im-did-l">AI generated</span>{did.map((d) => <span className="im-did-chip" key={d}>✓ {d}</span>)}</div>
      <div className="im-foot">One product or your whole catalogue — bulk “process all” in a single run</div>
    </WinFrame>
  );
}

function ComplianceMock() {
  const items = [
    { s: "Fixed", t: "Refund & privacy policy pages created & linked", c: "#067647", bg: "#E6F4EF" },
    { s: "Fixed", t: "Contact info + business address in footer", c: "#067647", bg: "#E6F4EF" },
    { s: "Fixed", t: "Missing GTINs researched for 34 products", c: "#067647", bg: "#E6F4EF" },
    { s: "Review", t: "2 broken navigation links", c: "#B54708", bg: "#FEF0E6" },
    { s: "Appeal", t: "Misrepresentation recovery drafted", c: "#6941C6", bg: "#F4EBFF" },
  ];
  return (
    <WinFrame label="Merchant Center Scan" accent="#0E9384">
      <div className="co-head"><span className="co-score">92</span><div><div className="co-score-l">Compliance score</div><div className="co-score-s">Google Merchant Center readiness</div></div></div>
      <div className="co-list">
        {items.map((it) => (
          <div className="co-row" key={it.t}><span className="co-badge" style={{ color: it.c, background: it.bg }}>{it.s}</span><span className="co-t">{it.t}</span></div>
        ))}
      </div>
      <div className="co-cta">One-click fixes applied — feed ready for Google Shopping</div>
    </WinFrame>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const CSS = `
.fx{--bg:#070d19;--panel:rgba(255,255,255,.035);--line:rgba(141,180,230,.15);--line2:rgba(141,180,230,.28);--text:#eaf1fb;--muted:#93a6c4;--faint:#63799b;--teal:#20c5b0;--cyan:#41c6ee;--purple:#a98bff;--amber:#f3b155;--green:#48d597;position:relative;min-height:100vh;background:#070d19;color:var(--text);font-family:'Space Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden;line-height:1.5;}
.fx *{box-sizing:border-box;}
.fx a{color:inherit;text-decoration:none;}
.fx-wrap{width:100%;max-width:1120px;margin:0 auto;padding:0 22px;}
.fx-bg{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;}
.fx-bg .glow{position:absolute;border-radius:50%;filter:blur(90px);opacity:.5;}
.fx-bg .g1{width:520px;height:520px;background:radial-gradient(circle,#0e9384,transparent 70%);top:-160px;left:-120px;}
.fx-bg .g2{width:560px;height:560px;background:radial-gradient(circle,#5b21b6,transparent 70%);top:340px;right:-180px;opacity:.4;}
.fx-bg .g3{width:480px;height:480px;background:radial-gradient(circle,#41c6ee,transparent 70%);bottom:-120px;left:30%;opacity:.28;}
.fx-bg .grid-lines{position:absolute;inset:0;background-image:linear-gradient(rgba(141,180,230,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(141,180,230,.05) 1px,transparent 1px);background-size:56px 56px;mask-image:radial-gradient(ellipse 90% 60% at 50% 0%,#000 30%,transparent 75%);}
.fx main,.fx-header,.fx-footer{position:relative;z-index:1;}
/* header */
.fx-header{position:sticky;top:0;z-index:20;backdrop-filter:blur(14px);background:rgba(7,13,25,.72);border-bottom:1px solid var(--line);}
.fx-headin{display:flex;align-items:center;justify-content:space-between;height:64px;}
.fx-logo{font-weight:700;font-size:19px;letter-spacing:-.01em;display:inline-flex;align-items:center;gap:8px;}
.fx-logomark{color:var(--teal);font-size:15px;}
.fx-ai{color:var(--cyan);}
.fx-nav{display:flex;align-items:center;gap:26px;font-size:14.5px;color:var(--muted);}
.fx-nav a:hover{color:var(--text);}
.fx-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-family:inherit;font-weight:600;border-radius:11px;cursor:pointer;transition:transform .12s ease,box-shadow .2s ease,background .2s;white-space:nowrap;border:1px solid transparent;}
.fx-btn-sm{height:38px;padding:0 15px;font-size:13.5px;}
.fx-btn-lg{height:52px;padding:0 26px;font-size:16px;}
.fx-btn-primary{background:linear-gradient(135deg,#20c5b0,#12a3d6);color:#04121b;box-shadow:0 10px 30px -10px rgba(32,197,176,.6);}
.fx-btn-primary:hover{transform:translateY(-1px);box-shadow:0 14px 36px -10px rgba(32,197,176,.75);}
.fx-btn-ghost{background:rgba(255,255,255,.04);color:var(--text);border-color:var(--line2);}
.fx-btn-ghost:hover{background:rgba(255,255,255,.09);}
/* hero */
.fx-hero{padding:74px 22px 20px;text-align:center;}
.fx-eyebrow{display:inline-block;font-size:12.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--teal);background:rgba(32,197,176,.1);border:1px solid rgba(32,197,176,.25);padding:6px 14px;border-radius:999px;margin-bottom:22px;}
.fx-h1{font-size:clamp(34px,5.4vw,60px);line-height:1.05;font-weight:700;letter-spacing:-.025em;margin:0 auto 20px;max-width:16ch;background:linear-gradient(180deg,#fff 45%,#b8cce8);-webkit-background-clip:text;background-clip:text;color:#fff;}
.fx-sub{font-size:clamp(16px,1.9vw,20px);color:var(--muted);max-width:60ch;margin:0 auto 30px;line-height:1.55;}
.fx-cta-row{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;}
.fx-cta-row.center{justify-content:center;}
.fx-hero-mock{margin:52px auto 0;max-width:820px;}
/* trust */
.fx-trust{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;padding:34px 22px 8px;}
.fx-trust-chip{display:inline-flex;align-items:center;gap:8px;font-size:13.5px;color:var(--muted);background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:8px 15px;}
.fx-tick{color:var(--green);font-weight:800;}
/* feature sections */
.fx-feature{display:grid;grid-template-columns:1fr 1.08fr;gap:52px;align-items:center;padding:80px 22px;}
.fx-feature.rev .fx-feature-text{order:2;}
.fx-feature.rev .fx-feature-mock{order:1;}
.fx-feyebrow{font-size:12.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--cyan);margin-bottom:14px;}
.fx-feyebrow.center{text-align:center;}
.fx-h2{font-size:clamp(26px,3.4vw,38px);font-weight:700;letter-spacing:-.02em;line-height:1.12;margin:0 0 16px;color:#fff;}
.fx-h2.center{text-align:center;max-width:22ch;margin-left:auto;margin-right:auto;}
.fx-body{font-size:16.5px;color:var(--muted);line-height:1.6;margin:0 0 20px;}
.fx-bullets{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:12px;}
.fx-bullets li{display:flex;gap:11px;font-size:15px;color:#cfdcef;line-height:1.5;}
.fx-bullets b,.fx-bullets strong{color:#fff;font-weight:600;}
.fx-b-tick{color:var(--teal);font-weight:800;flex:0 0 auto;}
/* compliance capability grid */
.fx-cg{padding:20px 22px 40px;}
.fx-cg-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:34px;}
.fx-cg-card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:22px;transition:border-color .2s,transform .2s;}
.fx-cg-card:hover{border-color:var(--line2);transform:translateY(-3px);}
.fx-cg-i{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:10px;background:rgba(32,197,176,.1);border:1px solid rgba(32,197,176,.22);font-size:19px;margin-bottom:12px;}
.fx-cg-t{font-weight:700;font-size:16px;color:#fff;margin-bottom:7px;}
.fx-cg-card p{margin:0;font-size:14px;color:var(--muted);line-height:1.55;}
/* differentiators */
.fx-diff{padding:70px 22px;}
.fx-diff-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:38px;}
.fx-diff-card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:22px;transition:border-color .2s,transform .2s;}
.fx-diff-card:hover{border-color:var(--line2);transform:translateY(-3px);}
.fx-diff-t{font-weight:700;font-size:16.5px;color:#fff;margin-bottom:8px;}
.fx-diff-card p{margin:0;font-size:14px;color:var(--muted);line-height:1.55;}
/* faq */
.fx-faq{padding:60px 22px;}
.fx-faq-list{max-width:780px;margin:34px auto 0;display:flex;flex-direction:column;gap:10px;}
.fx-faq-item{background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:2px 18px;}
.fx-faq-item summary{cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px 0;font-weight:600;font-size:15.5px;color:#eaf1fb;}
.fx-faq-item summary::-webkit-details-marker{display:none;}
.fx-faq-plus{color:var(--teal);font-size:20px;font-weight:400;transition:transform .2s;flex:0 0 auto;}
.fx-faq-item[open] .fx-faq-plus{transform:rotate(45deg);}
.fx-faq-item p{margin:0 0 16px;font-size:14.5px;color:var(--muted);line-height:1.6;}
/* final cta */
.fx-final{padding:40px 22px 90px;}
.fx-final-card{position:relative;text-align:center;background:linear-gradient(135deg,rgba(32,197,176,.1),rgba(91,33,182,.14));border:1px solid var(--line2);border-radius:24px;padding:56px 30px;overflow:hidden;}
.fx-final-card .fx-h2{margin-bottom:12px;}
.fx-final-card .fx-body{max-width:52ch;margin:0 auto 26px;}
/* footer */
.fx-footer{border-top:1px solid var(--line);padding:40px 22px;margin-top:20px;}
.fx-footin{display:flex;flex-direction:column;gap:16px;align-items:center;text-align:center;}
.fx-foot-links{display:flex;gap:22px;flex-wrap:wrap;justify-content:center;font-size:14px;color:var(--muted);}
.fx-foot-links a:hover{color:var(--text);}
.fx-foot-copy{font-size:12.5px;color:var(--faint);}
/* ── mockups (light UI) ── */
.mk{background:#fff;border-radius:15px;overflow:hidden;box-shadow:0 40px 90px -30px rgba(0,0,0,.7),0 0 0 1px rgba(141,180,230,.14);color:#101A24;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;text-align:left;}
.mk-bar{display:flex;align-items:center;gap:7px;padding:11px 14px;background:#F6F8FB;border-bottom:1px solid #EAEEF3;}
.mk-dot{width:11px;height:11px;border-radius:50%;display:inline-block;}
.mk-title{margin-left:10px;font-size:12.5px;font-weight:700;color:#5B6470;letter-spacing:-.01em;}
.mk-body{padding:16px 18px 18px;}
.mono{font-family:'JetBrains Mono',ui-monospace,monospace;}
/* profit report mock */
.rp-hero{font-size:14px;font-weight:700;color:#0B6E63;line-height:1.35;margin-bottom:12px;}
.rp-strip{display:flex;align-items:center;gap:7px;flex-wrap:wrap;background:#F2FBF8;border:1px solid #C7E4DF;border-radius:10px;padding:9px 12px;font-size:12.5px;color:#0B6E63;margin-bottom:11px;}
.rp-check{color:#12B76A;font-weight:800;}
.rp-strip-sub{color:#7A8696;font-weight:500;}
.rp-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:15px;}
.rp-chip{font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;}
.rp-wf-label{font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#8A94A2;margin-bottom:6px;}
.rp-wf{display:flex;height:13px;border-radius:6px;overflow:hidden;border:1px solid #EDF0F4;}
.rp-wf-legend{display:flex;gap:14px;flex-wrap:wrap;margin:8px 0 14px;font-size:11.5px;color:#5B6470;}
.rp-wf-legend span{display:inline-flex;align-items:center;gap:5px;}
.rp-wf-legend i{width:8px;height:8px;border-radius:2px;display:inline-block;}
.rp-sec{border-radius:11px;padding:11px 13px;margin-bottom:9px;}
.rp-sec.red{background:#FDF1F0;border-left:3px solid #B42318;}
.rp-sec.green{background:#EDF8F2;border-left:3px solid #067647;}
.rp-sec-h{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:7px;}
.rp-sec-t{font-size:13px;font-weight:700;color:#101A24;}
.rp-pill{font-size:9px;font-weight:800;letter-spacing:.04em;padding:2px 8px;border-radius:999px;color:#fff;}
.rp-pill.red{background:#B42318;}.rp-pill.green{background:#067647;}
.rp-act{background:#fff;border:1px solid #EDF0F4;border-radius:9px;padding:9px 11px;font-size:12.5px;color:#1B2430;}
.rp-act b{color:#0E7569;}
.rp-imp{font-size:11.5px;font-weight:700;color:#067647;margin-top:4px;}
/* price radar mock */
.pr-kpis{display:flex;gap:9px;margin-bottom:14px;}
.pr-kpi{flex:1;background:#FAFBFD;border:1px solid #EAEEF3;border-radius:10px;padding:9px 12px;}
.pr-kpi.hi{background:#F2FBF8;border-color:#C7E4DF;}
.pr-kpi-l{display:block;font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#8A94A2;}
.pr-kpi-v{display:block;font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:700;color:#101A24;margin-top:3px;}
.pr-tbl{border:1px solid #EDF0F4;border-radius:10px;overflow:hidden;}
.pr-tr{display:grid;grid-template-columns:2fr .7fr .7fr .7fr .9fr .9fr .9fr;gap:6px;padding:9px 11px;font-size:11.5px;align-items:center;border-bottom:1px solid #F2F5F8;font-family:'JetBrains Mono',monospace;}
.pr-tr:last-child{border-bottom:none;}
.pr-th{background:#F6F8FB;font-family:-apple-system,sans-serif;font-size:9.5px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:#8A94A2;}
.pr-th span:not(:first-child),.pr-tr span:not(.pr-name){text-align:right;}
.pr-name{font-family:-apple-system,sans-serif;font-weight:600;color:#1B2430;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;}
.pr-pf{font-weight:700;}
.pr-foot{margin-top:11px;font-size:11.5px;color:#7A8696;}
.pr-ai{color:#5B21B6;font-weight:700;}
/* campaign mock */
.cm-top{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:11px;}
.cm-budget{font-family:'JetBrains Mono',monospace;font-size:22px;font-weight:700;color:#101A24;}
.cm-budget small{font-size:12px;color:#8A94A2;font-weight:500;}
.cm-suggest{font-size:11.5px;color:#5B21B6;font-weight:600;}
.cm-split{display:flex;height:15px;border-radius:999px;overflow:hidden;margin-bottom:14px;background:#F2F5F8;}
.cm-cards{display:grid;grid-template-columns:1fr 1fr;gap:9px;}
.cm-card{background:#FAFBFD;border:1px solid #EAEEF3;border-radius:11px;padding:11px 12px;}
.cm-card-h{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px;}
.cm-card-n{font-size:12.5px;font-weight:700;color:#101A24;}
.cm-tier{font-size:11px;font-weight:800;padding:2px 8px;border-radius:7px;font-family:'JetBrains Mono',monospace;}
.cm-card-meta{display:flex;justify-content:space-between;font-size:11px;color:#5B6470;font-family:'JetBrains Mono',monospace;}
.cm-note{margin-top:13px;font-size:11.5px;color:#7A8696;}
/* compliance mock */
.co-head{display:flex;align-items:center;gap:13px;margin-bottom:15px;}
.co-score{font-family:'JetBrains Mono',monospace;font-size:34px;font-weight:700;color:#067647;background:#E6F4EF;border-radius:12px;padding:6px 15px;}
.co-score-l{font-size:14px;font-weight:700;color:#101A24;}
.co-score-s{font-size:12px;color:#7A8696;}
.co-list{display:flex;flex-direction:column;gap:8px;}
.co-row{display:flex;align-items:center;gap:11px;background:#FAFBFD;border:1px solid #EDF0F4;border-radius:9px;padding:9px 12px;}
.co-badge{font-size:10.5px;font-weight:800;padding:3px 9px;border-radius:7px;flex:0 0 auto;width:52px;text-align:center;}
.co-t{font-size:12.5px;color:#1B2430;}
.co-cta{margin-top:13px;font-size:11.5px;color:#0B6E63;font-weight:600;}
/* product import mock */
.im-src{display:flex;align-items:center;gap:9px;background:#F6F8FB;border:1px solid #EAEEF3;border-radius:10px;padding:9px 12px;margin-bottom:13px;flex-wrap:wrap;}
.im-src-l{font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:#8A94A2;}
.im-src-url{font-size:12px;color:#3B4657;flex:1;min-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.im-go{font-size:11.5px;font-weight:700;color:#5B21B6;background:#F4EBFF;border-radius:7px;padding:4px 10px;white-space:nowrap;}
.im-card{display:flex;gap:12px;border:1px solid #EDF0F4;border-radius:11px;padding:12px;margin-bottom:12px;}
.im-thumb{flex:0 0 56px;height:56px;border-radius:9px;background:linear-gradient(135deg,#EEF2F7,#DCE6F0);display:flex;align-items:center;justify-content:center;font-size:24px;}
.im-fields{flex:1;min-width:0;}
.im-title{font-size:13px;font-weight:700;color:#101A24;line-height:1.3;margin-bottom:4px;}
.im-desc{font-size:11.5px;color:#5B6470;line-height:1.4;margin-bottom:8px;}
.im-tags{display:flex;flex-wrap:wrap;gap:6px;}
.im-tag{font-size:10.5px;color:#3B4657;background:#F4F6F9;border:1px solid #EAEEF3;border-radius:7px;padding:3px 8px;}
.im-tag b{color:#101A24;font-weight:700;}
.im-tag.ok{color:#067647;background:#E6F4EF;border-color:#C7E4DF;}
.im-did{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:11px;}
.im-did-l{font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#8A94A2;}
.im-did-chip{font-size:11px;font-weight:700;color:#067647;background:#E6F4EF;border-radius:999px;padding:3px 9px;}
.im-foot{font-size:11.5px;color:#7A8696;}
/* responsive */
@media(max-width:860px){
  .fx-nav a:not(.fx-btn){display:none;}
  .fx-feature{grid-template-columns:1fr;gap:34px;padding:56px 22px;}
  .fx-feature.rev .fx-feature-text{order:1;}
  .fx-feature.rev .fx-feature-mock{order:2;}
  .fx-diff-grid{grid-template-columns:1fr;}
  .fx-cg-grid{grid-template-columns:1fr;}
  .pr-tr{grid-template-columns:1.6fr .6fr .8fr .8fr .8fr;}
  .pr-tr span:nth-child(4),.pr-tr span:nth-child(5){display:none;}
  .cm-cards{grid-template-columns:1fr;}
}
@media(max-width:560px){.fx-hero{padding:48px 18px 10px;}.pr-tr span:nth-child(2){display:none;}}
/* Scan-parameters layer cards */
.fx-layers{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;margin-top:34px;}
.fx-layer-card{background:var(--panel,#0d1a30);border:1px solid var(--line,rgba(141,180,230,.14));border-radius:16px;padding:20px 22px;}
.fx-layer-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px;}
.fx-layer-name{font-weight:700;font-size:16px;}
.fx-layer-tag{font-family:var(--mono,monospace);font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--accent,#41c6ee);border:1px solid var(--line-strong,rgba(141,180,230,.28));border-radius:99px;padding:3px 9px;white-space:nowrap;}
.fx-layer-card ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;}
.fx-layer-card li{display:flex;gap:9px;align-items:flex-start;font-size:14px;color:var(--muted);line-height:1.45;}
.fx-layer-card li .fx-tick{color:var(--green,#34d399);flex-shrink:0;}
/* Screenshot gallery */
.fx-shots{margin-top:20px;}
.fx-shots-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:18px;margin-top:34px;}
.fx-shot{margin:0;background:var(--panel,#0d1a30);border:1px solid var(--line,rgba(141,180,230,.14));border-radius:16px;overflow:hidden;}
.fx-shot img{display:block;width:100%;height:auto;border-bottom:1px solid var(--line,rgba(141,180,230,.14));}
.fx-shot figcaption{padding:13px 16px;font-size:13.5px;color:var(--muted);line-height:1.5;}
.fx-shot-wide{grid-column:1 / -1;}
/* Video showcase */
.fx-video{margin-top:10px;}
.fx-video-frame{max-width:980px;margin:38px auto 0;border-radius:18px;overflow:hidden;border:1px solid var(--line-strong,rgba(141,180,230,.28));box-shadow:0 40px 90px -30px rgba(0,0,0,.7);}
.fx-video-frame video{display:block;width:100%;height:auto;background:#060d1b;}
/* App pricing grid (uses site.css .plan cards) */
.fx-pricing{margin-top:20px;}
.fx-plan-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:40px;align-items:stretch;}
@media(max-width:860px){.fx-layers{grid-template-columns:1fr;}.fx-shots-grid{grid-template-columns:1fr;}.fx-plan-grid{grid-template-columns:repeat(2,1fr);}}
@media(max-width:560px){.fx-plan-grid{grid-template-columns:1fr;}}
`;
