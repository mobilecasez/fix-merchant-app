/**
 * Google Ads API client — pulls product-level CPC from `shopping_performance_view` and caches it
 * per shop for the Price Radar page.
 *
 * Auth model (per Google Ads API): an OAuth2 refresh token (per merchant) → short-lived access
 * token; a developer token + OAuth client id/secret identify the app. Those three "shared" values
 * can come from the per-shop settings OR from app-level env vars (GOOGLE_ADS_DEVELOPER_TOKEN /
 * GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET / GOOGLE_ADS_LOGIN_CUSTOMER_ID).
 *
 * The API version is env-overridable (GOOGLE_ADS_API_VERSION) so a Google version bump never
 * hard-breaks the integration — just set the env to the current version.
 */
import prisma from "../db.server";
import { encryptSecret, decryptSecret } from "./crypto.server";

// Current as of 2026; override via env if Google bumps the version (never hard-breaks).
const ADS_VERSION = process.env.GOOGLE_ADS_API_VERSION || "v24";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface AdsCreds {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  customerId: string; // digits only
  loginCustomerId?: string; // digits only, optional
}

const SECRET_FIELDS = ["developerToken", "clientId", "clientSecret", "refreshToken"] as const;

function digits(s?: string | null): string {
  return String(s || "").replace(/[^0-9]/g, "");
}

// ── credential persistence ──────────────────────────────────────────────────
/** Save settings; secret fields are only overwritten when a non-empty value is supplied. */
export async function saveAdsSettings(shop: string, input: Record<string, any>): Promise<void> {
  const data: any = {};
  for (const f of SECRET_FIELDS) {
    const v = input[f];
    if (typeof v === "string" && v.trim()) data[f] = encryptSecret(v.trim());
  }
  if (input.customerId != null) data.customerId = digits(input.customerId);
  if (input.loginCustomerId != null) data.loginCustomerId = digits(input.loginCustomerId);
  if (input.cpcWindowDays != null) { const n = parseInt(String(input.cpcWindowDays), 10); if (n > 0) data.cpcWindowDays = n; }
  await prisma.googleAdsSettings.upsert({ where: { shop }, update: data, create: { shop, ...data } });
}

/** Load decrypted creds, falling back to app-level env vars for the shared/app secrets. */
export async function loadAdsCreds(shop: string): Promise<{ creds: AdsCreds; settings: any } | { creds: null; settings: any | null }> {
  const s = await prisma.googleAdsSettings.findUnique({ where: { shop } });
  if (!s) return { creds: null, settings: null };
  const creds: AdsCreds = {
    developerToken: decryptSecret(s.developerToken) || process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "",
    clientId: decryptSecret(s.clientId) || process.env.GOOGLE_ADS_CLIENT_ID || "",
    clientSecret: decryptSecret(s.clientSecret) || process.env.GOOGLE_ADS_CLIENT_SECRET || "",
    refreshToken: decryptSecret(s.refreshToken) || "",
    customerId: digits(s.customerId),
    loginCustomerId: digits(s.loginCustomerId) || digits(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID),
  };
  return { creds, settings: s };
}

export function credsComplete(c: AdsCreds | null): c is AdsCreds {
  return !!(c && c.developerToken && c.clientId && c.clientSecret && c.refreshToken && c.customerId);
}

/** Which shared secrets are already supplied by app-level env (so the UI can say "leave blank"). */
export function adsEnvPresence() {
  return {
    developerToken: !!process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    clientId: !!process.env.GOOGLE_ADS_CLIENT_ID,
    clientSecret: !!process.env.GOOGLE_ADS_CLIENT_SECRET,
    loginCustomerId: !!process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
    apiVersion: ADS_VERSION,
  };
}

// ── API calls ───────────────────────────────────────────────────────────────
async function getAccessToken(c: AdsCreds): Promise<string> {
  const body = new URLSearchParams({
    client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: "refresh_token",
  });
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) {
    throw new Error(`OAuth: ${d.error_description || d.error || `token refresh failed (${r.status})`}`);
  }
  return d.access_token as string;
}

