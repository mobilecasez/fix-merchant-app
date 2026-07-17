/**
 * Web-side tiered scan engine (shopflixai.com — no Shopify auth required).
 *
 * Brings the public scan to the same depth as the embedded Shopify app, using only
 * PUBLIC surfaces (raw HTML, JSON-LD, /products.json), grounded in the current (2025-26)
 * Google Merchant Center policy research:
 *   - Basic:    store-level AI compliance audit (runMonitoringScan → buildBasicPrompt).
 *   - Advanced: EVERY product from /products.json → deterministic feed checks
 *               (computeAdvancedErrors: description, deceptive pricing, image) + a
 *               date-aware 500×500px image-resolution check + HTML-level JSON-LD ↔ feed
 *               price/availability consistency (Google's #1 reconciliation bucket).
 *   - Deep:     Advanced + the FULL AI misrepresentation audit (enrichDeepData →
 *               buildDeepPrompt → Gemini → reconcileDeepResult), the same engine the
 *               embedded app uses, with a deterministic fallback if the AI is unavailable.
 *
 * Severity follows the verified research: only the return/refund policy is an explicitly
 * required page (missing terms/privacy/shipping are trust notes, not hard fails); the
 * 500×500 image minimum is MEDIUM until its Jan-2027 enforcement.
 */

import prisma from "../db.server";
import {
  runMonitoringScan,
  computeAdvancedErrors,
  enrichDeepData,
  buildDeepPrompt,
  runGeminiJson,
  reconcileDeepResult,
  deriveTrustFindings,
  type DeepAuditData,
} from "./store-scanner.server";
import { mapBasicResult, assertPublicHost, type WebIssue } from "./web-scan.server";

type WP = {
  id: string; handle: string; title: string; description: string; link: string;
  image_url: string; image_width: number; image_height: number;
  gtin: string | null; mpn: string | null; brand: string | null;
  price: number; compare_at_price: number | null; weight: number | null; availability: string;
};

const TIER_RANK: Record<string, number> = { basic: 1, advanced: 2, deep: 3 };
const SEV_RANK: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
const UA = "ShopFlixAI-Scanner/1.0 (+https://shopflixai.com)";

function normSev(s: any): "High" | "Medium" | "Low" {
  const v = String(s || "").toLowerCase();
  if (v.startsWith("high")) return "High";
  if (v.startsWith("low")) return "Low";
  return "Medium";
}

