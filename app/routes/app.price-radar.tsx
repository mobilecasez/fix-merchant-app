import { useEffect, useState, useCallback, useRef, useLayoutEffect } from "react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useSearchParams, useRevalidator, useNavigation, Link as RemixLink } from "@remix-run/react";
import {
  BlockStack, InlineStack, Text, Button, TextField, Badge,
  Banner, Box, Collapsible, DropZone, List, Link as PolarisLink,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getOrCreateSubscription, getRemainingCredits } from "../utils/billing.server";
import { fetchPricingProducts, getOrderStatsByProduct, getSessionsByProduct, getImportedSessions, getImportMeta, getShopCurrency, startOfNextMonthUTC, conversionPct, resolveRange } from "../utils/product-analytics.server";
import { bulkCreditCost } from "../utils/price-research.server";
import { parseSessionsCsv, aggregateToBuckets } from "../utils/session-csv";
import { fixCurrencyDeep } from "../utils/currency-text.server";
import { getAiJob, jobView } from "../utils/ai-jobs.server";
import { getCpcSnapshot } from "../utils/google-ads.server";

const PAGE_SIZE = 50;
const ADVISOR_CREDITS = 20; // AI Profit Advisor cost (mirrors ADVISOR_CREDITS in profit-advisor.server.ts)
// useLayoutEffect warns during SSR; fall back to useEffect on the server.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;
const PIXEL_SRC = `${process.env.SHOPIFY_APP_URL || "https://shopflixai-production.up.railway.app"}/visit-tracker.js`;

async function ensureVisitPixel(admin: any): Promise<string> {
  try {
    const q: any = await admin.graphql(`#graphql
      query { scriptTags(first: 50) { nodes { id src } } }`);
    const d = await q.json();
    if (d?.errors?.length) return `permission needed: ${String(d.errors[0]?.message || "").slice(0, 80)}`;
    const exists = (d?.data?.scriptTags?.nodes || []).some((n: any) => n.src === PIXEL_SRC);
    if (exists) return "installed";
    const c: any = await admin.graphql(
      `#graphql
      mutation priceRadarPixel($input: ScriptTagInput!) {
        scriptTagCreate(input: $input) { scriptTag { id } userErrors { field message } }
      }`,
      { variables: { input: { src: PIXEL_SRC, displayScope: "ONLINE_STORE", cache: true } } },
    );
    const cd = await c.json();
    if (cd?.errors?.length) return `permission needed: ${String(cd.errors[0]?.message || "").slice(0, 80)}`;
    const errs = cd?.data?.scriptTagCreate?.userErrors;
    if (errs?.length) return `error: ${errs.map((e: any) => e.message).join("; ").slice(0, 80)}`;
    return cd?.data?.scriptTagCreate?.scriptTag?.id ? "installed" : "unknown";
  } catch (e: any) {
    return `error: ${String(e?.message || e).slice(0, 80)}`;
  }
}

// ── Redesign tokens ─────────────────────────────────────────────────────────
const MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', 'SFMono-Regular', Menlo, Consolas, monospace";
const CL = {
  ink: "#1B2430", inkDeep: "#101A24", sub: "#8A95A3", sub2: "#9AA7B6", sub3: "#7A8696",
  line: "#E5E9EE", line2: "#EDF0F4", line3: "#F2F5F8", strong: "#BAC3CD",
  teal: "#0E9384", tealDeep: "#0B6E63", tealBg: "#E6F4F1",
  green: "#147A45", greenDot: "#1AA458", greenBg: "#DBF3E3", mint: "#7FE3D6",
  amberBg: "#FBEFD6", amberFg: "#955B0C", blue: "#2E6BF0",
};
const GRID_COLS = "minmax(220px,1.9fr) 66px 54px 60px 72px 84px 92px 84px 116px 88px 148px 132px";
const cardStyle: any = { background: "#fff", border: `1px solid ${CL.line}`, borderRadius: 14 };

const PAGE_STYLE = `
  .pr-kpi { display:grid; gap:12px; grid-template-columns: repeat(4,1fr) 210px; }
  @media (max-width: 1100px){ .pr-kpi { grid-template-columns: repeat(3,1fr); } }
  @media (max-width: 700px){ .pr-kpi { grid-template-columns: repeat(2,1fr); } }
  /* Default to 3-across so the money cards are wide enough to show full amounts without shrinking;
     only go 6-across on very wide screens where they still fit. */
  .pr-kpi2 { display:grid; gap:12px; grid-template-columns: repeat(3,1fr); }
  @media (min-width: 1500px){ .pr-kpi2 { grid-template-columns: repeat(6,1fr); } }
  @media (max-width: 640px){ .pr-kpi2 { grid-template-columns: repeat(2,1fr); } }
  @media (max-width: 720px){ .pr-costgrid { grid-template-columns: repeat(2,1fr) !important; } }
  @media (max-width: 400px){ .pr-costgrid { grid-template-columns: 1fr !important; } }
  @media (max-width: 600px){ .pr-page { padding-left:12px !important; padding-right:12px !important; } }

  .pr-scroll { overflow-x:auto; overflow-y:hidden; }
  .pr-grid { display:grid; grid-template-columns:${GRID_COLS}; gap:11px; align-items:center; min-width:1300px; }
  /* Pin the product column so it stays readable while the money columns scroll under it. */
  .pr-grid > :first-child { position:sticky; left:0; z-index:2; padding-left:22px; }
  .pr-grid > :last-child { padding-right:24px; }
  .pr-hd { padding:11px 0; background:#F7F9FB; border-bottom:1px solid ${CL.line2}; }
  .pr-hd > :first-child { background:#F7F9FB; }
  .pr-row { padding:14px 0; border-bottom:1px solid ${CL.line3}; transition:background .12s; background:#fff; }
  .pr-row:hover { background:#FAFBFC; }
  .pr-row > :first-child { background:#fff; box-shadow: 7px 0 8px -8px rgba(16,30,54,0.10); }
  .pr-row:hover > :first-child { background:#FAFBFC; }

  .pr-sort { cursor:pointer; user-select:none; display:inline-flex; align-items:center; gap:3px; }
  .pr-sort:hover { color:#5B6573; }

  /* Product title: single-line ellipsis on desktop; tap to expand to the full title. */
  .pr-title { font-size:13.5px; font-weight:600; color:${CL.ink}; cursor:pointer; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
  .pr-title.open { white-space:normal; overflow:visible; }
  @media (max-width: 640px){
    /* On mobile: 2-line clamp (then tap for full), and hide the confidence/market/via details. */
    .pr-title:not(.open) { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; white-space:normal; }
    .pr-prod-details { display:none !important; }
  }

  /* Full-screen processing overlay — blocks input while any action is running. */
  .pr-overlay { position:fixed; inset:0; z-index:2147483000; display:flex; align-items:center; justify-content:center; background:rgba(16,26,36,0.28); backdrop-filter:blur(1.5px); }
  .pr-overlay-card { display:flex; flex-direction:column; align-items:center; gap:12px; background:#fff; padding:22px 30px; border-radius:16px; box-shadow:0 20px 50px -20px rgba(16,30,54,0.5); }
  .pr-bigspin { width:34px; height:34px; border:3px solid rgba(14,147,132,0.22); border-top-color:${CL.teal}; border-radius:50%; animation:prspin .7s linear infinite; }
  .pr-btn { cursor:pointer; transition:filter .12s; }
  .pr-btn:hover:not(:disabled) { filter:brightness(0.96); }
  .pr-btn:disabled { opacity:0.5; cursor:default; }
  .pr-in { border:none; outline:none; background:transparent; }
  .pr-sel { -webkit-appearance:none; appearance:none; border:none; background:transparent; cursor:pointer; }
  @keyframes prspin { to { transform:rotate(360deg); } }
  .pr-spin { display:inline-block; width:13px; height:13px; border:2px solid rgba(255,255,255,.35); border-top-color:#fff; border-radius:50%; animation:prspin .7s linear infinite; }
  .pr-spin-t { border-color:rgba(14,147,132,.25); border-top-color:${CL.teal}; }
`;

function Radar({ size = 23, color = CL.tealDeep }: { size?: number; color?: string }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m11 3v3M11 16v3M19 11h-3M6 11H3" /><circle cx="11" cy="11" r="2" fill={color} stroke="none" /><path d="m21 21-3.2-3.2" /></svg>);
}
function Spark({ size = 15, color = CL.mint }: { size?: number; color?: string }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M13 3l2.5 6.5L22 12l-6.5 2.5L13 21l-2.5-6.5L4 12l6.5-2.5L13 3Z" /></svg>);
}
function Check({ size = 14, color = CL.green }: { size?: number; color?: string }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>);
}
function Glass({ size = 14, color = CL.mint }: { size?: number; color?: string }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></svg>);
}