async function searchStream(c: AdsCreds, accessToken: string, query: string): Promise<any[]> {
  const cid = digits(c.customerId);
  const url = `https://googleads.googleapis.com/${ADS_VERSION}/customers/${cid}/googleAds:searchStream`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "developer-token": c.developerToken,
    Authorization: `Bearer ${accessToken}`,
  };
  const login = digits(c.loginCustomerId || "");
  if (login && login !== cid) headers["login-customer-id"] = login;
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify({ query }) });
  const text = await r.text();
  let data: any;
  try { data = JSON.parse(text); } catch { throw new Error(`Unexpected API response (${r.status}): ${text.slice(0, 160)}`); }
  if (!r.ok) {
    const err = Array.isArray(data) ? data[0]?.error : data?.error;
    throw new Error(err?.message || err?.status || `API error ${r.status}: ${text.slice(0, 160)}`);
  }
  const batches = Array.isArray(data) ? data : [data];
  const out: any[] = [];
  for (const b of batches) if (b?.results) out.push(...b.results);
  return out;
}

/** Validate credentials + return the account name/currency (a cheap probe). */
export async function testAdsConnection(c: AdsCreds): Promise<{ ok: boolean; error?: string; customerName?: string; currency?: string }> {
  try {
    const at = await getAccessToken(c);
    const rows = await searchStream(c, at, "SELECT customer.id, customer.descriptive_name, customer.currency_code FROM customer LIMIT 1");
    const cust = rows[0]?.customer;
    return { ok: true, customerName: cust?.descriptiveName || "", currency: cust?.currencyCode || "" };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 400) };
  }
}

function windowToDuring(days: number): string {
  if (days <= 7) return "LAST_7_DAYS";
  if (days <= 14) return "LAST_14_DAYS";
  return "LAST_30_DAYS";
}

export interface CpcRawRow { itemId: string; clicks: number; costMicros: number }

/** Fetch per-item shopping performance (clicks + cost) over the window. */
export async function fetchShoppingCpc(c: AdsCreds, windowDays: number): Promise<{ rows: CpcRawRow[]; currency: string }> {
  const at = await getAccessToken(c);
  let currency = "";
  try {
    const cr = await searchStream(c, at, "SELECT customer.currency_code FROM customer LIMIT 1");
    currency = cr[0]?.customer?.currencyCode || "";
  } catch { /* non-fatal */ }
  const during = windowToDuring(windowDays);
  const q = `SELECT segments.product_item_id, metrics.clicks, metrics.cost_micros FROM shopping_performance_view WHERE segments.date DURING ${during} AND metrics.clicks > 0`;
  const results = await searchStream(c, at, q);
  const rows: CpcRawRow[] = [];
  for (const r of results) {
    const itemId = r?.segments?.productItemId;
    if (!itemId) continue;
    rows.push({ itemId: String(itemId), clicks: Number(r?.metrics?.clicks || 0), costMicros: Number(r?.metrics?.costMicros || 0) });
  }
  return { rows, currency };
}

/**
 * Match Google Ads item ids to store products and compute a weighted CPC per product.
 * Shopify's Google channel emits ids like `shopify_US_{productId}_{variantId}` (and variants),
 * so we extract every digit group and match against known variant ids first, then product ids.
 */
export function cpcByProductMap(rows: CpcRawRow[], variantToProduct: Map<string, string>, productIds: Set<string>): Record<string, number> {
  const agg = new Map<string, { clicks: number; cost: number }>();
  for (const row of rows) {
    const groups = row.itemId.match(/\d+/g) || [];
    let pid: string | undefined;
    for (const g of groups) { const p = variantToProduct.get(g); if (p) { pid = p; break; } }
    if (!pid) for (const g of groups) { if (productIds.has(g)) { pid = g; break; } }
    if (!pid) continue;
    const a = agg.get(pid) || { clicks: 0, cost: 0 };
    a.clicks += row.clicks;
    a.cost += row.costMicros;
    agg.set(pid, a);
  }
  const out: Record<string, number> = {};
  for (const [pid, a] of agg) if (a.clicks > 0) out[pid] = Math.round((a.cost / a.clicks / 1e6) * 100) / 100;
  return out;
}

export interface AdPerf { c: number; s: number } // clicks + spend (account currency) in the sync window

