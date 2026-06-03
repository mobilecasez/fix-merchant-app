import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { incrementProductUsage, getOrCreateSubscription, getProductsUsed, getEffectiveProductLimit } from "../utils/billing.server";
import prisma from "../db.server";

// ── Theme asset helpers (use session.shop — NOT storeUrl which may be a custom domain) ──

function shopifyFetch(url: string, opts: RequestInit = {}, timeoutMs = 20000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function getThemeId(shop: string, accessToken: string): Promise<string | null> {
  try {
    const res = await shopifyFetch(
      `https://${shop}/admin/api/2024-07/themes.json?role=main`,
      { headers: { "X-Shopify-Access-Token": accessToken } }
    );
    if (!res.ok) { console.warn(`[theme] Could not fetch themes: ${res.status}`); return null; }
    const data = await res.json();
    const main = (data.themes || []).find((t: any) => t.role === "main");
    if (!main) { console.warn("[theme] No main theme found"); return null; }
    return String(main.id);
  } catch (err: any) {
    console.warn("[theme] getThemeId failed:", err.message);
    return null;
  }
}

async function readThemeAsset(shop: string, accessToken: string, themeId: string, assetKey: string): Promise<string | null> {
  try {
    const res = await shopifyFetch(
      `https://${shop}/admin/api/2024-07/themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(assetKey)}`,
      { headers: { "X-Shopify-Access-Token": accessToken } }
    );
    if (!res.ok) { console.warn(`[theme] Could not read ${assetKey}: ${res.status}`); return null; }
    const data = await res.json();
    return data?.asset?.value || null;
  } catch (err: any) {
    console.warn(`[theme] readThemeAsset(${assetKey}) failed:`, err.message);
    return null;
  }
}

async function writeThemeAsset(shop: string, accessToken: string, themeId: string, assetKey: string, value: string): Promise<boolean> {
  try {
    const res = await shopifyFetch(
      `https://${shop}/admin/api/2024-07/themes/${themeId}/assets.json`,
      {
        method: "PUT",
        headers: { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({ asset: { key: assetKey, value } }),
      }
    );
    if (!res.ok) { console.warn(`[theme] Could not write ${assetKey}: ${res.status} ${await res.text()}`); return false; }
    return true;
  } catch (err: any) {
    console.warn(`[theme] writeThemeAsset(${assetKey}) failed:`, err.message);
    return false;
  }
}

// ── Theme footer injection ─────────────────────────────────────────────────────
//
// Strategy 1 (primary — universal): Write a Liquid snippet to
//   snippets/shopflix-policy-links.liquid
// then inject {% render 'shopflix-policy-links' %} into layout/theme.liquid
// just before </body>.  Works on every Shopify theme because theme.liquid is
// the universal layout wrapper — no theme-specific JSON knowledge required.
//
// Strategy 2 (secondary — Dawn-family themes): Modify sections/footer-group.json
// or config/settings_data.json to add a link_list block pointing to the menu.
// This gives a native footer column for themes that support it.
//
// Both strategies are idempotent — re-running will detect the existing injection
// and skip without duplicating anything.

const SNIPPET_KEY = "snippets/shopflix-policy-links.liquid";
const SNIPPET_TAG = "{% render 'shopflix-policy-links' %}";

/** Build the Liquid snippet that renders compliance links using the Shopify menu */
function buildComplianceLinkSnippet(menuHandle: string, heading: string): string {
  return `{%- comment -%}
  ShopFlix AI — GMC Compliance Links
  Managed by the ShopFlix AI app. Do not edit manually.
  Menu handle: ${menuHandle}
{%- endcomment -%}

{%- assign shopflix_menu = linklists[${JSON.stringify(menuHandle)}] -%}
{%- if shopflix_menu and shopflix_menu.links.size > 0 -%}
<div class="shopflix-compliance-links" style="
  padding: 20px 24px;
  border-top: 1px solid rgba(255,255,255,0.12);
  text-align: center;
  background: transparent;
">
  {%- if ${JSON.stringify(heading)} != '' -%}
  <p style="
    margin: 0 0 10px 0;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    opacity: 0.6;
  ">{{ ${JSON.stringify(heading)} }}</p>
  {%- endif -%}
  <nav aria-label="{{ ${JSON.stringify(heading)} }}">
    {%- for link in shopflix_menu.links -%}
    <a href="{{ link.url | escape }}"
       style="
         display: inline-block;
         margin: 4px 10px;
         font-size: 12px;
         opacity: 0.75;
         text-decoration: none;
       "
       onmouseover="this.style.opacity='1'"
       onmouseout="this.style.opacity='0.75'">
      {{ link.title | escape }}
    </a>
    {%- endfor -%}
  </nav>
</div>
{%- endif -%}
`;
}

/**
 * Strategy 1: Write the Liquid snippet and inject a render tag into theme.liquid.
 * This is the universal approach — works on 100% of Shopify themes.
 */
async function injectViaThemeLiquid(
  shop: string,
  accessToken: string,
  themeId: string,
  menuHandle: string,
  heading: string
): Promise<boolean> {
  // 1. Write (or overwrite) the snippet file
  const snippetContent = buildComplianceLinkSnippet(menuHandle, heading);
  const snippetWritten = await writeThemeAsset(shop, accessToken, themeId, SNIPPET_KEY, snippetContent);
  if (!snippetWritten) {
    console.warn("[theme] Could not write snippet file — skipping theme.liquid injection");
    return false;
  }

  // 2. Read theme.liquid and inject the render tag (idempotent)
  const themeLiquid = await readThemeAsset(shop, accessToken, themeId, "layout/theme.liquid");
  if (!themeLiquid) {
    console.warn("[theme] Could not read layout/theme.liquid");
    return false;
  }

  if (themeLiquid.includes(SNIPPET_TAG)) {
    console.log("[theme] Render tag already present in theme.liquid — skipping");
    return true; // already injected
  }

  // Inject just before </body> (preferred) or </footer> as fallback
  let updated = themeLiquid;
  if (updated.includes("</body>")) {
    updated = updated.replace("</body>", `  ${SNIPPET_TAG}\n</body>`);
  } else if (updated.includes("</footer>")) {
    updated = updated.replace("</footer>", `  ${SNIPPET_TAG}\n</footer>`);
  } else {
    // Last resort: append at end
    updated = updated + `\n${SNIPPET_TAG}\n`;
  }

  const saved = await writeThemeAsset(shop, accessToken, themeId, "layout/theme.liquid", updated);
  if (saved) {
    console.log("[theme] Compliance links injected into layout/theme.liquid");
    return true;
  }
  return false;
}

/**
 * Strategy 2: Modify footer-group.json / settings_data.json to add a native
 * link_list block (Dawn-family themes).  Tried after the Liquid approach.
 */
async function injectViaFooterJson(
  shop: string,
  accessToken: string,
  themeId: string,
  blockId: string,
  menuHandle: string,
  heading: string
): Promise<boolean> {
  const candidates = [
    "sections/footer-group.json",
    "config/settings_data.json",
  ];

  for (const assetKey of candidates) {
    const raw = await readThemeAsset(shop, accessToken, themeId, assetKey);
    if (!raw) continue;

    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { continue; }

    const sectionsRoot = parsed.sections || parsed.current?.sections;
    if (!sectionsRoot) continue;

    const footerKey = Object.keys(sectionsRoot).find(
      (k: string) => sectionsRoot[k]?.type === "footer"
    );
    if (!footerKey) continue;

    const footerSection = sectionsRoot[footerKey];
    if (!footerSection.blocks) footerSection.blocks = {};
    if (!footerSection.block_order) footerSection.block_order = [];

    const alreadyHas = Object.values(footerSection.blocks).some(
      (b: any) => b?.settings?.menu === menuHandle
    );
    if (alreadyHas) return true;

    footerSection.blocks[blockId] = {
      type: "link_list",
      settings: { heading, menu: menuHandle },
    };
    footerSection.block_order.push(blockId);

    const saved = await writeThemeAsset(shop, accessToken, themeId, assetKey, JSON.stringify(parsed, null, 2));
    if (saved) {
      console.log(`[theme] Footer link_list block added to ${assetKey}`);
      return true;
    }
  }
  return false;
}

/**
 * Main footer injection — tries Strategy 1 (universal Liquid snippet) first,
 * then Strategy 2 (native Dawn-style block) as a bonus enhancement.
 * Returns true if at least Strategy 1 succeeded.
 */
async function addFooterBlock(
  shop: string,
  accessToken: string,
  blockId: string,
  menuHandle: string,
  heading: string
): Promise<boolean> {
  const themeId = await getThemeId(shop, accessToken);
  if (!themeId) {
    console.warn("[theme] Could not resolve live theme ID");
    return false;
  }

  // Strategy 1 — universal Liquid snippet injection (primary)
  const liquidOk = await injectViaThemeLiquid(shop, accessToken, themeId, menuHandle, heading);

  // Strategy 2 — native footer block (bonus, best-effort for Dawn themes)
  injectViaFooterJson(shop, accessToken, themeId, blockId, menuHandle, heading)
    .catch(err => console.warn("[theme] footer-json injection failed (non-fatal):", err));

  return liquidOk;
}

// Credit costs per fix type
const FIX_CREDIT_COSTS: Record<string, number> = {
  privacy_policy: 3,
  refund_policy: 3,
  shipping_policy: 3,
  terms_of_service: 3,
  contact_page: 2,
  about_page: 2,
  page_meta: 1,
  footer_links: 3,
  business_contact: 2,
};

// Policy page metadata — created as Shopify pages + URL redirect from /policies/...
const POLICY_PAGE_MAP: Record<string, { title: string; handle: string; policyPath: string }> = {
  privacy_policy:  { title: "Privacy Policy",         handle: "privacy-policy",  policyPath: "/policies/privacy-policy"  },
  refund_policy:   { title: "Refund & Return Policy", handle: "refund-policy",   policyPath: "/policies/refund-policy"   },
  shipping_policy: { title: "Shipping Policy",        handle: "shipping-policy", policyPath: "/policies/shipping-policy" },
  terms_of_service:{ title: "Terms of Service",       handle: "terms-of-service",policyPath: "/policies/terms-of-service"},
};

// Custom page metadata
const PAGE_META_MAP: Record<string, { title: string; handle: string }> = {
  contact_page: { title: "Contact Us", handle: "contact" },
  about_page:   { title: "About Us",   handle: "about-us" },
};

async function generateContent(
  autoFixType: string,
  issueDescription: string,
  storeName: string,
  storeUrl: string,
  storeDetails?: Record<string, string> | null
): Promise<string> {
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { temperature: 0.3 },
  });

  const isPolicyPage = ["privacy_policy", "refund_policy", "shipping_policy", "terms_of_service"].includes(autoFixType);
  const isCustomPage = ["contact_page", "about_page"].includes(autoFixType);

  let prompt = "";

  // Build a store info block from provided details (no placeholders if not provided)
  const sd = storeDetails || {};
  const effectiveStoreName = sd.storeName || storeName;
  const storeInfoLines = [
    `- Store name: ${effectiveStoreName}`,
    `- Store URL: ${storeUrl}`,
    sd.contactEmail    ? `- Contact email: ${sd.contactEmail}`    : null,
    sd.contactPhone    ? `- Contact phone: ${sd.contactPhone}`    : null,
    sd.businessAddress ? `- Business address: ${sd.businessAddress}` : null,
    sd.returnWindowDays ? `- Return window: ${sd.returnWindowDays} days` : null,
    sd.shippingEstimate ? `- Estimated delivery: ${sd.shippingEstimate}` : null,
    sd.shippingCost    ? `- Shipping cost policy: ${sd.shippingCost}`  : null,
    sd.aboutDescription ? `- About the store: ${sd.aboutDescription}` : null,
  ].filter(Boolean).join("\n");

  if (isPolicyPage) {
    const policyNames: Record<string, string> = {
      privacy_policy: "Privacy Policy",
      refund_policy: "Refund & Return Policy",
      shipping_policy: "Shipping Policy",
      terms_of_service: "Terms of Service",
    };
    const policyName = policyNames[autoFixType] || "Policy";

    prompt = `You are a professional legal content writer for e-commerce stores.

Write a comprehensive, GMC-compliant ${policyName} for a Shopify store using ONLY the real store details provided below. Do NOT use placeholders like [STORE_NAME], [EMAIL], [ADDRESS] — use the actual values given. If a value is not provided, omit that section entirely rather than using a placeholder.

Store details:
${storeInfoLines}

Requirements:
- 500-800 words
- Professional and clear language
- Compliant with Google Merchant Center requirements
- Use only the actual store details provided — no invented or placeholder values
- For Privacy Policy: cover data collection, usage, cookies, third-party sharing, contact details
- For Refund Policy: use the actual return window provided, cover condition requirements, refund process, exceptions
- For Shipping Policy: use the actual delivery estimate and cost policy provided, cover processing times and methods
- For Terms of Service: cover user responsibilities, intellectual property, limitation of liability
- Use plain HTML with <h2>, <h3>, <p>, <ul>, <li> tags (no markdown)
- Do NOT include <html>, <head>, or <body> tags — only the content body
- Use today's date: ${new Date().toISOString().split("T")[0]}

Return ONLY the HTML content, no explanation.`;
  } else if (isCustomPage) {
    const pageNames: Record<string, string> = {
      contact_page: "Contact Us",
      about_page: "About Us",
    };
    const pageName = pageNames[autoFixType] || "Page";

    prompt = `You are a professional copywriter for e-commerce stores.

Write compelling HTML content for a ${pageName} page using ONLY the real store details provided below. Do NOT use placeholders — use the actual values given. If a value is not provided, omit that detail entirely.

Store details:
${storeInfoLines}

Requirements:
- Professional, trust-building content using real store details only
- For Contact Us: show actual email, phone, and address if provided; include response time commitment
- For About Us: write a genuine brand story using the store description provided; include mission and values
- Use plain HTML with <h2>, <h3>, <p>, <ul>, <li> tags (no markdown)
- Do NOT include <html>, <head>, or <body> tags — only the content body
- 300-500 words
- Friendly but professional tone

Return ONLY the HTML content, no explanation.`;
  } else {
    // page_meta — generate a short meta description
    prompt = `Write a compelling, SEO-optimized meta description for a Shopify store page.

Store: ${storeName} (${storeUrl})
Issue: ${issueDescription}

Requirements:
- 140-160 characters
- Include the store name
- Focus on value proposition
- No special characters

Return ONLY the meta description text, nothing else.`;
  }

  const result = await model.generateContent(prompt);
  const response = await result.response;
  return response.text().trim();
}