function symbolFor(currency: string): string {
  try {
    const parts = new Intl.NumberFormat(undefined, { style: "currency", currency }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value || currency;
  } catch { return currency; }
}

function confChip(conf: string): { style: any; dot: string; label: string } {
  const c = conf === "high" ? { bg: CL.greenBg, fg: CL.green, dot: CL.greenDot, label: "High" }
    : conf === "medium" ? { bg: CL.amberBg, fg: CL.amberFg, dot: "#C88A2E", label: "Medium" }
    : { bg: "#EEF1F5", fg: "#6B7787", dot: CL.sub2, label: "Low" };
  return { style: { display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 9px", borderRadius: 999, fontSize: 11.5, fontWeight: 600, lineHeight: 1.4, whiteSpace: "nowrap", background: c.bg, color: c.fg }, dot: c.dot, label: c.label };
}
function convPill(kind: "good" | "mid" | "low"): any {
  const c = kind === "good" ? { bg: CL.greenBg, fg: CL.green } : kind === "low" ? { bg: CL.amberBg, fg: CL.amberFg } : { bg: CL.line3, fg: "#586575" };
  return { display: "inline-block", padding: "2px 8px", borderRadius: 7, fontFamily: MONO, fontSize: 12, fontWeight: 600, background: c.bg, color: c.fg };
}
function deltaChip(kind: "up" | "down" | "flat"): any {
  const c = kind === "up" ? { bg: CL.greenBg, fg: CL.green } : kind === "down" ? { bg: CL.amberBg, fg: CL.amberFg } : { bg: "#EEF1F5", fg: "#6B7787" };
  return { display: "inline-flex", alignItems: "center", gap: 3, padding: "3px 8px", borderRadius: 7, fontFamily: MONO, fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap", background: c.bg, color: c.fg };
}

function Notice({ tone, children }: { tone: "info" | "ok" | "warn"; children: any }) {
  const T = tone === "ok" ? { bg: CL.greenBg, bd: "#C7E4DF", fg: CL.green }
    : tone === "warn" ? { bg: CL.amberBg, bd: "#EBD9AE", fg: CL.amberFg }
    : { bg: "#F0F6FF", bd: "#CFE0FA", fg: "#1E50C9" };
  return <div style={{ background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 12, padding: "12px 16px", fontSize: 13, lineHeight: 1.5, color: T.fg }}>{children}</div>;
}

// Keeps the KPI value at its full size and ONLY shrinks it — by the minimum needed — when the text
// would otherwise overflow the card on one line. Most values stay at `max`; a long one drops just
// enough (never below `min`). Re-measures on container resize.
function FitValue({ text, color, max = 23, min = 17 }: { text: string; color: string; max?: number; min?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const txtRef = useRef<HTMLSpanElement>(null);
  const [fs, setFs] = useState(max);
  useIsoLayoutEffect(() => {
    const wrap = wrapRef.current, txt = txtRef.current;
    if (!wrap || !txt) return;
    const fit = () => {
      const avail = wrap.clientWidth;
      if (avail <= 4) return; // not laid out yet — don't shrink on a bogus 0-width measurement
      const prev = txt.style.fontSize;
      txt.style.fontSize = `${max}px`;         // measure the text's intrinsic width at full size
      const full = txt.scrollWidth;
      txt.style.fontSize = prev;
      if (!full || full <= avail + 1) { setFs(max); return; }   // fits → keep full size
      const scaled = Math.max(min, Math.floor((avail / full) * max * 2) / 2); // shrink just enough
      setFs(scaled);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [text]);
  return (
    <div ref={wrapRef} style={{ width: "100%", overflow: "hidden", marginTop: 6 }}>
      <span ref={txtRef} style={{ display: "inline-block", whiteSpace: "nowrap", fontFamily: MONO, fontWeight: 700, letterSpacing: "-0.02em", fontSize: fs, color }}>{text}</span>
    </div>
  );
}

function Kpi({ dot, icon, label, value, sub, valueColor, highlight }: { dot?: string; icon?: any; label: string; value: string; sub: string; valueColor?: string; highlight?: boolean }) {
  const clip = { whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 };
  return (
    <div style={{ ...cardStyle, ...(highlight ? { border: `1px solid ${CL.teal}`, background: CL.tealBg } : {}), padding: "14px 15px", minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 700, color: highlight ? CL.tealDeep : CL.sub3, textTransform: "uppercase", letterSpacing: "0.03em", ...clip }}>
        {icon || <span style={{ width: 7, height: 7, borderRadius: 999, background: dot, flex: "0 0 auto" }} />}<span style={clip}>{label}</span>
      </div>
      <FitValue text={value} color={valueColor || (highlight ? CL.tealDeep : CL.ink)} />
      <div style={{ fontSize: 11.5, color: highlight ? CL.tealDeep : CL.sub2, opacity: highlight ? 0.75 : 1, marginTop: 1, ...clip }}>{sub}</div>
    </div>
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);

  // Imported-sessions metadata (per-month CSV backfill) — load first so "All time" can span
  // the imported months and the pixel can be clamped to avoid double-counting.
  const importMeta = await getImportMeta(shop);

  // Date range: "all" (spans imported history), a custom since/until, or a preset of days.
  const sinceParam = url.searchParams.get("since");
  const untilParam = url.searchParams.get("until");
  const daysParam = url.searchParams.get("days") || "30";
  const range = resolveRange(url, importMeta.earliest);
  const { since, until } = range;
  // Pixel days on/after this are "live" (imported months own everything up to here).
  const pixelNotBefore = importMeta.latest ? startOfNextMonthUTC(importMeta.latest) : null;

  // Shop currency — throttle-safe with a DB-cached fallback (a single throttled call must never
  // flip an INR store's whole page to "$").
  const currency = (await getShopCurrency(admin, shop)) || "USD";

  // Orders & conversion need read_orders; the UI explains it if it's missing.
  const grantedScopes = String((session as any).scope || "");
  const hasOrdersScope = /read_orders/.test(grantedScopes);

  const pixelStatus = await ensureVisitPixel(admin); // idempotent install + status for the UI

  const [products, pixelData, importedData, sub, researchRows] = await Promise.all([
    fetchPricingProducts(admin, currency),
    getSessionsByProduct(shop, range, pixelNotBefore),
    getImportedSessions(shop, range),
    getOrCreateSubscription(shop),
    prisma.productPriceResearch.findMany({ where: { shop } }),
  ]);
  const cpc = await getCpcSnapshot(shop); // cached Google Ads CPC (no API call here)

  // Merchant-entered average shipping / RTO costs (per-order), split by prepaid vs COD.
  const costSettingsRow = await prisma.priceRadarSettings.findUnique({ where: { shop } });
  const costs = {
    shipCostPrepaid: costSettingsRow?.shipCostPrepaid || 0,
    shipCostCod: costSettingsRow?.shipCostCod || 0,
    rtoCostPrepaid: costSettingsRow?.rtoCostPrepaid || 0,
    rtoCostCod: costSettingsRow?.rtoCostCod || 0,
    assumedCogsPct: (costSettingsRow as any)?.assumedCogsPct ?? 50,
    paymentFeePct: (costSettingsRow as any)?.paymentFeePct ?? 2,
    weeklyDigest: (costSettingsRow as any)?.weeklyDigest !== false,
  };
  const hasCostInputs = costs.shipCostPrepaid > 0 || costs.shipCostCod > 0 || costs.rtoCostPrepaid > 0 || costs.rtoCostCod > 0;

  const orderStats = hasOrdersScope
    ? await getOrderStatsByProduct(admin, range, costs)
    : { byProduct: new Map<string, import("../utils/product-analytics.server").OrderStats>(), totals: { orders: 0, delivered: 0, inTransit: 0, returned: 0, returnInTransit: 0, revenue: 0, shipCost: 0, rtoCost: 0 } };

  const researchByVariant = new Map(researchRows.map((r) => [r.variantId, r]));

  // Ad-spend currency vs shop currency: CPC is denominated in the Google Ads account currency,
  // which is usually the same as the store's — but if it differs we can't convert without an FX
  // rate, so we surface a warning and the P&L assumes 1:1 rather than silently corrupting.
  const cpcCurrency = cpc.currency || currency;
  const currencyMismatch = cpc.enabled && cpc.currency != null && cpc.currency !== currency;

  // ACTUAL attributed ad spend (Google shopping performance) when the snapshot has it — the
  // sessions×CPC estimate overcharges organic-heavy products. Estimate stays as the fallback.
  // Snapshots are synced over cpc.windowDays (same setting), so the scale denominator is honest;
  // down-scaling is proportional, up-scaling capped at 3× (an "all time" view can't extrapolate).
  const adSpendActual = cpc.enabled && Object.keys(cpc.perfByProduct).length > 0;
  const rangeDaysGrid = Math.max(1, Math.round((range.until.getTime() - range.since.getTime()) / 86400000));
  const spendScaleGrid = Math.min(3, rangeDaysGrid / (cpc.windowDays || 30));

  let costCoveredCount = 0;
  let totalAdSpend = 0;
  let rows = products.map((p) => {
    // Sessions = imported historical months (in range) + live pixel (clamped after the import).
    const sessions = (importedData.get(p.numericId) || 0) + (pixelData.byId.get(p.numericId) || 0);
    const stats = orderStats.byProduct.get(p.numericId);
    const orders = stats?.orders || 0;
    const rr = researchByVariant.get(p.variantId);
    const productCpc = cpc.enabled ? (cpc.byProduct[p.numericId] ?? null) : null;
    const pf = adSpendActual ? cpc.perfByProduct[p.numericId] : undefined;
    const adSpend = pf && pf.s > 0 ? pf.s * spendScaleGrid : (!adSpendActual && productCpc != null ? sessions * productCpc : 0);
    if (productCpc != null || (pf && pf.s > 0)) { costCoveredCount++; totalAdSpend += adSpend; }
    // Shipping / RTO cost = this product's allocated share (computed per-order in the analytics
    // util so a multi-product parcel isn't charged shipping once per product).
    const shipCost = stats?.shipCost || 0;
    const rtoCost = stats?.rtoCost || 0;
    const revenue = stats?.revenue || 0;
    const cost = adSpend + shipCost + rtoCost;
    // Only surface money figures when there's some financial activity (orders or ad spend).
    const hasFinancials = orders > 0 || adSpend > 0;
    const profit = revenue - cost;
    const profitPct = cost > 0 ? Math.round((profit / cost) * 1000) / 10 : null;
    return {
      productId: p.productId, variantId: p.variantId, title: p.title, imageUrl: p.imageUrl,
      vendor: p.vendor, productType: p.productType, barcode: p.barcode,
      currentPrice: p.currentPrice, originalPrice: rr?.originalPrice ?? null,
      priceHistory: (rr?.priceHistory as any) || [],
      currency, sessions, orders, conversion: conversionPct(orders, sessions),
      cpc: productCpc,
      adSpend: hasFinancials ? adSpend : null,
      shipCost: hasFinancials ? (shipCost + rtoCost) : null, // shipping + RTO handling cost
      revenue: hasFinancials ? revenue : null,
      profit: hasFinancials ? profit : null,
      profitPct: hasFinancials ? profitPct : null,
      research: rr ? {
        researchedPrice: rr.researchedPrice, status: rr.status, confidence: rr.confidence,
        low: rr.priceLow, high: rr.priceHigh, sources: (rr.sources as any) || [], rationale: rr.rationale,
        appliedAt: rr.appliedAt ? rr.appliedAt.toISOString() : null,
        researchedAt: rr.updatedAt ? rr.updatedAt.toISOString() : null,
      } : null,
    };
  });

  // Server-side sort so the chosen order spans ALL pages (not just the current one). Nulls last.
  const sortKey = url.searchParams.get("sort") || "sessions";
  const sortDir = url.searchParams.get("dir") === "asc" ? "asc" : "desc";
  const num = (v: any) => (v == null ? null : Number(v));
  const val = (r: any): number | string | null => {
    switch (sortKey) {
      case "title": return r.title?.toLowerCase() || "";
      case "orders": return r.orders;
      case "conversion": return num(r.conversion);
      case "cpc": return num(r.cpc);
      case "adSpend": return num(r.adSpend);
      case "revenue": return num(r.revenue);
      case "shipCost": return num(r.shipCost);
      case "profit": return num(r.profit);
      case "currentPrice": return num(r.currentPrice);
      default: return r.sessions;
    }
  };
  rows.sort((a, b) => {
    const av = val(a), bv = val(b);
    if (typeof av === "string" || typeof bv === "string") {
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    }
    // nulls always last regardless of direction
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = av - bv;
    return sortDir === "asc" ? cmp : -cmp;
  });

  const totalCount = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const sessionsTotal = rows.reduce((s, r) => s + r.sessions, 0);

  // Store totals come from the analytics util (order-level, reconcile with Σ per-row) + ad spend.
  const totalShipCost = orderStats.totals.shipCost;
  const totalRtoCost = orderStats.totals.rtoCost;
  const totalRevenue = orderStats.totals.revenue;
  const totalCost = totalAdSpend + totalShipCost + totalRtoCost;
  const profitLoss = totalRevenue - totalCost;
  const profitLossPct = totalCost > 0 ? Math.round((profitLoss / totalCost) * 1000) / 10 : null;

  // KPI strip aggregates over ALL of the shop's research rows (not just this page).
  let suggestionsReady = 0, appliedCount = 0, raiseCount = 0, lowerCount = 0, deltaSum = 0, deltaN = 0;
  for (const r of researchRows) {
    if (r.status === "applied") { appliedCount++; continue; }
    if (r.researchedPrice != null && (r.status === "researched" || r.status === "edited")) {
      suggestionsReady++;
      if (r.currentPrice > 0) {
        if (r.researchedPrice > r.currentPrice) raiseCount++;
        else if (r.researchedPrice < r.currentPrice) lowerCount++;
        deltaSum += ((r.researchedPrice - r.currentPrice) / r.currentPrice) * 100;
        deltaN++;
      }
    }
  }
  const avgSuggestedPct = deltaN ? Math.round((deltaSum / deltaN) * 10) / 10 : null;

  const job = await prisma.priceBatchJob.findFirst({ where: { shop }, orderBy: { createdAt: "desc" } });

  // Saved AI profit report (view for free; credits only to regenerate). catch() covers the first
  // request during a deploy cutover before `db push` has created the table. The payload is
  // currency-sanitized at read time so older saved reports can't show "$" on a non-USD store.
  const savedAdvisorRow = await prisma.aiReport.findUnique({ where: { shop_kind: { shop, kind: "profit_advisor" } } }).catch(() => null);
  const savedAdvisor = savedAdvisorRow
    ? { ok: true, report: fixCurrencyDeep(savedAdvisorRow.data as any, currency), ...((savedAdvisorRow.meta as any) || {}), currency }
    : null;
  // Background-generation job state (the heavy Gemini run is detached; the page polls this).
  const advisorJob = jobView(await getAiJob(shop, "profit_advisor_job"));

  return json({
    savedAdvisor,
    advisorJob,
    rows: pageRows, totalCount, totalPages, page, currency,
    credits: getRemainingCredits(sub),
    bulkCost: bulkCreditCost(totalCount),
    suggestionsReady, appliedCount, raiseCount, lowerCount, avgSuggestedPct,
    hasOrdersScope,
    pixelStatus,
    sessionsTotal,
    importCount: importMeta.count,
    importEarliest: importMeta.earliest ? importMeta.earliest.toISOString().slice(0, 10) : null,
    importLatest: importMeta.latest ? importMeta.latest.toISOString().slice(0, 10) : null,
    cpcCurrency,
    ads: { enabled: cpc.enabled, configured: cpc.configured, lastSyncAt: cpc.lastSyncAt, windowDays: cpc.windowDays, cpcCount: Object.keys(cpc.byProduct).length, actual: adSpendActual },
    pnl: {
      adSpend: totalAdSpend, shipCost: totalShipCost, rtoCost: totalRtoCost, totalCost,
      revenue: totalRevenue, profitLoss, profitLossPct, costCoveredCount, hasCostInputs,
      ordersDelivered: orderStats.totals.delivered, ordersReturned: orderStats.totals.returned,
      ordersInTransit: orderStats.totals.inTransit,
      returnInTransit: orderStats.totals.returnInTransit, currencyMismatch,
    },
    costs,
    sortKey, sortDir,
    rangeMode: sinceParam || untilParam ? "0" : daysParam,
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
    job: job ? { status: job.status, processedCount: job.processedCount, productCount: job.productCount, email: job.email } : null,
  });
}

function money(n: number | null | undefined, currency: string) {
  if (n == null) return "—";
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n); }
  catch { return `${n} ${currency}`; }
}

function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); }
  catch { return String(iso).slice(0, 10); }
}

// Click-anchored popover showing a product's original price + the log of applied price changes.
// Fixed-positioned so it escapes the grid's horizontal-scroll clipping.
function PriceHistoryPopover({ rect, currency, current, original, history, onClose }: { rect: DOMRect; currency: string; current: number; original: number | null; history: any[]; onClose: () => void }) {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const W = 250;
  const left = Math.max(12, Math.min(rect.right - W, vw - W - 12));
  const top = Math.min(rect.bottom + 6, vh - 240);
  const entries = [...(history || [])].reverse();
  const Line = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0" }}>
      <span style={{ color: CL.sub }}>{label}</span>
      <span style={{ fontFamily: MONO, fontWeight: strong ? 700 : 600, color: CL.ink }}>{value}</span>
    </div>
  );
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000 }} />
      <div style={{ position: "fixed", top, left, width: W, zIndex: 1001, background: "#fff", border: `1px solid ${CL.line}`, borderRadius: 12, boxShadow: "0 18px 40px -16px rgba(16,30,54,0.42)", padding: 14, fontSize: 12.5, color: CL.ink }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Price history</div>
        <Line label="Current" value={money(current, currency)} strong />
        {original != null ? <Line label="Original" value={money(original, currency)} /> : null}
        <div style={{ height: 1, background: CL.line2, margin: "9px 0" }} />
        {entries.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 7, maxHeight: 180, overflowY: "auto" }}>
            {entries.map((e: any, i: number) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                <span style={{ color: CL.sub2, fontSize: 11.5 }}>{fmtDay(e.at)}</span>
                <span style={{ fontFamily: MONO, fontSize: 12 }}>{e.from != null ? <span style={{ color: CL.sub2 }}>{money(e.from, currency)} → </span> : null}<span style={{ fontWeight: 700 }}>{money(e.price, currency)}</span></span>
              </div>
            ))}
          </div>
        ) : <div style={{ color: CL.sub2 }}>No price changes recorded yet.</div>}
      </div>
    </>
  );
}

