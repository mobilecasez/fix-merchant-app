import prisma from "../db.server";
import {
  fetchPricingProducts, getOrderStatsByProduct, getShopCurrency, resolveRange,
} from "./product-analytics.server";
import { getCpcSnapshot } from "./google-ads.server";

// Builds/refreshes an auto-updating "Best Sellers" SMART collection from Price Radar data.
//
// Shopify smart-collection rules can't express "top sellers net of ad cost", so we compute the
// ranking ourselves (last-N-day delivered revenue minus attributed Google Ads spend), TAG the
// winners with `shopflix-best-seller`, and back a smart collection with a single TAG=… rule.
// A monthly cron re-runs this to re-tag — so the collection self-maintains. Idempotent + diffed:
// products that drop out of the top set get the tag removed.

const DEFAULT_TAG = "shopflix-best-seller";
const DEFAULT_TITLE = "Best Sellers";

type AdminClient = { graphql: (q: string, o?: any) => Promise<any> };

async function gql(admin: AdminClient, query: string, variables?: any) {
  const resp = await admin.graphql(query, variables ? { variables } : undefined);
  return await resp.json();
}

async function tagsAdd(admin: AdminClient, id: string, tags: string[]): Promise<any[]> {
  const d = await gql(admin, `#graphql
    mutation bsTagsAdd($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }`,
    { id, tags });
  return d?.data?.tagsAdd?.userErrors || [];
}

async function tagsRemove(admin: AdminClient, id: string, tags: string[]): Promise<any[]> {
  const d = await gql(admin, `#graphql
    mutation bsTagsRemove($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { message } } }`,
    { id, tags });
  return d?.data?.tagsRemove?.userErrors || [];
}

async function resolveOnlineStorePublication(admin: AdminClient): Promise<string | null> {
  try {
    const d = await gql(admin, `#graphql query { publications(first: 20) { edges { node { id name } } } }`);
    const pubs = d?.data?.publications?.edges || [];
    const online = pubs.find((e: any) => /online store/i.test(e.node?.name || "")) || pubs[0];
    return online?.node?.id || null;
  } catch {
    return null;
  }
}

// Reuse an existing collection if it still exists, else create the smart collection + publish it.
async function ensureCollection(
  admin: AdminClient, title: string, tag: string, windowDays: number, existingId?: string | null,
): Promise<{ id: string | null; created: boolean; error?: string }> {
  if (existingId) {
    try {
      const d = await gql(admin, `#graphql query bsColl($id: ID!) { collection(id: $id) { id } }`, { id: existingId });
      if (d?.data?.collection?.id) return { id: existingId, created: false };
    } catch { /* fall through and recreate */ }
  }
  const input: any = {
    title,
    descriptionHtml: `<p>Your current best-selling products (last ${windowDays} days, ranked by orders net of ad cost) — updated automatically by ShopFlix AI.</p>`,
    ruleSet: { appliedDisjunctively: false, rules: [{ column: "TAG", relation: "EQUALS", condition: tag }] },
    sortOrder: "BEST_SELLING",
  };
  const d = await gql(admin, `#graphql
    mutation bsCollectionCreate($input: CollectionInput!) {
      collectionCreate(input: $input) { collection { id } userErrors { field message } }
    }`, { input });
  const errs = d?.data?.collectionCreate?.userErrors;
  if (errs?.length) return { id: null, created: false, error: errs[0].message };
  const id = d?.data?.collectionCreate?.collection?.id || null;
  if (id) {
    const pub = await resolveOnlineStorePublication(admin);
    if (pub) {
      await gql(admin, `#graphql
        mutation bsPublish($id: ID!, $input: [PublicationInput!]!) {
          publishablePublish(id: $id, input: $input) { userErrors { field message } }
        }`, { id, input: [{ publicationId: pub }] }).catch(() => {});
    }
  }
  return { id, created: true };
}

export interface BestSellerResult {
  ok: boolean;
  error?: string;
  collectionId?: string;
  title?: string;
  count?: number;
  currency?: string;
  added?: number;
  removed?: number;
  created?: boolean;
}