async function fetchText(url: string, timeoutMs = 12000): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Fetch EVERY product from the store's public /products.json (no auth, no sampling). */
export async function fetchPublicProducts(storeUrl: string, max = 1500): Promise<WP[]> {
  const out: WP[] = [];
  try {
    const host = new URL(storeUrl).hostname;
    if (!(await assertPublicHost(host))) return out;
  } catch {
    return out;
  }
  for (let page = 1; page <= 12 && out.length < max; page++) {
    let data: any = null;
    try {
      const res = await fetch(`${storeUrl}/products.json?limit=250&page=${page}`, {
        headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) break;
      if (!(res.headers.get("content-type") || "").includes("json")) break; // /products.json disabled
      data = await res.json();
    } catch {
      break;
    }
    const products = Array.isArray(data?.products) ? data.products : [];
    if (!products.length) break;
    for (const p of products) {
      const v = (p.variants && p.variants[0]) || {};
      const img = (p.images && p.images[0]) || {};
      const description = String(p.body_html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      out.push({
        id: String(p.id), handle: String(p.handle || ""), title: String(p.title || "Untitled product"), description,
        link: `${storeUrl}/products/${p.handle}`,
        image_url: String(img.src || ""), image_width: Number(img.width) || 0, image_height: Number(img.height) || 0,
        gtin: null, mpn: null, brand: (p.vendor && String(p.vendor)) || null,
        price: parseFloat(v.price) || 0,
        compare_at_price: v.compare_at_price != null ? parseFloat(v.compare_at_price) || null : null,
        weight: v.grams != null ? Number(v.grams) : null,
        availability: v.available === false ? "out of stock" : "in stock",
      });
      if (out.length >= max) break;
    }
    if (products.length < 250) break;
  }
  return out;
}

const ADV_SEV: Record<string, "High" | "Medium" | "Low"> = {
  "Missing Description": "High", "Deceptive Pricing Logic": "High", "Image Policy Violation": "Medium",
};
function advancedToWebIssues(adv: any): WebIssue[] {
  // Skip "Missing Identifiers" — GTIN/MPN aren't exposed in public /products.json, so
  // flagging them would be a false positive (research: identifier_exists needs feed/Admin data).
  const errs: any[] = (adv?.errors_found || []).filter((e: any) => e.policy_violation_type !== "Missing Identifiers");
  return errs.map((e: any) => ({
    sev: ADV_SEV[e.policy_violation_type] || "Medium",
    title: `${e.policy_violation_type}: ${e.product_title}`.slice(0, 200),
    why: String(e.merchant_friendly_description || "").slice(0, 400),
    fix: (Array.isArray(e.manual_fix_steps) ? e.manual_fix_steps.join(" ") : "").slice(0, 600),
    cat: "Product feed & data",
  }));
}

/** Date-aware 500×500px minimum (warnings Apr 2026, enforced Jan 31 2027). Counts products
 *  whose main image is ≥100px (so it's not the "too small" advanced flag) but <500px. */
function imageResolutionIssue(products: WP[]): WebIssue[] {
  const small = products.filter((p) => p.image_width >= 100 && p.image_height >= 100 && (p.image_width < 500 || p.image_height < 500));
  if (!small.length) return [];
  return [{
    sev: "Medium",
    title: `${small.length} product image${small.length === 1 ? "" : "s"} below Google's 500×500px minimum`,
    why: `Google is raising the minimum product-image size to 500×500px — warnings begin in 2026 and disapprovals begin Jan 31, 2027. ${small.length} of your products have a smaller main image (e.g. "${small[0].title}" at ${small[0].image_width}×${small[0].image_height}px).`,
    fix: "Re-upload product images at 500×500px or larger (800×800+ recommended) so they keep showing in Shopping after enforcement begins.",
    cat: "Product images",
  }];
}

// ── HTML-level JSON-LD ↔ feed price/availability consistency (Google's #1 reconciliation) ──
function extractProductJsonLd(html: string): { obj: any; raw: string } | null {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    let obj: any;
    try { obj = JSON.parse(m[1].trim()); } catch { continue; }
    const list = Array.isArray(obj) ? obj : obj && obj["@graph"] ? obj["@graph"] : [obj];
    for (const c of list) {
      const t = c && c["@type"];
      if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) return { obj: c, raw: m[1].trim().slice(0, 1600) };
    }
  }
  return null;
}
function offerOf(p: any): { price: number | null; currency: string | null; availability: string } {
  let o = p && p.offers;
  if (Array.isArray(o)) o = o[0];
  if (!o) return { price: null, currency: null, availability: "" };
  const price = o.price != null ? parseFloat(String(o.price)) : (o.lowPrice != null ? parseFloat(String(o.lowPrice)) : null);
  return { price: Number.isFinite(price as number) ? (price as number) : null, currency: o.priceCurrency || null, availability: String(o.availability || "").toLowerCase() };
}

interface SampleResult { issues: WebIssue[]; aiSample: { json_ld_schema: string; visual_dom_price: string; simulated_checkout_price: string }; currency: string; }