/**
 * ACTUAL per-product ad performance (clicks + spend) from the same shopping rows — the real
 * attributed spend Google reports, NOT the sessions×CPC estimate (which overcharges organic-heavy
 * products). Same item-id → product matching as `cpcByProductMap`.
 */
export function adsPerfByProductMap(rows: CpcRawRow[], variantToProduct: Map<string, string>, productIds: Set<string>): Record<string, AdPerf> {
  const out: Record<string, AdPerf> = {};
  for (const row of rows) {
    const groups = row.itemId.match(/\d+/g) || [];
    let pid: string | undefined;
    for (const g of groups) { const p = variantToProduct.get(g); if (p) { pid = p; break; } }
    if (!pid) for (const g of groups) { if (productIds.has(g)) { pid = g; break; } }
    if (!pid) continue;
    const a = out[pid] || { c: 0, s: 0 };
    a.c += row.clicks;
    a.s += row.costMicros / 1e6;
    out[pid] = a;
  }
  for (const pid of Object.keys(out)) out[pid].s = Math.round(out[pid].s * 100) / 100;
  return out;
}

// ── Campaign creation (Performance Max, feed-only) ─────────────────────────

function adsHeaders(c: AdsCreds, accessToken: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "developer-token": c.developerToken,
    Authorization: `Bearer ${accessToken}`,
  };
  const login = digits(c.loginCustomerId || "");
  if (login && login !== digits(c.customerId)) headers["login-customer-id"] = login;
  return headers;
}

function adsErrorMessage(data: any, status: number, text: string): string {
  const err = Array.isArray(data) ? data[0]?.error : data?.error;
  // Google nests the useful message in details[].errors[].message — surface it.
  const detail = err?.details?.[0]?.errors?.[0];
  const msg = detail?.message || err?.message || err?.status;
  const code = detail?.errorCode ? Object.values(detail.errorCode)[0] : null;
  return `${code ? `[${code}] ` : ""}${msg || `API error ${status}: ${text.slice(0, 200)}`}`;
}

/** POST a mutate to a per-resource endpoint (campaignBudgets, campaigns, assetGroups, …). */
export async function adsMutate(c: AdsCreds, accessToken: string, resourcePath: string, operations: any[]): Promise<any[]> {
  const cid = digits(c.customerId);
  const url = `https://googleads.googleapis.com/${ADS_VERSION}/customers/${cid}/${resourcePath}:mutate`;
  const r = await fetch(url, { method: "POST", headers: adsHeaders(c, accessToken), body: JSON.stringify({ operations }) });
  const text = await r.text();
  let data: any;
  try { data = JSON.parse(text); } catch { throw new Error(`Unexpected API response (${r.status}): ${text.slice(0, 160)}`); }
  if (!r.ok) throw new Error(adsErrorMessage(data, r.status, text));
  return data?.results || [];
}

export { getAccessToken, searchStream, digits };

/** Detect the Merchant Center account linked to this ads account (needed for Shopping/PMax). */
export async function detectMerchantId(c: AdsCreds, accessToken: string): Promise<string | null> {
  // Newer versions expose links via product_link; older via merchant_center_link. Try both.
  try {
    const rows = await searchStream(c, accessToken, "SELECT product_link.merchant_center.merchant_center_id, product_link.type FROM product_link");
    for (const r of rows) {
      const id = r?.productLink?.merchantCenter?.merchantCenterId;
      if (id) return String(id);
    }
  } catch { /* fall through */ }
  try {
    const rows = await searchStream(c, accessToken, "SELECT merchant_center_link.id, merchant_center_link.status FROM merchant_center_link");
    for (const r of rows) {
      if (r?.merchantCenterLink?.status === "ENABLED" && r?.merchantCenterLink?.id) return String(r.merchantCenterLink.id);
    }
    const first = rows[0]?.merchantCenterLink?.id;
    if (first) return String(first);
  } catch { /* none found */ }
  return null;
}

/**
 * Map each store product (numeric id) to the Merchant Center item ids (offer ids) Google has seen
 * for it in the last ~120 days of shopping traffic. Item ids are what listing-group filters target,
 * so this is how we scope a campaign to specific products. Products with no ad history won't
 * appear (they can still be covered by an "everything else" campaign).
 */
