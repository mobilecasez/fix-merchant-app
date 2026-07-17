// Server-rendered SEO content. Renders in the initial HTML (and as the pre-hydration
// fallback for the client-only marketing SPA) so crawlers and no-JS clients see real,
// keyword-rich content instead of an empty body. Mirrors the live site's messaging — it
// is NOT cloaking: the interactive app shows the same offer once it hydrates.

export const SEO_FAQS: { q: string; a: string }[] = [
  {
    q: "What causes a Google Merchant Center suspension?",
    a: "Google Merchant Center suspends accounts and disapproves products when a store fails Google Shopping policies — the most common triggers are missing or thin policy pages (refund, return, shipping), missing business contact information, identity or misrepresentation mismatches, and product-feed problems like missing GTINs or prices that don't match your storefront. ShopFlix AI scans your Shopify store for these issues before Google does.",
  },
  {
    q: "How do I fix disapproved products on Google Shopping?",
    a: "Most disapprovals come from policy-page gaps, misrepresentation signals, or product-feed errors. ShopFlix AI's free scan pinpoints the exact issues on your store, and the Shopify app fixes many of them in one click — from policy pages and contact details to product titles, descriptions and images.",
  },
  {
    q: "Is the Shopify store scan really free?",
    a: "Yes. Your first store scan preview is free and needs no login — just enter your store URL. A paid Deep Scan unlocks the full report with step-by-step fixes plus product-feed, image and misrepresentation checks.",
  },
  {
    q: "Will ShopFlix AI help me get approved on Google Merchant Center?",
    a: "ShopFlix AI checks your store against the same categories Google reviews — policy pages, contact and trust signals, product data and misrepresentation — so you can fix the issues that cause suspensions and reinstatement rejections, and get approved on Google Shopping faster.",
  },
  {
    q: "Do I need to install anything to scan my store?",
    a: "No. The free scan runs from the website with just your store URL. To automatically fix issues and continuously monitor your store for new ones, install the ShopFlix AI app from the Shopify App Store.",
  },
  {
    q: "Why did my store get suspended again after I fixed everything the scan found?",
    a: "Because Misrepresentation suspensions are enforced on your business's identity and consistency — the layer below what a page-presence scanner reads. ShopFlix AI's Deep scan adds a Trust & Identity audit that catches the real triggers most tools miss: a registered-agent / mail-drop business address, a brand name implying a country you don't operate in, a brand-new or privacy-masked domain, overseas fulfillment concealed behind a local identity, inconsistent name/address/phone (NAP), and contradictions between your own policy pages.",
  },
];

export default function SeoContent() {
  return (
    <main className="wrap" style={{ padding: "56px 24px 80px" }}>
      <p className="kicker">Free Shopify store scan for Google Merchant Center</p>
      <h1 style={{ fontSize: "44px", fontWeight: 700, lineHeight: 1.12, maxWidth: "860px", letterSpacing: "-0.02em" }}>
        Is your Shopify store one scan away from a Google Merchant Center suspension?
      </h1>
      <p style={{ fontSize: "18px", maxWidth: "660px", marginTop: "18px", lineHeight: 1.6 }}>
        ShopFlix AI checks your Shopify store against Google Merchant Center policies — the same
        policy pages, contact and trust signals, product-feed data and misrepresentation checks
        Google reviews before approving your products for Google Shopping. Find what&rsquo;s getting
        your products disapproved, then fix it in one click.
      </p>
      <p style={{ marginTop: "30px" }}>
        <a className="btn btn-primary btn-lg" href="https://apps.shopify.com/shopflix-ai" rel="noopener">
          Install ShopFlix AI on Shopify
        </a>
      </p>

      <h2 style={{ fontSize: "26px", fontWeight: 700, marginTop: "56px" }}>What ShopFlix AI checks</h2>
      <ul style={{ lineHeight: 1.9, marginTop: "12px", maxWidth: "740px" }}>
        <li><strong>Policy pages</strong> — refund, return, shipping, privacy and terms pages Google Merchant Center requires.</li>
        <li><strong>Contact &amp; trust</strong> — business address, phone and email that prove your store is legitimate.</li>
        <li><strong>Product feed</strong> — GTINs, pricing consistency, titles and descriptions that pass Google&rsquo;s product-data rules.</li>
        <li><strong>Product images</strong> — watermarks, promotional overlays and low-quality images that get products disapproved.</li>
        <li><strong>Misrepresentation</strong> — identity mismatches and trust signals that trigger Merchant Center suspensions.</li>
        <li><strong>Trust &amp; Identity</strong> — the deep layer most scanners miss: registered-agent / mail-drop addresses, brand-vs-location mismatches, new or privacy-masked domains, overseas fulfillment concealed behind a local identity, NAP consistency and contradictions between your own policy pages — the real reasons a &ldquo;clean&rdquo; store stays suspended.</li>
      </ul>

      <h2 style={{ fontSize: "26px", fontWeight: 700, marginTop: "48px" }}>How it works</h2>
      <ol style={{ lineHeight: 1.9, marginTop: "12px", maxWidth: "740px" }}>
        <li>Enter your Shopify store URL — the first scan preview is free, with no login required.</li>
        <li>See the issues putting your store at risk of a Google Merchant Center suspension or product disapprovals.</li>
        <li>Fix them in one click with the ShopFlix AI Shopify app, then keep your store monitored for new issues.</li>
      </ol>

      <h2 style={{ fontSize: "26px", fontWeight: 700, marginTop: "48px" }}>Frequently asked questions</h2>
      <div style={{ maxWidth: "780px", marginTop: "12px" }}>
        {SEO_FAQS.map((f, i) => (
          <div key={i} style={{ marginBottom: "22px" }}>
            <h3 style={{ fontSize: "18px", fontWeight: 700 }}>{f.q}</h3>
            <p style={{ marginTop: "6px", lineHeight: 1.6 }}>{f.a}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
