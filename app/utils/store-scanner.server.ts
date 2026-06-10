import { parse } from "node-html-parser";
import { optimizeHtmlForAI, extractReadableText } from "./dom-optimizer.server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { retryOperation } from "./retry";
import prisma from "../db.server";

const BROWSER_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

// Key store pages to scan.
// For policy pages, we check both the Shopify built-in /policies/... path
// AND the /pages/... path (created by our Auto Fix feature).
// The scanner will mark a policy as present if EITHER URL responds with content.
const PAGES_TO_SCAN = [
  { path: "/",                           label: "Homepage",                  required: true,  altPath: null },
  { path: "/policies/privacy-policy",    label: "Privacy Policy",            required: true,  altPath: "/pages/privacy-policy"  },
  { path: "/policies/refund-policy",     label: "Refund/Return Policy",      required: true,  altPath: "/pages/refund-policy"   },
  { path: "/policies/shipping-policy",   label: "Shipping Policy",           required: true,  altPath: "/pages/shipping-policy" },
  { path: "/policies/terms-of-service",  label: "Terms of Service",          required: false, altPath: "/pages/terms-of-service"},
  { path: "/pages/contact",              label: "Contact Page",              required: true,  altPath: "/contact"               },
  { path: "/pages/about-us",             label: "About Us",                  required: false, altPath: null },
];

/** Detect if an HTML page is Shopify's storefront password page */
function isPasswordPage(html: string, finalUrl?: string): boolean {
  if (finalUrl && (finalUrl.endsWith("/password") || finalUrl.includes("/password?"))) return true;
  return (
    html.includes("storefront_password") ||
    html.includes("password_form") ||
    (html.includes('type="password"') &&
      (html.includes("Enter store using password") ||
        html.includes("store is protected") ||
        html.includes("password to enter")))
  );
}

/** Fetch with optional cookie string (used after password unlock) */
async function safeFetch(
  url: string,
  timeoutMs = 15000,
  cookie?: string
): Promise<{ html: string | null; status: number; finalUrl?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers: Record<string, string> = { ...BROWSER_HEADERS };
    if (cookie) headers["Cookie"] = cookie;
    const res = await fetch(url, {
      headers,
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!res.ok) return { html: null, status: res.status };
    const html = await res.text();
    return { html, status: res.status, finalUrl: res.url };
  } catch {
    return { html: null, status: 0 };
  }
}

/**
 * Read Set-Cookie headers correctly. `headers.get("set-cookie")` joins multiple
 * cookies with ", " AND keeps the commas inside `Expires=` dates, so splitting on
 * "," corrupts the values. `getSetCookie()` returns each cookie as its own entry.
 */
function readSetCookies(res: Response): string[] {
  const anyHeaders = res.headers as any;
  if (typeof anyHeaders.getSetCookie === "function") {
    return anyHeaders.getSetCookie() as string[];
  }
  const raw = res.headers.get("set-cookie");
  return raw ? [raw] : [];
}

/** Merge `Set-Cookie` values from a response into a name→value jar (later wins). */
function mergeCookies(jar: Map<string, string>, res: Response): void {
  for (const c of readSetCookies(res)) {
    const pair = c.split(";")[0];
    const idx = pair.indexOf("=");
    if (idx > 0) {
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (name) jar.set(name, value);
    }
  }
}

function jarToCookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

/**
 * Attempt to unlock a password-protected Shopify store.
 * Returns the cookie string to use in subsequent requests, or null if password is wrong.
 */
export async function unlockStorefront(
  baseUrl: string,
  password: string
): Promise<{ cookie: string | null; error?: string }> {
  try {
    const jar = new Map<string, string>();

    // First GET the password page to grab the authenticity_token (CSRF) + session cookies.
    const getController = new AbortController();
    const getTimer = setTimeout(() => getController.abort(), 10000);
    const pageRes = await fetch(`${baseUrl}/password`, {
      headers: BROWSER_HEADERS,
      signal: getController.signal,
    });
    clearTimeout(getTimer);
    const pageHtml = await pageRes.text();
    mergeCookies(jar, pageRes);

    const tokenMatch = pageHtml.match(/name="authenticity_token"\s+value="([^"]+)"/);
    const authToken = tokenMatch?.[1] || "";

    // POST the password with the session cookies from the GET.
    const postController = new AbortController();
    const postTimer = setTimeout(() => postController.abort(), 10000);
    const postRes = await fetch(`${baseUrl}/password`, {
      method: "POST",
      headers: {
        ...BROWSER_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        ...(jar.size ? { Cookie: jarToCookieHeader(jar) } : {}),
      },
      body: new URLSearchParams({
        form_type: "storefront_password",
        utf8: "✓",
        authenticity_token: authToken,
        password,
      }).toString(),
      redirect: "manual", // Don't follow — we need the Set-Cookie header
      signal: postController.signal,
    });
    clearTimeout(postTimer);
    mergeCookies(jar, postRes);

    const allCookies = jarToCookieHeader(jar);
    const location = postRes.headers.get("location") || "";
    const unlocked =
      !location.includes("/password") &&
      (postRes.status === 302 || postRes.status === 303 || postRes.status === 200);

    // Authoritative check: fetch the homepage with the jar and confirm it is no
    // longer the password page. This is the truth — only return the cookie if the
    // store actually opened, so we never scan the locked password page by mistake.
    if (allCookies) {
      const verifyRes = await safeFetch(`${baseUrl}/`, 8000, allCookies);
      if (verifyRes.html && !isPasswordPage(verifyRes.html, verifyRes.finalUrl)) {
        return { cookie: allCookies };
      }
    }

    // Verification didn't confirm; trust the redirect only if it pointed away
    // from /password (some themes set the unlock cookie on the redirect target).
    if (unlocked && allCookies) {
      const retry = await safeFetch(`${baseUrl}/`, 8000, allCookies);
      if (retry.html && !isPasswordPage(retry.html, retry.finalUrl)) {
        return { cookie: allCookies };
      }
    }

    return { cookie: null, error: "Incorrect password. Please check and try again." };
  } catch (err: any) {
    return { cookie: null, error: `Could not connect to store: ${err.message}` };
  }
}

/** Extract all internal links from a page's nav/header/footer.
 *  Uses broad selectors to catch all common Shopify theme footer patterns. */
function extractNavLinks(html: string, baseUrl: string): string[] {
  const root = parse(html);
  const links: string[] = [];
  // Broad selectors — Shopify themes vary wildly in their footer markup.
  // Many use <div class="footer">, <section class="footer-section">, or
  // data attributes instead of a semantic <footer> tag.
  const selectors = [
    "footer a",
    "nav a",
    "header a",
    "[role='navigation'] a",
    "[class*='footer'] a",
    "[id*='footer'] a",
    "[class*='Footer'] a",
    "[id*='Footer'] a",
    "[class*='site-bottom'] a",
    "[class*='bottom-bar'] a",
  ];
  for (const sel of selectors) {
    try {
      root.querySelectorAll(sel).forEach((el: any) => {
        const href = el.getAttribute("href") || "";
        if (href.startsWith("/") || href.startsWith(baseUrl)) {
          const full = href.startsWith("/") ? `${baseUrl}${href}` : href;
          links.push(full);
        }
      });
    } catch { /* selector not supported by node-html-parser — skip */ }
  }
  return Array.from(new Set(links)).slice(0, 60);
}

/** Check a batch of URLs for 404s — returns broken ones */
async function checkLinksForBroken(urls: string[], cookie?: string): Promise<string[]> {
  const results = await Promise.allSettled(urls.map((url) => safeFetch(url, 8000, cookie)));
  return urls.filter((_, i) => {
    const r = results[i];
    return r.status === "fulfilled" && (r.value.status === 404 || r.value.status === 0);
  });
}

interface PageScanResult {
  path: string;
  label: string;
  required: boolean;
  status: number;
  exists: boolean;
  foundAt: string; // actual URL that responded (primary or alt)
  markdown: string;
}

// Keyword patterns to recognize policy/contact pages under ANY slug. Kept in sync
// with REQUIRED_FOOTER_VARIANTS so footer-link validation and page discovery agree.
const POLICY_LINK_PATTERNS: Array<{ key: string; pattern: RegExp }> = [
  { key: "privacy",  pattern: /privacy/i },
  { key: "refund",   pattern: /refund|returns?/i },
  { key: "shipping", pattern: /shipping|delivery/i },
  { key: "terms",    pattern: /terms|conditions|\btos\b/i },
  { key: "contact",  pattern: /contact|support/i },
];

/** Maps a PAGES_TO_SCAN label to its discovered-policy key. */
const DISCOVERY_KEY_BY_LABEL: Record<string, string> = {
  "Privacy Policy": "privacy",
  "Refund/Return Policy": "refund",
  "Shipping Policy": "shipping",
  "Terms of Service": "terms",
  "Contact Page": "contact",
};

/**
 * Discover the real URL of each policy/contact page from the homepage's internal
 * links (footer + nav + anywhere). Lets the scanner find pages that live under
 * CUSTOM slugs — e.g. /pages/returns-and-refunds, /pages/terms-and-conditions,
 * /pages/contact-us — which the conventional /policies/* and /pages/<standard>
 * probes miss. Returns { privacy, refund, shipping, terms, contact } → absolute URL.
 */