export async function fetchProductItemIds(c: AdsCreds, accessToken: string, variantToProduct: Map<string, string>, productIds: Set<string>): Promise<Map<string, string[]>> {
  const until = new Date();
  const since = new Date(Date.now() - 120 * 86400000);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const q = `SELECT segments.product_item_id, metrics.impressions FROM shopping_performance_view WHERE segments.date BETWEEN '${ymd(since)}' AND '${ymd(until)}'`;
  const rows = await searchStream(c, accessToken, q);
  const byProduct = new Map<string, Set<string>>();
  for (const r of rows) {
    const itemId = r?.segments?.productItemId ? String(r.segments.productItemId) : "";
    if (!itemId) continue;
    const groups = itemId.match(/\d+/g) || [];
    let pid: string | undefined;
    for (const g of groups) { const p = variantToProduct.get(g); if (p) { pid = p; break; } }
    if (!pid) for (const g of groups) { if (productIds.has(g)) { pid = g; break; } }
    if (!pid) continue;
    if (!byProduct.has(pid)) byProduct.set(pid, new Set());
    byProduct.get(pid)!.add(itemId);
  }
  return new Map([...byProduct.entries()].map(([k, v]) => [k, [...v]]));
}

export interface CreateCampaignSpec {
  name: string;
  dailyBudget: number;           // in the ADS ACCOUNT currency
  status: "PAUSED" | "ENABLED";
  merchantId: string;            // Merchant Center id (digits)
  targetRoas?: number | null;    // optional, e.g. 4 = 400%
  finalUrl?: string;             // UNUSED for feed-only PMax (kept for caller compat) — a final URL
                                 // must match the MC homepage domain exactly; omitting it lets
                                 // Google land clicks on the feed's product pages (verified: the
                                 // account's own UI-created PMax asset groups carry no final URL)
  includeItemIds?: string[];     // scope TO these offers…
  excludeItemIds?: string[];     // …or (catch-all) everything EXCEPT these
  searchThemes?: string[];       // optional PMax search themes (feed-only quality boost)
  targetCountries?: string[];    // ISO-2 country codes to geo-target (empty = all countries)
}

// ISO-2 country code → Google geo target constant id (countries). Covers the app's target markets;
// unknown codes are skipped (campaign then targets all countries).
const GEO_TARGET: Record<string, string> = {
  IN: "2356", US: "2840", GB: "2826", CA: "2124", AU: "2036", AE: "2784", SA: "2682", SG: "2702",
  MY: "2458", ID: "2360", PH: "2608", NZ: "2554", DE: "2276", FR: "2250", NL: "2528", ES: "2724",
  IT: "2380", SE: "2752", IE: "2372", ZA: "2710", BR: "2076", MX: "2484",
};

export interface CreateCampaignResult { ok: boolean; step: string; campaignResource?: string; error?: string }

/**
 * Create one feed-only Performance Max campaign: budget → campaign → asset group →
 * listing-group filters. Feed-only PMax (retail) runs on the Merchant Center feed — Google builds
 * the ads from product data/images, so no creative assets are required. Campaigns are created in
 * the requested status (default PAUSED so nothing spends until the merchant reviews).
 */