export async function refreshBestSellerCollection(
  admin: AdminClient,
  shop: string,
  opts: { topN?: number; windowDays?: number; scopes?: string } = {},
): Promise<BestSellerResult> {
  const existing = await prisma.bestSellerCollection.findUnique({ where: { shop } }).catch(() => null);
  const topN = Math.min(50, Math.max(3, opts.topN ?? existing?.topN ?? 20));
  const windowDays = Math.max(7, opts.windowDays ?? existing?.windowDays ?? 30);
  const tag = existing?.tag || DEFAULT_TAG;
  const title = existing?.collectionTitle || DEFAULT_TITLE;

  // Ranking by orders needs read_orders. When the caller knows the scopes (route handler), fail
  // early with a clear message; the cron passes no scopes and relies on the query throwing.
  if (opts.scopes && !/read_orders/.test(opts.scopes)) {
    return { ok: false, error: "Best-seller ranking needs order access. Reload the app to approve the updated permissions, then try again." };
  }

  const currency = (await getShopCurrency(admin as any, shop)) || "USD";
  const url = new URL("https://x/");
  url.searchParams.set("days", String(windowDays));
  const range = resolveRange(url, null);

  const [products, orderStats, cpc] = await Promise.all([
    fetchPricingProducts(admin as any, currency),
    getOrderStatsByProduct(admin as any, range, { shipCostPrepaid: 0, shipCostCod: 0, rtoCostPrepaid: 0, rtoCostCod: 0 }),
    getCpcSnapshot(shop),
  ]);
  const perf: Record<string, { c: number; s: number }> = (cpc?.perfByProduct as any) || {};

  // Score = delivered revenue − attributed ad spend (last N days). Best sellers that lose money
  // to ads rank below cheaper-to-acquire ones — "best sellers based on order AND ad cost".
  const ranked = products
    .map((p: any) => {
      const st: any = orderStats.byProduct.get(p.numericId);
      const orders = st?.orders || 0;
      const revenue = st?.revenue || 0;
      const adSpend = perf[p.numericId]?.s || 0;
      return { numericId: p.numericId, gid: p.productId as string, orders, revenue, adSpend, score: revenue - adSpend };
    })
    .filter((r) => r.orders > 0 && r.gid)
    .sort((a, b) => b.score - a.score || b.orders - a.orders)
    .slice(0, topN);

  if (!ranked.length) {
    return { ok: false, error: `No sales in the last ${windowDays} days yet — nothing to add to a best-sellers collection.` };
  }

  const coll = await ensureCollection(admin, title, tag, windowDays, existing?.collectionId);
  if (!coll.id) return { ok: false, error: coll.error || "Could not create the collection." };

  const newIds = new Set(ranked.map((r) => r.numericId));
  const prevIds: string[] = Array.isArray(existing?.taggedIds) ? (existing!.taggedIds as any) : [];
  const gidByNumeric = new Map<string, string>(products.map((p: any) => [p.numericId, p.productId]));

  let added = 0;
  let removed = 0;
  for (const r of ranked) {
    const errs = await tagsAdd(admin, r.gid, [tag]);
    if (!errs.length) added++;
  }
  for (const id of prevIds) {
    if (newIds.has(id)) continue;
    const gid = gidByNumeric.get(id);
    if (!gid) continue; // product no longer active/visible — leave as-is
    const errs = await tagsRemove(admin, gid, [tag]);
    if (!errs.length) removed++;
  }

  await prisma.bestSellerCollection.upsert({
    where: { shop },
    create: {
      shop, collectionId: coll.id, collectionTitle: title, tag, topN, windowDays,
      taggedIds: [...newIds] as any, lastRunAt: new Date(), lastCount: ranked.length,
    },
    update: {
      collectionId: coll.id, topN, windowDays, taggedIds: [...newIds] as any,
      lastRunAt: new Date(), lastCount: ranked.length, enabled: true,
    },
  });

  return { ok: true, collectionId: coll.id, title, count: ranked.length, currency, added, removed, created: coll.created };
}