function discoverPolicyLinks(html: string, baseUrl: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const root = parse(html);
    root.querySelectorAll("a[href]").forEach((el: any) => {
      const href = (el.getAttribute("href") || "").trim();
      if (!href || href.startsWith("#") || /^(mailto:|tel:|javascript:)/i.test(href)) return;
      const full = href.startsWith("/") ? `${baseUrl}${href}` : href;
      if (!full.toLowerCase().startsWith(baseUrl.toLowerCase())) return; // internal only
      // Only consider real content pages, not account/cart/collections/products.
      if (/\/(cart|account|collections|products|blogs|search)(\/|$|\?)/i.test(full)) return;
      const text = (el.text || "").trim();
      const hay = `${full} ${text}`.toLowerCase();
      for (const { key, pattern } of POLICY_LINK_PATTERNS) {
        if (!out[key] && pattern.test(hay)) out[key] = full.split("#")[0].split("?")[0];
      }
    });
  } catch { /* non-fatal */ }
  return out;
}

/** Main scanner — fetches all pages, optimizes HTML, returns structured data for AI */
async function gatherStoreData(
  baseUrl: string,
  cookie?: string
): Promise<{ pages: PageScanResult[]; brokenNavLinks: string[]; footerLinks: string[]; baseUrl: string; discoveredPolicies: Record<string, string> }> {
  // Fetch the homepage ONCE up front and reuse it for page content, footer/nav
  // link extraction, and policy/contact discovery (so custom slugs are found).
  const homeFetch = await safeFetch(`${baseUrl}/`, 15000, cookie);
  const homepageHtml = homeFetch.html;
  const discoveredPolicies = homepageHtml ? discoverPolicyLinks(homepageHtml, baseUrl) : {};

  const pageResults: PageScanResult[] = await Promise.all(
    PAGES_TO_SCAN.map(async (page) => {
      // Homepage: reuse the HTML already fetched (no second request).
      if (page.path === "/") {
        if (!homepageHtml) return { ...page, status: homeFetch.status, exists: false, foundAt: "/", markdown: "" };
        const { markdown } = optimizeHtmlForAI(homepageHtml);
        return { ...page, status: homeFetch.status || 200, exists: true, foundAt: "/", markdown: markdown.substring(0, 6000) };
      }

      // Try primary path
      const primaryUrl = `${baseUrl}${page.path}`;
      let { html, status } = await safeFetch(primaryUrl, 15000, cookie);

      // If primary not found, try altPath
      let foundAt = page.path;
      if ((!html || status === 404 || status === 0) && page.altPath) {
        const altUrl = `${baseUrl}${page.altPath}`;
        const alt = await safeFetch(altUrl, 10000, cookie);
        if (alt.html && alt.status !== 404 && alt.status !== 0) {
          html = alt.html;
          status = alt.status;
          foundAt = page.altPath;
        }
      }

      // Custom-slug fallback: use the URL discovered from the homepage links
      // (e.g. /pages/returns-and-refunds, /pages/contact-us) so a present page on
      // a non-standard slug isn't falsely reported as missing.
      if (!html || status === 404 || status === 0) {
        const dkey = DISCOVERY_KEY_BY_LABEL[page.label];
        const durl = dkey ? discoveredPolicies[dkey] : undefined;
        if (durl && durl !== primaryUrl) {
          const d = await safeFetch(durl, 10000, cookie);
          if (d.html && d.status !== 404 && d.status !== 0) {
            html = d.html;
            status = d.status;
            foundAt = durl.toLowerCase().startsWith(baseUrl.toLowerCase()) ? durl.slice(baseUrl.length) : durl;
          }
        }
      }

      if (!html) return { ...page, status, exists: false, foundAt: page.path, markdown: "" };

      // Clean readable content only — the raw dataScripts blobs (JSON-LD / state)
      // are not used by the compliance checks and wasted ~2K tokens per page.
      const { markdown } = optimizeHtmlForAI(html);

      return {
        ...page,
        status,
        exists: true,
        foundAt,
        markdown: markdown.substring(0, 6000),
      };
    })
  );

  let brokenNavLinks: string[] = [];
  let footerLinks: string[] = [];

  if (homepageHtml) {
    const navLinks = extractNavLinks(homepageHtml, baseUrl);
    brokenNavLinks = await checkLinksForBroken(navLinks.slice(0, 20), cookie);

    // Extract footer links explicitly for the AI prompt
    const root = parse(homepageHtml);
    root.querySelectorAll("footer a, .footer a, [class*='footer'] a").forEach((el: any) => {
      const href = el.getAttribute("href") || "";
      const text = el.text?.trim() || "";
      if (href && text) {
        const full = href.startsWith("/") ? `${baseUrl}${href}` : href;
        footerLinks.push(`${text} → ${full}`);
      }
    });
    footerLinks = Array.from(new Set(footerLinks)).slice(0, 30);
  }

  return { pages: pageResults, brokenNavLinks, footerLinks, baseUrl, discoveredPolicies };
}

// ── Prompt: Basic Scan (Store Fundamentals & Legal Compliance) ─────────────────

