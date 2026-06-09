import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { incrementProductUsage, getOrCreateSubscription, getProductsUsed, getEffectiveProductLimit } from "../utils/billing.server";
import prisma from "../db.server";

// ── Theme injection via Shopify REST API ──────────────────────────────────────
// Theme file operations (read/write) are REST-only in Shopify API 2024-07.
// The stored offline access token has write_themes scope after app install.

const SNIPPET_KEY = "snippets/shopflix-policy-links.liquid";
const SNIPPET_TAG = "{% render 'shopflix-policy-links' %}";

function shopifyFetch(url: string, opts: RequestInit = {}, timeoutMs = 20000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function buildComplianceLinkSnippet(menuHandle: string, heading: string): string {
  return `{%- comment -%}ShopFlix AI — GMC Compliance Links. Menu: ${menuHandle}{%- endcomment -%}
{%- assign shopflix_menu = linklists[${JSON.stringify(menuHandle)}] -%}
{%- if shopflix_menu and shopflix_menu.links.size > 0 -%}
<div class="shopflix-compliance-links" style="padding:20px 24px;border-top:1px solid rgba(255,255,255,0.12);text-align:center;">
  {%- if ${JSON.stringify(heading)} != blank -%}
  <p style="margin:0 0 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;opacity:0.6;">{{ ${JSON.stringify(heading)} }}</p>
  {%- endif -%}
  <nav aria-label="{{ ${JSON.stringify(heading)} }}">
    {%- for link in shopflix_menu.links -%}
    <a href="{{ link.url | escape }}" style="display:inline-block;margin:4px 10px;font-size:12px;opacity:0.75;text-decoration:none;">{{ link.title | escape }}</a>
    {%- endfor -%}
  </nav>
</div>
{%- endif -%}`;
}

async function getThemeId(shop: string, accessToken: string): Promise<string | null> {
  try {
    const res = await shopifyFetch(
      `https://${shop}/admin/api/2024-07/themes.json?role=main`,
      { headers: { "X-Shopify-Access-Token": accessToken } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const main = (data.themes || []).find((t: any) => t.role === "main");
    return main ? String(main.id) : null;
  } catch { return null; }
}

async function readThemeAsset(shop: string, accessToken: string, themeId: string, key: string): Promise<string | null> {
  try {
    const res = await shopifyFetch(
      `https://${shop}/admin/api/2024-07/themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(key)}`,
      { headers: { "X-Shopify-Access-Token": accessToken } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.asset?.value || null;
  } catch { return null; }
}

async function writeThemeAsset(shop: string, accessToken: string, themeId: string, key: string, value: string): Promise<string | null> {
  try {
    const res = await shopifyFetch(
      `https://${shop}/admin/api/2024-07/themes/${themeId}/assets.json`,
      {
        method: "PUT",
        headers: { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({ asset: { key, value } }),
      }
    );
    if (!res.ok) {
      const body = await res.text();
      return `HTTP ${res.status}: ${body.substring(0, 200)}`;
    }
    return null; // success
  } catch (err: any) { return `Exception: ${err.message}`; }
}

/**
 * Pre-configure the footer block in sections/footer-group.json (or settings_data.json).
 * On success the Theme Editor will show the block already added — user just clicks Save.
 * Returns { themeId, sectionFileKey } on success so the caller can build a precise editor URL.
 */
async function preConfigureFooterBlock(
  shop: string,
  accessToken: string,
  blockId: string,
  menuHandle: string,
  heading: string
): Promise<{ themeId: string; sectionFileKey: string } | null> {
  const themeId = await getThemeId(shop, accessToken);
  if (!themeId) return null;

  const candidates = ["sections/footer-group.json", "config/settings_data.json"];
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

    // Already exists — idempotent
    const alreadyHas = Object.values(footerSection.blocks).some(
      (b: any) => b?.settings?.menu === menuHandle
    );
    if (alreadyHas) {
      // Derive the section file key (e.g. "footer-group" from "sections/footer-group.json")
      const sectionFileKey = assetKey.replace("sections/", "").replace(".json", "");
      return { themeId, sectionFileKey };
    }

    footerSection.blocks[blockId] = {
      type: "link_list",
      settings: { heading, menu: menuHandle },
    };
    footerSection.block_order.push(blockId);

    const err = await writeThemeAsset(shop, accessToken, themeId, assetKey, JSON.stringify(parsed, null, 2));
    if (!err) {
      const sectionFileKey = assetKey.replace("sections/", "").replace(".json", "");
      return { themeId, sectionFileKey };
    }
  }
  return null;
}

/**
 * Main footer injection.
 * Strategy 1: Full Liquid injection (snippet + theme.liquid patch) — fully automatic.
 * Strategy 2: Pre-configure footer-group.json + return Theme Editor URL — user clicks Save.
 */
async function addFooterBlock(
  shop: string,
  accessToken: string,
  blockId: string,
  menuHandle: string,
  heading: string
): Promise<{ ok: boolean; themeEditorUrl?: string; preConfigured?: boolean; error?: string }> {
  const themeId = await getThemeId(shop, accessToken);
  if (!themeId) return { ok: false, error: `Could not get theme ID. tokenLen=${accessToken.length}` };

  // ── Strategy 1: full Liquid injection ───────────────────────────────────────
  const snippetErr = await writeThemeAsset(shop, accessToken, themeId, SNIPPET_KEY, buildComplianceLinkSnippet(menuHandle, heading));
  if (!snippetErr) {
    const themeLiquid = await readThemeAsset(shop, accessToken, themeId, "layout/theme.liquid");
    if (themeLiquid) {
      if (!themeLiquid.includes(SNIPPET_TAG)) {
        const updated = themeLiquid.includes("</body>")
          ? themeLiquid.replace("</body>", `  ${SNIPPET_TAG}\n</body>`)
          : themeLiquid + `\n${SNIPPET_TAG}\n`;
        const writeErr = await writeThemeAsset(shop, accessToken, themeId, "layout/theme.liquid", updated);
        if (!writeErr) return { ok: true }; // ✅ fully automatic
      } else {
        return { ok: true }; // already injected
      }
    }
  }

  // ── Strategy 2: pre-configure footer-group.json + deep-link Theme Editor ────
  const configured = await preConfigureFooterBlock(shop, accessToken, blockId, menuHandle, heading);

  // Build a deep link that opens the Theme Editor directly at the footer section.
  // The sectionFileKey (e.g. "footer-group") maps to the section in the left panel.
  let editorUrl: string;
  if (configured) {
    // Deep link: opens editor → footer section already visible with our block
    editorUrl = `https://${shop}/admin/themes/${configured.themeId}/editor?context=section&template=index&section=${configured.sectionFileKey}`;
  } else {
    // Fallback: open the general Theme Editor
    editorUrl = `https://${shop}/admin/themes/current/editor`;
  }

  return {
    ok: false,
    preConfigured: !!configured,
    themeEditorUrl: editorUrl,
    error: snippetErr || "Theme file write restricted on this store",
  };
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

// Country → international dialing code. Used to prefix the phone number in
// contact info when the merchant hasn't already entered it in +XX format.
const COUNTRY_DIAL: Record<string, string> = {
  "United States": "+1", "United Kingdom": "+44", "Canada": "+1", "Australia": "+61",
  "India": "+91", "Germany": "+49", "France": "+33", "Spain": "+34", "Italy": "+39",
  "Netherlands": "+31", "Ireland": "+353", "New Zealand": "+64", "Singapore": "+65",
  "United Arab Emirates": "+971", "Saudi Arabia": "+966", "South Africa": "+27",
  "Brazil": "+55", "Mexico": "+52", "Japan": "+81", "China": "+86", "Hong Kong": "+852",
  "Malaysia": "+60", "Philippines": "+63", "Indonesia": "+62", "Pakistan": "+92",
  "Bangladesh": "+880", "Nigeria": "+234", "Sweden": "+46", "Norway": "+47",
  "Denmark": "+45", "Switzerland": "+41", "Belgium": "+32", "Portugal": "+351", "Poland": "+48",
};

/** Prefix the dialing code for the given country if the phone isn't already in +XX format. */
function normalizePhone(phone: string | undefined, country: string | undefined): string {
  const p = (phone || "").trim();
  if (!p) return "";
  if (p.startsWith("+")) return p; // already international
  const dial = COUNTRY_DIAL[(country || "").trim()];
  if (!dial) return p;
  // Strip a leading 0 (national trunk prefix) before adding the country code.
  const local = p.replace(/^0+/, "");
  return `${dial} ${local}`.trim();
}

/** Build the full address line including country. */
function fullAddress(address: string | undefined, country: string | undefined): string {
  const a = (address || "").trim();
  const c = (country || "").trim();
  if (a && c && !a.toLowerCase().includes(c.toLowerCase())) return `${a}, ${c}`;
  return a || c;
}

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
  const normalizedPhone = normalizePhone(sd.contactPhone, sd.country);
  const addressWithCountry = fullAddress(sd.businessAddress, sd.country);
  const storeInfoLines = [
    `- Store name: ${effectiveStoreName}`,
    `- Store URL: ${storeUrl}`,
    sd.contactEmail    ? `- Contact email: ${sd.contactEmail}`    : null,
    normalizedPhone    ? `- Contact phone: ${normalizedPhone}`    : null,
    addressWithCountry ? `- Business address: ${addressWithCountry}` : null,
    sd.country         ? `- Country: ${sd.country}`              : null,
    sd.returnWindowDays ? `- Return window: ${sd.returnWindowDays} days` : null,
    sd.shippingEstimate ? `- Estimated delivery: ${sd.shippingEstimate}` : null,
    sd.shippingCost    ? `- Shipping cost policy: ${sd.shippingCost}`  : null,
    sd.aboutDescription ? `- What the store sells / about: ${sd.aboutDescription}` : null,
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
    const designNote = `
DESIGN & FORMATTING RULES (produce a polished, well-organised page — not a plain wall of text):
- Output clean, self-contained HTML using inline styles so it looks designed inside any Shopify theme.
- Wrap everything in a single container: <div style="max-width:900px;margin:0 auto;line-height:1.7;color:#333;">…</div>
- Use styled section headings: <h2 style="font-size:24px;margin:32px 0 12px;color:#1a1a1a;">…</h2> and <h3 style="font-size:18px;margin:20px 0 8px;color:#1a1a1a;">…</h3>
- Use <p style="margin:0 0 16px;font-size:16px;"> for paragraphs.
- Use cards/callouts where helpful, e.g. <div style="background:#f7f9fb;border:1px solid #e5e7eb;border-radius:10px;padding:18px 22px;margin:14px 0;">…</div>
- Use <ul style="padding-left:20px;margin:0 0 16px;"> with <li style="margin-bottom:8px;"> for lists.
- Do NOT include <html>, <head>, <body>, <style>, or markdown — only the inner HTML body.
- Never invent specifics (exact founding year, employee count, awards) that aren't given; write warm, credible copy instead.
- Use only the real store details provided. If a contact value is missing, omit just that line — never write a placeholder.`;

    if (autoFixType === "contact_page") {
      prompt = `You are a senior e-commerce conversion copywriter and web designer. Create a complete, professional, well-designed "Contact Us" page in HTML for the store below.

Store details:
${storeInfoLines}
${designNote}

Build these sections:
1. A friendly hero intro (1 short heading + 1–2 sentence welcome that reassures customers we're easy to reach and happy to help).
2. A "Get in Touch" card grid showing each AVAILABLE contact method as its own styled card with an emoji icon and clickable link:
   - ✉️ Email → <a href="mailto:EMAIL">EMAIL</a>
   - 📞 Phone → <a href="tel:PHONE">PHONE</a> (use the exact phone provided, already including country code)
   - 📍 Address → the full business address including country
   Only include methods that are actually provided.
3. A "Customer Support Hours" section with reasonable general hours (e.g. Monday–Friday, 9am–6pm) and a clear response-time commitment (e.g. "We reply to all emails within 24 hours").
4. A short closing line inviting the customer to reach out, mentioning what the store sells if an about/description was provided.

Tone: warm, professional, trustworthy. Length: 250–450 words of real copy.
Return ONLY the HTML content, no explanation.`;
    } else {
      // about_page
      prompt = `You are a senior brand storyteller and web designer. Create a complete, engaging, well-designed "About Us" page in HTML for the store below. Take the brief description of what the store sells and EXPAND it into a genuine, compelling brand story — do not just restate it.

Store details:
${storeInfoLines}
${designNote}

Build these sections (use the store's product description to make every section specific and authentic):
1. A compelling hero heading + an opening paragraph introducing the brand and what it stands for.
2. "Our Story" — a warm narrative about why the store exists and the problem it solves for customers (inferred credibly from what it sells; no invented facts/dates).
3. "What We Offer" — a styled bullet list or card grid describing the product range and its benefits, based on the description provided.
4. "Why Choose Us" — 3–4 trust-building points (e.g. quality, customer care, secure shopping, fast support) as styled cards or a list.
5. "Our Mission" — a concise mission statement.
6. A closing call-to-invite with the available contact details (email/phone/address) so customers can reach out.

Tone: authentic, customer-focused, professional. Length: 400–650 words of real, specific copy.
Return ONLY the HTML content, no explanation.`;
    }
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
  console.log(`[auto-fix] shop=${session.shop} storedToken=${!!storedSession?.accessToken} sessionToken=${!!session.accessToken} tokenLen=${accessToken.length}`);

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
  let partialFixPayload: Record<string, any> | null = null;

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
      const footerResult = await addFooterBlock(session.shop, accessToken, "shopflix-policy-block", POLICY_MENU_HANDLE, "Policies");

      fixApplied = true;
      verifyUrl = `${storeUrl}/`;

      // Store partial fix payload — do NOT return early so credits and scan
      // record are always saved, keeping fixed state across page refreshes.
      if (!footerResult.ok) {
        partialFixPayload = {
          partialFix: true,
          preConfigured: footerResult.preConfigured ?? false,
          themeEditorUrl: footerResult.themeEditorUrl,
          debugError: footerResult.error,
          menuLabel: "Policy Links",
        };
      }

    } else if (autoFixType === "business_contact") {
      const sd = storeDetails || {};
      const effectiveStoreName = sd.storeName || storeName;
      const contactEmail = sd.contactEmail || "";
      // Phone gets the country dial code prefixed when not already international.
      const contactPhone = normalizePhone(sd.contactPhone, sd.country);
      // Address always includes the country so the footer shows a complete address.
      const businessAddress = fullAddress(sd.businessAddress, sd.country);

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
      // Create a dedicated "Contact Information" nav menu and add it as a
      // link_list block. The menu TITLE must match the label the merchant is told
      // to look for in the Theme Editor (menuLabel below) — otherwise the Menu
      // picker shows the store name instead of "Contact Information".
      const CONTACT_MENU_HANDLE = "shopflix-contact-info";
      const CONTACT_MENU_TITLE = "Contact Information";
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
        `, { variables: { id: existingContactMenu.id, handle: CONTACT_MENU_HANDLE, title: CONTACT_MENU_TITLE, items: contactMenuItems.map(i => ({ title: i.title, url: i.url, type: i.type })) } });
      } else {
        await admin.graphql(`#graphql
          mutation menuCreate($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
            menuCreate(title: $title, handle: $handle, items: $items) { userErrors { field message } }
          }
        `, { variables: { title: CONTACT_MENU_TITLE, handle: CONTACT_MENU_HANDLE, items: contactMenuItems } });
      }

      // Inject link_list block into the theme footer (same mechanism as
      // footer_links). The footer heading + menuLabel must match CONTACT_MENU_TITLE
      // so the merchant finds the right menu in the Theme Editor.
      const contactFooterResult = await addFooterBlock(
        session.shop, accessToken, "shopflix-contact-block", CONTACT_MENU_HANDLE, CONTACT_MENU_TITLE
      ).catch(() => ({ ok: false } as { ok: boolean; themeEditorUrl?: string; preConfigured?: boolean; error?: string }));

      fixApplied = true;
      verifyUrl = `${storeUrl}/`;

      if (!contactFooterResult.ok) {
        partialFixPayload = {
          partialFix: true,
          preConfigured: contactFooterResult.preConfigured ?? false,
          themeEditorUrl: contactFooterResult.themeEditorUrl,
          debugError: contactFooterResult.error,
          menuLabel: CONTACT_MENU_TITLE,
        };
      }
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

  // Update scan record if scanId provided — always, even for partial fixes,
  // so the fixed/partial state survives page refreshes.
  if (scanId) {
    try {
      const scan = await (prisma as any).storeScan.findUnique({ where: { id: scanId } });
      if (scan) {
        const result = (scan.result as any) || {};
        const appliedFixes = result.applied_fixes || [];
        appliedFixes.push({
          autoFixType,
          issueDescription,
          appliedAt: new Date().toISOString(),
          partial: !!partialFixPayload,
          ...(partialFixPayload ?? {}),
        });
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
    ...(partialFixPayload ?? {}),
  });
}