async function structuredDataSample(storeUrl: string, products: WP[], sampleN = 6): Promise<SampleResult> {
  const issues: WebIssue[] = [];
  const aiSample = { json_ld_schema: "", visual_dom_price: "", simulated_checkout_price: "" };
  let currency = "";
  const sample = products.filter((p) => p.handle).slice(0, sampleN);
  if (!sample.length) return { issues, aiSample, currency };

  let checked = 0, missingLd = 0, priceMismatch = 0, availMismatch = 0;
  let firstExample = "";
  for (const p of sample) {
    const html = await fetchText(`${storeUrl}/products/${p.handle}`, 11000);
    if (html == null) continue;
    checked++;
    const ld = extractProductJsonLd(html);
    if (!ld) { missingLd++; continue; }
    if (!aiSample.json_ld_schema) { aiSample.json_ld_schema = ld.raw; }
    const offer = offerOf(ld.obj);
    if (!currency && offer.currency) currency = String(offer.currency).toUpperCase();
    if (offer.price == null) { missingLd++; continue; }
    if (!aiSample.visual_dom_price) aiSample.visual_dom_price = `${offer.currency || ""} ${offer.price}`.trim();
    // Price: structured data vs the product feed (/products.json)
    if (p.price > 0 && Math.abs(offer.price - p.price) > 0.011) {
      priceMismatch++;
      if (!firstExample) firstExample = `"${p.title}" feed price ${p.price} vs structured-data price ${offer.price}`;
    }
    // Availability: structured data vs feed
    const ldInStock = offer.availability.includes("instock") || offer.availability.includes("in_stock");
    const feedInStock = p.availability === "in stock";
    if (offer.availability && ldInStock !== feedInStock) availMismatch++;
  }

  if (checked === 0) return { issues, aiSample, currency };
  if (missingLd >= Math.ceil(checked / 2)) {
    issues.push({
      sev: "High",
      title: "Product pages are missing valid structured data (JSON-LD)",
      why: `Google reconciles your feed against the Product/Offer structured data on each landing page; ${missingLd} of ${checked} sampled product pages had no usable Product JSON-LD with a price. Without it, Google falls back to error-prone price/availability extraction, a common cause of disapprovals.`,
      fix: "Ensure each product page outputs valid schema.org Product JSON-LD with price, priceCurrency and availability that match the displayed values (most Shopify themes or an SEO app provide this).",
      cat: "Pricing & availability",
    });
  }
  if (priceMismatch > 0) {
    issues.push({
      sev: "High",
      title: `Price mismatch between structured data and your product feed (${priceMismatch} of ${checked} sampled)`,
      why: `Google disapproves items when the landing-page structured-data price doesn't match the feed price. Example: ${firstExample}. This is one of the most common disapproval reasons.`,
      fix: "Make the price in each product page's JSON-LD exactly match the price shown to shoppers and in your feed. Avoid injecting price via JavaScript after load — Google's crawler reads the server HTML.",
      cat: "Pricing & availability",
    });
  }
  if (availMismatch > 0) {
    issues.push({
      sev: "High",
      title: `Availability mismatch between structured data and feed (${availMismatch} of ${checked} sampled)`,
      why: "Availability must be consistent across the landing page, structured data and feed. A mismatch (e.g. in stock in JSON-LD but sold out on the feed) triggers product disapproval.",
      fix: "Keep availability in your product JSON-LD in sync with real stock; for out-of-stock items keep the page live with the price visible and a 'Sold out' state.",
      cat: "Pricing & availability",
    });
  }
  return { issues, aiSample, currency };
}

