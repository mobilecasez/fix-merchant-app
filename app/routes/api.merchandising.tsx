import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { geminiGenerateText, extractJson } from "../utils/gemini.server";
import {
  incrementProductUsage, getOrCreateSubscription, getProductsUsed, getEffectiveProductLimit,
} from "../utils/billing.server";

/**
 * Run Gemini and parse JSON — uses the shared model-fallback helper with JSON mode, a high output
 * cap and low-thinking (Gemini 3's dynamic thinking otherwise burns the whole output budget and
 * truncates), and the robust `extractJson` salvage (handles top-level arrays + trailing braces,
 * which the old indexOf('{')…lastIndexOf('}') slice broke on). Time-boxed so a big prompt can't hang.
 */
async function runGeminiJson(prompt: string, _retryId: string, temperature = 0.2): Promise<any> {
  const text = await Promise.race([
    geminiGenerateText(
      { config: { generationConfig: { temperature, responseMimeType: "application/json", maxOutputTokens: 8192 } }, lowThinking: true },
      prompt,
    ),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("AI timed out")), 120000)),
  ]);
  const parsed = extractJson(text);
  if (!parsed) throw new Error("AI returned unparseable JSON");
  return parsed;
}

type CatProduct = { id: string; title: string; handle: string; type: string; vendor: string; tags: string[] };