export async function createPmaxCampaign(c: AdsCreds, accessToken: string, spec: CreateCampaignSpec): Promise<CreateCampaignResult> {
  const cid = digits(c.customerId);
  let step = "budget";
  try {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const suffix = Math.random().toString(36).slice(2, 6);
    const budgetRes = await adsMutate(c, accessToken, "campaignBudgets", [{
      create: {
        name: `${spec.name} budget · ${stamp} ${suffix}`,
        amountMicros: String(Math.round(spec.dailyBudget * 1e6)),
        deliveryMethod: "STANDARD",
        explicitlyShared: false,
      },
    }]);
    const budgetResource = budgetRes[0]?.resourceName;
    if (!budgetResource) return { ok: false, step, error: "Budget was not created." };

    step = "campaign";
    const bidding: any = spec.targetRoas && spec.targetRoas > 0
      ? { maximizeConversionValue: { targetRoas: spec.targetRoas } }
      : { maximizeConversionValue: {} };
    const campaignBase = {
      name: `${spec.name} · ${stamp} ${suffix}`,
      status: spec.status,
      advertisingChannelType: "PERFORMANCE_MAX",
      campaignBudget: budgetResource,
      shoppingSetting: { merchantId: String(digits(spec.merchantId)) },
      // Mandatory in v24 — creation fails with FieldError.REQUIRED without it.
      containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
      ...bidding,
    };
    // Feed-only: send clicks to the product pages, never AI-expanded final URLs. v24 removed
    // `urlExpansionOptOut` in favour of asset-automation opt-outs (verified against the v24
    // discovery doc); older pinned API versions still want the legacy field — try new, fall back.
    let campRes: any[];
    try {
      campRes = await adsMutate(c, accessToken, "campaigns", [{
        create: {
          ...campaignBase,
          assetAutomationSettings: [{ assetAutomationType: "FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION", assetAutomationStatus: "OPTED_OUT" }],
        },
      }]);
    } catch (e: any) {
      if (!/Unknown name "(assetAutomationSettings|containsEuPoliticalAdvertising)"/i.test(String(e?.message || e))) throw e;
      // Legacy API version (env-pinned below v22-ish): old field names, no EU declaration.
      const { containsEuPoliticalAdvertising: _eu, ...legacyBase } = campaignBase as any;
      campRes = await adsMutate(c, accessToken, "campaigns", [{
        create: { ...legacyBase, urlExpansionOptOut: true },
      }]);
    }
    const campaignResource = campRes[0]?.resourceName;
    if (!campaignResource) return { ok: false, step, error: "Campaign was not created." };

    step = "asset group";
    // Feed-only: NO finalUrls — a final URL must exactly match the Merchant Center homepage
    // domain (FINAL_URL_SHOPPING_MERCHANT_HOME_PAGE_URL_DOMAINS_DIFFER otherwise); omitting it
    // lets Google send clicks to the feed's own product pages.
    const agRes = await adsMutate(c, accessToken, "assetGroups", [{
      create: {
        name: `${spec.name} products`,
        campaign: campaignResource,
        status: "ENABLED",
      },
    }]);
    const assetGroup = agRes[0]?.resourceName;
    if (!assetGroup) return { ok: false, step, campaignResource, error: "Asset group was not created." };
    const assetGroupId = String(assetGroup).split("/").pop();

    // Listing-group filters: scope the campaign to (or away from) specific offers. No filters at
    // all ⇒ the whole feed. Resource names are COMPOSITE: {assetGroupId}~{tempId} — a flat "-1"
    // is rejected with BAD_RESOURCE_ID (verified against v24 via validate_only).
    const include = (spec.includeItemIds || []).slice(0, 900);
    const exclude = (spec.excludeItemIds || []).slice(0, 900);
    if (include.length || exclude.length) {
      step = "product filters";
      const rn = (n: number) => `customers/${cid}/assetGroupListingGroupFilters/${assetGroupId}~-${n}`;
      const ops: any[] = [{
        create: { resourceName: rn(1), assetGroup, type: "SUBDIVISION", listingSource: "SHOPPING" },
      }];
      let n = 2;
      const scoped = include.length ? include : exclude;
      const scopedType = include.length ? "UNIT_INCLUDED" : "UNIT_EXCLUDED";
      for (const itemId of scoped) {
        ops.push({ create: { resourceName: rn(n++), assetGroup, parentListingGroupFilter: rn(1), type: scopedType, listingSource: "SHOPPING", caseValue: { productItemId: { value: itemId } } } });
      }
      // The mandatory "everything else" node: excluded for an include-list, included for a catch-all.
      ops.push({ create: { resourceName: rn(n++), assetGroup, parentListingGroupFilter: rn(1), type: include.length ? "UNIT_EXCLUDED" : "UNIT_INCLUDED", listingSource: "SHOPPING", caseValue: { productItemId: {} } } });
      await adsMutate(c, accessToken, "assetGroupListingGroupFilters", ops);
    }

    // Search themes (best-effort): practitioner tests show feed-only PMax + search themes beats
    // bare feed-only. A signal failure must not fail the campaign — it's an optimisation, not a
    // requirement.
    const themes = (spec.searchThemes || []).map((t) => String(t).trim()).filter(Boolean).slice(0, 25);
    if (themes.length) {
      try {
        await adsMutate(c, accessToken, "assetGroupSignals", themes.map((t2) => ({
          create: { assetGroup, searchTheme: { text: t2.slice(0, 80) } },
        })));
      } catch (e: any) {
        console.warn(`[google-ads] search themes failed for "${spec.name}" (campaign still created):`, String(e?.message || e).slice(0, 200));
      }
    }

    // Geo targeting (best-effort): restrict where the campaign can serve to the chosen countries.
    // A failure must not kill the campaign — it just means it targets all countries until fixed.
    const geoIds = (spec.targetCountries || [])
      .map((code) => GEO_TARGET[String(code).toUpperCase().trim()])
      .filter(Boolean);
    if (geoIds.length) {
      try {
        await adsMutate(c, accessToken, "campaignCriteria", geoIds.map((id) => ({
          create: { campaign: campaignResource, location: { geoTargetConstant: `geoTargetConstants/${id}` } },
        })));
      } catch (e: any) {
        console.warn(`[google-ads] geo targeting failed for "${spec.name}" (campaign still created):`, String(e?.message || e).slice(0, 200));
      }
    }

    return { ok: true, step: "done", campaignResource };
  } catch (e: any) {
    return { ok: false, step, error: String(e?.message || e).slice(0, 500) };
  }
}

