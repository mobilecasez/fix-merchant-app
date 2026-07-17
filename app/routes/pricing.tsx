import type { LinksFunction, MetaFunction } from "@remix-run/node";
import siteStyles from "../website/site.css?url";

/**
 * shopflixai.com/pricing — SERVER-RENDERED pricing page. Fixes the Shopify App Store
 * "more pricing" link (which previously pointed at a page that 404'd / needed JS).
 * Shows BOTH the pay-per-scan tiers (public web scan) AND the in-app Shopify subscription
 * plans, in the same card style as the home page. Reuses site.css (.section/.plan/.card/.btn).
 */

const SITE = "https://shopflixai.com";
const APP = "https://apps.shopify.com/shopflix-ai";
const OG_IMAGE = `${SITE}/web-assets/app-scan.png`;

const TITLE = "Pricing — ShopFlix AI | GMC Suspension Fix, Scans & Google Ads for Shopify";
const DESCRIPTION =
  "Simple pricing for ShopFlix AI. Pay-per-scan from $3.99 (free preview, no account), or install the Shopify app on a plan from free to $99/mo. See every plan and what's included.";

type Plan = {
  name: string; price: string; unit: string; tagline: string;
  flag?: string | null; pop?: boolean; features: string[]; cta: string; href: string;
};

// Pay-per-scan tiers (public web scan) — mirror app/website/site.jsx PLANS.
const WEB_SCANS: Plan[] = [
  { name: "Basic Scan", price: "3.99", unit: "one-time / scan", tagline: "Store fundamentals & legal compliance", flag: "Free preview included",
    features: ["All store-level compliance issues, unlocked", "Policy pages, contact info & navigation checks", "Plain-English fix instructions for every issue", "Compliance score & risk level", "Downloadable PDF report"],
    cta: "Start with a free scan", href: SITE },
  { name: "Advanced Scan", price: "5.99", unit: "one-time / scan", tagline: "Product feed data & accuracy", pop: true, flag: "Most popular",
    features: ["Everything in Basic Scan", "Product-feed analysis — GTINs, brands & MPNs", "Pricing logic & feed-vs-storefront integrity", "Image compliance — watermarks & promo text", "Excel export of every flagged product"],
    cta: "Run an Advanced Scan", href: SITE },
  { name: "Deep Scan", price: "9.99", unit: "one-time / scan", tagline: "Misrepresentation & Trust & Identity audit", flag: null,
    features: ["Everything in Advanced Scan", "Mirrors Google's manual review process", "Trust & Identity misrepresentation layer", "Registered-agent, domain-age, NAP & fulfillment checks", "Suspension appeal-readiness checklist"],
    cta: "Run a Deep Scan", href: SITE },
];

// In-app subscription plans (real Shopify billing) — mirror seed-subscription-plans.js.
const APP_PLANS: Plan[] = [
  { name: "Free", price: "0", unit: "free forever", tagline: "2 credits", flag: "No card required",
    features: ["First Basic store scan free", "2 one-time credits for AI imports & fixes", "Full compliance scan preview", "Upgrade anytime"], cta: "Install free", href: APP },
  { name: "Starter", price: "4.99", unit: "/ month", tagline: "20 credits / month",
    features: ["20 credits every month", "AI product imports", "Basic + compliance scans", "One-click auto-fixes"], cta: "Choose Starter", href: APP },
  { name: "Basic", price: "9.99", unit: "/ month", tagline: "50 credits / month",
    features: ["50 credits every month", "Basic + Advanced scans", "Auto-fixes & image fixer", "Store monitoring"], cta: "Choose Basic", href: APP },
  { name: "Professional", price: "17.99", unit: "/ month", tagline: "100 credits / month", pop: true, flag: "Most popular",
    features: ["100 credits every month", "Full scan suite incl. Deep scan", "Trust & Identity misrepresentation audit", "Suspension Recovery + appeal letters"], cta: "Choose Professional", href: APP },
  { name: "Advanced", price: "24.99", unit: "/ month", tagline: "150 credits / month",
    features: ["150 credits every month", "Everything at scale", "Image fixes & monitoring", "Priority processing"], cta: "Choose Advanced", href: APP },
  { name: "Enterprise", price: "99", unit: "/ month", tagline: "999 credits / month",
    features: ["999 credits every month", "For high-volume stores & agencies", "All features unlocked", "Dedicated support"], cta: "Contact / Install", href: APP },
];