const PRIO: Record<string, { bg: string; fg: string; label: string }> = {
  high: { bg: "#FDECEC", fg: "#B42318", label: "High priority" },
  medium: { bg: CL.amberBg, fg: CL.amberFg, label: "Medium" },
  low: { bg: "#EEF1F5", fg: "#6B7787", label: "Low" },
};

// Rich card-based PDF export — lives in its own module so it can be visually verified in node.
async function exportAdvisorPdf(data: any, currency: string) {
  const { exportAdvisorPdf: run } = await import("../utils/advisor-pdf");
  await run(data, currency);
}

// Human labels for the deterministic screening buckets (meta.screened.counts).
const BUCKET_LABEL: Record<string, string> = {
  MARGIN_IMPOSSIBLE: "Margin impossible",
  BLEEDER: "Ad bleeders", RTO_LEAK: "RTO leaks", TRUE_DRAIN: "True drains", LOSS_LEADER: "Loss leaders",
  WINNER: "Winners", HIDDEN_GEM: "Hidden gems", RAISE_PRICE: "Raise price", PRICE_TEST: "Price tests",
  WATCH: "Watchlist", ZOMBIE: "Zombies", OK: "Healthy",
};
const BUCKET_CHIP: Record<string, { bg: string; fg: string }> = {
  MARGIN_IMPOSSIBLE: { bg: "#7F1D1D", fg: "#FEE2E2" },
  BLEEDER: { bg: "#FDE8E8", fg: "#B42318" }, RTO_LEAK: { bg: "#FEF0E6", fg: "#B54708" },
  TRUE_DRAIN: { bg: "#FDE8E8", fg: "#B42318" }, LOSS_LEADER: { bg: "#EFF4FF", fg: "#3538CD" },
  WINNER: { bg: "#E6F4EF", fg: "#067647" }, HIDDEN_GEM: { bg: "#F4EBFF", fg: "#6941C6" },
  RAISE_PRICE: { bg: "#E6F4F1", fg: "#0E7569" }, PRICE_TEST: { bg: "#FEF7E6", fg: "#93700A" },
  WATCH: { bg: "#F2F4F7", fg: "#475467" }, ZOMBIE: { bg: "#F2F4F7", fg: "#98A2B3" }, OK: { bg: "#F2F4F7", fg: "#475467" },
};

/** "All N products screened" trust strip — coverage is code-verified, so we can say it plainly. */
function ScreenedStrip({ data }: { data: any }) {
  const sc = data.screened;
  if (!sc?.total) return null;
  const counts = sc.counts || {};
  const chips = Object.keys(BUCKET_LABEL).filter((b) => (counts[b] || 0) > 0);
  return (
    <div style={{ border: "1px solid #C7E4DF", background: "#F2FBF8", borderRadius: 12, padding: "10px 14px", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Check size={14} color={CL.green} />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: CL.tealDeep }}>
          All {Number(sc.total).toLocaleString()} products screened
        </span>
        <span style={{ fontSize: 11.5, color: CL.sub2 }}>
          · {sc.listed} analysed individually · ad spend: {sc.adSpendSource === "google-ads" ? "actual (Google Ads)" : sc.adSpendSource === "estimated" ? "estimated (sessions × CPC)" : "not connected"}
          {sc.cogsRealCount != null ? (sc.cogsRealCount > 0 ? ` · real unit costs on ${sc.cogsRealCount} products` : ` · margins assume ~${sc.assumedCogsPct ?? 50}% product cost (set real costs for exact numbers)`) : null}
        </span>
      </div>
      {chips.length ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          {chips.map((b) => (
            <span key={b} style={{ fontSize: 10.5, fontWeight: 700, background: BUCKET_CHIP[b].bg, color: BUCKET_CHIP[b].fg, padding: "2px 9px", borderRadius: 999 }}>
              {counts[b]} {BUCKET_LABEL[b]}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Where-did-the-money-go waterfall: revenue → ads → shipping → RTO → net profit. */
function ProfitWaterfall({ data, currency }: { data: any; currency: string }) {
  const w = data.waterfall;
  if (!w || !(w.revenue > 0)) return null;
  const sym = symbolFor(currency);
  const fmt = (n: number) => `${sym}${Math.round(Math.abs(n)).toLocaleString()}`;
  const segs = [
    { label: "Ad spend", value: w.adSpend || 0, color: "#F97066" },
    { label: "Shipping", value: w.shipCost || 0, color: "#F7B267" },
    { label: "RTO", value: w.rtoCost || 0, color: "#B54708" },
  ].filter((s) => s.value > 0);
  const profit = w.profit || 0;
  const profitPos = profit >= 0;
  const biggest = segs.length ? segs.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  return (
    <div style={{ ...cardStyle, padding: "12px 16px", marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: CL.sub3, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
        Where the money went{biggest ? <span style={{ color: "#B42318", textTransform: "none", letterSpacing: 0 }}> — biggest leak: {biggest.label.toLowerCase()} ({fmt(biggest.value)})</span> : null}
      </div>
      <div style={{ display: "flex", height: 14, borderRadius: 7, overflow: "hidden", border: `1px solid ${CL.line2}` }}>
        {segs.map((s, i) => (
          <div key={i} title={`${s.label}: ${fmt(s.value)}`} style={{ width: `${Math.max(1.5, (s.value / w.revenue) * 100)}%`, background: s.color }} />
        ))}
        <div title={`${profitPos ? "Net profit" : "Net loss"}: ${fmt(profit)}`} style={{ flex: 1, background: profitPos ? "#12B76A" : "#B42318", minWidth: "1.5%" }} />
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8, fontSize: 11.5, color: CL.sub }}>
        <span style={{ fontWeight: 700, color: CL.ink }}>Revenue {fmt(w.revenue)}</span>
        {segs.map((s, i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: "inline-block" }} />−{fmt(s.value)} {s.label.toLowerCase()}
          </span>
        ))}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 700, color: profitPos ? "#067647" : "#B42318" }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: profitPos ? "#12B76A" : "#B42318", display: "inline-block" }} />= {profitPos ? "profit" : "loss"} {fmt(profit)}
        </span>
      </div>
    </div>
  );
}

function ProfitAdvisorModal({ data, onClose, onRegenerate, regenerating, credits }: { data: any; onClose: () => void; onRegenerate?: () => void; regenerating?: boolean; credits?: number }) {
  const [saving, setSaving] = useState(false);
  const report = data.report;
  const currency: string = data.currency || "USD";
  const doPdf = async () => {
    setSaving(true);
    try { await exportAdvisorPdf(data, currency); }
    catch { window.alert("Couldn't build the PDF. Please try again."); }
    finally { setSaving(false); }
  };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2147483200, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(16,26,36,0.42)", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 18, width: "min(820px, 100%)", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 30px 80px -24px rgba(16,30,54,0.6)", overflow: "hidden" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "16px 20px", borderBottom: `1px solid ${CL.line2}`, background: "linear-gradient(135deg,#F6F1FF,#FBFAFF)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, background: "linear-gradient(135deg,#7C3AED,#5B21B6)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}><Spark size={18} color="#E9D5FF" /></div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" }}>AI Profit Advisor</div>
              <div style={{ fontSize: 12, color: CL.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{`${data.screened?.total ? `Screened all ${data.screened.total} products` : `Analysed ${data.analysed || 0} products`} · ${data.rangeLabel || ""}${data.generatedAt ? ` · generated ${fmtDay(data.generatedAt)}` : ""}`}</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
            {onRegenerate ? (
              <button className="pr-btn" onClick={onRegenerate} disabled={!!regenerating} title={`Fresh analysis of the current data — uses ${credits ?? 10} credits`} style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 34, padding: "0 13px", border: "none", borderRadius: 9, background: "linear-gradient(135deg,#7C3AED,#5B21B6)", color: "#fff", fontWeight: 600, fontSize: 12.5 }}>
                {regenerating ? <span className="pr-spin" /> : <Spark size={13} color="#E9D5FF" />}
                Regenerate
                <span style={{ fontFamily: MONO, fontSize: 11, background: "rgba(233,213,255,0.22)", color: "#EDE0FF", padding: "1px 6px", borderRadius: 5 }}>{credits ?? 10} cr</span>
              </button>
            ) : null}
            <button className="pr-btn" onClick={doPdf} disabled={saving} style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 34, padding: "0 13px", border: `1px solid ${CL.strong}`, borderRadius: 9, background: "#fff", color: "#3A4452", fontWeight: 600, fontSize: 12.5 }}>
              {saving ? <span className="pr-spin pr-spin-t" /> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3A4452" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>}
              Export PDF
            </button>
            <button className="pr-btn" onClick={onClose} aria-label="Close" style={{ width: 34, height: 34, display: "inline-flex", alignItems: "center", justifyContent: "center", border: `1px solid ${CL.line}`, borderRadius: 9, background: "#fff", color: CL.sub }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        {/* body */}
        <div style={{ padding: "18px 22px", overflowY: "auto" }}>
          {report.headline ? <div style={{ fontSize: 16, fontWeight: 700, color: CL.tealDeep, marginBottom: 8 }}>{report.headline}</div> : null}
          {report.summary ? <div style={{ fontSize: 13.5, color: "#3A4452", lineHeight: 1.55, marginBottom: 16 }}>{report.summary}</div> : null}

          <ScreenedStrip data={data} />
          <ProfitWaterfall data={data} currency={currency} />

          {report.keyStats?.length ? (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
              {report.keyStats.map((k: any, i: number) => (
                <div key={i} style={{ ...cardStyle, padding: "10px 14px", minWidth: 140 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: CL.sub3, textTransform: "uppercase", letterSpacing: "0.03em" }}>{k.label}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginTop: 3, fontFamily: MONO }}>{k.value}</div>
                </div>
              ))}
            </div>
          ) : null}

          <BlockStack gap="300">
            {(report.sections || []).map((sec: any, i: number) => {
              const p = PRIO[sec.priority] || PRIO.medium;
              const acts = sec.actions || [];
              return (
                <div key={i} style={{ ...cardStyle, padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: sec.insight ? 6 : 10 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 700 }}>{sec.title}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: p.fg, background: p.bg, padding: "2px 9px", borderRadius: 999, textTransform: "uppercase", letterSpacing: "0.03em" }}>{p.label}</span>
                    {acts.length > 1 ? <span style={{ fontSize: 10.5, fontWeight: 700, color: CL.sub2, background: CL.line3, padding: "2px 9px", borderRadius: 999 }}>{acts.length} products</span> : null}
                  </div>
                  {sec.insight ? <div style={{ fontSize: 12.5, color: CL.sub, lineHeight: 1.5, marginBottom: 12 }}>{sec.insight}</div> : null}
                  {/* Long lists scroll INSIDE the section so every affected product is visible. */}
                  <div style={acts.length > 4 ? { maxHeight: 320, overflowY: "auto", paddingRight: 8, border: `1px solid ${CL.line2}`, borderRadius: 10, padding: "10px 12px" } : undefined}>
                    <BlockStack gap="200">
                      {acts.map((a: any, j: number) => (
                        <div key={j} style={{ borderLeft: `3px solid ${CL.tealBg}`, paddingLeft: 12 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: CL.ink }}>{a.product ? <span style={{ color: CL.tealDeep }}>{a.product}</span> : null}{a.product ? " — " : ""}{a.recommendation}</div>
                          {a.reason ? <div style={{ fontSize: 12, color: CL.sub2, marginTop: 2, lineHeight: 1.5 }}>{a.reason}</div> : null}
                          {a.impact ? <div style={{ fontSize: 11.5, color: CL.green, fontWeight: 600, marginTop: 3 }}>↑ {a.impact}</div> : null}
                        </div>
                      ))}
                    </BlockStack>
                  </div>
                </div>
              );
            })}
          </BlockStack>

          {report.quickWins?.length ? (
            <div style={{ ...cardStyle, padding: 16, marginTop: 14, background: CL.tealBg, border: `1px solid #C7E4DF` }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: CL.tealDeep, marginBottom: 8 }}>Quick wins</div>
              <BlockStack gap="150">
                {report.quickWins.map((w: string, i: number) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "#2C6E63" }}><Check size={13} color={CL.green} /><span>{w}</span></div>
                ))}
              </BlockStack>
            </div>
          ) : null}

          <div style={{ fontSize: 11, color: CL.sub2, marginTop: 16, textAlign: "center" }}>AI-generated from your store data — review before acting. Prices only change when you Apply.</div>
        </div>
      </div>
    </div>
  );
}

