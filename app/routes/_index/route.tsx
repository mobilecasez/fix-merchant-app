import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

import { ClientOnly } from "../../components/ClientOnly";
// @ts-ignore - generated JSX design bundle (see app/website/site.jsx)
import SiteApp from "../../website/site.jsx";
import SeoContent, { SEO_FAQS } from "../../website/SeoContent";
import siteStyles from "../../website/site.css?url";

const SITE_URL = "https://shopflixai.com";
const OG_IMAGE = `${SITE_URL}/web-assets/app-scan.png`;
const TITLE = "ShopFlix AI — Fix Google Merchant Center & Get Approved";
const DESCRIPTION =
  "Free Shopify store scan for Google Merchant Center compliance. Fix policy pages, product feeds & contact info in one click — and recover from suspensions.";

// SEO: rendered server-side via <Meta/> in root.tsx even though the page body is a
// client-only SPA, so crawlers and Google Ads see real title/description/OG tags.
export const meta: MetaFunction = () => [
  { title: TITLE },
  { name: "description", content: DESCRIPTION },
  {
    name: "keywords",
    content:
      "Google Merchant Center, Shopify GMC compliance, Merchant Center suspension recovery, misrepresentation suspension fix, suspended after fixing everything, trust and identity scan, registered agent address suspension, brand geography mismatch, concealed fulfillment dropshipping, NAP consistency Shopify, domain age WHOIS privacy merchant center, Shopify product feed, GMC approval, AI product import Shopify, Google Shopping disapproved products, reinstatement appeal, Shopify SEO app",
  },
  { name: "robots", content: "index, follow" },
  { tagName: "link", rel: "canonical", href: SITE_URL },
  // Open Graph
  { property: "og:type", content: "website" },
  { property: "og:site_name", content: "ShopFlix AI" },
  { property: "og:url", content: SITE_URL },
  { property: "og:title", content: TITLE },
  { property: "og:description", content: DESCRIPTION },
  { property: "og:image", content: OG_IMAGE },
  { property: "og:image:width", content: "1600" },
  { property: "og:image:height", content: "900" },
  { property: "og:image:alt", content: "ShopFlix AI scan dashboard inside the Shopify admin" },
  // Twitter
  { name: "twitter:card", content: "summary_large_image" },
  { name: "twitter:title", content: TITLE },
  { name: "twitter:description", content: DESCRIPTION },
  { name: "twitter:image", content: OG_IMAGE },
  // Structured data for rich results
  {
    "script:ld+json": {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "ShopFlix AI",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Shopify",
      url: SITE_URL,
      description: DESCRIPTION,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
  },
  {
    "script:ld+json": {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "ShopFlix AI",
      url: SITE_URL,
      logo: `${SITE_URL}/icon-512.png`,
    },
  },
  {
    "script:ld+json": {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "ShopFlix AI",
      url: SITE_URL,
    },
  },
  {
    "script:ld+json": {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: SEO_FAQS.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  },
];

export const links: LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  { rel: "stylesheet", href: siteStyles },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  // Preserve the Shopify install entry point: ?shop=... goes to the embedded app.
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  // Google Ads conversion config. These are PUBLIC client-side IDs (not secrets) and are
  // injected only on this marketing page (never inside the embedded Shopify admin app).
  // Everything no-ops until GOOGLE_ADS_ID is set, so the page is unaffected pre-setup.
  return json({
    ads: {
      // Base Google Ads tag id (public, not a secret). Installs the Google tag so Google can
      // verify it. Conversion labels below stay empty until the conversion actions are made —
      // the scan/purchase events no-op until then. Env vars override these defaults.
      id: process.env.GOOGLE_ADS_ID || "AW-18266469423",
      scanLabel: process.env.GOOGLE_ADS_SCAN_LABEL || "",
      purchaseLabel: process.env.GOOGLE_ADS_PURCHASE_LABEL || "",
    },
  });
};

export default function Index() {
  const { ads } = useLoaderData<typeof loader>();
  const gtagInit = ads.id
    ? `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}` +
      `gtag('js',new Date());gtag('config',${JSON.stringify(ads.id)});` +
      `window.__ADS=${JSON.stringify({ id: ads.id, scan: ads.scanLabel, purchase: ads.purchaseLabel })};`
    : "";
  return (
    <div id="root">
      {ads.id ? (
        <>
          <script async src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ads.id)}`} />
          <script dangerouslySetInnerHTML={{ __html: gtagInit }} />
        </>
      ) : null}
      <ClientOnly fallback={<SeoContent />}>
        <SiteApp />
      </ClientOnly>
    </div>
  );
}