export const meta: MetaFunction = () => [
  { title: TITLE },
  { name: "description", content: DESCRIPTION },
  { name: "keywords", content: "ShopFlix AI pricing, Google Merchant Center fix pricing, GMC scan cost, Shopify compliance app pricing, per scan pricing Shopify, merchant center suspension fix price, shopify app plans" },
  { name: "robots", content: "index, follow" },
  { tagName: "link", rel: "canonical", href: `${SITE}/pricing` },
  { property: "og:type", content: "website" },
  { property: "og:site_name", content: "ShopFlix AI" },
  { property: "og:url", content: `${SITE}/pricing` },
  { property: "og:title", content: TITLE },
  { property: "og:description", content: DESCRIPTION },
  { property: "og:image", content: OG_IMAGE },
  { name: "twitter:card", content: "summary_large_image" },
  { name: "twitter:title", content: TITLE },
  { name: "twitter:description", content: DESCRIPTION },
  {
    "script:ld+json": {
      "@context": "https://schema.org", "@type": "Product", name: "ShopFlix AI",
      description: DESCRIPTION,
      offers: {
        "@type": "AggregateOffer", priceCurrency: "USD", lowPrice: "0", highPrice: "99",
        offerCount: String(WEB_SCANS.length + APP_PLANS.length), url: `${SITE}/pricing`,
      },
    },
  },
  {
    "script:ld+json": {
      "@context": "https://schema.org", "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE },
        { "@type": "ListItem", position: 2, name: "Pricing", item: `${SITE}/pricing` },
      ],
    },
  },
];

export const links: LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "stylesheet", href: siteStyles },
];

function Check() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }}>
      <polyline points="4.5 12.5 9.5 17.5 19.5 6.5" />
    </svg>
  );
}

function Card({ p }: { p: Plan }) {
  return (
    <div className={"card card-hover plan" + (p.pop ? " plan-pop" : "")}>
      {p.flag ? <div className="plan-flag" style={p.pop ? undefined : { background: "var(--panel2)", color: "var(--accent)", border: "1px solid var(--line-strong)" }}>{p.flag}</div> : null}
      <div style={{ fontWeight: 700, fontSize: "19px" }}>{p.name}</div>
      <div className="mono" style={{ fontSize: "12px", color: "var(--faint)", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: "4px" }}>{p.tagline}</div>
      <div className="plan-price">
        <b>${p.price}</b>
        <span>{p.unit}</span>
      </div>
      <ul>
        {p.features.map((f, i) => <li key={i}><Check />{f}</li>)}
      </ul>
      <a className={"btn btn-block " + (p.pop ? "btn-primary" : "btn-ghost")} href={p.href} target="_blank" rel="noopener" style={{ textAlign: "center", textDecoration: "none" }}>{p.cta}</a>
    </div>
  );
}

function Grid({ plans }: { plans: Plan[] }) {
  return (
    <div className="pricing-grid">
      {plans.map((p) => <Card key={p.name} p={p} />)}
    </div>
  );
}