function HeaderRow({ sortKey, sortDir, onSort, allSelected, someSelected, onToggleAll, currency }: { sortKey: string; sortDir: string; onSort: (k: string) => void; allSelected: boolean; someSelected: boolean; onToggleAll: () => void; currency: string }) {
  // Th = a header cell. When `k` is given the cell is clickable to sort; the active column shows a
  // ▲/▼ arrow. `right` right-aligns (numeric columns).
  const Th = ({ label, k, right }: { label: any; k?: string; right?: boolean }) => {
    const active = k && sortKey === k;
    const content = (
      <span className={k ? "pr-sort" : undefined} onClick={k ? () => onSort(k) : undefined} style={{ color: active ? CL.tealDeep : undefined }}>
        {label}
        {k ? <span style={{ fontSize: 8, opacity: active ? 1 : 0.35 }}>{active ? (sortDir === "asc" ? "▲" : "▼") : "▼"}</span> : null}
      </span>
    );
    return <div style={{ textAlign: right ? "right" : "left", ...(right ? { justifySelf: "end" } : {}) }}>{k ? <span style={{ display: "inline-flex", justifyContent: right ? "flex-end" : "flex-start" }}>{content}</span> : content}</div>;
  };
  return (
    <div className="pr-grid pr-hd" style={{ fontSize: 10.5, fontWeight: 700, color: "#909CAB", textTransform: "uppercase", letterSpacing: "0.05em" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input type="checkbox" checked={allSelected} ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }} onChange={onToggleAll} aria-label="Select all" style={{ width: 16, height: 16, flex: "0 0 auto", cursor: "pointer", accentColor: CL.teal }} />
        <span className="pr-sort" onClick={() => onSort("title")} style={{ color: sortKey === "title" ? CL.tealDeep : undefined }}>Product<span style={{ fontSize: 8, opacity: sortKey === "title" ? 1 : 0.35 }}>{sortKey === "title" ? (sortDir === "asc" ? "▲" : "▼") : "▼"}</span></span>
      </div>
      <Th label="Sessions" k="sessions" right />
      <Th label="Orders" k="orders" right />
      <Th label="Conv." k="conversion" right />
      <Th label={<>Ad&nbsp;CPC</>} k="cpc" right />
      <Th label={<>Ad&nbsp;spend</>} k="adSpend" right />
      <Th label="Revenue" k="revenue" right />
      <Th label="Shipping" k="shipCost" right />
      <Th label={<>Profit&nbsp;/&nbsp;Loss</>} k="profit" right />
      <Th label={`Current (${symbolFor(currency)})`} k="currentPrice" right />
      <Th label="Suggested" />
      <Th label="Action" right />
    </div>
  );
}

function ShippingCostsToggle({ open, onToggle, hasCosts }: { open: boolean; onToggle: () => void; hasCosts: boolean }) {
  return (
    <button className="pr-btn" onClick={onToggle} style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 32, padding: "0 12px", border: `1px solid ${CL.line}`, borderRadius: 9, background: "#fff", color: CL.tealDeep, fontWeight: 600, fontSize: 12.5 }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M10 17h4V5H2v12h3" /><path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5v8h1" /><circle cx="7.5" cy="17.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></svg>
      {hasCosts ? "Edit shipping & RTO costs" : "Add shipping & RTO costs"}
      <span style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s", fontSize: 10, opacity: 0.7 }}>▼</span>
    </button>
  );
}

function ShippingCosts({ data }: { data: any }) {
  const fetcher = useFetcher<any>();
  const revalidator = useRevalidator();
  const sym = symbolFor(data.currency);
  const seed = () => ({
    shipCostPrepaid: String(data.costs.shipCostPrepaid || ""),
    shipCostCod: String(data.costs.shipCostCod || ""),
    rtoCostPrepaid: String(data.costs.rtoCostPrepaid || ""),
    rtoCostCod: String(data.costs.rtoCostCod || ""),
    assumedCogsPct: String(data.costs.assumedCogsPct ?? 50),
    paymentFeePct: String(data.costs.paymentFeePct ?? 2),
    weeklyDigest: String(data.costs.weeklyDigest !== false),
  });
  const [v, setV] = useState(seed());
  const saved = fetcher.data?.savedCosts === true;
  // After a save, re-read the loader so the KPIs update AND re-seed the inputs from what was
  // actually persisted (the server sanitises the numbers, so shown == stored).
  useEffect(() => { if (saved) revalidator.revalidate(); /* eslint-disable-next-line */ }, [saved]);
  useEffect(() => {
    setV(seed());
    /* eslint-disable-next-line */
  }, [data.costs.shipCostPrepaid, data.costs.shipCostCod, data.costs.rtoCostPrepaid, data.costs.rtoCostCod, data.costs.assumedCogsPct, data.costs.paymentFeePct]);

  const save = () => fetcher.submit(
    { intent: "save_costs", ...v },
    { method: "post", action: "/api/price-radar" },
  );

  const field = (key: keyof ReturnType<typeof seed>, label: string, hint: string, unit: string = sym) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
      <label style={{ fontSize: 11.5, fontWeight: 600, color: CL.sub3 }}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", height: 38, border: `1.5px solid ${CL.line}`, borderRadius: 10, background: "#fff", padding: "0 10px", gap: 4, fontFamily: MONO }}>
        <span style={{ color: CL.sub, flex: "0 0 auto" }}>{unit}</span>
        <input className="pr-in" value={v[key]} onChange={(e) => setV((s) => ({ ...s, [key]: e.target.value }))} placeholder="0" inputMode="decimal" style={{ width: "100%", minWidth: 0, fontFamily: MONO, fontSize: 13.5, fontWeight: 600, color: CL.ink }} />
      </div>
      <span style={{ fontSize: 11, color: CL.sub2 }}>{hint}</span>
    </div>
  );

  return (
    <div style={{ ...cardStyle, padding: 16, marginBottom: 13 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: CL.ink, marginBottom: 4 }}>Average shipping &amp; RTO cost per order</div>
      <div style={{ fontSize: 12.5, color: CL.sub, marginBottom: 14 }}>
        Enter your average per-parcel costs. Delivered orders add the shipping cost; returned / RTO orders add the RTO cost — split by <strong>Prepaid</strong> vs <strong>COD</strong> (detected from the order&rsquo;s payment method). These feed the Total cost, Profit / Loss and per-product figures.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12 }} className="pr-costgrid">
        {field("shipCostPrepaid", "Shipping — Prepaid", "avg forward cost, prepaid order")}
        {field("shipCostCod", "Shipping — COD", "avg forward cost, COD order")}
        {field("rtoCostPrepaid", "RTO — Prepaid", "avg return-to-origin, prepaid")}
        {field("rtoCostCod", "RTO — COD", "avg return-to-origin, COD")}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12, marginTop: 12 }} className="pr-costgrid">
        {field("assumedCogsPct", "Product cost (assumed)", "% of price when a real unit cost isn't set — powers breakeven ROAS in the AI report", "%")}
        {field("paymentFeePct", "Payment fee", "% of price the gateway keeps (Razorpay ≈ 2%)", "%")}
        <div style={{ display: "flex", flexDirection: "column", gap: 5, justifyContent: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 600, color: CL.ink, cursor: "pointer" }}>
            <input type="checkbox" checked={v.weeklyDigest === "true"} onChange={(e) => setV((s) => ({ ...s, weeklyDigest: String(e.target.checked) }))} style={{ width: 16, height: 16, accentColor: CL.teal, cursor: "pointer" }} />
            Weekly profit digest email
          </label>
          <span style={{ fontSize: 11, color: CL.sub2 }}>a Monday summary of your saved AI report</span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
        <button className="pr-btn" onClick={save} disabled={fetcher.state !== "idle"} style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 36, padding: "0 16px", border: "none", borderRadius: 10, background: CL.teal, color: "#fff", fontWeight: 700, fontSize: 13 }}>
          {fetcher.state !== "idle" ? <span className="pr-spin" /> : <Check size={14} color="#fff" />}Save costs
        </button>
        {saved ? <span style={{ fontSize: 12.5, color: CL.green, fontWeight: 600 }}>Saved — figures updated.</span> : null}
      </div>
    </div>
  );
}