function buildBasicPrompt(data: ReturnType<typeof gatherStoreData> extends Promise<infer T> ? T : never): string {
  const { pages, brokenNavLinks, baseUrl, footerLinks, discoveredPolicies } = data as any;

  // Structured INPUT DATA block
  const isPasswordProtected = pages.some((p: any) => p.path === "/" && !p.exists && p.status === 0);

  const footerLinksText = footerLinks && footerLinks.length > 0
    ? footerLinks.map((l: string) => `- ${l}`).join("\n")
    : "No footer links detected.";

  const homePage = pages.find((p: any) => p.path === "/");
  const contactPage = pages.find((p: any) => p.path === "/pages/contact");
  const headerFooterContent = [
    homePage?.exists ? `[Homepage nav/footer excerpt]\n${homePage.markdown.substring(0, 3000)}` : "",
    contactPage?.exists ? `[Contact page excerpt]\n${contactPage.markdown.substring(0, 2000)}` : "",
    `[Footer links]\n${footerLinksText}`,
  ].filter(Boolean).join("\n\n");

  const contactInfo = [
    contactPage?.exists ? contactPage.markdown.substring(0, 1500) : "",
    homePage?.exists ? homePage.markdown.substring(0, 500) : "",
  ].filter(Boolean).join("\n");

  // Deterministic ground truth the AI can rely on (code's job = supply complete,
  // clean data; the AI's job = judge compliance across any store layout):
  //  - contact_channels_found: contact methods actually detected on the live store
  //  - discovered_pages: real policy/contact URLs found in the store's own links,
  //    so pages under custom slugs are KNOWN to exist.
  const channelCorpus = `${contactInfo}\n${(footerLinks || []).join("\n")}`;
  const contactChannels: string[] = [];
  if (/mailto:|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(channelCorpus)) contactChannels.push("email");
  if (/tel:|(?:\+?\d[\d\s().-]{7,}\d)/.test(channelCorpus)) contactChannels.push("phone");
  if (looksLikeAddress(channelCorpus)) contactChannels.push("physical address");

  const discoveredPagesText = discoveredPolicies && Object.keys(discoveredPolicies).length
    ? Object.entries(discoveredPolicies).map(([k, v]) => `- ${k}: ${v}`).join("\n")
    : "None discovered from homepage links.";

  // Pages already confirmed missing/broken by HTTP — provide as ground truth
  const confirmedMissingPages = pages
    .filter((p: any) => p.required && !p.exists)
    .map((p: any) => `${p.label} → ${baseUrl}${p.path} (HTTP ${p.status || "timeout"})`);

  const confirmedBrokenLinks = brokenNavLinks.map((u: string) => u);

  // Full page content for reference
  const pagesSummary = pages
    .filter((p: any) => p.exists)
    .map((p: any) => `### ${p.label} (${baseUrl}${p.foundAt || p.path})\n${p.markdown}`)
    .join("\n\n---\n");

  return `You are an expert Google Merchant Center (GMC) Compliance Auditor AI. Your job is to analyze the provided content of a Shopify store's pages, footer, and navigation links to ensure it meets Google's strict baseline requirements for Shopping Ads.

STRICT EVALUATION RULES (FOR CONSISTENCY):
1. DO NOT assume or guess. Evaluate ONLY the data explicitly provided in the INPUT DATA block below.
2. If a required page or detail is present in the provided data, it PASSES. If it is entirely missing, it FAILS. Do not generate false positives.
3. Your output MUST be a valid JSON object. Do not include markdown formatting like \`\`\`json or any conversational text outside the JSON.
4. The CONFIRMED MISSING PAGES and CONFIRMED BROKEN LINKS lists below are verified HTTP facts — treat them as absolute ground truth, not as AI guesses.

INPUT DATA:
{
  "store_url": "${baseUrl}",
  "is_password_protected": ${isPasswordProtected},
  "header_footer_text_and_links": ${JSON.stringify(headerFooterContent.substring(0, 4000))},
  "extracted_contact_info": ${JSON.stringify(contactInfo.substring(0, 2000))},
  "contact_channels_found": ${JSON.stringify(contactChannels)}
}

DISCOVERED POLICY/CONTACT PAGES (real URLs found in the store's OWN footer/nav links — these pages EXIST and are LINKED, even under custom slugs):
${discoveredPagesText}

CONFIRMED MISSING PAGES (verified via HTTP — these are definite failures):
${confirmedMissingPages.length > 0 ? confirmedMissingPages.join("\n") : "None — all required pages responded with content."}

CONFIRMED BROKEN LINKS (verified 404/timeout):
${confirmedBrokenLinks.length > 0 ? confirmedBrokenLinks.join("\n") : "None detected."}

FULL PAGE CONTENT (use for detailed analysis only — do not contradict the CONFIRMED lists above):
${pagesSummary}

---

CHECKS TO PERFORM:
1. Missing Essential Pages: The store MUST have distinct, working pages for: "Privacy Policy", "Terms of Service" (or Terms and Conditions), "Contact Us", "Shipping Policy", and "Refund/Return Policy". Use the CONFIRMED MISSING PAGES list as the authoritative source. A page listed under DISCOVERED POLICY/CONTACT PAGES EXISTS (it was found via the store's own links) — NEVER flag it as missing even if its slug is non-standard. Only flag a page as missing if it appears in CONFIRMED MISSING PAGES AND is not in DISCOVERED POLICY/CONTACT PAGES.
2. Contact Information: The store MUST display at least two of: a physical business address, a support email, or a phone number. contact_channels_found lists the channels detected deterministically on the live store — if it contains 2 or more entries, contact info is SUFFICIENT and you MUST NOT flag it. Only flag "business_contact" when fewer than two channels are evidenced across contact_channels_found and extracted_contact_info combined.
3. Broken Navigation Links: Use the CONFIRMED BROKEN LINKS list. Do not flag any URL that is not in that list.
4. Footer/Navigation Compliance (CRITICAL for GMC): The store footer MUST contain visible links to Privacy Policy, Refund/Return Policy, Shipping Policy, Terms of Service, and Contact page. Evaluate against header_footer_text_and_links AND the [Footer links] list. A link COUNTS AS PRESENT even under a custom slug or alternate wording — e.g. "Returns and Refunds" or "/pages/returns-and-refunds" satisfies Refund/Return Policy; "Terms and Conditions" or "/pages/terms-and-conditions" satisfies Terms of Service; "Contact Us" or "/pages/contact-us" satisfies Contact. Only flag a SINGLE "footer_links" issue if a required link is genuinely absent from BOTH lists. NEVER flag based on slug naming differences alone. Any page in DISCOVERED POLICY/CONTACT PAGES is already linked from the store — do not flag its link as missing.
5. Password Protection: If is_password_protected is true, add ONE Medium severity issue in site_structure_and_seo: "Store is password-protected — disable this before going live so Google bots can crawl the store." Set auto_fixable=false, auto_fix_type=null. Do NOT attribute any other failures to password protection.

FIELD RULES:
- Severity: "High" = GMC disapproval or suspension risk; "Medium" = trust/SEO impact; "Low" = best-practice improvement.
- auto_fixable = true ONLY for issues fixable via Shopify Admin API.
- auto_fix_type must be exactly one of: "privacy_policy", "refund_policy", "shipping_policy", "terms_of_service", "contact_page", "about_page", "page_meta", "footer_links", "business_contact", or null.
- credit_cost: 1 = simple text/meta fix, 2 = page creation, 3 = policy/footer fix requiring AI generation, 5 = complex multi-step.
- For "footer_links": auto_fixable=true, credit_cost=3.
- For "business_contact": auto_fixable=true, credit_cost=2.
- detailed_fix_steps: exactly 3–5 specific numbered steps a merchant can follow manually in Shopify Admin.

OUTPUT FORMAT:
Return ONLY a valid JSON object — no markdown fences, no extra text:
{
  "scan_summary": {
    "store_url": "${baseUrl}",
    "pages_scanned": ${pages.filter((p: any) => p.exists).length},
    "pages_missing": ${pages.filter((p: any) => p.required && !p.exists).length},
    "broken_links_found": ${brokenNavLinks.length},
    "overall_risk": "High | Medium | Low"
  },
  "merchant_center_compliance": [
    {
      "issue_description": "Concise description of what was found in the provided data.",
      "severity": "High",
      "suggested_fix": "Exact action the merchant must take.",
      "detailed_fix_steps": ["Step 1: ...", "Step 2: ...", "Step 3: ..."],
      "auto_fixable": true,
      "auto_fix_type": "privacy_policy",
      "credit_cost": 3
    }
  ],
  "customer_trust_and_policy": [
    {
      "issue_description": "...",
      "severity": "High",
      "suggested_fix": "...",
      "detailed_fix_steps": ["Step 1: ...", "Step 2: ...", "Step 3: ..."],
      "auto_fixable": false,
      "auto_fix_type": null,
      "credit_cost": 1
    }
  ],
  "site_structure_and_seo": [
    {
      "issue_description": "...",
      "severity": "Medium",
      "suggested_fix": "...",
      "detailed_fix_steps": ["Step 1: ...", "Step 2: ...", "Step 3: ..."],
      "auto_fixable": false,
      "auto_fix_type": null,
      "credit_cost": 1
    }
  ],
  "missing_pages": [
    {
      "label": "...",
      "url": "...",
      "severity": "High",
      "suggested_fix": "...",
      "detailed_fix_steps": ["Step 1: ...", "Step 2: ...", "Step 3: ..."],
      "auto_fixable": true,
      "auto_fix_type": "privacy_policy",
      "credit_cost": 3
    }
  ],
  "broken_links": [
    {
      "url": "...",
      "severity": "High",
      "suggested_fix": "...",
      "detailed_fix_steps": ["Step 1: ...", "Step 2: ...", "Step 3: ..."],
      "auto_fixable": false,
      "auto_fix_type": null,
      "credit_cost": 1
    }
  ]
}`;
}

// Keep legacy alias so processStoreScan callers don't break
const buildPrompt = buildBasicPrompt;

// ── Prompt: Advanced Scan (Product Feed Data & Accuracy) ──────────────────────

export function buildAdvancedPrompt(products: Array<{
  id: string;
  title: string;
  description: string;
  link: string;
  image_url: string;
  image_width: number;
  image_height: number;
  gtin: string | null;
  mpn: string | null;
  brand: string | null;
  price: number;
  compare_at_price: number | null;
  weight: number | null;
  availability: string;
}>, isPasswordProtected: boolean): string {
  return `You are the lead Google Merchant Center (GMC) Compliance & Product Data Expert for the ShopFlix AI app. Your job is to analyze a JSON array of Shopify products, flag errors that violate Google's strict policies, and output a highly descriptive, non-technical remediation report containing automated fix parameters.

STRICT EVALUATION RULES (FOR CONSISTENCY):
1. Evaluate ONLY the data provided. Do not guess or hallucinate.
2. Every single error object MUST contain clear, layperson explanations, a click-by-click manual solution, and a precise backend payload for your app's "Auto-Fix" function.
3. Your output MUST be a valid JSON object. Do not include markdown code block syntax (like \`\`\`json) or any conversational text outside the JSON structure.

INPUT DATA:
${JSON.stringify({ is_password_protected: isPasswordProtected, products }, null, 2)}

CHECKS & POLICIES TO ENFORCE:
1. Basic Syntax: Missing mandatory attributes ('title', 'id', 'link', 'description').
2. Product Identifiers: Missing or invalid unique product identifiers. Google's rules require the 'brand' attribute AND at least one unique identifier ('gtin' or 'mpn'). If all three are missing, or if brand is present but both GTIN and MPN are missing, flag it.
3. Deceptive Pricing Logic: The 'compare_at_price' (MRP) MUST be strictly greater than the 'price' (Sale Price). If 'compare_at_price' <= 'price', it is a deceptive pricing violation. If 'compare_at_price' is blank or 0, skip this check.
4. Image Quality & Overlays: Flag images with dimensions under 100x100 pixels. Flag images if the URL string indicates promotional overlays (contains "sale", "promo", "watermark").
5. Password Protection: If is_password_protected is true, add exactly this string to store_warnings: "Before going live, please remove the password protection to ensure GMC bots can crawl your site."

OUTPUT FORMAT:
Return ONLY a valid JSON object — no markdown fences, no extra text:
{
  "scan_type": "advanced",
  "status": "pass | fail",
  "affected_products_count": 0,
  "store_warnings": [],
  "errors_found": [
    {
      "product_id": "...",
      "product_title": "...",
      "policy_violation_type": "Deceptive Pricing Logic | Missing Identifiers | Missing Description | Image Policy Violation",
      "merchant_friendly_description": "A clear, descriptive, jargon-free explanation of exactly what is wrong and why Google will reject or suspend the product for this.",
      "manual_fix_steps": [
        "Step 1: Log into your Shopify Admin dashboard.",
        "Step 2: Go to 'Products' and click on [Product Title].",
        "Step 3: ...",
        "Step 4: Click Save."
      ],
      "autofix_metadata": {
        "can_autofix": true,
        "action_required": "update_product_variant_fields | generate_placeholder_identifier | strip_image_overlay",
        "target_fields": {
          "compare_at_price": "Suggest a correct safe price value or null if resetting",
          "gtin": "Suggest 'Custom Product' flag configuration or identifier if applicable",
          "description": "Provide a brief AI-generated placeholder description if it was entirely missing"
        }
      }
    }
  ]
}`;
}

// ── Prompt: Deep Scan (Misrepresentation & Checkout Audit) ────────────────────

