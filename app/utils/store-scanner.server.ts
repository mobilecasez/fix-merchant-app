import { parse } from "node-html-parser";
import { optimizeHtmlForAI } from "./dom-optimizer.server";
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
 * Attempt to unlock a password-protected Shopify store.
 * Returns the cookie string to use in subsequent requests, or null if password is wrong.
 */
export async function unlockStorefront(
  baseUrl: string,
  password: string
): Promise<{ cookie: string | null; error?: string }> {
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10000);

    // First GET the password page to grab the authenticity_token (CSRF)
    const pageRes = await fetch(`${baseUrl}/password`, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
    });
    const pageHtml = await pageRes.text();
    const setCookieRaw = pageRes.headers.get("set-cookie") || "";

    // Extract authenticity_token from the form
    const tokenMatch = pageHtml.match(/name="authenticity_token"\s+value="([^"]+)"/);
    const authToken = tokenMatch?.[1] || "";

    // Extract initial cookies (session cookie)
    const initialCookie = setCookieRaw
      .split(",")
      .map((c) => c.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");

    // POST the password
    const postController = new AbortController();
    setTimeout(() => postController.abort(), 10000);

    const postRes = await fetch(`${baseUrl}/password`, {
      method: "POST",
      headers: {
        ...BROWSER_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        ...(initialCookie ? { Cookie: initialCookie } : {}),
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

    // Collect all Set-Cookie values from the POST response
    const postCookieRaw = postRes.headers.get("set-cookie") || "";
    const allCookies = [...setCookieRaw.split(","), ...postCookieRaw.split(",")]
      .map((c) => c.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");

    // If redirect location is not /password, the unlock succeeded
    const location = postRes.headers.get("location") || "";
    const unlocked = !location.includes("/password") && (postRes.status === 302 || postRes.status === 303 || postRes.status === 200);

    // Verify by fetching homepage with the cookie
    if (allCookies) {
      const verifyRes = await safeFetch(`${baseUrl}/`, 8000, allCookies);
      if (verifyRes.html && !isPasswordPage(verifyRes.html, verifyRes.finalUrl)) {
        return { cookie: allCookies };
      }
    }

    if (unlocked && allCookies) {
      return { cookie: allCookies };
    }

    return { cookie: null, error: "Incorrect password. Please check and try again." };
  } catch (err: any) {
    return { cookie: null, error: `Could not connect to store: ${err.message}` };
  }
}

/** Extract all internal links from a page's nav/header/footer */
function extractNavLinks(html: string, baseUrl: string): string[] {
  const root = parse(html);
  const links: string[] = [];
  const selectors = ["header a", "footer a", "nav a", "[role='navigation'] a"];
  for (const sel of selectors) {
    root.querySelectorAll(sel).forEach((el: any) => {
      const href = el.getAttribute("href") || "";
      if (href.startsWith("/") || href.startsWith(baseUrl)) {
        const full = href.startsWith("/") ? `${baseUrl}${href}` : href;
        links.push(full);
      }
    });
  }
  return Array.from(new Set(links)).slice(0, 40);
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

/** Main scanner — fetches all pages, optimizes HTML, returns structured data for AI */
async function gatherStoreData(
  baseUrl: string,
  cookie?: string
): Promise<{ pages: PageScanResult[]; brokenNavLinks: string[]; baseUrl: string }> {
  const pageResults: PageScanResult[] = await Promise.all(
    PAGES_TO_SCAN.map(async (page) => {
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

      if (!html) return { ...page, status, exists: false, foundAt: page.path, markdown: "" };

      const { markdown, dataScripts } = optimizeHtmlForAI(html);
      const combined = `${markdown}\n\n<!-- DATA -->\n${dataScripts.substring(0, 2000)}`;

      return {
        ...page,
        status,
        exists: true,
        foundAt,
        markdown: combined.substring(0, 6000),
      };
    })
  );

  const homePage = pageResults.find((p) => p.path === "/");
  let brokenNavLinks: string[] = [];
  let footerLinks: string[] = [];

  if (homePage?.exists) {
    const { html } = await safeFetch(`${baseUrl}/`, 10000, cookie);
    if (html) {
      const navLinks = extractNavLinks(html, baseUrl);
      brokenNavLinks = await checkLinksForBroken(navLinks.slice(0, 20), cookie);

      // Extract footer links explicitly for the AI prompt
      const root = parse(html);
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
  }

  return { pages: pageResults, brokenNavLinks, footerLinks, baseUrl };
}

// ── Prompt: Basic Scan (Store Fundamentals & Legal Compliance) ─────────────────

function buildBasicPrompt(data: ReturnType<typeof gatherStoreData> extends Promise<infer T> ? T : never): string {
  const { pages, brokenNavLinks, baseUrl, footerLinks } = data as any;

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
  "extracted_contact_info": ${JSON.stringify(contactInfo.substring(0, 2000))}
}

CONFIRMED MISSING PAGES (verified via HTTP — these are definite failures):
${confirmedMissingPages.length > 0 ? confirmedMissingPages.join("\n") : "None — all required pages responded with content."}

CONFIRMED BROKEN LINKS (verified 404/timeout):
${confirmedBrokenLinks.length > 0 ? confirmedBrokenLinks.join("\n") : "None detected."}

FULL PAGE CONTENT (use for detailed analysis only — do not contradict the CONFIRMED lists above):
${pagesSummary}

---

CHECKS TO PERFORM:
1. Missing Essential Pages: The store MUST have distinct, working pages for: "Privacy Policy", "Terms of Service" (or Terms and Conditions), "Contact Us", "Shipping Policy", and "Refund/Return Policy". Use the CONFIRMED MISSING PAGES list as the authoritative source. Only flag a page as missing if it appears in that list OR if it is genuinely absent from all provided page content.
2. Contact Information: The store MUST display at least two of the following: a physical business address, a support email, or a phone number. Check extracted_contact_info. Only flag as missing if none of these are found in the provided data.
3. Broken Navigation Links: Use the CONFIRMED BROKEN LINKS list. Do not flag any URL that is not in that list.
4. Footer/Navigation Compliance (CRITICAL for GMC): The store footer MUST contain visible links to Privacy Policy, Refund/Return Policy, Shipping Policy, Terms of Service, and Contact page. Evaluate strictly against header_footer_text_and_links. If any of these links are absent, flag as a SINGLE issue with auto_fix_type "footer_links".
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
  return `You are an expert Google Merchant Center (GMC) Data Integrity AI. Your job is to analyze an array of Shopify product data and compare it against baseline requirements to prevent product disapprovals.

STRICT EVALUATION RULES (FOR CONSISTENCY):
1. DO NOT hallucinate errors. Apply the logic strictly to the provided JSON array of products.
2. If the pricing logic or identifier logic passes the stated rules, DO NOT flag it.
3. Your output MUST be a valid JSON object. Do not include markdown formatting like \`\`\`json or any conversational text outside the JSON.

INPUT DATA:
${JSON.stringify({ is_password_protected: isPasswordProtected, products }, null, 2)}

CHECKS TO PERFORM:
1. Basic Syntax: Flag any product missing a 'title', 'id', 'link', or 'description'.
2. Identifiers: Flag any product where 'gtin', 'mpn', AND 'brand' are ALL missing or null. (Google requires Brand + GTIN or MPN at minimum.)
3. Pricing Logic (CRITICAL): The compare_at_price MUST be strictly greater than price. If compare_at_price <= price, flag as "Deceptive Pricing Logic". If compare_at_price is null or 0, skip this check entirely.
4. Image Violations: Flag images if width or height is less than 100px. Flag if the image_url contains the substrings "watermark", "promo", or "sale".
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
      "issue_type": "Pricing Logic | Missing Identifier | Image Violation | Syntax Error",
      "description": "Specific detail based strictly on the provided data.",
      "fix_action": "Actionable fix for the merchant."
    }
  ]
}`;
}

// ── Prompt: Deep Scan (Misrepresentation & Checkout Audit) ────────────────────

export function buildDeepPrompt(deepData: {
  is_password_protected: boolean;
  business_identity: { name: string; domain: string; legal_address: string };
  contact_page_text: string;
  sample_product: {
    json_ld_schema: string;
    visual_dom_price: string;
    simulated_checkout_price: string;
  };
  active_third_party_apps: string[];
}): string {
  return `You are a senior Google Merchant Center Policy Enforcement AI. Your job is to analyze a store's deep structural data, structured schema, and behavioral elements to prevent "Misrepresentation" suspensions.

STRICT EVALUATION RULES (FOR CONSISTENCY):
1. Base all findings ONLY on the provided INPUT DATA. Do not extrapolate or assume external context.
2. A schema mismatch only occurs if the exact numeric values or currencies differ between the provided json_ld_schema and visual_dom_price.
3. Your output MUST be a valid JSON object. Do not include markdown formatting like \`\`\`json or any conversational text outside the JSON.

INPUT DATA:
${JSON.stringify(deepData, null, 2)}

CHECKS TO PERFORM:
1. Schema Markup Audit: Compare the price and currency in json_ld_schema against visual_dom_price. Flag any discrepancy as "Structured Data Mismatch".
2. Business Identity Alignment: Verify that the business_identity details (name, domain, legal_address) strictly match what is stated in contact_page_text. Flag any mismatch as "Business Identity Mismatch".
3. Deceptive Practices: Flag any app in active_third_party_apps known for fake scarcity tactics (countdown timers, fake visitor counts, urgency pop-ups). Flag as "Deceptive App Detected".
4. Hidden Fees: Compare visual_dom_price with simulated_checkout_price. If simulated_checkout_price is higher (excluding standard shipping/tax), flag as "Incomplete Checkout Disclosure".
5. Password Protection: If is_password_protected is true, add exactly this string to store_warnings: "Before going live, please remove the password protection to ensure GMC bots can crawl your site."

OUTPUT FORMAT:
Return ONLY a valid JSON object — no markdown fences, no extra text:
{
  "scan_type": "deep",
  "suspension_risk": "Low | Medium | High",
  "store_warnings": [],
  "critical_misrepresentation_errors": [
    {
      "category": "Schema Mismatch | Identity Mismatch | Deceptive App | Hidden Fees",
      "evidence": "Exact data point from the input that caused the flag.",
      "google_policy_violated": "Name of the relevant GMC policy.",
      "remediation_steps": ["Step 1...", "Step 2..."]
    }
  ]
}`;
}

/** Background processor — runs the full scan and saves to DB */
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

    // ── Password check — only if no cookie already provided ──────────────────
    if (!cookie) {
      const { html, finalUrl } = await safeFetch(`${storeUrl}/`, 12000);
      if (!html || isPasswordPage(html || "", finalUrl)) {
        // Store is password-protected — park scan in NEEDS_PASSWORD state
        await (prisma as any).storeScan.update({
          where: { id: scanId },
          data: {
            status: "NEEDS_PASSWORD",
            result: { password_protected: true, store_url: storeUrl },
          },
        });
        return;
      }
    }

    const storeData = await gatherStoreData(storeUrl, cookie);
    const prompt = buildPrompt(storeData);

    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    });

    const aiText = await retryOperation(async () => {
      const result = await Promise.race([
        model.generateContent(prompt),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("AI response timed out")), 180000)
        ),
      ]);
      const response = await (result as any).response;
      return response.text();
    }, 3, 2000, scanId);

    const start = aiText.indexOf("{");
    const end = aiText.lastIndexOf("}");
    const result = JSON.parse(aiText.substring(start, end + 1));

    // ── Strip password-related issues from all compliance sections ────────────
    // The scan was already unlocked with a cookie — the AI should not flag any
    // page as inaccessible due to password protection. We keep only the single
    // intentional password notice we inject in site_structure_and_seo below.
    const PASSWORD_KEYWORDS = /password.protect|password.promot|password.page|inaccessible.due.to.password|cannot.be.crawled.due.to.password/i;
    for (const section of ["merchant_center_compliance", "customer_trust_and_policy", "site_structure_and_seo", "missing_pages"]) {
      if (Array.isArray(result[section])) {
        result[section] = result[section].filter((issue: any) => {
          const text = `${issue.issue_description || ""} ${issue.suggested_fix || ""}`;
          return !PASSWORD_KEYWORDS.test(text);
        });
      }
    }

    // ── Deterministic footer check ────────────────────────────────────────────
    // The AI is not always consistent about marking footer_links as auto_fixable.
    // We check the homepage HTML ourselves and inject/patch the issue if needed.
    try {
      const homePage = storeData.pages.find((p: any) => p.path === "/");
      if (homePage?.exists) {
        const { html: homeHtml } = await safeFetch(`${storeUrl}/`, 10000, cookie);
        if (homeHtml) {
          const footerLinks = extractNavLinks(homeHtml, storeUrl)
            .map((u: string) => u.toLowerCase().replace(/\/$/, ""));

          const REQUIRED_FOOTER_PATHS = [
            ["/pages/privacy-policy", "/policies/privacy-policy"],
            ["/pages/refund-policy", "/policies/refund-policy"],
            ["/pages/shipping-policy", "/policies/shipping-policy"],
            ["/pages/terms-of-service", "/policies/terms-of-service"],
            ["/pages/contact", "/contact"],
            ["/pages/about-us", "/about-us"],
          ];

          const missingFooterLinks = REQUIRED_FOOTER_PATHS.filter(variants =>
            !variants.some(v => footerLinks.some(l => l.endsWith(v)))
          );

          if (missingFooterLinks.length > 0) {
            // Check if AI already added a footer_links issue anywhere
            const allIssues = [
              ...(result.site_structure_and_seo || []),
              ...(result.merchant_center_compliance || []),
              ...(result.customer_trust_and_policy || []),
            ];
            const hasFooterIssue = allIssues.some((i: any) => i.auto_fix_type === "footer_links");

            if (!hasFooterIssue) {
              // Inject a guaranteed footer_links issue into site_structure_and_seo
              if (!result.site_structure_and_seo) result.site_structure_and_seo = [];
              result.site_structure_and_seo.unshift({
                severity: "High",
                issue_description: "The store footer is missing critical links required by Google Merchant Center: Privacy Policy, Refund/Return Policy, Shipping Policy, Terms of Service, Contact, and About Us. These links must be visible from every page.",
                suggested_fix: "Add all required policy and contact links to your store's footer navigation.",
                detailed_fix_steps: [
                  "Go to Online Store → Navigation in Shopify Admin.",
                  "Add a new menu called 'Policy Links' with links to Privacy Policy, Refund Policy, Shipping Policy, Terms of Service, Contact, and About Us.",
                  "In Online Store → Themes → Customize → Footer, add a new 'Link list' block pointing to this menu.",
                ],
                auto_fixable: true,
                auto_fix_type: "footer_links",
                credit_cost: 3,
              });
            } else {
              // AI added the issue but may not have set auto_fixable — patch it
              for (const section of ["site_structure_and_seo", "merchant_center_compliance", "customer_trust_and_policy"]) {
                if (result[section]) {
                  result[section] = result[section].map((i: any) =>
                    i.auto_fix_type === "footer_links"
                      ? { ...i, auto_fixable: true, credit_cost: i.credit_cost ?? 3 }
                      : i
                  );
                }
              }
            }
          }
        }
      }
    } catch (footerCheckErr) {
      console.warn("[StoreScan] Footer check failed (non-fatal):", footerCheckErr);
    }

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