function PriceRow({ row, currency, cpcCurrency, selected, onToggleSelect, onBusy }: { row: any; currency: string; cpcCurrency: string; selected: boolean; onToggleSelect: (productId: string) => void; onBusy: (id: string, busy: boolean) => void }) {
  const fetcher = useFetcher<any>();
  // A "discard" clears research (fetcher.data.cleared) so the row returns to "Find price".
  const research = fetcher.data?.cleared ? null : (fetcher.data?.research || row.research);
  const [price, setPrice] = useState<string>(research?.researchedPrice != null ? String(research.researchedPrice) : "");
  const [titleOpen, setTitleOpen] = useState(false);
  const [histRect, setHistRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (fetcher.data?.research?.researchedPrice != null) setPrice(String(fetcher.data.research.researchedPrice));
  }, [fetcher.data]);

  // Silent save on the edited price uses its OWN fetcher so editing never spins the Apply button.
  const saveFetcher = useFetcher<any>();
  const busy = fetcher.state !== "idle";
  // Surface this row's processing to the page-level overlay (and clear on unmount so a row that
  // scrolls/paginates away mid-request can't leave the overlay stuck).
  useEffect(() => { onBusy(row.variantId, busy); }, [busy, row.variantId, onBusy]);
  useEffect(() => () => onBusy(row.variantId, false), [row.variantId, onBusy]);
  const post = (fields: Record<string, string>) => fetcher.submit(fields, { method: "post", action: "/api/price-radar" });
  const findPrice = () => post({
    intent: "research", variantId: row.variantId, productId: row.productId, title: row.title,
    currentPrice: String(row.currentPrice), currency, imageUrl: row.imageUrl || "",
    vendor: row.vendor || "", productType: row.productType || "", barcode: row.barcode || "",
  });
  // Shared fields so a manually-typed price can upsert a record (no prior research needed).
  const baseFields = { variantId: row.variantId, productId: row.productId, title: row.title, currentPrice: String(row.currentPrice), currency };
  const apply = () => post({ intent: "apply", ...baseFields, price });
  const save = () => { if (parseFloat(price) > 0) saveFetcher.submit({ intent: "save", ...baseFields, price }, { method: "post", action: "/api/price-radar" }); };
  const discard = () => post({ intent: "discard", variantId: row.variantId });
  // Cancel: revert an edit-after-apply back to the applied price (keep the record); otherwise
  // discard a researched-not-applied suggestion, or just clear a manually-typed value.

  const applied = research?.status === "applied";
  // Once applied, treat the field as "edited" the moment its value differs from the applied price —
  // that flips the row back to Apply(✓)/Cancel(✗) so a re-price can be saved.
  const appliedPriceNum = applied ? (research?.researchedPrice ?? null) : null;
  const editedAfterApply = applied && appliedPriceNum != null && Math.abs((parseFloat(price) || 0) - appliedPriceNum) > 0.005;
  const err = fetcher.data && fetcher.data.ok === false ? fetcher.data.error : null;
  const priceNum = parseFloat(price) || 0;
  const sym = symbolFor(currency);
  const hasHistory = (row.priceHistory && row.priceHistory.length > 0) || (row.originalPrice != null && Math.abs(row.originalPrice - row.currentPrice) > 0.005);
  const cancel = () => {
    if (editedAfterApply && appliedPriceNum != null) setPrice(String(appliedPriceNum));
    else if (research) discard();
    else setPrice("");
  };

  const conv = row.conversion;
  const convKind: "good" | "mid" | "low" = conv == null || conv === 0 ? "low" : conv >= 1.5 ? "good" : "mid";
  const cc = research?.confidence ? confChip(research.confidence) : null;

  return (
    <div>
      <div className="pr-grid pr-row">
        {/* product (checkbox + thumb + title) — vertically centered to line up with the numbers */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <input type="checkbox" checked={selected} onChange={() => onToggleSelect(row.productId)} aria-label={`Select ${row.title}`}
            style={{ width: 16, height: 16, flex: "0 0 auto", cursor: "pointer", accentColor: CL.teal }} />
          {row.imageUrl
            ? <img src={row.imageUrl} alt="" style={{ width: 42, height: 42, borderRadius: 10, objectFit: "cover", border: `1px solid ${CL.line}`, flex: "0 0 auto" }} />
            : <div style={{ width: 42, height: 42, borderRadius: 10, background: "repeating-linear-gradient(135deg,#EEF2F6 0 6px,#E6EBF1 6px 12px)", border: "1px solid #EAEEF2", flex: "0 0 auto" }} />}
          <div style={{ minWidth: 0 }}>
            <div className={`pr-title${titleOpen ? " open" : ""}`} onClick={() => setTitleOpen((o) => !o)} title={row.title}>{row.title}</div>
            <div className="pr-prod-details">
              {research ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                  {cc ? <span style={cc.style}><span style={{ width: 6, height: 6, borderRadius: 999, background: cc.dot, flex: "0 0 auto" }} />{cc.label} confidence</span> : null}
                  {research.low != null && research.high != null ? <span style={{ fontSize: 12, color: CL.sub }}>Market <span style={{ fontFamily: MONO, color: "#5B6573" }}>{money(research.low, currency)}–{money(research.high, currency)}</span></span> : null}
                </div>
              ) : null}
              {research?.sources && research.sources.length ? <div style={{ fontSize: 11.5, color: CL.sub2, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>via {research.sources.slice(0, 3).join(", ")}</div> : null}
            </div>
            {err ? <div style={{ fontSize: 11.5, color: "#B42318", marginTop: 4 }}>{err}</div> : null}
          </div>
        </div>
        {/* sessions */}
        <div style={{ textAlign: "right", fontFamily: MONO, fontSize: 13.5, fontWeight: 600, color: CL.ink }}>{row.sessions ? row.sessions.toLocaleString() : "—"}</div>
        {/* orders */}
        <div style={{ textAlign: "right", fontFamily: MONO, fontSize: 13.5, fontWeight: 600, color: "#3A4452" }}>{row.orders || "—"}</div>
        {/* conversion */}
        <div style={{ textAlign: "right" }}><span style={convPill(convKind)}>{conv != null ? `${conv}%` : "—"}</span></div>
        {/* ad CPC */}
        <div style={{ textAlign: "right", fontFamily: MONO, fontSize: 13, fontWeight: 600, color: row.cpc != null ? "#3A4452" : CL.sub2 }}>{row.cpc != null ? money(row.cpc, cpcCurrency) : "—"}</div>
        {/* ad spend (sessions × CPC) */}
        <div style={{ textAlign: "right", fontFamily: MONO, fontSize: 13, fontWeight: 600, color: row.adSpend ? "#3A4452" : CL.sub2 }}>{row.adSpend ? money(row.adSpend, cpcCurrency) : "—"}</div>
        {/* revenue (delivered, after discount) */}
        <div style={{ textAlign: "right", fontFamily: MONO, fontSize: 13, fontWeight: 600, color: row.revenue != null ? CL.ink : CL.sub2 }}>{row.revenue != null ? money(row.revenue, currency) : "—"}</div>
        {/* shipping + RTO cost (blank until costs are entered) */}
        <div style={{ textAlign: "right", fontFamily: MONO, fontSize: 13, fontWeight: 600, color: row.shipCost ? "#3A4452" : CL.sub2 }}>{row.shipCost ? money(row.shipCost, currency) : "—"}</div>
        {/* profit / loss + % */}
        <div style={{ textAlign: "right", lineHeight: 1.25 }}>
          {row.profit != null ? (
            <>
              <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: row.profit >= 0 ? CL.green : "#B42318" }}>{row.profit >= 0 ? "+" : "−"}{money(Math.abs(row.profit), currency)}</div>
              {row.profitPct != null ? <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: row.profit >= 0 ? CL.green : "#B42318", opacity: 0.8 }}>({row.profitPct > 0 ? "+" : ""}{row.profitPct}%)</div> : null}
            </>
          ) : <span style={{ color: CL.sub2 }}>—</span>}
        </div>
        {/* current price — click to see original + change history */}
        <div style={{ textAlign: "right", lineHeight: 1.25 }}>
          <span
            onClick={hasHistory ? (e) => setHistRect((e.currentTarget as HTMLElement).getBoundingClientRect()) : undefined}
            title={hasHistory ? "View price history" : undefined}
            style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", cursor: hasHistory ? "pointer" : "default" }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontFamily: MONO, fontSize: 13.5, fontWeight: 600, color: CL.ink }}>
              {hasHistory ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={CL.sub2} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ flex: "0 0 auto" }}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg> : null}
              {money(row.currentPrice, currency)}
            </span>
            {row.originalPrice != null && Math.abs(row.originalPrice - row.currentPrice) > 0.005
              ? <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 600, color: CL.sub2 }}>orig {money(row.originalPrice, currency)}</span>
              : null}
          </span>
        </div>
        {/* suggested (no delta % chip — kept clean per request) */}
        <div>
          <div style={{ display: "flex", alignItems: "center", height: 38, width: 116, maxWidth: "100%", border: `1.5px solid ${CL.strong}`, borderRadius: 10, background: "#fff", padding: "0 10px", gap: 3, fontFamily: MONO }}>
            <span style={{ color: CL.sub, flex: "0 0 auto" }}>{sym}</span>
            <input className="pr-in" value={price} onChange={(e) => setPrice(e.target.value)} onBlur={save} placeholder="—" inputMode="decimal" style={{ width: "100%", minWidth: 0, fontFamily: MONO, fontSize: 13.5, fontWeight: 600, color: CL.ink }} />
          </div>
        </div>
        {/* action */}
        <div style={{ display: "flex", alignItems: "center", gap: 7, justifyContent: "flex-end" }}>
          {applied && !editedAfterApply ? (
            // Already applied & unchanged → a green "Analyze again" button (re-research is allowed);
            // the tooltip shows the applied price + date.
            <button className="pr-btn" onClick={findPrice} disabled={busy}
              title={`Applied ${money(research.researchedPrice, currency)}${research.appliedAt ? ` on ${fmtDay(research.appliedAt)}` : ""}${research.researchedAt ? ` · last researched ${fmtDay(research.researchedAt)}` : ""} — click to research a new price`}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 12px", border: `1px solid #C7E4DF`, borderRadius: 10, background: CL.greenBg, color: CL.green, fontWeight: 700, fontSize: 12.5, whiteSpace: "nowrap", flex: "0 0 auto" }}>
              {busy ? <span className="pr-spin pr-spin-t" /> : <Check size={14} color={CL.green} />}Analyze
            </button>
          ) : priceNum > 0 ? (
            <>
              <button className="pr-btn" title="Apply this price" aria-label="Apply price" onClick={apply} disabled={busy} style={{ width: 36, height: 34, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "none", borderRadius: 10, background: CL.teal, color: "#fff", boxShadow: "0 6px 12px -7px rgba(14,147,132,0.8)" }}>{busy ? <span className="pr-spin" /> : <Check size={16} color="#fff" />}</button>
              <button className="pr-btn" title={editedAfterApply ? "Revert to applied price" : "Cancel"} aria-label="Cancel" onClick={cancel} disabled={busy} style={{ width: 36, height: 34, display: "inline-flex", alignItems: "center", justifyContent: "center", border: `1px solid ${CL.line}`, borderRadius: 10, background: "#fff", color: "#B42318" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#B42318" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </>
          ) : (
            <button className="pr-btn" onClick={findPrice} disabled={busy} style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 34, padding: "0 15px", border: "none", borderRadius: 10, background: CL.inkDeep, color: "#fff", fontWeight: 600, fontSize: 12.5, whiteSpace: "nowrap", flex: "0 0 auto" }}>{busy ? <span className="pr-spin" /> : <Glass size={14} color={CL.mint} />}Analyze</button>
          )}
        </div>
      </div>
      {histRect ? (
        <PriceHistoryPopover rect={histRect} currency={currency} current={row.currentPrice} original={row.originalPrice} history={row.priceHistory} onClose={() => setHistRect(null)} />
      ) : null}
    </div>
  );
}

function buildShopifyQL(from: string, to: string): string {
  return `FROM sessions
  SHOW sessions
  WHERE landing_page_path IS NOT NULL
    AND human_or_bot_session IN ('human', 'bot')
  GROUP BY landing_page_path
  TIMESERIES day
  SINCE ${from} UNTIL ${to}
  ORDER BY day ASC
  LIMIT 100000`;
}