/** Pull the WHOLE catalogue (250/page, uncapped up to ~6000) with the fields the AI + rules need. */
async function fetchAllProducts(admin: any): Promise<CatProduct[]> {
  const out: CatProduct[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 24; page++) {
    const resp: any = await admin.graphql(`#graphql
      query products($cursor: String) {
        products(first: 250, after: $cursor, query: "status:active") {
          pageInfo { hasNextPage endCursor }
          edges { node { id title handle productType vendor tags } }
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
        handle: e.node.handle || "",
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

/** Cursor-paginated fetch of {handle,title} nodes for a connection (collections / pages). */
async function fetchAllNodes(admin: any, field: "collections" | "pages"): Promise<Array<{ handle: string; title: string }>> {
  const out: Array<{ handle: string; title: string }> = [];
  let cursor: string | null = null;
  for (let page = 0; page < 12; page++) {
    const resp: any = await admin.graphql(`#graphql
      query nodes($cursor: String) {
        ${field}(first: 250, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          edges { node { handle title } }
        }
      }
    `, { variables: { cursor } });
    const data = await resp.json();
    const conn = data?.data?.[field];
    if (!conn) break;
    for (const e of conn.edges) out.push({ handle: e.node.handle, title: e.node.title });
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

      const creditErr = await checkCredits(3);
      if (creditErr) return creditErr;

      // Send the WHOLE catalog to the AI — the point is to read every TITLE and infer the real
      // brand / model / category structure, not just prettify existing tags. Compact & indexed.
      const catalog = products.map((p, i) => ({ i, t: p.title, ty: p.type || undefined, v: p.vendor || undefined }));

      const prompt = `You are a world-class Shopify merchandising expert. Below is a store's FULL product catalog. Each item has an index "i", a title "t", and optional product type "ty" and vendor "v".

Read the PRODUCT TITLES and infer the true structure of this catalog — brand, product line / MODEL, category, material, colour, compatibility, use-case. Example: from "UAG Monarch Rugged Case for iPhone 15 Pro Max" infer brand=UAG, model="iPhone 15 Pro Max", category=Case. Then design a set of HIGH-CONVERTING collections shoppers actually search and browse for.

CATALOG (${products.length} products):
${JSON.stringify(catalog)}

Define every collection with a TITLE-KEYWORD RULE the system applies automatically: "title_all" is the list of lowercase words/phrases that a product's TITLE must ALL contain to belong. Optionally also constrain by exact product_type or vendor. Examples:
- "iPhone 15 Pro Cases"  -> title_all: ["iphone 15 pro", "case"]
- "Samsung Galaxy S24 Screen Protectors" -> title_all: ["galaxy s24", "screen protector"]
- "Leather Wallets" -> title_all: ["leather", "wallet"]
- "UAG Accessories" -> title_all: ["uag"]   (or vendor: "UAG")

RULES:
1. Group collections under intuitive PARENT GROUPS that fit THIS catalog (e.g. "By Brand", "By Model / Device", "By Category", "By Material / Feature", "Bundles & Featured").
2. Choose title_all keywords that are SPECIFIC enough to be accurate yet BROAD enough to catch every matching product — use the exact brand/model/category tokens that appear in the titles.
3. Produce 15-40 collections that together cover most of the catalog, with minimal near-duplicates. Favour model+category combos ("iPhone 15 Pro Cases") that convert.
4. Each collection: a clean shopper-facing title + a one-line SEO description.
5. title_all: lowercase, trimmed keywords only. No regex, no punctuation-only tokens.
6. Output valid JSON only — no markdown.

Return ONLY:
{ "groups": [ { "group": "By Model / Device", "collections": [ { "title": "iPhone 15 Pro Cases", "description": "...", "title_all": ["iphone 15 pro","case"], "product_type": null, "vendor": null } ] } ] }`;

      const result = await runGeminiJson(prompt, "suggest_collections");

      // Compute membership DETERMINISTICALLY in code (accurate counts, drop empties/dupes). The AI
      // proposes the rules; the app decides who's actually in — so no hallucinated product lists.
      // On very large catalogs the local scan is over the fetched window (≤6000); the created smart
      // collection matches the WHOLE catalog, so when truncated we keep low-count collections (their
      // real membership can be larger) and treat counts as a lower bound.
      const truncated = products.length >= 6000;
      const minCount = truncated ? 1 : 3;
      const norm = (s: string) => (s || "").toLowerCase().trim();
      const seenRule = new Set<string>();
      const groups = ((result.groups || []) as any[]).map((g: any) => ({
        group: g.group || "Collections",
        collections: ((g.collections || []) as any[]).map((c: any) => {
          const titleAll: string[] = (c.title_all || []).map((k: string) => norm(k)).filter(Boolean);
          const pType = c.product_type ? norm(c.product_type) : null;
          const vendor = c.vendor ? norm(c.vendor) : null;
          if (!titleAll.length && !pType && !vendor) return null;
          const ruleKey = JSON.stringify([titleAll, pType, vendor]);
          if (seenRule.has(ruleKey)) return null; // drop duplicate rules across groups
          seenRule.add(ruleKey);
          let count = 0;
          for (const p of products) {
            const t = norm(p.title);
            if (titleAll.length && !titleAll.every((k) => t.includes(k))) continue;
            if (pType && norm(p.type) !== pType) continue;
            if (vendor && norm(p.vendor) !== vendor) continue;
            count++;
          }
          return { title: String(c.title || "").trim(), description: String(c.description || "").trim(), title_all: titleAll, product_type: c.product_type || null, vendor: c.vendor || null, count };
        }).filter((c: any) => c && c.title && c.count >= minCount),
      })).filter((g: any) => g.collections.length);

      // Only charge once we've confirmed the AI produced usable collections.
      if (!groups.length) return json({ error: "The AI couldn't design usable collections for this catalog (too few matching products). No credits were charged." }, { status: 422 });
      await chargeCredits(session.shop, 3);

      return json({ success: true, suggestions: groups, totalProducts: products.length, truncated, creditsUsed: 3 });
    }

    // ── Create the selected collections as Shopify smart collections ──────────
    if (intent === "create_collections") {
      const selected: Array<any> = body.collections || [];
      if (!selected.length) return json({ error: "No collections selected." }, { status: 400 });

      // Build a smart-collection ruleSet from the AI match spec (title keywords + optional
      // type/vendor). Falls back to the legacy single rule_field/rule_value shape.
      const buildRules = (c: any): any[] => {
        const rules: any[] = [];
        for (const kw of (Array.isArray(c.title_all) ? c.title_all : [])) {
          const v = String(kw || "").trim();
          if (v) rules.push({ column: "TITLE", relation: "CONTAINS", condition: v });
        }
        if (c.product_type) rules.push({ column: "TYPE", relation: "EQUALS", condition: String(c.product_type) });
        if (c.vendor) rules.push({ column: "VENDOR", relation: "EQUALS", condition: String(c.vendor) });
        if (!rules.length && c.rule_field && c.rule_value) {
          const col: Record<string, string> = { TAG: "TAG", TYPE: "TYPE", VENDOR: "VENDOR" };
          rules.push({ column: col[String(c.rule_field).toUpperCase()] || "TAG", relation: "EQUALS", condition: String(c.rule_value) });
        }
        return rules;
      };
      // A storefront search query to grab a representative cover image for the collection.
      const coverQuery = (c: any): string => {
        const kw = (Array.isArray(c.title_all) && c.title_all[0]) || c.rule_value;
        if (kw) return `title:*${String(kw).replace(/[:'"*]/g, " ").trim()}*`;
        if (c.product_type) return `product_type:'${String(c.product_type).replace(/'/g, " ")}'`;
        if (c.vendor) return `vendor:'${String(c.vendor).replace(/'/g, " ")}'`;
        return "";
      };

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
        const rules = buildRules(c);
        if (!rules.length) { results.push({ title: c.title, ok: false, error: "No valid rule for this collection." }); continue; }
        try {
          // 1. Find a representative product image to use as the collection cover.
          let imageSrc: string | null = null;
          try {
            const q = coverQuery(c);
            if (q) {
              const prodResp = await admin.graphql(`#graphql
                query firstMatch($q: String!) {
                  products(first: 1, query: $q) {
                    edges { node { featuredImage { url } images(first: 1) { edges { node { url } } } } }
                  }
                }
              `, { variables: { q } });
              const prodData = await prodResp.json();
              const node = prodData?.data?.products?.edges?.[0]?.node;
              imageSrc = node?.featuredImage?.url || node?.images?.edges?.[0]?.node?.url || null;
            }
          } catch { /* image is optional */ }

          // 2. Create the smart collection — a multi-rule ruleSet (all rules AND'd) that
          //    auto-updates as the catalog changes, so no tagging / manual attach is needed.
          const input: any = {
            title: c.title,
            descriptionHtml: c.description ? `<p>${c.description}</p>` : undefined,
            ruleSet: { appliedDisjunctively: false, rules },
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
      // Gather EVERYTHING crawlable: all products, all collections, all pages, real store policies.
      const [collections, pages, products, shopResp] = await Promise.all([
        fetchAllNodes(admin, "collections"),
        fetchAllNodes(admin, "pages"),
        fetchAllProducts(admin),
        admin.graphql(`#graphql query { shop { name primaryDomain { url } shopPolicies { title url } } }`),
      ]);
      const shopData = await shopResp.json();
      const storeUrl: string = shopData?.data?.shop?.primaryDomain?.url || "";
      const shopName: string = shopData?.data?.shop?.name || "Our Store";
      // Real policy URLs from Shopify (never guessed handles) — only the ones that actually exist.
      const policies: Array<{ title: string; url: string }> = (shopData?.data?.shop?.shopPolicies || []).filter((p: any) => p?.url);

      const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      const linkLi = (title: string, href: string) =>
        `<li><a href="${esc(href)}" style="color:#0369a1">${esc(title)}</a></li>`;
      const section = (heading: string, items: string[]) =>
        items.length
          ? `<div style="margin-bottom:28px;"><h2 style="font-size:20px;margin:0 0 10px;color:#1a1a1a;border-bottom:2px solid #eee;padding-bottom:6px;">${esc(heading)}</h2><ul style="list-style:none;padding:0;margin:0;columns:2;-webkit-columns:2;">${items.join("")}</ul></div>`
          : "";

      // Products grouped by product type (crawlable internal links Google + shoppers can follow).
      // Capped to keep the page body within Shopify limits on very large catalogs.
      const MAX_PRODUCT_LINKS = 1000; // keep the page body within Shopify's size limit
      const byType = new Map<string, Array<{ title: string; handle: string }>>();
      let linkBudget = MAX_PRODUCT_LINKS;
      for (const p of products) {
        if (linkBudget <= 0) break;
        if (!p.handle) continue;
        const key = p.type?.trim() || "More Products";
        if (!byType.has(key)) byType.set(key, []);
        byType.get(key)!.push({ title: p.title, handle: p.handle });
        linkBudget--;
      }
      const typeSections = [...byType.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([type, list]) =>
          section(type, list.sort((a, b) => a.title.localeCompare(b.title)).map((p) => linkLi(p.title, `/products/${p.handle}`)))
        )
        .join("");

      const html = `<div style="max-width:1000px;margin:0 auto;line-height:1.6;color:#333;">
<p style="font-size:16px;margin:0 0 24px;">Welcome to the ${esc(shopName)} sitemap — a complete directory of our shop. Browse every collection, product, page and policy below.</p>
${section("Shop by Collection", collections.map((c) => linkLi(c.title, `/collections/${c.handle}`)))}
<h2 style="font-size:22px;margin:6px 0 14px;color:#111;">All Products</h2>
${typeSections || section("Products", [])}
${section("Pages", pages.map((p) => linkLi(p.title, `/pages/${p.handle}`)))}
${section("Customer Policies", policies.map((p) => linkLi(p.title, p.url)))}
<div style="margin-top:8px;"><h2 style="font-size:20px;margin:0 0 10px;color:#1a1a1a;border-bottom:2px solid #eee;padding-bottom:6px;">Quick Links</h2><ul style="list-style:none;padding:0;margin:0;">${linkLi("Home", "/")}${linkLi("All Products", "/collections/all")}</ul></div>
</div>`;

      // Upsert a "Sitemap" page. NON-DESTRUCTIVE: app-generated sitemaps carry a marker so re-runs
      // update in place; if a merchant already has a REAL page at 'sitemap', we publish ours at
      // 'store-sitemap' instead of clobbering it. We track the ACTUAL handle we wrote to.
      const SITEMAP_MARKER = "shopflix-sitemap";
      const body = `<!-- ${SITEMAP_MARKER} -->\n${html}`;
      // Runs a page mutation and returns the real handle OR a userError message (never a false handle).
      const upsert = async (mutation: string, variables: any): Promise<{ handle: string | null; error: string | null }> => {
        try {
          const r = await admin.graphql(mutation, variables);
          const d = await r.json();
          const payload = d?.data?.pageUpdate || d?.data?.pageCreate;
          const err = payload?.userErrors?.[0]?.message || (d?.errors?.[0]?.message) || null;
          return { handle: payload?.page?.handle || null, error: err };
        } catch (e: any) {
          return { handle: null, error: e?.message || "Page mutation failed." };
        }
      };
      const CREATE = `#graphql
        mutation pageCreate($page: PageCreateInput!) {
          pageCreate(page: $page) { page { id handle } userErrors { field message } }
        }`;
      const UPDATE = `#graphql
        mutation pageUpdate($id: ID!, $page: PageUpdateInput!) {
          pageUpdate(id: $id, page: $page) { page { id handle } userErrors { field message } }
        }`;

      // Look at BOTH candidate handles so re-runs update our own page in place (never re-create a
      // taken handle). Our page is the one carrying the marker, whichever handle it lives on.
      const findResp = await admin.graphql(`#graphql
        query findPages($q: String!) { pages(first: 10, query: $q) { edges { node { id handle body } } } }
      `, { variables: { q: "handle:sitemap OR handle:store-sitemap" } });
      const nodes: any[] = ((await findResp.json())?.data?.pages?.edges || []).map((e: any) => e.node);
      const appPage = nodes.find((n) => String(n.body || "").includes(SITEMAP_MARKER));
      const sitemapPage = nodes.find((n) => n.handle === "sitemap");
      const storePage = nodes.find((n) => n.handle === "store-sitemap");

      let res: { handle: string | null; error: string | null };
      if (appPage) {
        res = await upsert(UPDATE, { id: appPage.id, page: { body } }); // refresh our page in place
      } else if (sitemapPage) {
        // A real merchant page owns 'sitemap' — publish/refresh ours at 'store-sitemap' instead.
        res = storePage
          ? await upsert(UPDATE, { id: storePage.id, page: { body } })
          : await upsert(CREATE, { page: { title: "Store Sitemap", handle: "store-sitemap", body, isPublished: true } });
      } else {
        res = await upsert(CREATE, { page: { title: "Sitemap", handle: "sitemap", body, isPublished: true } });
      }
      if (res.error || !res.handle) {
        return json({ error: `Couldn't save the sitemap page: ${res.error || "unknown error"}. No sitemap was published.` }, { status: 502 });
      }
      const handle = res.handle;

      const productCount = MAX_PRODUCT_LINKS - Math.max(0, linkBudget);
      return json({
        success: true,
        sitemapUrl: `${storeUrl}/pages/${handle}`,
        xmlSitemapUrl: `${storeUrl}/sitemap.xml`,
        counts: { products: productCount, collections: collections.length, pages: pages.length },
        message: `HTML sitemap built with ${productCount} products, ${collections.length} collections and ${pages.length} pages.`,
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // 3. CROSS-SELL — AI suggests complementary products, save as metafields
    // ════════════════════════════════════════════════════════════════════════
    if (intent === "suggest_crosssell") {
      const allProducts = await fetchAllProducts(admin);
      if (allProducts.length < 2) return json({ error: "You need at least 2 products to build cross-sell links." }, { status: 400 });

      // Cross-sell embeds the candidate pool in every batch prompt, so cost scales with catalog size
      // — process a bounded WINDOW per run. The UI passes `offset` to continue through a large
      // catalog; `nextOffset` in the response tells it where to resume so every product gets covered.
      const CS_MAX = 500;
      const totalCatalog = allProducts.length;
      const offset = Math.min(Math.max(0, Math.floor(Number(body.offset) || 0)), Math.max(0, totalCatalog - 1));
      const products = allProducts.slice(offset, offset + CS_MAX);
      if (products.length < 2) return json({ error: "No more products to process from that point." }, { status: 400 });
      const nextOffset = offset + CS_MAX < totalCatalog ? offset + CS_MAX : null;

      const creditsNeeded = Math.max(1, Math.ceil(products.length / 5));
      const creditErr = await checkCredits(creditsNeeded);
      if (creditErr) return creditErr;

      // Full candidate POOL — every product is a valid complement, so the AI sees
      // the whole catalog. Kept compact (index + short title + type + a few tags).
      const pool = products.map((p, i) => ({
        i,
        title: p.title.slice(0, 80),
        type: p.type || "",
        vendor: p.vendor || "",
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
3. BRAND + MODEL AWARE: infer each product's brand and MODEL/DEVICE from its title (e.g. "iPhone 15 Pro Max", "Galaxy S24"). For accessories (case, cover, screen protector, charger, cable, mount, strap), the strongest complements are (a) OTHER accessory categories for the SAME device/model, then (b) the same accessory in a compatible model. Never recommend a case for a different phone model.
4. Prefer TRUE COMPLEMENTS bought together (phone case → tempered glass + charger + cable; jeans → belt + shoes; snowboard → bindings + boots + wax + bag). Only if there's no genuine complement, FALL BACK to the 2–4 most closely RELATED / same-category products so every product still gets useful recommendations.
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
          .catch(() => ({ links: [], _failed: true }));
      }));

      const linkByIndex = new Map<number, { complements: number[]; reason: string }>();
      for (const result of batchResults) {
        const linksArr = Array.isArray((result as any)?.links) ? (result as any).links : [];
        for (const l of linksArr) {
          if (!l || typeof l.i !== "number") continue;
          const raw = Array.isArray(l.complements) ? l.complements : [];
          const complements = raw.filter((ci: number) => ci !== l.i && products[ci]);
          if (complements.length) linkByIndex.set(l.i, { complements, reason: l.reason || "" });
        }
      }

      // If EVERY batch failed (AI outage/overload), don't charge — surface the error instead.
      if (batchResults.every((r: any) => r?._failed)) {
        return json({ error: "The AI service is busy right now — no cross-sell links were generated and no credits were charged. Please try again in a minute." }, { status: 503 });
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
        totalProducts: totalCatalog,
        processedCount: products.length,
        coveredProducts: links.length,
        nextOffset,
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