// Fix types that build their content from templates — no AI generation needed.
const NO_AI_FIX_TYPES = new Set(["footer_links", "business_contact"]);

export async function action({ request }: ActionFunctionArgs) {
  // ── IMPORTANT: clone the request BEFORE authenticate.admin() ──────────────
  // authenticate.admin() reads the request body stream to extract the session
  // token (unstable_newEmbeddedAuthStrategy). Cloning first lets us read the
  // JSON body from the clone after authentication completes.
  const bodyClone = request.clone();
  const { admin, session } = await authenticate.admin(request);
  if (!session) return json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await bodyClone.json();
  } catch {
    return json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { autoFixType, issueDescription, scanId, creditCost: clientCreditCost, storeDetails } = body;

  if (!autoFixType || !issueDescription) {
    return json({ error: "Missing required fields: autoFixType, issueDescription." }, { status: 400 });
  }

  // Determine credit cost (use server-side value as authoritative)
  const creditCost = FIX_CREDIT_COSTS[autoFixType] ?? clientCreditCost ?? 1;

  // Get access token for REST API calls (session.accessToken may be empty in embedded apps)
  const storedSession = await prisma.session.findFirst({
    where: { shop: session.shop, isOnline: false },
    orderBy: { expires: "desc" },
  });
  const accessToken = storedSession?.accessToken || session.accessToken || "";

  // Credit check
  const subscription = await getOrCreateSubscription(session.shop);
  const used = getProductsUsed(subscription);
  const limit = getEffectiveProductLimit(subscription);
  if (used + creditCost > limit) {
    return json({ error: `Not enough credits. You need ${creditCost} but have ${limit - used} remaining.` }, { status: 402 });
  }

  // Get store info for content generation
  const shopResponse = await admin.graphql(`#graphql
    query shopInfo {
      shop {
        name
        email
        primaryDomain { url }
      }
    }
  `);
  const shopData = await shopResponse.json();
  const storeName = shopData?.data?.shop?.name || session.shop;
  const storeUrl = shopData?.data?.shop?.primaryDomain?.url || `https://${session.shop}`;

  // Generate AI content — skipped for fix types that use templates, not AI.
  // footer_links and business_contact build their content deterministically.
  let generatedContent: string = "";
  if (!NO_AI_FIX_TYPES.has(autoFixType)) {
    try {
      // Wrap in a 90-second timeout so a hanging AI call never blocks the action
      generatedContent = await Promise.race([
        generateContent(autoFixType, issueDescription, storeName, storeUrl, storeDetails),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("AI content generation timed out after 90s")), 90000)
        ),
      ]);
    } catch (err: any) {
      console.error("[auto-fix] Content generation failed:", err);
      return json({ error: `AI content generation failed: ${err.message}` }, { status: 500 });
    }
  }

  // Apply the fix via Shopify Admin GraphQL
  let fixApplied = false;
  let verifyUrl = storeUrl;

  try {
    if (POLICY_PAGE_MAP[autoFixType]) {
      // Policy pages: create as a Shopify page + add URL redirect from /policies/... path
      const { title, handle, policyPath } = POLICY_PAGE_MAP[autoFixType];

      // 1. Try to find existing page by handle
      const findResult = await admin.graphql(`#graphql
        query findPage($query: String!) {
          pages(first: 1, query: $query) {
            edges { node { id handle } }
          }
        }
      `, { variables: { query: `handle:${handle}` } });

      const findData = await findResult.json();
      const existingPage = findData?.data?.pages?.edges?.[0]?.node;

      if (existingPage) {
        // Update existing page
        const updateResult = await admin.graphql(`#graphql
          mutation pageUpdate($id: ID!, $page: PageUpdateInput!) {
            pageUpdate(id: $id, page: $page) {
              page { id handle }
              userErrors { field message }
            }
          }
        `, { variables: { id: existingPage.id, page: { body: generatedContent } } });

        const updateData = await updateResult.json();
        const updateErrors = updateData?.data?.pageUpdate?.userErrors;
        if (updateErrors?.length) {
          return json({ error: `Shopify error: ${updateErrors.map((e: any) => e.message).join(", ")}` }, { status: 422 });
        }
      } else {
        // Create new page
        const createResult = await admin.graphql(`#graphql
          mutation pageCreate($page: PageCreateInput!) {
            pageCreate(page: $page) {
              page { id handle }
              userErrors { field message }
            }
          }
        `, { variables: { page: { title, handle, body: generatedContent, isPublished: true } } });

        const createData = await createResult.json();
        const createErrors = createData?.data?.pageCreate?.userErrors;
        if (createErrors?.length) {
          return json({ error: `Shopify error: ${createErrors.map((e: any) => e.message).join(", ")}` }, { status: 422 });
        }
      }

      // 2. Create URL redirect from /policies/... → /pages/handle (ignore errors — may already exist)
      await admin.graphql(`#graphql
        mutation urlRedirectCreate($urlRedirect: UrlRedirectInput!) {
          urlRedirectCreate(urlRedirect: $urlRedirect) {
            urlRedirect { id }
            userErrors { field message }
          }
        }
      `, { variables: { urlRedirect: { path: policyPath, target: `/pages/${handle}` } } }).catch(() => {});

      fixApplied = true;
      verifyUrl = `${storeUrl}/pages/${handle}`;

    } else if (PAGE_META_MAP[autoFixType]) {
      // Create custom page
      const { title, handle } = PAGE_META_MAP[autoFixType];
      const mutationResult = await admin.graphql(`#graphql
        mutation pageCreate($page: PageCreateInput!) {
          pageCreate(page: $page) {
            page { id title handle }
            userErrors { field message }
          }
        }
      `, {
        variables: {
          page: {
            title,
            handle,
            body: generatedContent,
            isPublished: true,
          },
        },
      });

      const mutData = await mutationResult.json();
      const errors = mutData?.data?.pageCreate?.userErrors;
      if (errors?.length) {
        // If handle already exists, try updating instead
        if (errors.some((e: any) => e.message?.toLowerCase().includes("handle"))) {
          // Find page by handle and update
          const findResult = await admin.graphql(`#graphql
            query findPage($query: String!) {
              pages(first: 1, query: $query) {
                edges { node { id title handle } }
              }
            }
          `, { variables: { query: `handle:${handle}` } });

          const findData = await findResult.json();
          const existingPage = findData?.data?.pages?.edges?.[0]?.node;

          if (existingPage) {
            const updateResult = await admin.graphql(`#graphql
              mutation pageUpdate($id: ID!, $page: PageUpdateInput!) {
                pageUpdate(id: $id, page: $page) {
                  page { id title handle }
                  userErrors { field message }
                }
              }
            `, {
              variables: {
                id: existingPage.id,
                page: { body: generatedContent },
              },
            });
            const updateData = await updateResult.json();
            const updateErrors = updateData?.data?.pageUpdate?.userErrors;
            if (updateErrors?.length) {
              return json({ error: `Shopify error: ${updateErrors.map((e: any) => e.message).join(", ")}` }, { status: 422 });
            }
            fixApplied = true;
          } else {
            return json({ error: `Shopify error: ${errors.map((e: any) => e.message).join(", ")}` }, { status: 422 });
          }
        } else {
          return json({ error: `Shopify error: ${errors.map((e: any) => e.message).join(", ")}` }, { status: 422 });
        }
      } else {
        fixApplied = true;
      }
      verifyUrl = `${storeUrl}/pages/${handle}`;

    } else if (autoFixType === "page_meta") {
      // For page_meta, update the shop's homepage SEO meta description
      const updateResult = await admin.graphql(`#graphql
        mutation shopUpdate($input: ShopInput!) {
          shopUpdate(input: $input) {
            shop { description }
            userErrors { field message }
          }
        }
      `, {
        variables: {
          input: { description: generatedContent },
        },
      });

      const updateData = await updateResult.json();
      const errors = updateData?.data?.shopUpdate?.userErrors;
      if (errors?.length) {
        return json({ error: `Shopify error: ${errors.map((e: any) => e.message).join(", ")}` }, { status: 422 });
      }
      fixApplied = true;
      verifyUrl = storeUrl;

    } else if (autoFixType === "footer_links") {
      // Required links — all /pages/ since that's where auto-fix creates them
      const POLICY_MENU_HANDLE = "shopflix-policy-links";
      const requiredLinks = [
        { title: "Privacy Policy",         url: `${storeUrl}/pages/privacy-policy`   },
        { title: "Refund & Return Policy", url: `${storeUrl}/pages/refund-policy`    },
        { title: "Shipping Policy",        url: `${storeUrl}/pages/shipping-policy`  },
        { title: "Terms of Service",       url: `${storeUrl}/pages/terms-of-service` },
        { title: "Contact Us",             url: `${storeUrl}/pages/contact`          },
        { title: "About Us",               url: `${storeUrl}/pages/about-us`         },
      ];

      // ── Step 1: Create or update the navigation menu ──────────────────────────
      const menusResult = await admin.graphql(`#graphql
        query getMenus {
          menus(first: 50) {
            edges { node { id handle title items { id title url type items { id title url type } } } }
          }
        }
      `);
      const menusData = await menusResult.json();
      const allMenus: any[] = menusData?.data?.menus?.edges?.map((e: any) => e.node) || [];
      const existingMenu = allMenus.find((m: any) => m.handle === POLICY_MENU_HANDLE);

      if (existingMenu) {
        // Update existing menu to ensure all links are present
        const existingUrls = new Set(existingMenu.items.map((i: any) => i.url?.toLowerCase()));
        const missingLinks = requiredLinks.filter(l => !existingUrls.has(l.url.toLowerCase()));
        if (missingLinks.length > 0) {
          const updatedItems = [
            ...existingMenu.items.map((item: any) => ({
              id: item.id, title: item.title, url: item.url, type: item.type || "HTTP",
              items: (item.items || []).map((s: any) => ({ id: s.id, title: s.title, url: s.url, type: s.type || "HTTP" })),
            })),
            ...missingLinks.map(l => ({ title: l.title, url: l.url, type: "HTTP" })),
          ];
          await admin.graphql(`#graphql
            mutation menuUpdate($id: ID!, $handle: String!, $title: String!, $items: [MenuItemUpdateInput!]!) {
              menuUpdate(id: $id, handle: $handle, title: $title, items: $items) {
                userErrors { field message }
              }
            }
          `, { variables: { id: existingMenu.id, handle: POLICY_MENU_HANDLE, title: "Policy Links", items: updatedItems } });
        }
      } else {
        // Create the menu fresh
        const createResult = await admin.graphql(`#graphql
          mutation menuCreate($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
            menuCreate(title: $title, handle: $handle, items: $items) {
              menu { id }
              userErrors { field message }
            }
          }
        `, {
          variables: {
            title: "Policy Links",
            handle: POLICY_MENU_HANDLE,
            items: requiredLinks.map(l => ({ title: l.title, url: l.url, type: "HTTP" })),
          },
        });
        const createData = await createResult.json();
        const createErrors = createData?.data?.menuCreate?.userErrors;
        if (createErrors?.length) {
          return json({ error: `Shopify error: ${createErrors.map((e: any) => e.message).join(", ")}` }, { status: 422 });
        }
      }

      // ── Step 2: Inject a link_list block into the theme footer ───────────────
      const themeInjected = await addFooterBlock(session.shop, accessToken, "shopflix-policy-block", POLICY_MENU_HANDLE, "Policies");

      fixApplied = true;
      verifyUrl = `${storeUrl}/`;

      // If theme injection failed (e.g. token lacks write_themes scope), surface
      // manual instructions so the merchant can still act on the menu we created.
      if (!themeInjected) {
        const themeEditorUrl = `https://${session.shop}/admin/themes/current/editor`;
        const navAdminUrl = `https://${session.shop}/admin/menus`;
        return json({
          success: true,
          fixApplied: true,
          creditsCharged: creditCost,
          verifyUrl,
          partialFix: true,
          manualSteps: [
            `✅ Navigation menu "Policy Links" created with all 6 compliance links.`,
            `⚠️ Automatic footer injection couldn't complete — your access token may need a scope refresh.`,
            `To display the links: go to ${themeEditorUrl} → Footer section → Add block → "Link list" → select "Policy Links".`,
            `Or view your menus at: ${navAdminUrl}`,
          ],
        });
      }

    } else if (autoFixType === "business_contact") {
      const sd = storeDetails || {};
      const effectiveStoreName = sd.storeName || storeName;
      const contactEmail = sd.contactEmail || "";
      const contactPhone = sd.contactPhone || "";
      const businessAddress = sd.businessAddress || "";

      // ── Step 1: Regenerate ALL existing policy & info pages with correct details
      // This fixes conflicting/incorrect business identity across all pages at once.
      const POLICY_PAGES_TO_FIX = [
        { handle: "privacy-policy",   fixType: "privacy_policy"   },
        { handle: "refund-policy",    fixType: "refund_policy"    },
        { handle: "shipping-policy",  fixType: "shipping_policy"  },
        { handle: "terms-of-service", fixType: "terms_of_service" },
        { handle: "contact",          fixType: "contact_page"     },
        { handle: "about-us",         fixType: "about_page"       },
      ];

      // Query each page handle individually — OR queries are unreliable in Shopify GraphQL
      const existingPageMap: Record<string, { id: string; title: string }> = {};
      await Promise.all(POLICY_PAGES_TO_FIX.map(async ({ handle }) => {
        const res = await admin.graphql(`#graphql
          query getPage($query: String!) {
            pages(first: 1, query: $query) { edges { node { id handle title } } }
          }
        `, { variables: { query: `handle:${handle}` } });
        const data = await res.json();
        const node = data?.data?.pages?.edges?.[0]?.node;
        if (node) existingPageMap[node.handle] = { id: node.id, title: node.title };
      }));

      // Identity header block — prepended to all pages (no AI = no recitation risk)
      const identityHeader = `<div style="background:#f8fafc;border-left:4px solid #1a4a5a;padding:12px 16px;margin-bottom:24px;border-radius:4px">
  <p style="margin:0;font-size:14px;color:#374151">
    <strong>${effectiveStoreName}</strong>${contactEmail ? ` &nbsp;·&nbsp; <a href="mailto:${contactEmail}">${contactEmail}</a>` : ""}${contactPhone ? ` &nbsp;·&nbsp; ${contactPhone}` : ""}${businessAddress ? ` &nbsp;·&nbsp; ${businessAddress}` : ""}
  </p>
</div>`;

      // About Us template — built from user-provided details, no AI
      const aboutBody = `<h1>About ${effectiveStoreName}</h1>
<p>Welcome to <strong>${effectiveStoreName}</strong>${sd.aboutDescription ? ` — ${sd.aboutDescription}` : ", your trusted online store."}.</p>
<h2>Contact Us</h2>
<ul>
  ${contactEmail ? `<li><strong>Email:</strong> <a href="mailto:${contactEmail}">${contactEmail}</a></li>` : ""}
  ${contactPhone ? `<li><strong>Phone:</strong> ${contactPhone}</li>` : ""}
  ${businessAddress ? `<li><strong>Address:</strong> ${businessAddress}</li>` : ""}
</ul>
<p>We typically respond within 1–2 business days.</p>`;

      // Contact page template
      const contactBody = `<h1>Contact ${effectiveStoreName}</h1>
<p>We'd love to hear from you. Reach out through any of the following:</p>
<ul>
  ${contactEmail ? `<li><strong>Email:</strong> <a href="mailto:${contactEmail}">${contactEmail}</a></li>` : ""}
  ${contactPhone ? `<li><strong>Phone:</strong> ${contactPhone}</li>` : ""}
  ${businessAddress ? `<li><strong>Address:</strong> ${businessAddress}</li>` : ""}
</ul>
<p>We aim to respond to all inquiries within 1–2 business days.</p>`;

      await Promise.all(POLICY_PAGES_TO_FIX.map(async ({ handle, fixType }) => {
        const existingPage = existingPageMap[handle];
        if (!existingPage) return;

        let newBody: string;
        if (fixType === "about_page") {
          newBody = aboutBody;
        } else if (fixType === "contact_page") {
          newBody = contactBody;
        } else {
          // Policy pages: fetch current body, strip old header, prepend new one
          const pageRes = await admin.graphql(`#graphql
            query getPage($id: ID!) { page(id: $id) { body } }
          `, { variables: { id: existingPage.id } });
          const pageData = await pageRes.json();
          let currentBody: string = pageData?.data?.page?.body || "";
          currentBody = currentBody.replace(/<div style="background:#f8fafc;border-left:4px solid #1a4a5a[\s\S]*?<\/div>\s*/g, "");
          newBody = identityHeader + currentBody;
        }

        await admin.graphql(`#graphql
          mutation pageUpdate($id: ID!, $page: PageUpdateInput!) {
            pageUpdate(id: $id, page: $page) { userErrors { field message } }
          }
        `, { variables: { id: existingPage.id, page: { body: newBody } } });
      }));

      // ── Step 2: Add contact info to the footer via settings_data.json ─────────
      // Create a dedicated "Contact" nav menu and add it as a link_list block
      const CONTACT_MENU_HANDLE = "shopflix-contact-info";
      const contactMenuItems = [
        contactEmail    ? { title: `Email: ${contactEmail}`,       url: `mailto:${contactEmail}`,    type: "HTTP" } : null,
        contactPhone    ? { title: `Phone: ${contactPhone}`,       url: `tel:${contactPhone.replace(/\s/g,"")}`, type: "HTTP" } : null,
        businessAddress ? { title: `Address: ${businessAddress}`,  url: `${storeUrl}/pages/contact`, type: "HTTP" } : null,
        { title: "About Us", url: `${storeUrl}/pages/about-us`, type: "HTTP" },
      ].filter(Boolean) as { title: string; url: string; type: string }[];

      // Upsert the contact info menu
      const existingContactMenuRes = await admin.graphql(`#graphql
        query { menus(first: 50) { edges { node { id handle } } } }
      `);
      const existingContactMenuData = await existingContactMenuRes.json();
      const allExistingMenus: any[] = existingContactMenuData?.data?.menus?.edges?.map((e: any) => e.node) || [];
      const existingContactMenu = allExistingMenus.find((m: any) => m.handle === CONTACT_MENU_HANDLE);

      if (existingContactMenu) {
        await admin.graphql(`#graphql
          mutation menuUpdate($id: ID!, $handle: String!, $title: String!, $items: [MenuItemUpdateInput!]!) {
            menuUpdate(id: $id, handle: $handle, title: $title, items: $items) { userErrors { field message } }
          }
        `, { variables: { id: existingContactMenu.id, handle: CONTACT_MENU_HANDLE, title: effectiveStoreName, items: contactMenuItems.map(i => ({ title: i.title, url: i.url, type: i.type })) } });
      } else {
        await admin.graphql(`#graphql
          mutation menuCreate($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
            menuCreate(title: $title, handle: $handle, items: $items) { userErrors { field message } }
          }
        `, { variables: { title: effectiveStoreName, handle: CONTACT_MENU_HANDLE, items: contactMenuItems } });
      }

      // Inject link_list block into the theme footer
      await addFooterBlock(session.shop, accessToken, "shopflix-contact-block", CONTACT_MENU_HANDLE, effectiveStoreName);

      fixApplied = true;
      verifyUrl = `${storeUrl}/pages/about-us`;
    }
  } catch (err: any) {
    console.error("[auto-fix] Shopify API error:", err);
    return json({ error: `Failed to apply fix: ${err.message}` }, { status: 500 });
  }

  // Charge credits
  try {
    for (let i = 0; i < creditCost; i++) {
      await incrementProductUsage(session.shop);
    }
  } catch (err: any) {
    console.error("[auto-fix] Credit deduction failed:", err);
    // Fix was applied but credits couldn't be deducted — log but don't fail
  }

  // Update scan record if scanId provided
  if (scanId) {
    try {
      const scan = await (prisma as any).storeScan.findUnique({ where: { id: scanId } });
      if (scan) {
        const result = (scan.result as any) || {};
        const appliedFixes = result.applied_fixes || [];
        appliedFixes.push({ autoFixType, issueDescription, appliedAt: new Date().toISOString() });
        await (prisma as any).storeScan.update({
          where: { id: scanId },
          data: { result: { ...result, applied_fixes: appliedFixes } },
        });
      }
    } catch (err) {
      console.warn("[auto-fix] Could not update scan record:", err);
    }
  }

  return json({
    success: true,
    fixApplied,
    creditsCharged: creditCost,
    verifyUrl,
  });
}
