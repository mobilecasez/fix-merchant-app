/**
 * Server-side matching for the imported sessions backfill. The CSV is parsed and aggregated to
 * per-(identifier, month) buckets in the browser (see session-csv.ts); here we resolve each
 * identifier to a store product and produce per-(product, month) rows to persist.
 *
 * The identifier can be a product title, handle, a landing-page URL/path (/products/<handle>),
 * or a numeric/gid product id — matched by the `kind` the client detected.
 */

export interface ImportProduct { numericId: string; title: string; handle: string }
export interface MatchedMonth { productId: string; title: string; month: Date; sessions: number }
export interface MatchResult {
  matched: MatchedMonth[];
  matchedProductCount: number;
  unmatchedIdentifiers: number;
  months: number;
}

function numericId(gid: string): string {
  return String(gid || "").split("/").pop() || "";
}
function handleFromUrl(u: string): string {
  const m = String(u).match(/\/products\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]).toLowerCase() : "";
}
function normTitle(t: string): string {
  return String(t).toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * `buckets` = { identifier: { "YYYY-MM-01": sessions } }. Resolves each identifier to a product
 * (by `kind`), summing sessions per (product, month) across identifiers that map to the same product.
 */
export function matchBuckets(
  buckets: Record<string, Record<string, number>>,
  kind: string,
  products: ImportProduct[],
): MatchResult {
  const byId = new Map<string, ImportProduct>();
  const byHandle = new Map<string, ImportProduct>();
  const byTitle = new Map<string, ImportProduct>();
  for (const p of products) {
    if (p.numericId) byId.set(p.numericId, p);
    if (p.handle) byHandle.set(p.handle.toLowerCase(), p);
    if (p.title) byTitle.set(normTitle(p.title), p);
  }

  const resolve = (identifier: string): ImportProduct | undefined => {
    if (kind === "id") return byId.get(numericId(identifier)) || byId.get(identifier);
    if (kind === "handle") return byHandle.get(identifier.toLowerCase());
    if (kind === "url") return byHandle.get(handleFromUrl(identifier));
    return byTitle.get(normTitle(identifier));
  };

  const acc = new Map<string, MatchedMonth>(); // key = productId|monthISO
  const matchedProducts = new Set<string>();
  const monthsSeen = new Set<string>();
  let unmatched = 0;

  for (const identifier of Object.keys(buckets)) {
    const p = resolve(identifier);
    if (!p) { unmatched++; continue; }
    matchedProducts.add(p.numericId);
    const monthly = buckets[identifier];
    for (const monthISO of Object.keys(monthly)) {
      const sessions = monthly[monthISO] | 0;
      if (sessions <= 0) continue;
      const d = new Date(monthISO + "T00:00:00Z");
      if (Number.isNaN(d.getTime())) continue;
      monthsSeen.add(monthISO);
      const key = `${p.numericId}|${monthISO}`;
      const prev = acc.get(key);
      if (prev) prev.sessions += sessions;
      else acc.set(key, { productId: p.numericId, title: p.title, month: d, sessions });
    }
  }

  return {
    matched: [...acc.values()],
    matchedProductCount: matchedProducts.size,
    unmatchedIdentifiers: unmatched,
    months: monthsSeen.size,
  };
}