export interface DeepAuditData {
  is_password_protected: boolean;
  business_identity: { name: string; domain: string; legal_address: string; contact_email?: string };
  contact_page_text: string;
  /** Deterministically detected contact channels (email / phone / physical address)
   *  found in the footer, contact page, or store settings. Authoritative — the AI
   *  must treat 2+ channels here as sufficient contact information. */
  contact_channels_found?: string[];
  homepage_text?: string;
  https_enabled?: boolean;
  policy_pages?: {
    refund_return?: { exists: boolean; word_count: number };
    shipping?: { exists: boolean; word_count: number };
    terms?: { exists: boolean; word_count: number };
    privacy?: { exists: boolean; word_count: number };
  };
  social_links?: string[];
  payment_trust_signals?: string[];
  scarcity_signals?: string[];
  popup_signals?: string[];
  product_samples?: Array<{ title: string; price: number; compare_at_price: number | null; availability: string }>;
  sample_product: {
    json_ld_schema: string;
    visual_dom_price: string;
    simulated_checkout_price: string;
  };
  active_third_party_apps: string[];
}

export function buildDeepPrompt(deepData: DeepAuditData): string {
  return `You are a senior Google Merchant Center (GMC) Policy Enforcement & Account Suspension Prevention AI. Google suspends Shopping accounts most often for "Misrepresentation", "Insufficient Contact Information", "Untrustworthy Promotions", and "Conditions Not Met". Your job is to perform an EXHAUSTIVE, robust audit of the store data below and surface EVERY signal that could trigger a Google review, warning, or suspension — so the merchant can fix them before Google ever finds them, or appeal an existing suspension.

STRICT EVALUATION RULES (FOR CONSISTENCY):
1. Base all findings ONLY on the provided INPUT DATA. Do not invent data that is not present, but DO reason about whether each required trust/transparency signal is PRESENT or ABSENT.
2. Be thorough and slightly conservative: if a signal that Google requires for trust is MISSING from the data, flag it as a risk (absence of required trust info IS itself a suspension risk under GMC's "Misrepresentation" and "Insufficient Contact Information" policies).
3. Each finding must be specific, descriptive, and actionable for a non-technical merchant.
4. Your output MUST be a valid JSON object. Do not include markdown like \`\`\`json or any text outside the JSON.

INPUT DATA:
${JSON.stringify(deepData)}

COMPREHENSIVE CHECKS TO PERFORM (evaluate ALL of these — report each as a separate finding when there is a risk):

A. BUSINESS IDENTITY & MISREPRESENTATION
1. Business Identity Consistency: Does business_identity (name, domain, legal_address) appear consistently in contact_page_text and homepage_text? Flag mismatches or a generic/placeholder business name as "Business Identity Mismatch".
2. Missing Physical Address: Google requires a verifiable physical business address. Treat a physical address as PRESENT if contact_channels_found includes "physical address", OR legal_address is non-empty, OR an address appears in contact_page_text or homepage_text. Only flag "Missing Business Address" when NONE of these show an address.
3. Missing/Generic Contact Channels: Google requires multiple ways to contact the business (email, phone, physical address, or contact form). contact_channels_found is the AUTHORITATIVE, deterministically-detected list of channels present on the live store — if it contains 2 OR MORE channels, contact information is SUFFICIENT and you MUST NOT flag "Insufficient Contact Information" (and MUST NOT claim the contact page is "mostly code" or hides details). Only flag "Insufficient Contact Information" when fewer than two channels are evidenced across contact_channels_found, contact_page_text, and homepage_text combined.

B. POLICY & TRANSPARENCY (Conditions Not Met)
4. Refund/Return Policy Quality: Using policy_pages.refund_return, if it does not exist OR word_count is very low (< 80 words ≈ too thin to be a real policy), flag "Inadequate Refund/Return Policy".
5. Shipping Policy Quality: Using policy_pages.shipping, if missing or too thin (< 50 words), flag "Inadequate Shipping Policy".
6. Terms of Service: If policy_pages.terms is missing, flag "Missing Terms of Service".
7. Privacy Policy: If policy_pages.privacy is missing, flag "Missing Privacy Policy".

C. TRUST & SECURITY SIGNALS
8. Secure Connection: If https_enabled is false, flag "No SSL / Insecure Connection" (High severity).
9. Payment Transparency: If payment_trust_signals is empty (no visible accepted-payment icons or secure-checkout badge), flag "Missing Payment/Trust Signals".
10. Social Proof / Legitimacy: If social_links is empty, flag a Low-severity "No Social Presence Detected" trust note.

D. DECEPTIVE / UNTRUSTWORTHY PROMOTIONS
11. Fake Scarcity & Urgency: Inspect scarcity_signals, popup_signals, homepage_text, and active_third_party_apps for countdown timers, "only X left", fake live-visitor counters, or aggressive urgency pop-ups. Flag each as "Deceptive Urgency / Fake Scarcity".
12. Deceptive Apps: Flag any app in active_third_party_apps known for fake scarcity, fake reviews, or manipulative pop-ups as "Deceptive App Detected".

E. PRICING & AVAILABILITY ACCURACY (Misrepresentation)
13. Structured Data Mismatch: Compare price/currency in sample_product.json_ld_schema vs sample_product.visual_dom_price. Flag exact-value discrepancies as "Structured Data / Price Mismatch".
14. Hidden Fees at Checkout: If sample_product.simulated_checkout_price is higher than visual_dom_price beyond standard shipping/tax, flag "Hidden Fees / Checkout Price Mismatch".
15. Deceptive Discounts: In product_samples, flag any product whose compare_at_price is present but <= price (a fake "was" price) as "Deceptive Discount Pricing".
16. Inaccurate Availability: Note any product_samples marked "out of stock" still being advertised, as a Medium trust note.

F. CRAWLABILITY
17. Password Protection: If is_password_protected is true, add to store_warnings exactly: "Before going live, please remove the password protection to ensure GMC bots can crawl your site."

SEVERITY GUIDE: "High" = direct suspension/disapproval trigger; "Medium" = trust/review risk; "Low" = best-practice improvement.

Also produce a "passed_checks" array: short labels of the trust/compliance checks the store PASSED (so the merchant sees what is already good). And a "summary" one-sentence overall assessment.

OUTPUT FORMAT (return ONLY this JSON — include as many findings as apply, do not limit to one):
{
  "scan_type": "deep",
  "suspension_risk": "Low | Medium | High",
  "summary": "One-sentence overall assessment of suspension risk.",
  "store_warnings": [],
  "passed_checks": ["e.g. Privacy Policy present", "HTTPS enabled", "..."],
  "critical_misrepresentation_errors": [
    {
      "category": "Business Identity Mismatch | Missing Business Address | Insufficient Contact Information | Inadequate Refund/Return Policy | Inadequate Shipping Policy | Missing Terms of Service | Missing Privacy Policy | No SSL / Insecure Connection | Missing Payment/Trust Signals | No Social Presence Detected | Deceptive Urgency / Fake Scarcity | Deceptive App Detected | Structured Data / Price Mismatch | Hidden Fees / Checkout Price Mismatch | Deceptive Discount Pricing | Inaccurate Availability",
      "severity": "High | Medium | Low",
      "evidence": "The exact data point (or its absence) that caused the flag.",
      "merchant_friendly_explanation": "Plain-English explanation of what is wrong and WHY Google may suspend or review the store for this.",
      "google_policy_violated": "Name of the relevant GMC policy (e.g. Misrepresentation, Insufficient Contact Information, Untrustworthy Promotions, Conditions Not Met).",
      "remediation_steps": ["Step 1...", "Step 2...", "Step 3..."]
    }
  ]
}`;
}

/** Shared helper — run Gemini with a prompt and return parsed JSON */
async function runGeminiJson(prompt: string, timeoutMs = 180000, retryId = "scan"): Promise<any> {
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
  });
  const aiText = await retryOperation(async () => {
    const result = await Promise.race([
      model.generateContent(prompt),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("AI timed out")), timeoutMs)),
    ]);
    return (await (result as any).response).text();
  }, 3, 2000, retryId);
  const start = aiText.indexOf("{");
  const end = aiText.lastIndexOf("}");
  return JSON.parse(aiText.substring(start, end + 1));
}

// ── Deterministic reconciliation (authoritative live-store validation) ─────────
// Maps a storefront path to the auto_fix_type the auto-fix engine uses.
const FIX_TYPE_BY_PATH: Record<string, string> = {
  "/policies/privacy-policy": "privacy_policy",
  "/policies/refund-policy": "refund_policy",
  "/policies/shipping-policy": "shipping_policy",
  "/policies/terms-of-service": "terms_of_service",
  "/pages/contact": "contact_page",
  "/pages/about-us": "about_page",
};

// The links GMC actually requires to be visible site-wide. About Us is NOT
// required by Google, so it is intentionally excluded — requiring it caused the
// footer issue to be flagged forever on stores that legitimately omit it.
// Match required footer links by KEYWORD (not exact slug) so custom page slugs
// and alternate wording are recognized — e.g. "returns-and-refunds" / "Returns and
// Refunds" = Refund/Return Policy, "terms-and-conditions" = Terms of Service,
// "contact-us" = Contact. Each pattern is tested against the footer link's URL
// AND its anchor text.
const REQUIRED_FOOTER_VARIANTS: Array<{ type: string; label: string; pattern: RegExp }> = [
  { type: "privacy_policy",   label: "Privacy Policy",       pattern: /privacy/i },
  { type: "refund_policy",    label: "Refund/Return Policy", pattern: /refund|returns?/i },
  { type: "shipping_policy",  label: "Shipping Policy",      pattern: /shipping|delivery/i },
  { type: "terms_of_service", label: "Terms of Service",     pattern: /terms|conditions|\btos\b/i },
  { type: "contact_page",     label: "Contact Page",         pattern: /contact|support/i },
];