export default function Pricing() {
  return (
    <div style={{ minHeight: "100vh" }}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <header style={{ borderBottom: "1px solid var(--line)", position: "sticky", top: 0, zIndex: 20, background: "rgba(6,13,27,0.85)", backdropFilter: "blur(12px)" }}>
        <div className="wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 64 }}>
          <a href="/" style={{ fontWeight: 800, fontSize: 18, color: "var(--text)", textDecoration: "none", letterSpacing: "-0.02em" }}>ShopFlix<span style={{ color: "var(--accent)" }}> AI</span></a>
          <nav style={{ display: "flex", alignItems: "center", gap: 22, fontSize: 14 }}>
            <a href="/" style={{ color: "var(--muted)", textDecoration: "none" }}>Home</a>
            <a href="/features" style={{ color: "var(--muted)", textDecoration: "none" }}>Features</a>
            <a href="/blog" style={{ color: "var(--muted)", textDecoration: "none" }}>Blog</a>
            <a className="btn btn-primary btn-sm" href={APP} target="_blank" rel="noopener" style={{ textDecoration: "none" }}>Install free</a>
          </nav>
        </div>
      </header>

      <main>
        <section className="section" style={{ paddingBottom: 40 }}>
          <div className="wrap" style={{ textAlign: "center" }}>
            <div className="kicker">Pricing</div>
            <h1 className="h2" style={{ fontSize: 44 }}>Fix suspensions for the price of a coffee.</h1>
            <p className="sub" style={{ margin: "16px auto 0" }}>Two ways to use ShopFlix AI: a quick pay-per-scan with no account, or install the Shopify app on a plan that fits your store. Your first Basic scan is always free.</p>
          </div>
        </section>

        {/* Pay-per-scan */}
        <section className="section" style={{ paddingTop: 24 }}>
          <div className="wrap">
            <div style={{ textAlign: "center", marginBottom: 40 }}>
              <div className="kicker">No account needed</div>
              <h2 className="h2">Pay per scan</h2>
              <p className="sub" style={{ margin: "12px auto 0" }}>Run a one-off compliance scan on any store URL. Free Basic preview, then unlock the full report.</p>
            </div>
            <Grid plans={WEB_SCANS} />
            <p className="mono" style={{ textAlign: "center", color: "var(--faint)", fontSize: "12.5px", marginTop: 28 }}>One-time payment per scan · secure checkout · results in about a minute</p>
          </div>
        </section>

        {/* In-app subscription plans */}
        <section className="section section-alt">
          <div className="wrap">
            <div style={{ textAlign: "center", marginBottom: 40 }}>
              <div className="kicker">On the Shopify App Store</div>
              <h2 className="h2">In-app plans</h2>
              <p className="sub" style={{ margin: "12px auto 0" }}>Install ShopFlix AI on your store for scans, one-click fixes, AI product import, Suspension Recovery, Price Radar & Google Ads. Credits refresh every month.</p>
            </div>
            <Grid plans={APP_PLANS} />
            <p className="mono" style={{ textAlign: "center", color: "var(--faint)", fontSize: "12.5px", marginTop: 28 }}>Billed monthly through Shopify · cancel anytime · 1 credit ≈ 1 AI import, fix or scan action</p>
            <div style={{ textAlign: "center", marginTop: 36 }}>
              <a className="btn btn-primary btn-lg" href={APP} target="_blank" rel="noopener" style={{ textDecoration: "none" }}>Install ShopFlix AI on Shopify — free</a>
            </div>
          </div>
        </section>
      </main>

      <footer style={{ borderTop: "1px solid var(--line)", padding: "40px 0", textAlign: "center", color: "var(--faint)", fontSize: 13 }}>
        <div className="wrap">
          <div style={{ display: "flex", gap: 20, justifyContent: "center", flexWrap: "wrap", marginBottom: 14 }}>
            <a href="/" style={{ color: "var(--muted)", textDecoration: "none" }}>Home</a>
            <a href="/features" style={{ color: "var(--muted)", textDecoration: "none" }}>Features</a>
            <a href="/pricing" style={{ color: "var(--muted)", textDecoration: "none" }}>Pricing</a>
            <a href="/blog" style={{ color: "var(--muted)", textDecoration: "none" }}>Blog</a>
          </div>
          © {new Date().getFullYear()} ShopFlix AI · Google Merchant Center compliance, AI product import & Google Ads for Shopify
        </div>
      </footer>
    </div>
  );
}

const CSS = `
.pricing-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; align-items: stretch; }
@media (max-width: 900px) { .pricing-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 600px) { .pricing-grid { grid-template-columns: 1fr; } }
.plan a.btn { margin-top: auto; }
`;