function ImportSessions({ data, onViewImported }: { data: any; onViewImported: () => void }) {
  const [open, setOpen] = useState(false);
  const fetcher = useFetcher<any>();
  const revalidator = useRevalidator();
  const [csv, setCsv] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [preparing, setPreparing] = useState(false);
  const [parseErr, setParseErr] = useState<string>("");
  const today = new Date().toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState<string>(data.importEarliest || "2022-02-01");
  const [toDate, setToDate] = useState<string>(today);
  const query = buildShopifyQL(fromDate, toDate);

  const busy = preparing || fetcher.state !== "idle";
  const done = fetcher.data?.ok === true && typeof fetcher.data?.matched === "number";
  const cleared = fetcher.data?.ok === true && fetcher.data?.matched === undefined;
  const err = parseErr || (fetcher.data?.ok === false ? fetcher.data.error : null);

  // After a successful import/clear, refresh the loader so the range option + counts update.
  useEffect(() => {
    if (done || cleared) revalidator.revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, cleared]);

  const onDrop = useCallback((_files: File[], accepted: File[]) => {
    const f = accepted[0];
    if (!f) return;
    setFileName(f.name);
    setParseErr("");
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result || ""));
    reader.readAsText(f);
  }, []);

  const doImport = () => {
    if (!csv) return;
    setParseErr("");
    setPreparing(true);
    // Defer so the button paints its loading state before the (heavy) parse blocks the thread.
    setTimeout(() => {
      try {
        const { rows, header } = parseSessionsCsv(csv);
        if (!rows.length) {
          setParseErr("Couldn't find a product column and a sessions count in that file. Make sure it has product-page URLs (or titles) and a Sessions column.");
          setPreparing(false);
          return;
        }
        const kind = rows[0].kind;
        // For landing-page exports, keep only product pages — homepage/collection rows can't map to a product.
        const useRows = kind === "url" ? rows.filter((r) => /\/products\//i.test(r.identifier)) : rows;
        if (!useRows.length) {
          setParseErr("No product-page rows (/products/…) were found in that export. Use a report that lists product URLs, titles, or handles.");
          setPreparing(false);
          return;
        }
        const fallbackMonthISO = (fromDate || "2022-02-01").slice(0, 8) + "01"; // first of the "From" month
        const buckets = aggregateToBuckets(useRows, fallbackMonthISO);
        fetcher.submit(
          { intent: "import_sessions", kind, hasMonth: !!header.month, buckets },
          { method: "post", action: "/api/price-radar", encType: "application/json" },
        );
      } catch {
        setParseErr("Could not read that file. Please re-export it as CSV and try again.");
      }
      setPreparing(false);
    }, 30);
  };
  const doClear = () => {
    if (typeof window !== "undefined" && !window.confirm("Remove the imported historical sessions?")) return;
    fetcher.submit({ intent: "clear_import" }, { method: "post", action: "/api/price-radar" });
    setCsv(""); setFileName("");
  };
  const copyQuery = () => { try { navigator.clipboard?.writeText(query); } catch { /* ignore */ } };

  return (
    <div style={{ ...cardStyle, padding: 16 }}>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" wrap>
          <InlineStack gap="200" blockAlign="center">
            <div style={{ width: 34, height: 34, borderRadius: 10, background: "#E2ECFD", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#1E50C9" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
            </div>
            <Text as="h2" variant="headingSm">Import historical sessions</Text>
            {data.importCount > 0 ? <Badge tone="success">{`${data.importCount} products imported`}</Badge> : <Badge>One-time backfill</Badge>}
          </InlineStack>
          <Button variant="plain" onClick={() => setOpen((o) => !o)} ariaExpanded={open} ariaControls="import-sessions-panel">
            {open ? "Hide" : data.importCount > 0 ? "Update / manage" : "Show me how"}
          </Button>
        </InlineStack>

        {data.importCount > 0 && !open ? (
          <Text as="p" variant="bodySm" tone="subdued">
            {`Historical sessions from ${data.importEarliest || "?"} to ${data.importLatest || "?"} are loaded — they show in every date range now. `}
            <PolarisLink onClick={onViewImported}>View all time</PolarisLink>{"."}
          </Text>
        ) : null}

        <Collapsible open={open} id="import-sessions-panel" transition={{ duration: "200ms", timingFunction: "ease-in-out" }}>
          <BlockStack gap="400">
            <Text as="p" variant="bodySm" tone="subdued">
              Sessions from before you installed ShopFlix live in your Shopify Analytics, not ours. Export them once and upload the CSV here. We&rsquo;ll match each row to a product and fill in the Sessions column so your <strong>date-range filter works on the historical data too</strong>. Big files are fine — we parse them right here in your browser and only send a compact summary. Going forward, our storefront pixel keeps sessions current automatically, so this is a one-time step.
            </Text>

            <Box background="bg-surface-secondary" padding="300" borderRadius="200">
              <BlockStack gap="300">
                <Text as="h3" variant="headingXs">1 · Export the sessions report from Shopify</Text>
                <InlineStack gap="300" wrap blockAlign="end">
                  <div style={{ minWidth: 150 }}><TextField label="From (SINCE)" type="date" value={fromDate} onChange={setFromDate} autoComplete="off" /></div>
                  <div style={{ minWidth: 150 }}><TextField label="To (UNTIL)" type="date" value={toDate} onChange={setToDate} autoComplete="off" /></div>
                  <Text as="span" variant="bodyXs" tone="subdued">Dates flow into the query below. Shopify session data starts Oct 2022.</Text>
                </InlineStack>
                <List type="number">
                  <List.Item>In Shopify admin, open <strong>Analytics → Reports → Create report</strong> (the ShopifyQL / query editor).</List.Item>
                  <List.Item>Paste the query below and run it. The <code>TIMESERIES day</code> line breaks sessions down over time, which is what lets the date filter here work.</List.Item>
                  <List.Item>Click <strong>“…” (more actions) → Export</strong>, choose <strong>CSV</strong> and <strong>Full report</strong>, then upload it below.</List.Item>
                </List>
                <TextField label="ShopifyQL query" labelHidden value={query} readOnly multiline={8} autoComplete="off" />
                <InlineStack gap="200">
                  <Button size="slim" onClick={copyQuery}>Copy query</Button>
                  <Text as="span" variant="bodyXs" tone="subdued">Landing-page rows (<code>/products/…</code>) are matched to products by handle.</Text>
                </InlineStack>
              </BlockStack>
            </Box>

            <BlockStack gap="200">
              <Text as="h3" variant="headingXs">2 · Upload the CSV</Text>
              <DropZone accept=".csv,text/csv" type="file" allowMultiple={false} onDrop={onDrop}>
                {fileName ? (
                  <Box padding="400"><Text as="span" variant="bodySm">{`Selected: ${fileName}`}</Text></Box>
                ) : (
                  <DropZone.FileUpload actionTitle="Choose CSV" actionHint="or drag & drop your exported report" />
                )}
              </DropZone>
              <InlineStack gap="200">
                <Button variant="primary" onClick={doImport} loading={busy} disabled={!csv}>{preparing ? "Reading file…" : "Import sessions"}</Button>
                {data.importCount > 0 ? <Button variant="plain" tone="critical" onClick={doClear} loading={fetcher.state !== "idle"}>Clear imported data</Button> : null}
              </InlineStack>
            </BlockStack>

            {done ? (
              <Banner tone="success" title="Historical sessions imported">
                <p>
                  {`Matched ${fetcher.data.matched} products across ${fetcher.data.months || 0} month${fetcher.data.months === 1 ? "" : "s"}${fetcher.data.unmatched ? ` — ${fetcher.data.unmatched} landing pages didn’t match an active product and were skipped` : ""}. `}
                  {fetcher.data.hasMonth === false ? "Heads up: no date column was found, so everything landed in one month — re-export with the TIMESERIES line for accurate date filtering. " : ""}
                  <PolarisLink onClick={onViewImported}>View all time</PolarisLink>{"."}
                </p>
              </Banner>
            ) : null}
            {err ? <Banner tone="warning">{err}</Banner> : null}
          </BlockStack>
        </Collapsible>
      </BlockStack>
    </div>
  );
}

export default function PriceRadar() {
  const data = useLoaderData<typeof loader>();
  const [sp, setSp] = useSearchParams();
  const bulk = useFetcher<any>();
  const applyAll = useFetcher<any>();
  const bulkStatus = useFetcher<any>();
  const revalidator = useRevalidator();
  const navigation = useNavigation(); // "loading" during sort / pagination / date-range reloads

  // Row selection (by productId) + bulk actions.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSelect = useCallback((productId: string) => {
    setSelected((s) => { const n = new Set(s); n.has(productId) ? n.delete(productId) : n.add(productId); return n; });
  }, []);

  // Aggregate per-row processing into a page-level busy overlay. Kept in a ref-backed set so the
  // callback identity is stable (rows won't re-render from it).
  const [busyCount, setBusyCount] = useState(0);
  const busySet = useRef<Set<string>>(new Set());
  const onRowBusy = useCallback((id: string, busy: boolean) => {
    const s = busySet.current;
    const had = s.has(id);
    if (busy && !had) s.add(id);
    else if (!busy && had) s.delete(id);
    else return;
    setBusyCount(s.size);
  }, []);

  const jobActive = data.job && (data.job.status === "pending" || data.job.status === "processing");

  // Poll while a bulk job is running so the progress + results refresh.
  useEffect(() => {
    if (!jobActive) return;
    const t = setInterval(() => revalidator.revalidate(), 8000);
    return () => clearInterval(t);
  }, [jobActive, revalidator]);

  const setRange = useCallback((val: string) => {
    const next = new URLSearchParams(sp);
    next.set("days", val); next.delete("since"); next.delete("until"); next.set("page", "1");
    setSp(next);
  }, [sp, setSp]);

  const gotoPage = useCallback((p: number) => {
    const next = new URLSearchParams(sp); next.set("page", String(p)); setSp(next);
  }, [sp, setSp]);

  const [q, setQ] = useState("");
  const [costsOpen, setCostsOpen] = useState(false);
  const startBulk = () => bulk.submit({ intent: "bulk", currency: data.currency }, { method: "post", action: "/api/price-radar" });
  const startApplyAll = () => {
    if (typeof window !== "undefined" && !window.confirm("Apply the researched prices to all these products? This updates the live prices on your store.")) return;
    applyAll.submit({ intent: "apply_all" }, { method: "post", action: "/api/price-radar" });
  };

  // AI Profit Advisor — the heavy Gemini run happens as a BACKGROUND JOB on the server (a 1-3 min
  // synchronous request would be killed by browser/proxy timeouts). The click returns instantly,
  // the page polls while the job runs, and the finished report pops open automatically. The report
  // is SAVED per store: viewing it again is free, only a regenerate costs credits.
  const advisor = useFetcher<any>();
  const jobPoll = useFetcher<any>(); // LIGHTWEIGHT status poll — zero Shopify API cost, so it can't
                                     // collide with the job's own Shopify usage (→ Throttled).
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const advisorData = data.savedAdvisor;
  const advisorJob = jobPoll.data?.advisorJob ?? data.advisorJob; // freshest wins
  const advisorRunning = advisorJob?.status === "running" || (advisor.data?.started === true && advisorJob?.status !== "done" && advisorJob?.status !== "error");
  const runAdvisor = () => {
    if (advisorRunning) return;
    if (typeof window !== "undefined" && !window.confirm(`${advisorData ? "Regenerate" : "Run"} the AI Profit Advisor on your products for this date range? This uses ${ADVISOR_CREDITS} credits and takes 1-3 minutes — we'll open the report when it's ready.`)) return;
    const fields: Record<string, string> = { intent: "profit_advisor", days: String(data.rangeMode || "30"), currency: data.currency };
    if (data.rangeMode === "0") { fields.since = data.since; fields.until = data.until; }
    advisor.submit(fields, { method: "post", action: "/api/price-radar" });
  };
  // Saved report → open instantly (free); nothing saved yet → generate.
  const advisorClick = () => { if (advisorRunning) return; if (advisorData) setAdvisorOpen(true); else runAdvisor(); };

  // Best-Sellers collection — one click creates/refreshes an auto-updating Shopify smart collection
  // of the last-30-day top sellers (ranked by orders net of ad cost). A monthly cron keeps it fresh.
  const bestSeller = useFetcher<any>();
  const createBestSeller = () => {
    if (bestSeller.state !== "idle") return;
    bestSeller.submit({ intent: "create_bestseller_collection", topN: "20" }, { method: "post", action: "/api/price-radar" });
  };
  // While the job runs, poll the CHEAP status endpoint every 6s (not the heavy page loader).
  useEffect(() => {
    if (!advisorRunning) return;
    const t = setInterval(() => { if (jobPoll.state === "idle") jobPoll.load("/api/price-radar"); }, 6000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advisorRunning]);
  // Job finished (done or error) → ONE full revalidate to pull the new report / error state.
  const prevJobStatus = useRef<string | null>(null);
  useEffect(() => {
    const s = advisorJob?.status || null;
    if (prevJobStatus.current === "running" && (s === "done" || s === "error")) revalidator.revalidate();
    prevJobStatus.current = s;
  }, [advisorJob?.status, revalidator]);
  // Auto-open the report when a NEW one lands (generatedAt changed since mount/last view).
  const lastGenRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const g = data.savedAdvisor?.generatedAt || null;
    if (lastGenRef.current === undefined) { lastGenRef.current = g; return; } // initial mount — don't auto-open
    if (g && g !== lastGenRef.current) { lastGenRef.current = g; setAdvisorOpen(true); }
  }, [data.savedAdvisor?.generatedAt]);

  // Click a sortable column header → set ?sort=&dir= (toggles asc/desc). Server-side so the order
  // spans every page. Default direction: descending for a new column (biggest first).
  const setSort = useCallback((key: string) => {
    const next = new URLSearchParams(sp);
    const curKey = data.sortKey, curDir = data.sortDir;
    const dir = curKey === key ? (curDir === "desc" ? "asc" : "desc") : (key === "title" ? "asc" : "desc");
    next.set("sort", key); next.set("dir", dir); next.set("page", "1");
    setSp(next);
  }, [sp, setSp, data.sortKey, data.sortDir]);

  // CSV download helper — App Bridge adds the session token to same-origin fetch, then we save the
  // blob (an embedded-app iframe can't just navigate to the endpoint).
  const [exporting, setExporting] = useState<"" | "orders" | "report">("");
  const rangeParams = () => {
    const p = new URLSearchParams();
    if (data.rangeMode && data.rangeMode !== "0") p.set("days", data.rangeMode);
    else { p.set("since", data.since); p.set("until", data.until); }
    return p;
  };
  const download = async (kind: "orders" | "report", path: string, filename: string) => {
    setExporting(kind);
    try {
      const res = await fetch(`${path}?${rangeParams().toString()}`);
      if (!res.ok) { window.alert(`Export failed: ${await res.text().catch(() => res.statusText)}`); return; }
      const blob = await res.blob();
      const u = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = u; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(u);
    } catch {
      window.alert("Export failed — please try again.");
    } finally {
      setExporting("");
    }
  };
  const exportOrders = () => download("orders", "/api/price-radar/orders-export", `price-radar-orders_${data.since}_${data.until}.csv`);
  const exportReport = () => download("report", "/api/price-radar/report-export", `price-radar-report_${data.since}_${data.until}.csv`);

  const visibleRows = q.trim()
    ? data.rows.filter((r: any) => r.title.toLowerCase().includes(q.trim().toLowerCase()))
    : data.rows;

  // Selection over the currently-visible rows.
  const visibleIds: string[] = visibleRows.map((r: any) => r.productId);
  const selectedVisible = visibleIds.filter((id) => selected.has(id));
  const allSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
  const someSelected = selectedVisible.length > 0 && !allSelected;
  const toggleAll = useCallback(() => {
    setSelected((s) => {
      const n = new Set(s);
      const ids = visibleRows.map((r: any) => r.productId);
      const everyOn = ids.length > 0 && ids.every((id: string) => n.has(id));
      if (everyOn) ids.forEach((id: string) => n.delete(id));
      else ids.forEach((id: string) => n.add(id));
      return n;
    });
  }, [visibleRows]);
  const clearSelection = useCallback(() => setSelected(new Set()), []);
  const markDraft = () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (typeof window !== "undefined" && !window.confirm(`Mark ${ids.length} product${ids.length === 1 ? "" : "s"} as Draft? They'll be hidden from your storefront and ad channels until you re-activate them.`)) return;
    bulkStatus.submit({ intent: "bulk_status", status: "DRAFT", productIds: ids.join(",") }, { method: "post", action: "/api/price-radar" });
  };
  // After a bulk status change, clear the selection and refresh (drafted products drop off the grid).
  useEffect(() => {
    if (bulkStatus.data?.ok && bulkStatus.data.updated != null) { setSelected(new Set()); revalidator.revalidate(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkStatus.data]);

  // Page-level "something is processing" — drives the blocking overlay. Includes `navigation`
  // (sort / pagination / date-range change all reload the loader) but NOT the revalidator, so the
  // background 8s job-status poll doesn't flash the overlay.
  const overlayBusy = busyCount > 0 || navigation.state !== "idle" || applyAll.state !== "idle" || bulk.state !== "idle" || bulkStatus.state !== "idle" || advisor.state !== "idle" || exporting !== "";

  const rangeOptions: [string, string][] = [
    ["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 3 months"],
    ["180", "Last 6 months"], ["365", "Last year"], ["730", "Last 2 years"],
    ["all", data.importCount > 0 ? `All time (since ${data.importEarliest})` : "All time"],
  ];

  return (
    <div className="pr-page" style={{ background: "#F4F6F8", minHeight: "100%", padding: "22px 24px 80px", color: CL.ink }}>
      <style>{PAGE_STYLE}</style>
      {overlayBusy ? (
        <div className="pr-overlay" role="status" aria-live="polite" aria-busy="true">
          <div className="pr-overlay-card">
            <div className="pr-bigspin" />
            <div style={{ fontSize: 13, fontWeight: 600, color: CL.ink }}>{advisor.state !== "idle" ? "Analysing your profit…" : "Working…"}</div>
          </div>
        </div>
      ) : null}
      {advisorOpen && advisorData?.report ? (
        <ProfitAdvisorModal data={advisorData} onClose={() => setAdvisorOpen(false)} onRegenerate={runAdvisor} regenerating={advisor.state !== "idle" || advisorRunning} credits={ADVISOR_CREDITS} />
      ) : null}
      <div style={{ width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>

        {/* ── header ── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 18, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 46, height: 46, borderRadius: 14, background: CL.tealBg, display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}><Radar size={23} /></div>
            <div>
              <div style={{ fontSize: 23, fontWeight: 700, letterSpacing: "-0.015em" }}>Price Radar</div>
              <div style={{ fontSize: 13.5, color: CL.sub, marginTop: 2 }}>Products ranked by visits — with orders, conversion &amp; AI competitive-price research</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 40, padding: "0 12px 0 14px", border: `1.5px solid ${CL.strong}`, borderRadius: 11, background: "#fff", fontSize: 13.5 }}>
              <span style={{ color: CL.sub, fontWeight: 600 }}>Date range</span>
              <select className="pr-sel" value={data.rangeMode} onChange={(e) => setRange(e.target.value)} style={{ fontWeight: 700, fontSize: 13.5, color: CL.ink }}>
                {rangeOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <button className="pr-btn" onClick={startApplyAll} disabled={applyAll.state !== "idle"} style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 40, padding: "0 15px", border: `1.5px solid ${CL.strong}`, borderRadius: 11, background: "#fff", color: "#3A4452", fontWeight: 600, fontSize: 13.5 }}>
              {applyAll.state !== "idle" ? <span className="pr-spin pr-spin-t" /> : <Check size={15} color={CL.tealDeep} />}Apply all
            </button>
            <button className="pr-btn" onClick={startBulk} disabled={bulk.state !== "idle" || !!jobActive} style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 40, padding: "0 16px", border: "none", borderRadius: 11, background: CL.inkDeep, color: "#fff", fontWeight: 600, fontSize: 13.5, boxShadow: "0 6px 14px -8px rgba(16,26,36,0.6)" }}>
              {bulk.state !== "idle" ? <span className="pr-spin" /> : <Spark size={15} color={CL.mint} />}Analyze all
              <span style={{ fontFamily: MONO, fontSize: 12, background: "rgba(127,227,214,0.18)", color: CL.mint, padding: "2px 7px", borderRadius: 6 }}>{data.bulkCost} cr</span>
            </button>
            <button className="pr-btn" onClick={advisorClick} disabled={advisor.state !== "idle" || advisorRunning} title={advisorRunning ? "Your report is being generated — it will open automatically" : advisorData ? "View your saved profit report (free) — regenerate from inside" : "AI-powered plan to increase your profit"}
              style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 40, padding: "0 16px", border: "none", borderRadius: 11, background: "linear-gradient(135deg,#7C3AED,#5B21B6)", color: "#fff", fontWeight: 600, fontSize: 13.5, boxShadow: "0 6px 14px -8px rgba(91,33,182,0.7)" }}>
              {advisor.state !== "idle" || advisorRunning ? <span className="pr-spin" /> : <Spark size={15} color="#E9D5FF" />}{advisorRunning ? "Generating…" : advisorData ? "View Profit Report" : "AI Profit Advisor"}
              {!advisorRunning ? <span style={{ fontFamily: MONO, fontSize: 12, background: "rgba(233,213,255,0.22)", color: "#EDE0FF", padding: "2px 7px", borderRadius: 6 }}>{advisorData ? "saved" : `${ADVISOR_CREDITS} cr`}</span> : null}
            </button>
            <RemixLink to="/app/ad-campaigns" title="Turn your profit report into an AI-optimized Google Ads campaign structure"
              style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 40, padding: "0 16px", border: "none", borderRadius: 11, background: "linear-gradient(135deg,#1A73E8,#174EA6)", color: "#fff", fontWeight: 600, fontSize: 13.5, textDecoration: "none", boxShadow: "0 6px 14px -8px rgba(23,78,166,0.7)" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#D2E3FC" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l18-8-8 18-2.5-7.5L3 11Z" /></svg>
              Create optimized ad campaign
            </RemixLink>
          </div>
        </div>
        {advisor.data && advisor.data.ok === false ? <Notice tone="warn">{advisor.data.error}</Notice> : null}
        {advisorRunning ? <Notice tone="info"><strong>Generating your profit report</strong> with Gemini Pro — takes 1–3 minutes. You can keep using the page; the report will open automatically when it&rsquo;s ready.</Notice> : null}
        {!advisorRunning && advisorJob?.status === "error" ? <Notice tone="warn"><strong>Profit report failed:</strong> {advisorJob.error} Your credits were refunded — try Regenerate again.</Notice> : null}

        {/* ── KPI strip ── */}
        <div className="pr-kpi">
          <Kpi dot={CL.blue} label="Active products" value={data.totalCount.toLocaleString()} sub="ranked by visits" />
          <Kpi dot={CL.teal} label="Suggestions ready" value={data.suggestionsReady.toLocaleString()} sub={`${data.raiseCount} raise · ${data.lowerCount} lower`} />
          <Kpi dot={CL.greenDot} label="Prices applied" value={data.appliedCount.toLocaleString()} sub="total" />
          <Kpi dot="#E0900F" label="Avg suggested" value={data.avgSuggestedPct != null ? `${data.avgSuggestedPct > 0 ? "+" : ""}${data.avgSuggestedPct}%` : "—"} valueColor={data.avgSuggestedPct != null && data.avgSuggestedPct > 0 ? CL.green : undefined} sub="vs current" />
          <Kpi highlight icon={<Spark size={14} color={CL.tealDeep} />} label="Research credits" value={data.credits.toLocaleString()} sub="≈ 1 cr per product" />
        </div>

        {/* ── cost & revenue strip ── */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: CL.sub3, textTransform: "uppercase", letterSpacing: "0.05em" }}>Cost &amp; revenue (this range)</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {data.hasOrdersScope ? (
                <button className="pr-btn" onClick={exportOrders} disabled={exporting !== ""} style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 34, padding: "0 13px", border: `1px solid ${CL.strong}`, borderRadius: 9, background: "#fff", color: "#3A4452", fontWeight: 600, fontSize: 12.5 }}>
                  {exporting === "orders" ? <span className="pr-spin pr-spin-t" /> : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3A4452" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
                  )}
                  {exporting === "orders" ? "Preparing…" : "Export orders (CSV)"}
                </button>
              ) : null}
              <ShippingCostsToggle open={costsOpen} onToggle={() => setCostsOpen((o) => !o)} hasCosts={data.pnl.hasCostInputs} />
            </div>
          </div>
          {costsOpen ? <ShippingCosts data={data} /> : null}
          <div className="pr-kpi2">
            <Kpi dot={CL.blue} label="Total cost" value={data.ads.configured || data.pnl.hasCostInputs ? money(data.pnl.totalCost, data.currency) : "—"} sub={`ads ${money(data.pnl.adSpend, data.cpcCurrency)}${(data.ads as any).actual ? " (actual)" : ""} · ship ${money(data.pnl.shipCost, data.currency)} · RTO ${money(data.pnl.rtoCost, data.currency)}`} />
            <Kpi dot={CL.teal} label="Revenue" value={money(data.pnl.revenue, data.currency)} sub="delivered orders, after discount" />
            <Kpi
              dot={data.pnl.profitLoss >= 0 ? CL.greenDot : "#B42318"}
              label="Profit / loss"
              value={`${data.pnl.profitLoss >= 0 ? "+" : "−"}${money(Math.abs(data.pnl.profitLoss), data.currency)}`}
              valueColor={data.pnl.profitLoss >= 0 ? CL.green : "#B42318"}
              sub={data.pnl.profitLossPct != null ? `(${data.pnl.profitLossPct > 0 ? "+" : ""}${data.pnl.profitLossPct}% vs cost)` : "add costs / Google Ads for %"}
            />
            <Kpi dot={CL.greenDot} label="Orders delivered" value={data.pnl.ordersDelivered.toLocaleString()} sub="carrier delivered" />
            <Kpi dot={CL.blue} label="Orders in transit" value={data.pnl.ordersInTransit.toLocaleString()} sub="shipped, not delivered yet" />
            <Kpi dot="#C88A2E" label="Orders returned" value={data.pnl.ordersReturned.toLocaleString()} sub={data.pnl.returnInTransit > 0 ? `+ ${data.pnl.returnInTransit} coming back` : "RTO / customer return"} />
          </div>
        </div>

        {/* ── notices ── */}
        {jobActive ? <Notice tone="info">{`Researching competitive prices… processed ${data.job!.processedCount} of ${data.job!.productCount} in the background${data.job!.email ? ` — we'll email ${data.job!.email} when ready` : ""}. Prices only change when you Apply.`}</Notice> : null}
        {bulk.data && bulk.data.ok === false ? <Notice tone="warn">{bulk.data.error}</Notice> : null}
        {bulk.data && bulk.data.ok ? <Notice tone="ok">{`Started research for ${bulk.data.count} products (${bulk.data.cost} credits). We'll email you when it's ready.`}</Notice> : null}
        {applyAll.data && applyAll.data.ok ? <Notice tone="ok">{`Applied ${applyAll.data.applied} prices${applyAll.data.failed ? `, ${applyAll.data.failed} failed` : ""} — live on your storefront now.`}</Notice> : null}
        {!data.hasOrdersScope ? <Notice tone="warn">Orders &amp; Conversion need the <strong>read&nbsp;orders</strong> permission. Run <code>shopify app deploy</code>, then reopen the app and approve the updated permissions.</Notice> : null}
        {!data.ads.configured ? <Notice tone="info">The <strong>Ad&nbsp;CPC</strong> column is empty — connect your Google Ads account in <PolarisLink url="/app/settings" removeUnderline>Settings → Google Ads</PolarisLink> to pull cost-per-click per product.</Notice> : null}
        {data.hasOrdersScope ? <Notice tone="info">&ldquo;Delivered&rdquo; / &ldquo;In transit&rdquo; come from Shopify&rsquo;s carrier <strong>Delivery status</strong>. &ldquo;Returned&rdquo; (RTO) is detected from Shopify&rsquo;s return status, a failed/undeliverable delivery, <strong>and the order&rsquo;s note</strong> — e.g. &ldquo;This shipment has been Returned&rdquo; — since an RTO often still reads Delivered/In&nbsp;transit. Order <strong>tags are ignored</strong> for this (an &ldquo;RTO Risk&rdquo; tag is a prediction, not a return). <strong>Revenue &amp; Profit / Loss count delivered orders only.</strong> Use <em>Export orders</em> to see each order&rsquo;s classification and why.</Notice> : null}
        {data.pnl.currencyMismatch ? <Notice tone="warn">Your Google Ads account is in <strong>{data.cpcCurrency}</strong> but your store is in <strong>{data.currency}</strong>. Ad spend can&rsquo;t be auto-converted, so Total cost &amp; Profit / Loss treat it as {data.currency} 1:1 — read the ad-spend figure with that in mind.</Notice> : null}

        {/* ── Best-Sellers auto-collection ── */}
        <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 22px", flexWrap: "wrap" }}>
            <div style={{ width: 46, height: 46, borderRadius: 14, background: "#FEF3E6", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto", fontSize: 22 }}>🏆</div>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" }}>Best-Sellers collection</div>
              <div style={{ fontSize: 13, color: CL.sub, marginTop: 3, lineHeight: 1.45 }}>
                Create an auto-updating Shopify collection of your top sellers from the last 30 days — ranked by orders <strong>net of ad cost</strong>, so ad-money-losers don&rsquo;t sneak in. It re-tags itself <strong>automatically every month</strong>, no maintenance.
              </div>
            </div>
            <button className="pr-btn" onClick={createBestSeller} disabled={bestSeller.state !== "idle" || !data.hasOrdersScope}
              title={!data.hasOrdersScope ? "Needs the read orders permission" : "Create or refresh your best-sellers collection"}
              style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 42, padding: "0 18px", border: "none", borderRadius: 12, background: "linear-gradient(135deg,#F5A623,#E0900F)", color: "#fff", fontWeight: 700, fontSize: 13.5, boxShadow: "0 6px 14px -8px rgba(224,144,15,0.7)", flex: "0 0 auto", opacity: !data.hasOrdersScope ? 0.5 : 1 }}>
              {bestSeller.state !== "idle" ? <span className="pr-spin" /> : <span style={{ fontSize: 15 }}>🏆</span>}
              {bestSeller.state !== "idle" ? "Building…" : (bestSeller.data?.ok ? "Refresh collection" : "Create collection")}
            </button>
          </div>
          {bestSeller.data && bestSeller.data.ok === false ? (
            <div style={{ padding: "0 22px 18px" }}><Notice tone="warn">{bestSeller.data.error}</Notice></div>
          ) : null}
          {bestSeller.data && bestSeller.data.ok ? (
            <div style={{ padding: "0 22px 18px" }}><Notice tone="ok">
              <strong>{bestSeller.data.created ? "Created" : "Refreshed"} your &ldquo;{bestSeller.data.title}&rdquo; collection</strong> with {bestSeller.data.count} best-selling product{bestSeller.data.count === 1 ? "" : "s"} — it&rsquo;s published to your Online Store and will update automatically each month. {bestSeller.data.removed ? `(${bestSeller.data.added} added, ${bestSeller.data.removed} dropped out this run.)` : ""}
            </Notice></div>
          ) : null}
        </div>

        <ImportSessions data={data} onViewImported={() => setRange("all")} />

        {/* ── table ── */}
        <div style={{ ...cardStyle, borderRadius: 20, boxShadow: "0 24px 50px -30px rgba(16,30,54,0.32)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "16px 22px", borderBottom: `1px solid ${CL.line2}`, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" }}>Ranked products</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: CL.sub2, background: CL.line3, padding: "3px 9px", borderRadius: 999 }}>{`${data.totalCount.toLocaleString()} by visits`}</span>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: "#B42318", background: "#FDECEC", border: "1px solid #F6D2D2", padding: "3px 9px", borderRadius: 999 }}>Each Analyze = 1 credit</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <button className="pr-btn" onClick={exportReport} disabled={exporting !== ""} style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 38, padding: "0 14px", border: `1px solid ${CL.strong}`, borderRadius: 10, background: "#fff", color: "#3A4452", fontWeight: 600, fontSize: 12.5 }}>
                {exporting === "report" ? <span className="pr-spin pr-spin-t" /> : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3A4452" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
                )}
                {exporting === "report" ? "Preparing…" : "Export report"}
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#F2F5F8", border: `1px solid ${CL.line}`, borderRadius: 10, padding: "0 12px", height: 38, width: 230, maxWidth: "100%" }}>
                <Glass size={15} color={CL.sub2} />
                <input className="pr-in" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product…" style={{ fontSize: 13, color: CL.ink, width: "100%" }} />
              </div>
            </div>
          </div>

          {/* Bulk-action bar — appears once one or more products are selected. */}
          {selected.size > 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 22px", background: CL.tealBg, borderBottom: `1px solid #C7E4DF`, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: CL.tealDeep }}>{selected.size} selected</span>
              <button className="pr-btn" onClick={markDraft} disabled={bulkStatus.state !== "idle"} style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 34, padding: "0 14px", border: "none", borderRadius: 9, background: CL.inkDeep, color: "#fff", fontWeight: 600, fontSize: 12.5 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                Mark as Draft
              </button>
              <button className="pr-btn" onClick={clearSelection} style={{ height: 34, padding: "0 12px", border: `1px solid ${CL.line}`, borderRadius: 9, background: "#fff", color: CL.sub, fontWeight: 600, fontSize: 12.5 }}>Clear</button>
              <span style={{ fontSize: 12, color: CL.tealDeep, opacity: 0.85 }}>Drafted products are hidden from your storefront &amp; ad channels.</span>
              {bulkStatus.data?.ok && bulkStatus.data.updated != null ? <span style={{ fontSize: 12, fontWeight: 600, color: CL.green }}>Updated {bulkStatus.data.updated}{bulkStatus.data.failed ? `, ${bulkStatus.data.failed} failed` : ""}.</span> : null}
            </div>
          ) : null}

          <div className="pr-scroll">
            <HeaderRow sortKey={data.sortKey} sortDir={data.sortDir} onSort={setSort} allSelected={allSelected} someSelected={someSelected} onToggleAll={toggleAll} currency={data.currency} />
            {visibleRows.length === 0 ? (
              <div style={{ padding: "34px 22px", textAlign: "center", color: CL.sub2, fontSize: 13.5 }}>{q.trim() ? "No products match your search." : "No active products found."}</div>
            ) : (
              visibleRows.map((row: any) => <PriceRow key={row.variantId} row={row} currency={data.currency} cpcCurrency={data.cpcCurrency} selected={selected.has(row.productId)} onToggleSelect={toggleSelect} onBusy={onRowBusy} />)
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "15px 22px", flexWrap: "wrap" }}>
            <div style={{ fontSize: 12.5, color: CL.sub }}>Showing <b style={{ color: "#3A4452" }}>{visibleRows.length}</b> of <b style={{ color: "#3A4452" }}>{data.totalCount.toLocaleString()}</b> active products · page {data.page} of {data.totalPages}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button className="pr-btn" onClick={() => gotoPage(data.page - 1)} disabled={data.page <= 1} style={{ height: 34, padding: "0 14px", border: "1px solid #D6DDE4", borderRadius: 9, background: "#fff", color: data.page > 1 ? "#3A4452" : CL.sub2, fontWeight: 600, fontSize: 13 }}>← Prev</button>
              <button className="pr-btn" onClick={() => gotoPage(data.page + 1)} disabled={data.page >= data.totalPages} style={{ height: 34, padding: "0 15px", border: "1px solid #D6DDE4", borderRadius: 9, background: "#fff", color: data.page < data.totalPages ? "#3A4452" : CL.sub2, fontWeight: 600, fontSize: 13 }}>Next →</button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