// Selectors that target the FOOTER region only (no header/nav). GMC requires the
// links to be visible in the footer, so we scope detection there — otherwise a
// header-nav link or a stray body link would wrongly satisfy the requirement and
// the issue would never reappear after the merchant removes it from the footer.
const FOOTER_REGION_SELECTORS = [
  "footer a",
  "[class*='footer'] a",
  "[id*='footer'] a",
  "[class*='Footer'] a",
  "[id*='Footer'] a",
  "[class*='site-bottom'] a",
  "[class*='bottom-bar'] a",
  "[class*='site-footer'] a",
];

/**
 * Read the homepage once and return signals used by reconciliation:
 *  - footerLinks: internal links found in the FOOTER region (lowercased,
 *    slash-trimmed). Falls back to all internal links only when no footer region
 *    is detected, so themes without a semantic footer aren't falsely flagged.
 *  - hasContactLink: a mailto:/tel: link is present in the footer (contact info
 *    visible site-wide).
 */
// Footer container selectors (region-level, not just anchors) — used to extract
// the footer's visible text for business-address / contact detection.
const FOOTER_CONTAINER_SELECTORS = [
  "footer",
  "[class*='footer']",
  "[id*='footer']",
  "[class*='Footer']",
  "[id*='Footer']",
  "[class*='site-bottom']",
  "[class*='bottom-bar']",
  "[class*='site-footer']",
];