/** Cached CPC snapshot for the Price Radar loader — no decryption or API call. */
export async function getCpcSnapshot(shop: string): Promise<{ byProduct: Record<string, number>; perfByProduct: Record<string, AdPerf>; enabled: boolean; lastSyncAt: string | null; currency: string | null; windowDays: number; configured: boolean }> {
  const s = await prisma.googleAdsSettings.findUnique({ where: { shop } });
  if (!s) return { byProduct: {}, perfByProduct: {}, enabled: false, lastSyncAt: null, currency: null, windowDays: 30, configured: false };
  return {
    byProduct: (s.cpcByProduct as any) || {},
    perfByProduct: (s.adPerfByProduct as any) || {},
    enabled: s.enabled,
    lastSyncAt: s.lastSyncAt ? s.lastSyncAt.toISOString() : null,
    currency: s.currencyCode || null,
    windowDays: s.cpcWindowDays || 30,
    configured: !!(s.refreshToken && s.customerId),
  };
}

/**
 * Refresh the shop's CPC + actual-spend snapshot straight from Google Ads (used by the settings
 * "Sync" button AND by AI jobs so reports use fresh REAL spend, not a stale estimate). Persists the
 * snapshot; returns the fresh maps. Throws on API failure — callers fall back to the cached snapshot.
 *
 * `windowDays` must be the merchant's configured CPC window (getCpcSnapshot().windowDays) so the
 * spend-scaling denominator downstream matches what was actually synced. Callers gate on
 * `cpc.enabled || !cpc.lastSyncAt` before invoking — a merchant who explicitly DISCONNECTED
 * (enabled=false after a sync) must not be silently re-enabled by an AI job.
 */
export async function refreshAdsSnapshot(shop: string, creds: AdsCreds, variantToProduct: Map<string, string>, productIds: Set<string>, windowDays = 30): Promise<{ byProduct: Record<string, number>; perfByProduct: Record<string, AdPerf>; currency: string }> {
  const { rows, currency } = await fetchShoppingCpc(creds, windowDays);
  const byProduct = cpcByProductMap(rows, variantToProduct, productIds);
  const perfByProduct = adsPerfByProductMap(rows, variantToProduct, productIds);
  await prisma.googleAdsSettings.update({
    where: { shop },
    data: { cpcByProduct: byProduct, adPerfByProduct: perfByProduct as any, lastSyncAt: new Date(), enabled: true, status: "ok", lastError: null, currencyCode: currency || undefined },
  }).catch((e) => console.error("[google-ads] snapshot save failed:", e?.message));
  return { byProduct, perfByProduct, currency };
}