// ── Public identity extraction (no Shopify session) — reads the store's own pages to seed the
//    Trust & Identity checks: brand name, address, phone, email, country, currency, registrable TLD. ──
function stripHtml(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function detectWebCountry(corpus: string): string | null {
  const c = corpus.toLowerCase();
  if (/,?\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/.test(corpus) || /\bunited states\b|\bu\.?s\.?a\.?\b/.test(c)) return "US";
  if (/\bunited kingdom\b|\bengland\b|\b[a-z]{1,2}\d{1,2}[a-z]?\s*\d[a-z]{2}\b/i.test(corpus)) return "GB";
  if (/\bcanada\b/.test(c)) return "CA";
  if (/\baustralia\b/.test(c)) return "AU";
  return null;
}
async function extractWebIdentity(storeUrl: string, storeDomain: string): Promise<{
  name: string; address: string; phone: string; email: string; country: string | null; tld: string; contactText: string;
}> {
  const home = (await fetchText(`${storeUrl}/`, 12000)) || "";
  const contactHtml = (await fetchText(`${storeUrl}/pages/contact`, 10000)) || (await fetchText(`${storeUrl}/pages/contact-us`, 10000)) || "";
  const contactText = stripHtml(contactHtml).slice(0, 2500);
  const corpus = `${contactText}\n${stripHtml(home).slice(0, 3000)}`;
  const og = home.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
  const title = home.match(/<title[^>]*>([^<]+)<\/title>/i);
  // RAW brand name from og:site_name → <title> (may be empty; the caller falls back to the product
  // vendor before the domain, so brand-geography detection has a real name to read).
  const name = String(og?.[1] || title?.[1] || "").split(/[|–—\-·]/)[0].trim().replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const address = (corpus.match(/\d{1,6}\s+[A-Za-z0-9.,'\- ]{4,60}\b(?:street|st|road|rd|avenue|ave|highway|hwy|blvd|boulevard|drive|dr|lane|ln|way|court|ct|suite|ste)\b[A-Za-z0-9.,'\- ]{0,40}/i) || [])[0]?.trim() || "";
  const phone = (corpus.match(/\+?\d[\d\s().-]{7,}\d/) || [])[0]?.trim() || "";
  const email = (corpus.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [])[0]?.toLowerCase() || "";
  const country = detectWebCountry(corpus);
  const tld = storeDomain.replace(/^www\./, "").split(".").slice(-2).join(".");
  return { name, address, phone, email, country, tld, contactText };
}

// deriveTrustFindings' shape → WebIssue. These are real misrepresentation signals — keep severity.
function trustToWebIssues(findings: { errors: any[] }): WebIssue[] {
  return (findings?.errors || []).map((e: any) => ({
    sev: normSev(e.severity),
    title: String(e.category || "Trust & identity risk").slice(0, 200),
    why: (String(e.merchant_friendly_explanation || e.evidence || "") + (e.google_policy_violated ? ` (Google policy: ${e.google_policy_violated})` : "")).slice(0, 400),
    fix: (Array.isArray(e.remediation_steps) ? e.remediation_steps.join(" ") : "").slice(0, 600),
    cat: "Misrepresentation & trust",
  }));
}

// ── Deep AI misrepresentation audit → WebIssues (app parity) ──
const DEEP_DOWNGRADE = new Set(["Missing Terms of Service", "Missing Privacy Policy", "Inadequate Shipping Policy", "No Social Presence Detected"]);
function deepCat(category: string): string {
  const c = category.toLowerCase();
  if (c.includes("contact") || c.includes("address") || c.includes("identity")) return "Contact & trust signals";
  if (c.includes("refund") || c.includes("return") || c.includes("terms") || c.includes("privacy") || c.includes("shipping") || c.includes("policy")) return "Policy pages & legal";
  if (c.includes("price") || c.includes("discount") || c.includes("fee") || c.includes("availab")) return "Pricing & availability";
  if (c.includes("ssl") || c.includes("secure")) return "Site security";
  return "Misrepresentation & trust";
}
function deepAIToWebIssues(deepResult: any): WebIssue[] {
  const errs: any[] = (deepResult && deepResult.critical_misrepresentation_errors) || [];
  return errs.map((e: any) => {
    const category = String(e.category || "Risk");
    // Research: only the return/refund policy is an explicitly required page — soften the
    // others to trust notes so we don't hard-fail merchants on non-required pages.
    const sev = DEEP_DOWNGRADE.has(category) ? "Low" : normSev(e.severity);
    const why = (String(e.merchant_friendly_explanation || e.evidence || "") + (e.google_policy_violated ? ` (Google policy: ${e.google_policy_violated})` : "")).slice(0, 400);
    const fix = (Array.isArray(e.remediation_steps) ? e.remediation_steps.join(" ") : "").slice(0, 600);
    return { sev, title: category.slice(0, 200), why, fix, cat: deepCat(category) };
  });
}

// Deterministic deep fallback (used only if the AI audit is unavailable). Research-tuned.
function deepDeterministic(d: DeepAuditData): WebIssue[] {
  const out: WebIssue[] = [];
  if (d.https_enabled === false) out.push({ sev: "High", title: "Store is not served over HTTPS", why: "Google requires a secure connection; an insecure site is a misrepresentation/site-quality trigger.", fix: "Enable SSL on your domain so the whole store loads over https://.", cat: "Site security" });
  const scar = d.scarcity_signals || [];
  if (scar.length) out.push({ sev: "High", title: "Deceptive urgency / fake-scarcity tactics detected", why: `Untrustworthy-promotions / misrepresentation risk. Detected: ${scar.join("; ")}.`, fix: "Remove fake countdown timers, 'only N left' and 'X people viewing' widgets unless the numbers are genuinely real.", cat: "Misrepresentation & trust" });
  const pol: any = d.policy_pages || {};
  if (!pol.refund_return || !pol.refund_return.exists || (pol.refund_return.word_count || 0) < 80)
    out.push({ sev: "High", title: "Missing or thin Refund / Return policy", why: "An unclear, missing, or hard-to-find return & refund policy is explicitly listed under Google's Misrepresentation policy — a top suspension trigger.", fix: "Publish a clear, detailed refund/return policy (timeframes, conditions, how to start a return) and link it in your footer.", cat: "Policy pages & legal" });
  for (const [k, label] of [["shipping", "Shipping"], ["terms", "Terms of service"], ["privacy", "Privacy"]] as const) {
    const pp = pol[k];
    if (!pp || !pp.exists) out.push({ sev: "Low", title: `No ${label} page found`, why: `A ${label.toLowerCase()} page is a trust signal Google reviewers look for (not a hard requirement on its own).`, fix: `Add a ${label.toLowerCase()} page and link it in your footer.`, cat: "Policy pages & legal" });
  }
  const channels = d.contact_channels_found || [];
  if (channels.length < 2) out.push({ sev: "High", title: "Insufficient business contact information", why: `Google expects clear contact details (email, phone and/or a physical address). Found: ${channels.join(", ") || "none"}.`, fix: "Add at least two contact methods — business email, phone and physical address — on a Contact page and in the footer.", cat: "Contact & trust signals" });
  if (!(d.payment_trust_signals || []).length) out.push({ sev: "Low", title: "No payment / secure-checkout trust signals found", why: "Recognisable payment badges reassure shoppers and reviewers.", fix: "Show accepted-payment icons and a secure-checkout badge near the cart and footer.", cat: "Contact & trust signals" });
  return out;
}

function finalize(issues: WebIssue[]) {
  const seen = new Set<string>();
  const deduped = issues.filter((i) => {
    const k = (i.title || "").toLowerCase().slice(0, 80);
    if (!i.title || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  deduped.sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev]);
  const highCount = deduped.filter((i) => i.sev === "High").length;
  const mediumCount = deduped.filter((i) => i.sev === "Medium").length;
  const totalIssues = deduped.length;
  const score = Math.max(8, Math.min(100, 100 - highCount * 14 - mediumCount * 6 - (totalIssues - highCount - mediumCount) * 2));
  const riskLevel: "High" | "Medium" | "Low" = score < 60 ? "High" : score < 80 ? "Medium" : "Low";
  return { issues: deduped, score, riskLevel, totalIssues, highCount };
}

/** Run the scan for a tier and return the finalized issue set (DB-independent; testable). */
export async function computeTierIssues(storeUrl: string, storeDomain: string, tier: string) {
  let host = "";
  try { host = new URL(storeUrl).hostname; } catch { /* invalid */ }
  if (!host || !(await assertPublicHost(host))) throw new Error("Store host is not allowed.");

  const basicResult = await runMonitoringScan(storeUrl);
  if (!basicResult) throw new Error("Could not reach the store to scan it.");
  const mapped = mapBasicResult(basicResult, storeUrl, storeDomain);
  let issues: WebIssue[] = [...mapped.issues];
  const rank = TIER_RANK[tier] || 1;
  let productCount = 0;

  if (rank >= TIER_RANK.advanced) {
    const products = await fetchPublicProducts(storeUrl);
    productCount = products.length;
    if (products.length) {
      try { issues = issues.concat(advancedToWebIssues(computeAdvancedErrors(products as any, false))); } catch (e) { console.error("[web-tier-scan] advanced failed:", e); }
      try { issues = issues.concat(imageResolutionIssue(products)); } catch (e) { console.error("[web-tier-scan] image-res failed:", e); }
    }

    if (rank >= TIER_RANK.deep) {
      // Structured-data sample first — it also gives us the store's currency + a JSON-LD sample
      // for the AI, both needed to seed the Trust & Identity checks accurately.
      let sd: SampleResult = { issues: [], aiSample: { json_ld_schema: "", visual_dom_price: "", simulated_checkout_price: "" }, currency: "" };
      try { sd = await structuredDataSample(storeUrl, products); issues = issues.concat(sd.issues); } catch (e) { console.error("[web-tier-scan] structured-data sample failed:", e); }

      // Seed business identity from PUBLIC pages (the web scan has no Shopify session, so we read
      // the brand name, address, phone, email, country, currency and TLD off the store itself).
      let ident: Awaited<ReturnType<typeof extractWebIdentity>> | null = null;
      try { ident = await extractWebIdentity(storeUrl, storeDomain); } catch (e) { console.error("[web-tier-scan] identity extract failed:", e); }
      // Robust brand name for brand-geography: og:site_name/title → most common product vendor →
      // domain (last resort). The vendor from /products.json is structured + reliable.
      const topVendor = (() => {
        const f: Record<string, number> = {};
        for (const p of products) if (p.brand) f[p.brand] = (f[p.brand] || 0) + 1;
        return Object.entries(f).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
      })();
      const brandName = (ident?.name && ident.name.length > 1) ? ident.name : (topVendor || storeDomain.replace(/^www\./, "").replace(/\.[a-z.]+$/, ""));
      const seed: DeepAuditData = {
        is_password_protected: false,
        business_identity: { name: brandName, domain: storeDomain, legal_address: ident?.address || "", contact_email: ident?.email || "" },
        contact_page_text: ident?.contactText || "",
        sample_product: sd.aiSample,
        active_third_party_apps: [],
        store_meta: {
          phone: ident?.phone || null,
          currency: sd.currency || null,
          country_code: ident?.country || null,
          address_full: ident?.address || null,
          tld: ident?.tld || null,
        },
      };
      let auditData = seed;
      try { auditData = await enrichDeepData(seed, storeUrl, products as any); } catch (e) { console.error("[web-tier-scan] enrich failed:", e); }

      // TRUST & IDENTITY LAYER — deterministic misrepresentation findings (registered-agent address,
      // brand-geography, new/untrusted domain, concealed fulfillment, NAP), same as the embedded app.
      try { issues = issues.concat(trustToWebIssues(deriveTrustFindings(auditData))); } catch (e) { console.error("[web-tier-scan] trust layer failed:", e); }

      // Full AI misrepresentation audit (contradictions etc., app parity), with a deterministic fallback.
      try {
        const deepResult = await runGeminiJson(buildDeepPrompt(auditData), 120000, "web-deep");
        try { reconcileDeepResult(deepResult, auditData); } catch { /* non-fatal */ }
        const ai = deepAIToWebIssues(deepResult);
        issues = issues.concat(ai.length ? ai : deepDeterministic(auditData));
      } catch (e) {
        console.error("[web-tier-scan] deep AI failed, using deterministic fallback:", e);
        issues = issues.concat(deepDeterministic(auditData));
      }
    }
  }

  const result = finalize(issues);
  return { ...result, productCount };
}

/** Background entry point: run the paid tier's scan for a WebScan row and persist the
 *  fully-unlocked result. Idempotent, self-contained, never throws. */
export async function runWebTierScan(scanId: string, tier: string): Promise<void> {
  const scan = await prisma.webScan.findUnique({ where: { id: scanId } });
  if (!scan) return;
  try {
    await prisma.webScan.update({ where: { id: scanId }, data: { scanStatus: "PROCESSING" } });
    const r = await computeTierIssues(scan.storeUrl, scan.storeDomain, tier);
    await prisma.webScan.update({
      where: { id: scanId },
      data: {
        fullResult: r.issues as any, score: r.score, riskLevel: r.riskLevel,
        totalIssues: r.totalIssues, highCount: r.highCount, productsScanned: r.productCount || 0,
        scanStatus: "COMPLETE", scanError: null,
      },
    });
  } catch (e: any) {
    console.error("[web-tier-scan] failed for", scanId, e);
    await prisma.webScan.update({ where: { id: scanId }, data: { scanStatus: "FAILED", scanError: String(e?.message || e).slice(0, 300) } }).catch(() => {});
  }
}