/** Detect a plausible physical/postal address in a block of text. */
function looksLikeAddress(text: string): boolean {
  if (!text) return false;
  // Street-style line: number + street keyword
  const street = /\b\d{1,6}\s+[A-Za-z0-9.\s]{2,40}\b(street|st\.?|avenue|ave\.?|road|rd\.?|lane|ln\.?|drive|dr\.?|blvd|boulevard|suite|ste\.?|unit|floor|fl\.?|highway|hwy)\b/i;
  // US ZIP / generic postal patterns
  const usZip = /\b\d{5}(-\d{4})?\b/;
  const ukPost = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
  const inPin = /\b\d{6}\b/;
  // "City, ST" or "City, Country"
  const cityState = /\b[A-Za-z .'-]{2,30},\s*[A-Za-z]{2,}\b/;
  return street.test(text) || ((usZip.test(text) || ukPost.test(text) || inPin.test(text)) && cityState.test(text));
}

async function getHomepageSignals(
  storeUrl: string,
  storeData: any,
  cookie?: string
): Promise<{ footerLinks: string[]; hasContactLink: boolean; footerHasAddress: boolean; footerHasEmail: boolean; footerHasPhone: boolean }> {
  const { html: homeHtml } = await safeFetch(`${storeUrl}/`, 10000, cookie);
  if (!homeHtml) return { footerLinks: [], hasContactLink: false, footerHasAddress: false, footerHasEmail: false, footerHasPhone: false };

  const norm = (href: string): string | null => {
    const h = (href || "").trim();
    if (h.startsWith("/")) return `${storeUrl}${h}`.toLowerCase().replace(/\/$/, "");
    if (h.startsWith(storeUrl)) return h.toLowerCase().replace(/\/$/, "");
    return null;
  };

  const footerScoped = new Set<string>();
  const allInternal = new Set<string>();
  let hasContactLink = false;
  let footerText = "";

  try {
    const root = parse(homeHtml);

    // Whole page — used only as a fallback when no footer region exists.
    root.querySelectorAll("a[href]").forEach((el: any) => {
      const href = el.getAttribute("href") || "";
      const n = norm(href);
      if (n) allInternal.add(n);
    });

    // Footer region — the authoritative source for the footer-links requirement.
    for (const sel of FOOTER_REGION_SELECTORS) {
      try {
        root.querySelectorAll(sel).forEach((el: any) => {
          const href = (el.getAttribute("href") || "").trim();
          if (/^(mailto:|tel:)/i.test(href)) hasContactLink = true;
          const n = norm(href);
          if (n) footerScoped.add(n);
        });
      } catch { /* selector unsupported — skip */ }
    }

    // Footer text content — for address / email / phone detection in the footer.
    for (const sel of FOOTER_CONTAINER_SELECTORS) {
      try {
        root.querySelectorAll(sel).forEach((el: any) => {
          const t = (el.text || "").replace(/\s+/g, " ").trim();
          if (t) footerText += " " + t;
        });
      } catch { /* skip */ }
      if (footerText.length > 4000) break;
    }
  } catch { /* non-fatal */ }

  // Footer links captured during gatherStoreData (also footer-region) reinforce
  // the scoped set.
  ((storeData as any).footerLinks || []).forEach((entry: string) => {
    const arrow = entry.lastIndexOf("→");
    const u = (arrow !== -1 ? entry.substring(arrow + 1).trim() : entry).toLowerCase().replace(/\/$/, "");
    if (u.startsWith("http")) footerScoped.add(u);
  });

  const footerLinks = footerScoped.size > 0 ? [...footerScoped] : [...allInternal];
  const footerHasEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(footerText) || hasContactLink;
  const footerHasPhone = /(?:\+?\d[\d\s().-]{7,}\d)/.test(footerText);
  const footerHasAddress = looksLikeAddress(footerText);

  return { footerLinks, hasContactLink, footerHasAddress, footerHasEmail, footerHasPhone };
}

/** Recompute the scan summary counts/risk from the reconciled issue lists. */
function recomputeBasicSummary(result: any, storeData: any) {
  let high = 0, medium = 0;
  for (const s of ["merchant_center_compliance", "customer_trust_and_policy", "site_structure_and_seo", "missing_pages", "broken_links"]) {
    for (const issue of (result[s] || [])) {
      const sev = (issue.severity || "").toLowerCase();
      if (sev === "high") high++;
      else if (sev === "medium") medium++;
    }
  }
  const pagesMissing = (result.missing_pages || []).length;
  const brokenLinks = (result.broken_links || []).length;
  result.scan_summary = {
    ...(result.scan_summary || {}),
    pages_scanned: (storeData.pages || []).filter((p: any) => p.exists).length,
    pages_missing: pagesMissing,
    broken_links_found: brokenLinks,
    overall_risk: (high > 0 || pagesMissing > 0) ? "High" : medium > 0 ? "Medium" : "Low",
  };
}

/**
 * Authoritative reconciliation — mutates `result` in place.
 *
 * The AI is non-deterministic and frequently re-flags issues that are already
 * fixed. This pass checks the LIVE store (the same truth Google crawls) and
 * removes any auto-fixable issue whose fix is genuinely already in place, so
 * re-scans correctly recognize fixed pages, footer links, and contact info —
 * whether the fix was applied via Auto Fix or manually by the merchant.
 */
async function reconcileBasicResult(result: any, storeData: any, storeUrl: string, cookie?: string): Promise<void> {
  const resolved = new Set<string>();

  // Read the homepage once for footer links + contact/address signals.
  let footerLinks: string[] = [];
  let footerHasContactLink = false;
  let footerHasAddress = false;
  let footerHasEmail = false;
  let footerHasPhone = false;
  try {
    const signals = await getHomepageSignals(storeUrl, storeData, cookie);
    footerLinks = signals.footerLinks;
    footerHasContactLink = signals.hasContactLink;
    footerHasAddress = signals.footerHasAddress;
    footerHasEmail = signals.footerHasEmail;
    footerHasPhone = signals.footerHasPhone;
  } catch { /* non-fatal */ }

  // 1. Page-based fixes — resolved if the live page responds with content.
  for (const page of storeData.pages || []) {
    const fixType = FIX_TYPE_BY_PATH[page.path];
    if (fixType && page.exists) resolved.add(fixType);
  }

  // 2. Business contact details (Scan 1 / GMC "Insufficient Contact Information").
  //    Google requires the business to be reachable, with contact details ideally
  //    visible site-wide in the FOOTER (address, email, or phone). We treat the
  //    requirement as satisfied when the footer shows ANY business contact signal
  //    (address / email / phone / mailto-tel link), OR the contact page clearly
  //    carries an email/phone. Otherwise we flag business_contact so it is caught
  //    in the Basic scan — not deferred to the Deep scan.
  const contactPage = (storeData.pages || []).find((p: any) => p.path === "/pages/contact");
  const homePage = (storeData.pages || []).find((p: any) => p.path === "/");
  const contactText = `${contactPage?.markdown || ""}\n${homePage?.markdown || ""}`;
  const pageHasEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(contactText);
  const pageHasPhone = /(?:\+?\d[\d\s().-]{7,}\d)/.test(contactText);

  const footerHasBusinessDetails = footerHasContactLink || footerHasAddress || footerHasEmail || footerHasPhone;
  const businessContactSatisfied = footerHasBusinessDetails || (contactPage?.exists && (pageHasEmail || pageHasPhone));

  if (businessContactSatisfied) {
    resolved.add("business_contact");
  }

  // 3. Footer links — resolved only if ALL required GMC links are present.
  //    Match by keyword against the footer link URLs AND their anchor text, so
  //    custom slugs / alternate names (e.g. "Returns and Refunds",
  //    "Terms and Conditions", "Contact Us") are correctly recognized instead of
  //    being falsely reported as missing.
  let missingFooter: Array<{ type: string; label: string; pattern: RegExp }> = [];
  const footerCorpus = [
    ...footerLinks,
    ...(((storeData as any).footerLinks || []) as string[]),
  ].join(" \n ").toLowerCase();
  if (footerCorpus.trim().length > 0) {
    missingFooter = REQUIRED_FOOTER_VARIANTS.filter(({ pattern }) => !pattern.test(footerCorpus));
    if (missingFooter.length === 0) resolved.add("footer_links");
  }

  // 4. Drop every auto-fixable issue whose fix is already in place.
  for (const section of ["merchant_center_compliance", "customer_trust_and_policy", "site_structure_and_seo", "missing_pages"]) {
    if (Array.isArray(result[section])) {
      result[section] = result[section].filter((issue: any) => {
        const t = issue.auto_fix_type;
        return !(t && resolved.has(t));
      });
    }
  }

  // NOTE: this pass is SUPPRESSION-ONLY. Steps 1–4 remove findings the live store
  // proves are already satisfied; it never INJECTS a finding from a deterministic
  // rule. Detecting what is genuinely missing is the AI's job — it is given the
  // complete footer links, the discovered policy/contact pages, and the
  // contact_channels_found signal, and it handles the real-world variety of store
  // layouts far better than brittle keyword rules. This is what stops code from
  // manufacturing false positives on compliant stores with unconventional naming.

  // 6. Recompute summary counts/risk from the reconciled lists.
  recomputeBasicSummary(result, storeData);
}

/** Run the basic scan and return the cleaned result object (no DB writes) */
async function runBasicScan(storeUrl: string, cookie?: string): Promise<any> {
  const storeData = await gatherStoreData(storeUrl, cookie);
  const prompt = buildPrompt(storeData);
  const result = await runGeminiJson(prompt, 180000, storeUrl);

  // Strip password noise
  const PASSWORD_KEYWORDS = /password.protect|password.promot|inaccessible.due.to.password|cannot.be.crawled.due.to.password/i;
  for (const section of ["merchant_center_compliance", "customer_trust_and_policy", "site_structure_and_seo", "missing_pages"]) {
    if (Array.isArray(result[section])) {
      result[section] = result[section].filter((issue: any) => {
        const text = `${issue.issue_description || ""} ${issue.suggested_fix || ""}`;
        return !PASSWORD_KEYWORDS.test(text);
      });
    }
  }

  // ── Authoritative deterministic reconciliation ──────────────────────────────
  // Removes any auto-fixable issue the AI flagged that is actually already fixed
  // on the live store (pages, footer links, contact info), and injects a footer
  // issue only when links are genuinely missing. This is the single source of
  // truth that makes re-scans recognize fixed items.
  try {
    await reconcileBasicResult(result, storeData, storeUrl, cookie);
  } catch (e) {
    console.warn("[runBasicScan] Reconciliation failed (non-fatal):", e);
  }

  return result;
}

type AdvancedProduct = {
  id: string; title: string; description: string; link: string;
  image_url: string; image_width: number; image_height: number;
  gtin: string | null; mpn: string | null; brand: string | null;
  price: number; compare_at_price: number | null; weight: number | null;
  availability: string;
};

/**
 * Deterministic Advanced product-feed validation.
 *
 * Replaces the non-deterministic AI pass so results are 100% consistent and a
 * product that has been fixed (GTIN added, price corrected, description written)
 * automatically drops off the next scan. The output shape matches the previous
 * AI format, so the UI (ViolationGroupCard, group-fix, etc.) is unchanged.
 */
export function computeAdvancedErrors(products: AdvancedProduct[], isPasswordProtected: boolean) {
  const errors: any[] = [];
  const overlayRe = /(^|[/_-])(sale|promo|watermark|discount)([/_.-]|$)/i;

  for (const p of products) {
    const title = p.title || "Untitled product";

    // 1. Missing description (mandatory attribute)
    if (!p.description || !p.description.trim()) {
      errors.push({
        product_id: p.id,
        product_title: title,
        policy_violation_type: "Missing Description",
        merchant_friendly_description: `"${title}" has no product description. Google requires a description before it will show the product in Shopping ads, and an empty description usually leads to disapproval.`,
        manual_fix_steps: [
          "Open your Shopify Admin and go to Products.",
          `Click "${title}".`,
          "Write a clear description covering what the product is, its key features, and materials or specs.",
          "Click Save.",
        ],
        autofix_metadata: {
          can_autofix: true,
          action_required: "update_product_variant_fields",
          target_fields: { description: "Provide a brief AI-generated description" },
        },
      });
    }

    // 2. Missing product identifiers — Google needs a GTIN or MPN
    if (!p.gtin && !p.mpn) {
      errors.push({
        product_id: p.id,
        product_title: title,
        policy_violation_type: "Missing Identifiers",
        merchant_friendly_description: `"${title}" is missing a unique product identifier (GTIN/barcode or MPN)${!p.brand ? " and a brand" : ""}. Without these, Google can't match the product to its catalog and will disapprove it.`,
        manual_fix_steps: [
          "Open your Shopify Admin and go to Products.",
          `Click "${title}".`,
          "Scroll to the variant's Inventory section and enter the product's barcode (GTIN) — or add the manufacturer's MPN.",
          !p.brand ? "Set the product Vendor to the brand/manufacturer name." : "Confirm the product Vendor is set to the brand name.",
          "Click Save.",
        ],
        autofix_metadata: {
          can_autofix: true,
          action_required: "generate_placeholder_identifier",
          target_fields: { gtin: "Look up or assign a valid identifier", brand: p.brand || "Set brand from vendor" },
        },
      });
    }

    // 3. Deceptive pricing — compare-at (MRP) must be strictly greater than price
    if (p.compare_at_price != null && p.compare_at_price > 0 && p.compare_at_price <= p.price) {
      errors.push({
        product_id: p.id,
        product_title: title,
        policy_violation_type: "Deceptive Pricing Logic",
        merchant_friendly_description: `"${title}" shows a Compare-at price (${p.compare_at_price}) that is not higher than the selling price (${p.price}). Google treats a "fake" sale price as deceptive pricing and will disapprove the product.`,
        manual_fix_steps: [
          "Open your Shopify Admin and go to Products.",
          `Click "${title}".`,
          "In the Pricing section, either set the Compare-at price higher than the price, or clear the Compare-at price entirely.",
          "Click Save.",
        ],
        autofix_metadata: {
          can_autofix: true,
          action_required: "update_product_variant_fields",
          target_fields: { compare_at_price: "Clear the compare-at price or set it above the sale price" },
        },
      });
    }

    // 4. Image quality — too small or carries a promotional overlay
    const tooSmall = p.image_width > 0 && p.image_height > 0 && (p.image_width < 100 || p.image_height < 100);
    const hasOverlay = overlayRe.test(p.image_url || "");
    if (tooSmall || hasOverlay) {
      errors.push({
        product_id: p.id,
        product_title: title,
        policy_violation_type: "Image Policy Violation",
        merchant_friendly_description: tooSmall
          ? `"${title}" has a main image that is too small (${p.image_width}×${p.image_height}px). Google requires product images of at least 100×100px (250×250px recommended).`
          : `"${title}" appears to use a promotional image (sale/watermark overlay). Google rejects product images with promotional text or watermarks.`,
        manual_fix_steps: [
          "Open your Shopify Admin and go to Products.",
          `Click "${title}".`,
          tooSmall
            ? "Upload a larger, high-resolution main image (at least 250×250px)."
            : "Replace the main image with a clean product photo that has no text, badges, or watermarks.",
          "Click Save.",
        ],
        autofix_metadata: { can_autofix: false, action_required: "manual_image_update", target_fields: {} },
      });
    }
  }

  const storeWarnings: string[] = [];
  if (isPasswordProtected) {
    storeWarnings.push("Before going live, please remove the password protection to ensure GMC bots can crawl your site.");
  }

  return {
    scan_type: "advanced",
    status: errors.length === 0 ? "pass" : "fail",
    affected_products_count: new Set(errors.map((e) => e.product_id)).size,
    store_warnings: storeWarnings,
    errors_found: errors,
  };
}

/** Advanced scan — runs Basic first, then Advanced; stores both results */
export async function processAdvancedScan(
  scanId: string,
  shop: string,
  storeUrl: string,
  products: Array<{
    id: string;
    title: string;
    description: string;
    link: string;
    image_url: string;
    image_width: number;
    image_height: number;
    gtin: string | null;
    mpn: string | null;
    brand: string | null;
    price: number;
    compare_at_price: number | null;
    weight: number | null;
    availability: string;
  }>,
  isPasswordProtected = false,
  cookie?: string
) {
  try {
    await (prisma as any).storeScan.update({
      where: { id: scanId },
      data: { status: "PROCESSING" },
    });

    // ── Password check (same as Basic) — pause for the storefront password ─────
    // so the Basic portion isn't scanned against the locked password page.
    if (!cookie) {
      const { html, finalUrl } = await safeFetch(`${storeUrl}/`, 12000);
      if (!html || isPasswordPage(html || "", finalUrl)) {
        await (prisma as any).storeScan.update({
          where: { id: scanId },
          data: {
            status: "NEEDS_PASSWORD",
            result: { password_protected: true, store_url: storeUrl, scan_type: "ADVANCED", products },
          },
        });
        return;
      }
    }

    // Basic scan (AI + reconciliation) runs first; product feed checks are
    // deterministic and need no AI call.
    const basicResult = await runBasicScan(storeUrl, cookie).catch(
      (e: any) => ({ _error: e?.message || "Basic scan failed" })
    );
    const advancedResult = computeAdvancedErrors(products, isPasswordProtected);

    const combined = {
      scan_type: "advanced",
      basic_result: basicResult,
      advanced_result: advancedResult,
    };

    await (prisma as any).storeScan.update({
      where: { id: scanId },
      data: { status: "COMPLETE", result: combined },
    });
  } catch (err: any) {
    console.error(`[AdvancedScan] Failed for ${scanId}:`, err);
    await (prisma as any).storeScan.update({
      where: { id: scanId },
      data: { status: "FAILED", error: err?.message || "Unknown error" },
    });
  }
}

/**
 * Deep scan — runs Basic + Advanced first (same chaining as the Advanced scan),
 * then layers the misrepresentation/checkout audit on top. Stores all three
 * results so the report shows the full picture and Deep is never run in
 * isolation from the foundational checks.
 */
/**
 * Enrich the deep-audit data by reading the LIVE store (homepage + policy pages)
 * with the unlocked session cookie. Detects trust/transparency/scarcity signals
 * that the AI needs to robustly audit for GMC suspension triggers.
 */
async function enrichDeepData(
  deepData: DeepAuditData,
  storeUrl: string,
  products: AdvancedProduct[],
  cookie?: string
): Promise<DeepAuditData> {
  const out: DeepAuditData = { ...deepData };
  out.https_enabled = storeUrl.startsWith("https://");

  // Policy/contact pages discovered from homepage links (custom slugs), plus
  // footer contact-link evidence. Declared outside the try so they survive a
  // homepage-fetch failure.
  let discoveredPolicies: Record<string, string> = {};
  let footerHasEmailLink = false;
  let footerHasPhoneLink = false;

  // ── Homepage signals ───────────────────────────────────────────────────────
  try {
    const { html } = await safeFetch(`${storeUrl}/`, 12000, cookie);
    if (html && !isPasswordPage(html)) {
      const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      out.homepage_text = text.substring(0, 2500);
      const lowerHtml = html.toLowerCase();

      // Scarcity / urgency language
      const scarcity: string[] = [];
      const scarcityPatterns: Array<[RegExp, string]> = [
        [/only\s+\d+\s+left/i, "\"Only N left\" stock pressure"],
        [/\d+\s+(people|customers)\s+(are\s+)?(viewing|watching|looking)/i, "Live-visitor / 'X people viewing' counter"],
        [/(hurry|act now|don'?t miss|limited time|ends? (in|soon)|while stocks last)/i, "Urgency phrase ('Hurry', 'Limited time', etc.)"],
        [/countdown|timer|sale ends/i, "Countdown timer / 'Sale ends in'"],
        [/selling fast|almost gone|going fast/i, "'Selling fast' / 'Almost gone' pressure"],
      ];
      for (const [re, label] of scarcityPatterns) if (re.test(text)) scarcity.push(label);
      out.scarcity_signals = Array.from(new Set(scarcity));

      // Popup / newsletter / spin-wheel signals
      const popups: string[] = [];
      if (/(newsletter|subscribe|sign ?up).{0,40}(discount|% off|coupon|code)/i.test(text)) popups.push("Newsletter discount popup");
      if (/spin (the |to )?win|wheel of fortune|lucky wheel/i.test(lowerHtml)) popups.push("Spin-to-win gamified popup");
      if (/exit[- ]?intent|before you (go|leave)/i.test(text)) popups.push("Exit-intent popup");
      out.popup_signals = Array.from(new Set(popups));

      // Payment / trust badges
      const trust: string[] = [];
      const trustPatterns: Array<[RegExp, string]> = [
        [/\b(visa|mastercard|amex|american express)\b/i, "Card brand icons (Visa/Mastercard/Amex)"],
        [/\bpaypal\b/i, "PayPal"],
        [/\b(apple pay|google pay|shop pay)\b/i, "Wallet (Apple/Google/Shop Pay)"],
        [/secure (checkout|payment|ssl)|256[- ]?bit|ssl secured|norton|mcafee|trust ?badge/i, "Secure-checkout / SSL trust badge"],
        [/money[- ]?back guarantee|satisfaction guarantee/i, "Money-back guarantee badge"],
      ];
      for (const [re, label] of trustPatterns) if (re.test(lowerHtml)) trust.push(label);
      out.payment_trust_signals = Array.from(new Set(trust));

      // Social links
      const social = new Set<string>();
      const socialRe = /(facebook|instagram|twitter|x\.com|tiktok|youtube|pinterest|linkedin)\.com/gi;
      let m: RegExpExecArray | null;
      while ((m = socialRe.exec(html)) !== null) social.add(m[1].toLowerCase());
      out.social_links = Array.from(social);

      // Discover policy/contact pages under custom slugs from the homepage links.
      discoveredPolicies = discoverPolicyLinks(html, storeUrl);
      // Footer mailto:/tel: links are strong, slug-agnostic contact evidence.
      if (/mailto:[^"'\s>]+@/i.test(html)) footerHasEmailLink = true;
      if (/tel:[+\d][^"'\s>]*/i.test(html)) footerHasPhoneLink = true;
    }
  } catch { /* non-fatal */ }

  // If the contact page wasn't captured by the caller (e.g. it lives on a custom
  // slug like /pages/contact-us), fetch the discovered contact URL now.
  if ((!out.contact_page_text || out.contact_page_text.trim().length < 40) && discoveredPolicies.contact) {
    try {
      const { html } = await safeFetch(discoveredPolicies.contact, 9000, cookie);
      if (html && !isPasswordPage(html)) out.contact_page_text = extractReadableText(html, 2500);
    } catch { /* non-fatal */ }
  }

  // ── Contact channels (deterministic, ALWAYS computed) ──────────────────────
  // Authoritative evidence of how the business can be reached — from the contact
  // page text, homepage text/footer links, and the Shopify business address.
  // Computed even when the homepage fetch failed, so the AI never false-flags
  // "Insufficient Contact Information" / "Missing Business Address" when present.
  {
    const contactCorpus = `${out.contact_page_text || ""}\n${out.homepage_text || ""}`;
    const channels: string[] = [];
    if (footerHasEmailLink || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(contactCorpus)) channels.push("email");
    if (footerHasPhoneLink || /(?:\+?\d[\d\s().-]{7,}\d)/.test(contactCorpus)) channels.push("phone");
    if (looksLikeAddress(contactCorpus) || (out.business_identity?.legal_address || "").trim().length > 5) channels.push("physical address");
    out.contact_channels_found = channels;
  }

  // ── Policy page completeness (word counts) ─────────────────────────────────
  // Probe the conventional paths first, then fall back to the custom slug
  // discovered from the homepage (e.g. /pages/returns-and-refunds), so policies
  // on non-standard slugs aren't falsely reported missing/thin.
  const policyPaths: Array<[keyof NonNullable<DeepAuditData["policy_pages"]>, string[], string]> = [
    ["refund_return", ["/policies/refund-policy", "/pages/refund-policy"], "refund"],
    ["shipping", ["/policies/shipping-policy", "/pages/shipping-policy"], "shipping"],
    ["terms", ["/policies/terms-of-service", "/pages/terms-of-service"], "terms"],
    ["privacy", ["/policies/privacy-policy", "/pages/privacy-policy"], "privacy"],
  ];
  const policyPages: NonNullable<DeepAuditData["policy_pages"]> = {};
  await Promise.all(policyPaths.map(async ([key, paths, discoveryKey]) => {
    const candidates = [...paths.map(p => `${storeUrl}${p}`)];
    if (discoveredPolicies[discoveryKey]) candidates.push(discoveredPolicies[discoveryKey]);
    for (const url of candidates) {
      try {
        const { html, status } = await safeFetch(url, 9000, cookie);
        if (html && status !== 404 && !isPasswordPage(html)) {
          // Readable text only (strips scripts/styles) so word_count reflects the
          // real policy prose, not inline JS/CSS.
          const text = extractReadableText(html, 8000);
          const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
          policyPages[key] = { exists: true, word_count: wordCount };
          return;
        }
      } catch { /* try next variant */ }
    }
    policyPages[key] = { exists: false, word_count: 0 };
  }));
  out.policy_pages = policyPages;

  // ── Product price/availability samples (from already-fetched feed) ─────────
  out.product_samples = (products || []).slice(0, 15).map(p => ({
    title: p.title,
    price: p.price,
    compare_at_price: p.compare_at_price,
    availability: p.availability,
  }));

  return out;
}

/**
 * Map a Deep-Scan finding's category to a system auto-fix type (or mark manual).
 * The auto-fixable categories reuse the SAME Shopify-Admin auto-fix engine the
 * Basic scan uses (policy pages + business contact), so the existing IssueCard
 * Auto-Fix + Mark-as-Fixed flow works unchanged.
 */
function deepAutofixForCategory(category: string): { can_autofix: boolean; auto_fix_type: string | null; credit_cost: number } {
  const c = (category || "").toLowerCase();
  if (c.includes("privacy")) return { can_autofix: true, auto_fix_type: "privacy_policy", credit_cost: 3 };
  if (c.includes("terms")) return { can_autofix: true, auto_fix_type: "terms_of_service", credit_cost: 3 };
  if (c.includes("refund") || c.includes("return")) return { can_autofix: true, auto_fix_type: "refund_policy", credit_cost: 3 };
  if (c.includes("shipping")) return { can_autofix: true, auto_fix_type: "shipping_policy", credit_cost: 3 };
  // Business identity / address / contact info → template-based business_contact fix
  if (c.includes("contact") || c.includes("address") || c.includes("identity"))
    return { can_autofix: true, auto_fix_type: "business_contact", credit_cost: 2 };
  // Everything else (SSL, trust badges, scarcity, deceptive apps, schema/price
  // mismatch, hidden fees, deceptive discounts, availability, social) → manual.
  return { can_autofix: false, auto_fix_type: null, credit_cost: 0 };
}

/** Annotate each deep finding with auto-fix metadata + a stable issue key. */
function annotateDeepErrors(deepResult: any): void {
  const errors: any[] = deepResult?.critical_misrepresentation_errors || [];
  const slug = (s: string) => (s || "issue").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").substring(0, 40);
  errors.forEach((err: any, i: number) => {
    const meta = deepAutofixForCategory(err.category || "");
    err.auto_fixable = meta.can_autofix;
    err.auto_fix_type = meta.auto_fix_type;
    err.credit_cost = meta.credit_cost;
    // Auto-fixable findings share the basic-scan key so a single fix clears them
    // everywhere; manual findings get a unique per-finding key.
    err.issue_key = meta.can_autofix && meta.auto_fix_type
      ? meta.auto_fix_type
      : `deep_${i}_${slug(err.category)}`;
  });
}

/**
 * Deterministic reconciliation for the Deep scan — the AI is non-deterministic
 * and sometimes re-flags trust signals that the live store demonstrably HAS.
 * This drops any finding the gathered facts contradict (contact channels present,
 * policy pages present & substantive, HTTPS on, address present), so a correct
 * store isn't told it has suspension risks it has already satisfied. Mutates
 * deepResult in place and records the dropped items under passed_checks.
 */
function reconcileDeepResult(deepResult: any, auditData: DeepAuditData): void {
  const errors: any[] = deepResult?.critical_misrepresentation_errors;
  if (!Array.isArray(errors)) return;

  const channels = auditData.contact_channels_found || [];
  const hasAddress = channels.includes("physical address") || (auditData.business_identity?.legal_address || "").trim().length > 5;
  const pp: any = auditData.policy_pages || {};

  const resolvedReason = (category: string): string | null => {
    const c = (category || "").toLowerCase();
    if (c.includes("insufficient contact") && channels.length >= 2) return `Contact channels present: ${channels.join(", ")}`;
    if (c.includes("missing business address") && hasAddress) return "Business address present";
    if (c.includes("missing privacy") && pp.privacy?.exists) return "Privacy Policy present";
    if (c.includes("missing terms") && pp.terms?.exists) return "Terms of Service present";
    if ((c.includes("refund") || c.includes("return")) && pp.refund_return?.exists && (pp.refund_return.word_count || 0) >= 80) return "Refund/Return policy present & substantive";
    if (c.includes("shipping") && pp.shipping?.exists && (pp.shipping.word_count || 0) >= 50) return "Shipping policy present & substantive";
    if ((c.includes("no ssl") || c.includes("insecure")) && auditData.https_enabled) return "HTTPS enabled";
    return null;
  };

  const passed: string[] = Array.isArray(deepResult.passed_checks) ? deepResult.passed_checks : [];
  deepResult.critical_misrepresentation_errors = errors.filter((err: any) => {
    const reason = resolvedReason(err.category || "");
    if (reason) { passed.push(reason); return false; }
    return true;
  });
  deepResult.passed_checks = Array.from(new Set(passed));
}

export async function processDeepScan(
  scanId: string,
  shop: string,
  storeUrl: string,
  products: AdvancedProduct[],
  deepData: DeepAuditData,
  cookie?: string
) {
  try {
    await (prisma as any).storeScan.update({
      where: { id: scanId },
      data: { status: "PROCESSING" },
    });

    // ── Password check (same as Basic) — pause for the storefront password ─────
    if (!cookie) {
      const { html, finalUrl } = await safeFetch(`${storeUrl}/`, 12000);
      if (!html || isPasswordPage(html || "", finalUrl)) {
        await (prisma as any).storeScan.update({
          where: { id: scanId },
          data: {
            status: "NEEDS_PASSWORD",
            result: { password_protected: true, store_url: storeUrl, scan_type: "DEEP", products, deepData },
          },
        });
        return;
      }
    }

    // 1. Foundational checks first — Basic (AI + reconciliation) and the
    //    deterministic Advanced product-feed audit.
    const basicResult = await runBasicScan(storeUrl, cookie).catch(
      (e: any) => ({ _error: e?.message || "Basic scan failed" })
    );
    const advancedResult = computeAdvancedErrors(products, deepData.is_password_protected);

    // Refresh the contact-page text using the (now unlocked) session so a
    // password store isn't audited for identity mismatch against its locked page.
    let auditData: DeepAuditData = { ...deepData };
    try {
      const { html } = await safeFetch(`${storeUrl}/pages/contact`, 10000, cookie);
      if (html && !isPasswordPage(html)) {
        // Clean, readable text only — strips inline JS/CSS so the AI sees the
        // actual contact details instead of "mostly code".
        const text = extractReadableText(html, 2500);
        if (text) auditData.contact_page_text = text;
      }
    } catch { /* non-fatal — keep originally gathered text */ }

    // Enrich with live homepage + policy-page signals (trust, scarcity, payment,
    // social, policy completeness) so the deep audit is robust and comprehensive.
    try {
      auditData = await enrichDeepData(auditData, storeUrl, products, cookie);
    } catch (e) {
      console.warn("[DeepScan] Enrichment failed (non-fatal):", e);
    }

    // 2. Deep misrepresentation audit (AI).
    const deepResult = await runGeminiJson(buildDeepPrompt(auditData), 180000, scanId);

    // Drop AI findings the live-store facts contradict (deterministic safety net).
    reconcileDeepResult(deepResult, auditData);

    // Annotate findings with system auto-fix metadata (reuses the basic auto-fix engine).
    annotateDeepErrors(deepResult);

    const combined = {
      scan_type: "deep",
      basic_result: basicResult,
      advanced_result: advancedResult,
      deep_result: deepResult,
    };

    await (prisma as any).storeScan.update({
      where: { id: scanId },
      data: { status: "COMPLETE", result: combined },
    });
  } catch (err: any) {
    console.error(`[DeepScan] Failed for ${scanId}:`, err);
    await (prisma as any).storeScan.update({
      where: { id: scanId },
      data: { status: "FAILED", error: err?.message || "Unknown error" },
    });
  }
}

/** Background processor — runs the Basic scan and saves to DB */
export async function processStoreScan(
  scanId: string,
  shop: string,
  storeUrl: string,
  cookie?: string
) {
  try {
    await (prisma as any).storeScan.update({
      where: { id: scanId },
      data: { status: "PROCESSING" },
    });

    // ── Password check ────────────────────────────────────────────────────────
    if (!cookie) {
      const { html, finalUrl } = await safeFetch(`${storeUrl}/`, 12000);
      if (!html || isPasswordPage(html || "", finalUrl)) {
        await (prisma as any).storeScan.update({
          where: { id: scanId },
          data: { status: "NEEDS_PASSWORD", result: { password_protected: true, store_url: storeUrl } },
        });
        return;
      }
    }

    const result = await runBasicScan(storeUrl, cookie);

    await (prisma as any).storeScan.update({
      where: { id: scanId },
      data: { status: "COMPLETE", result },
    });
  } catch (err: any) {
    console.error(`[StoreScan] Failed for ${scanId}:`, err);
    await (prisma as any).storeScan.update({
      where: { id: scanId },
      data: { status: "FAILED", error: err?.message || "Unknown error" },
    });
  }
}

/**
 * Run a store-level (Basic) scan for monitoring — no DB writes, no admin session.
 * Returns null if the store is unreachable or password-protected (so monitoring
 * doesn't falsely alert on a parked/locked store).
 */
export async function runMonitoringScan(storeUrl: string): Promise<any | null> {
  const { html, finalUrl } = await safeFetch(`${storeUrl}/`, 12000);
  if (!html || isPasswordPage(html || "", finalUrl)) return null;
  return runBasicScan(storeUrl);
}

/**
 * Extract the issues from a Basic scan result with a STABLE fingerprint each, used
 * to diff monitoring runs and detect NEW problems regardless of wording changes.
 */
export function extractBasicIssues(result: any): Array<{ fp: string; label: string; severity: string }> {
  if (!result) return [];
  const out: Array<{ fp: string; label: string; severity: string }> = [];
  const seen = new Set<string>();
  const norm = (s: string) => (s || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);
  const push = (fp: string, label: string, severity: string) => {
    if (seen.has(fp)) return;
    seen.add(fp);
    out.push({ fp, label, severity: severity || "Medium" });
  };

  for (const p of (result.missing_pages || [])) {
    push(`missing_page|${p.auto_fix_type || norm(p.label || p.url || "")}`, `Missing page: ${p.label || p.url || "required page"}`, p.severity || "High");
  }
  for (const l of (result.broken_links || [])) {
    push(`broken_link|${norm(l.url || l.issue_description || "")}`, `Broken link: ${l.url || l.issue_description || ""}`, l.severity || "High");
  }
  for (const section of ["merchant_center_compliance", "customer_trust_and_policy", "site_structure_and_seo"]) {
    for (const i of (result[section] || [])) {
      push(`${section}|${i.auto_fix_type || norm(i.issue_description || "")}`, i.issue_description || i.label || "Compliance issue", i.severity || "Medium");
    }
  }
  return out;
}
