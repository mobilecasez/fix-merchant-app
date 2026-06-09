import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { retryOperation } from "../utils/retry.js";
import {
  incrementProductUsage, getOrCreateSubscription, getProductsUsed, getEffectiveProductLimit,
} from "../utils/billing.server";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);

/** Run Gemini and parse a JSON object from the response. */
async function runGeminiJson(prompt: string, retryId: string, temperature = 0.2): Promise<any> {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { temperature, responseMimeType: "application/json" },
  });
  const text = await retryOperation(async () => {
    const result = await Promise.race([
      model.generateContent(prompt),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("AI timed out")), 90000)),
    ]);
    return (await (result as any).response).text();
  }, 3, 1500, retryId);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return JSON.parse(text.substring(start, end + 1));
}

/** Pull every product with its tags/type/vendor (paginated, up to ~250). */
async function fetchAllProducts(admin: any): Promise<Array<{ id: string; title: string; type: string; vendor: string; tags: string[] }>> {
  const out: any[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 5; page++) {
    const resp: any = await admin.graphql(`#graphql
      query products($cursor: String) {
        products(first: 50, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          edges { node { id title productType vendor tags } }
        }
      }
    `, { variables: { cursor } });
    const data = await resp.json();
    const conn = data?.data?.products;
    if (!conn) break;
    for (const e of conn.edges) {
      out.push({
        id: e.node.id,
        title: e.node.title || "",
        type: e.node.productType || "",
        vendor: e.node.vendor || "",
        tags: e.node.tags || [],
      });
    }
    if (!conn.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return out;
}

async function chargeCredits(shop: string, n: number) {
  for (let i = 0; i < n; i++) await incrementProductUsage(shop);
}

export async function action({ request }: ActionFunctionArgs) {
  const bodyClone = request.clone();
  const { admin, session } = await authenticate.admin(request);
  if (!session) return json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try { body = await bodyClone.json(); } catch { return json({ error: "Invalid JSON body." }, { status: 400 }); }
  const intent = body.intent as string;

  // Credit helper — checks balance, returns error response or null
  const checkCredits = async (needed: number) => {
    const sub = await getOrCreateSubscription(session.shop);
    const used = getProductsUsed(sub);
    const limit = getEffectiveProductLimit(sub);
    if (used + needed > limit) {
      return json({ error: `Not enough credits. This action needs ${needed} credit${needed > 1 ? "s" : ""}. You have ${limit - used} remaining.` }, { status: 402 });
    }
    return null;
  };

  try {
    // ════════════════════════════════════════════════════════════════════════
    // 1. COLLECTIONS — analyse tags & suggest smart collections
    // ════════════════════════════════════════════════════════════════════════
    if (intent === "suggest_collections") {
      const products = await fetchAllProducts(admin);
      if (!products.length) return json({ error: "No products found in your store." }, { status: 400 });

      // Build tag / type / vendor frequency maps (token-efficient summary for AI)
      const tagFreq: Record<string, number> = {};
      const typeFreq: Record<string, number> = {};
      const vendorFreq: Record<string, number> = {};
      for (const p of products) {
        for (const t of p.tags) tagFreq[t] = (tagFreq[t] || 0) + 1;
        if (p.type) typeFreq[p.type] = (typeFreq[p.type] || 0) + 1;
        if (p.vendor) vendorFreq[p.vendor] = (vendorFreq[p.vendor] || 0) + 1;
      }
      const top = (m: Record<string, number>, n: number) =>
        Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ value: k, count: v }));

      const creditErr = await checkCredits(3);
      if (creditErr) return creditErr;

      const prompt = `You are a Shopify merchandising expert. A store has these product TAGS, TYPES and VENDORS (with how many products carry each). Design a clean, shopper-friendly set of COLLECTIONS that organise this catalog so customers can browse easily.

PRODUCT TAGS (tag : product count):
${JSON.stringify(top(tagFreq, 60))}

PRODUCT TYPES:
${JSON.stringify(top(typeFreq, 30))}

VENDORS/BRANDS:
${JSON.stringify(top(vendorFreq, 30))}

TOTAL PRODUCTS: ${products.length}

RULES:
1. Group suggestions under intuitive PARENT GROUPS (e.g. "By Category", "By Gender", "By Brand", "By Price", "Featured"). Use whatever groups fit THIS catalog (apparel → Gender/Category/Size; phone cases → Phone Model/Type; etc.).
2. Every collection must be backed by a concrete RULE the system can apply automatically: match on a TAG, a PRODUCT_TYPE, or a VENDOR that actually exists in the data above.
3. Only suggest collections that will contain products (the rule value must exist in the data).
4. Give each collection a clean shopper-facing title and a one-line description.
5. Suggest 6–18 collections total. Skip near-duplicates.
6. Output valid JSON only — no markdown.

Return ONLY:
{
  "groups": [
    {
      "group": "By Category",
      "collections": [
        { "title": "T-Shirts", "rule_field": "TAG | TYPE | VENDOR", "rule_value": "t-shirts", "description": "Short shopper-facing description", "est_products": 12 }
      ]
    }
  ]
}`;

      const result = await runGeminiJson(prompt, "suggest_collections");
      await chargeCredits(session.shop, 3);
      return json({ success: true, suggestions: result.groups || [], totalProducts: products.length, creditsUsed: 3 });
    }

    // ── Create the selected collections as Shopify smart collections ──────────
    if (intent === "create_collections") {
      const selected: Array<{ title: string; rule_field: string; rule_value: string; description?: string }> = body.collections || [];
      if (!selected.length) return json({ error: "No collections selected." }, { status: 400 });

      const COLUMN_BY_FIELD: Record<string, string> = { TAG: "TAG", TYPE: "TYPE", VENDOR: "VENDOR" };
      const QUERY_FIELD: Record<string, string> = { TAG: "tag", TYPE: "product_type", VENDOR: "vendor" };

      // Resolve the Online Store publication once so collections become visible.
      let onlineStorePublicationId: string | null = null;
      try {
        const pubResp = await admin.graphql(`#graphql
          query { publications(first: 20) { edges { node { id name } } } }
        `);
        const pubData = await pubResp.json();
        const pubs = pubData?.data?.publications?.edges || [];
        const online = pubs.find((e: any) => /online store/i.test(e.node.name)) || pubs[0];
        onlineStorePublicationId = online?.node?.id || null;
      } catch { /* non-fatal — collection still created, just not auto-published */ }

      const results: Array<{ title: string; ok: boolean; error?: string }> = [];

      for (const c of selected) {
        const fieldKey = (c.rule_field || "TAG").toUpperCase();
        const column = COLUMN_BY_FIELD[fieldKey] || "TAG";
        try {
          // 1. Find the first matching product's image to use as the collection image.
          let imageSrc: string | null = null;
          try {
            const qField = QUERY_FIELD[fieldKey] || "tag";
            const escaped = String(c.rule_value).replace(/'/g, "\\'");
            const prodResp = await admin.graphql(`#graphql
              query firstMatch($q: String!) {
                products(first: 1, query: $q) {
                  edges { node { featuredImage { url } images(first: 1) { edges { node { url } } } } }
                }
              }
            `, { variables: { q: `${qField}:'${escaped}'` } });
            const prodData = await prodResp.json();
            const node = prodData?.data?.products?.edges?.[0]?.node;
            imageSrc = node?.featuredImage?.url || node?.images?.edges?.[0]?.node?.url || null;
          } catch { /* image is optional */ }

          // 2. Create the smart collection (with image if found).
          const input: any = {
            title: c.title,
            descriptionHtml: c.description ? `<p>${c.description}</p>` : undefined,
            ruleSet: {
              appliedDisjunctively: false,
              rules: [{ column, relation: "EQUALS", condition: c.rule_value }],
            },
          };
          if (imageSrc) input.image = { src: imageSrc };

          const resp = await admin.graphql(`#graphql
            mutation collectionCreate($input: CollectionInput!) {
              collectionCreate(input: $input) {
                collection { id title handle }
                userErrors { field message }
              }
            }
          `, { variables: { input } });
          const data = await resp.json();
          const errs = data?.data?.collectionCreate?.userErrors;
          if (errs?.length) { results.push({ title: c.title, ok: false, error: errs[0].message }); continue; }

          const collectionId = data?.data?.collectionCreate?.collection?.id;

          // 3. Publish to the Online Store so it actually appears on the storefront.
          if (collectionId && onlineStorePublicationId) {
            await admin.graphql(`#graphql
              mutation publish($id: ID!, $input: [PublicationInput!]!) {
                publishablePublish(id: $id, input: $input) {
                  userErrors { field message }
                }
              }
            `, { variables: { id: collectionId, input: [{ publicationId: onlineStorePublicationId }] } }).catch(() => {});
          }

          results.push({ title: c.title, ok: true });
        } catch (e: any) {
          results.push({ title: c.title, ok: false, error: e.message });
        }
      }

      const created = results.filter(r => r.ok).length;
      return json({
        success: true, results,
        message: `Created & published ${created} of ${selected.length} collections to your Online Store.`,
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // 2. SITEMAP — build an organised HTML sitemap page for SEO + navigation
    // ════════════════════════════════════════════════════════════════════════
    if (intent === "generate_sitemap") {
      // Gather live collections + published pages.
      const [collResp, pageResp, shopResp] = await Promise.all([
        admin.graphql(`#graphql
          query { collections(first: 100) { edges { node { handle title } } } }
        `),
        admin.graphql(`#graphql
          query { pages(first: 100) { edges { node { handle title } } } }
        `),
        admin.graphql(`#graphql query { shop { name primaryDomain { url } } }`),
      ]);
      const collData = await collResp.json();
      const pageData = await pageResp.json();
      const shopData = await shopResp.json();

      const storeUrl: string = shopData?.data?.shop?.primaryDomain?.url || "";
      const shopName: string = shopData?.data?.shop?.name || "Our Store";
      const collections = (collData?.data?.collections?.edges || []).map((e: any) => e.node);
      const pages = (pageData?.data?.pages?.edges || []).map((e: any) => e.node);

      const policyLinks = [
        { title: "Privacy Policy", handle: "privacy-policy" },
        { title: "Refund & Return Policy", handle: "refund-policy" },
        { title: "Shipping Policy", handle: "shipping-policy" },
        { title: "Terms of Service", handle: "terms-of-service" },
      ];

      const linkLi = (title: string, href: string) =>
        `<li style="margin:6px 0;"><a href="${href}" style="color:#0369a1;text-decoration:none;">${title}</a></li>`;

      const section = (heading: string, items: string[]) =>
        items.length
          ? `<div style="margin-bottom:28px;"><h2 style="font-size:20px;margin:0 0 10px;color:#1a1a1a;border-bottom:2px solid #eee;padding-bottom:6px;">${heading}</h2><ul style="list-style:none;padding:0;margin:0;columns:2;-webkit-columns:2;">${items.join("")}</ul></div>`
          : "";

      const html = `<div style="max-width:960px;margin:0 auto;line-height:1.6;color:#333;">
<p style="font-size:16px;margin:0 0 24px;">Welcome to the ${shopName} sitemap — a complete directory of our shop. Use the links below to quickly find collections, pages and policies.</p>
${section("Shop by Collection", collections.map((c: any) => linkLi(c.title, `/collections/${c.handle}`)))}
${section("Pages", pages.map((p: any) => linkLi(p.title, `/pages/${p.handle}`)))}
${section("Customer Policies", policyLinks.map(p => linkLi(p.title, `/policies/${p.handle}`)))}
<div style="margin-top:8px;"><h2 style="font-size:20px;margin:0 0 10px;color:#1a1a1a;border-bottom:2px solid #eee;padding-bottom:6px;">Quick Links</h2><ul style="list-style:none;padding:0;margin:0;">${linkLi("Home", "/")}${linkLi("All Products", "/collections/all")}${linkLi("Contact Us", "/pages/contact")}</ul></div>
</div>`;

      // Upsert a "Sitemap" page (handle: sitemap)
      const findResp = await admin.graphql(`#graphql
        query findPage($q: String!) { pages(first: 1, query: $q) { edges { node { id } } } }
      `, { variables: { q: "handle:sitemap" } });
      const existing = (await findResp.json())?.data?.pages?.edges?.[0]?.node;

      if (existing) {
        await admin.graphql(`#graphql
          mutation pageUpdate($id: ID!, $page: PageUpdateInput!) {
            pageUpdate(id: $id, page: $page) { page { id handle } userErrors { field message } }
          }
        `, { variables: { id: existing.id, page: { body: html } } });
      } else {
        await admin.graphql(`#graphql
          mutation pageCreate($page: PageCreateInput!) {
            pageCreate(page: $page) { page { id handle } userErrors { field message } }
          }
        `, { variables: { page: { title: "Sitemap", handle: "sitemap", body: html, isPublished: true } } });
      }

      return json({
        success: true,
        sitemapUrl: `${storeUrl}/pages/sitemap`,
        xmlSitemapUrl: `${storeUrl}/sitemap.xml`,
        counts: { collections: collections.length, pages: pages.length },
        message: `HTML sitemap built with ${collections.length} collections and ${pages.length} pages.`,
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // 3. CROSS-SELL — AI suggests complementary products, save as metafields
    // ════════════════════════════════════════════════════════════════════════
    if (intent === "suggest_crosssell") {
      const products = await fetchAllProducts(admin);
      if (products.length < 2) return json({ error: "You need at least 2 products to build cross-sell links." }, { status: 400 });

      const creditsNeeded = Math.max(1, Math.ceil(products.length / 5));
      const creditErr = await checkCredits(creditsNeeded);
      if (creditErr) return creditErr;

      // Full candidate POOL — every product is a valid complement, so the AI sees
      // the whole catalog. Kept compact (index + short title + type + a few tags).
      const pool = products.map((p, i) => ({
        i,
        title: p.title.slice(0, 70),
        type: p.type || "",
        tags: (p.tags || []).slice(0, 5),
      }));
      const poolJson = JSON.stringify(pool);

      // Process EVERY product as a target, in deterministic batches, so the whole
      // catalog is covered in a single "Find Cross-Sells" run (not just the first few).
      const BATCH = 35;
      const batchStarts: number[] = [];
      for (let start = 0; start < products.length; start += BATCH) batchStarts.push(start);

      const buildPrompt = (targetIdxs: number[]) => `You are an expert e-commerce cross-sell & merchandising strategist. You are given a store's FULL catalog as a candidate POOL (each item has an index "i"). Your job: for EACH TARGET product listed below, recommend the products from the POOL that a shopper would most likely buy alongside it.

POOL (all selectable products — recommend ONLY by these indices):
${poolJson}

TARGET PRODUCT INDICES to generate recommendations for (cover EVERY one of these):
${JSON.stringify(targetIdxs)}

STRICT RULES (be thorough, consistent and deterministic):
1. Output a recommendation entry for EVERY target index above. Do not skip any target unless the pool literally has no other product (i.e. fewer than 2 products total).
2. Recommend ONLY by index from the POOL. Never invent products. Never recommend the target itself.
3. Prefer TRUE COMPLEMENTS first — different items bought together (phone case → tempered glass + charger; jeans → belt + shoes; snowboard → bindings + boots + wax + bag).
4. If the catalog has no genuine complement for a target, FALL BACK to the 2–4 most closely RELATED / similar products so every product still gets useful recommendations.
5. Give 2–4 recommendations per target (fewer only if the catalog is very small).
6. Be DETERMINISTIC: always choose the single most relevant set; pick lower indices first when equally relevant, so repeated runs give the same result.
7. One short, specific reason per target.
8. Output valid JSON only — no markdown, no commentary.

Return ONLY:
{
  "links": [
    { "i": 0, "complements": [3, 7], "reason": "Shoppers who buy this usually add ..." }
  ]
}`;

      // Run all batches in parallel (temperature 0 → stable, repeatable across runs).
      const batchResults = await Promise.all(batchStarts.map(start => {
        const targetIdxs: number[] = [];
        for (let i = start; i < Math.min(start + BATCH, products.length); i++) targetIdxs.push(i);
        return runGeminiJson(buildPrompt(targetIdxs), `crosssell_${start}`, 0)
          .catch(() => ({ links: [] }));
      }));

      const linkByIndex = new Map<number, { complements: number[]; reason: string }>();
      for (const result of batchResults) {
        for (const l of (result.links || [])) {
          if (typeof l.i !== "number") continue;
          const complements = (l.complements || []).filter((ci: number) => ci !== l.i && products[ci]);
          if (complements.length) linkByIndex.set(l.i, { complements, reason: l.reason || "" });
        }
      }

      await chargeCredits(session.shop, creditsNeeded);

      // Resolve indices → product ids/titles, dedupe complements, stable order by index.
      const links = [...linkByIndex.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([i, l]) => {
          const seen = new Set<string>();
          const complements = l.complements
            .map((ci: number) => ({ id: products[ci]?.id, title: products[ci]?.title }))
            .filter((c: any) => c.id && c.id !== products[i]?.id && !seen.has(c.id) && seen.add(c.id))
            .slice(0, 4);
          return { product_id: products[i]?.id, product_title: products[i]?.title, reason: l.reason, complements };
        })
        .filter(l => l.product_id && l.complements.length);

      return json({
        success: true,
        links,
        totalProducts: products.length,
        coveredProducts: links.length,
        creditsUsed: creditsNeeded,
      });
    }

    // ── Apply cross-sell links: metafield definition + values + theme snippet ──
    if (intent === "apply_crosssell") {
      const links: Array<{ product_id: string; complements: Array<{ id: string }> }> = body.links || [];
      if (!links.length) return json({ error: "No cross-sell links to apply." }, { status: 400 });

      // 1. Ensure a metafield DEFINITION exists so the field is visible in admin and
      //    readable by the theme. Idempotent — ignore "already exists".
      try {
        const defResp = await admin.graphql(`#graphql
          mutation defCreate($definition: MetafieldDefinitionInput!) {
            metafieldDefinitionCreate(definition: $definition) {
              createdDefinition { id }
              userErrors { field message code }
            }
          }
        `, {
          variables: {
            definition: {
              name: "Complementary Products",
              namespace: "custom",
              key: "complementary_products",
              description: "Cross-sell / related products shown on the product page.",
              type: "list.product_reference",
              ownerType: "PRODUCT",
            },
          },
        });
        await defResp.json(); // ignore TAKEN/already-exists errors
      } catch { /* non-fatal */ }

      // 2. Save the complementary-product values (chunked — max 25 per call).
      const metafields = links.map(l => ({
        ownerId: l.product_id,
        namespace: "custom",
        key: "complementary_products",
        type: "list.product_reference",
        value: JSON.stringify(l.complements.map(c => c.id)),
      }));

      const results: Array<{ ok: boolean; error?: string }> = [];
      for (let i = 0; i < metafields.length; i += 25) {
        const chunk = metafields.slice(i, i + 25);
        const resp = await admin.graphql(`#graphql
          mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              metafields { id }
              userErrors { field message }
            }
          }
        `, { variables: { metafields: chunk } });
        const data = await resp.json();
        const errs = data?.data?.metafieldsSet?.userErrors;
        if (errs?.length) results.push({ ok: false, error: errs[0].message });
        else results.push({ ok: true });
      }
      const failed = results.filter(r => !r.ok);

      // 3. Display is handled by our Theme App Extension app block (Built-for-Shopify
      //    compliant — no theme-file editing). The merchant adds it to the product
      //    page with ONE CLICK via this deep link; Shopify writes it into the theme
      //    and auto-removes it on uninstall. The block reads the metafield we just set.
      const apiKey = process.env.SHOPIFY_API_KEY || "";
      const addBlockUrl = `https://${session.shop}/admin/themes/current/editor?template=product&addAppBlockId=${apiKey}/related-products&target=newAppsSection`;

      return json({
        success: failed.length === 0,
        savedCount: links.length,
        addBlockUrl,
        setupSteps: [
          "Click 'Add to product page' below — it opens your theme editor with our 'Related Products' block ready to place.",
          "The block appears under a new 'Apps' section on the product template. Drag it where you'd like it shown.",
          "Click Save. That's it — related products now show on every product page automatically.",
        ],
        message: failed.length === 0
          ? `Cross-sell links saved to ${links.length} products. Add the display block to your product page with one click below.`
          : `Saved with ${failed.length} error(s): ${failed[0].error}`,
      });
    }

    return json({ error: `Unknown intent: ${intent}` }, { status: 400 });
  } catch (err: any) {
    console.error(`[merchandising] ${intent} failed:`, err);
    return json({ error: err.message || "Operation failed." }, { status: 500 });
  }
}
