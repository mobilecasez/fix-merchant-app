import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useState } from "react";
import {
  Page, Layout, Card, BlockStack, InlineStack, InlineGrid, Text, Badge, Button, Box, Divider,
} from "@shopify/polaris";
import { authenticate, unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { requireAppAdmin } from "../utils/admin-access.server";
import { summarizeScanResult, type ScanSummary } from "../utils/store-scanner.server";

// ── Owner-only cross-store analytics: installs, who installed (store name + domain +
//    email), plan, and everything each store has done — with full scan-issue breakdowns
//    and product-import field reports. Gated by admin-access.server (404 otherwise). ──

type Ev = { at: number; type: string; label: string };
type ScanRow = ScanSummary & { at: number; status: string };
type ImportRow = { at: number; success: boolean; productName: string; sourceUrl: string; missingFields: string[]; fetched: any };
const MAX_LIVE_META = 30; // cap live shop{name,domain,email} fetches per load to bound latency/throttle

const TYPE_META: Record<string, { label: string; tone: "success" | "info" | "attention" | "warning" | "new" }> = {
  profit_report: { label: "Profit report", tone: "info" },
  campaign_plan: { label: "Ad campaign", tone: "info" },
  campaign_fix: { label: "Campaign fix", tone: "attention" },
  bestseller_collection: { label: "Best-sellers", tone: "success" },
  store_scan: { label: "Store scan", tone: "attention" },
  price_apply: { label: "Price applied", tone: "success" },
  price_research: { label: "Price research", tone: "info" },
  product_import: { label: "Product import", tone: "new" },
  ads_connected: { label: "Ads connected", tone: "success" },
  monitor: { label: "Monitor run", tone: "attention" },
  review: { label: "Review", tone: "new" },
  subscribed: { label: "Subscription", tone: "success" },
  install: { label: "Installed", tone: "success" },
};

const FR_STATUS: Record<string, { label: string; tone: "success" | "info" | "attention" | "warning" | "new" | undefined }> = {
  open: { label: "Open", tone: "info" },
  planned: { label: "Planned", tone: "attention" },
  in_progress: { label: "In progress", tone: "new" },
  done: { label: "Done", tone: "success" },
  declined: { label: "Declined", tone: "warning" },
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  await requireAppAdmin(request, session.shop); // throws 404 for non-admins

  // Pull every shop-keyed source once, then group in memory (fast for a few hundred shops).
  const [
    sessions, appSettings, subs, aiReports, storeScans, priceJobs, priceResearch,
    usage, ads, monitors, reviews, events, bestSellers, featureReqs,
  ] = await Promise.all([
    prisma.session.findMany({ where: { isOnline: false }, select: { shop: true } }),
    prisma.appSettings.findMany({ select: { shop: true, createdAt: true, updatedAt: true, storeDetails: true } }),
    prisma.shopSubscription.findMany({ include: { plan: true } }),
    prisma.aiReport.findMany({ select: { shop: true, kind: true, updatedAt: true } }),
    // Full result included so we can summarize issue breakdowns for the admin timeline
    // (the result payload never leaves the server — only the compact summary is sent).
    prisma.storeScan.findMany({ orderBy: { createdAt: "desc" }, take: 600, select: { shop: true, type: true, status: true, result: true, createdAt: true } }),
    prisma.priceBatchJob.findMany({ select: { shop: true, productCount: true, createdAt: true } }),
    prisma.productPriceResearch.findMany({ where: { status: "applied" }, select: { shop: true, appliedAt: true } }),
    prisma.usageHistory.findMany({ select: { shop: true, productsCreated: true, date: true } }),
    prisma.googleAdsSettings.findMany({ select: { shop: true, enabled: true, updatedAt: true } }),
    prisma.storeMonitor.findMany({ select: { shop: true, enabled: true, lastRunAt: true } }),
    prisma.shopReview.findMany({ select: { shop: true, rating: true, updatedAt: true } }),
    prisma.activityEvent.findMany({ orderBy: { createdAt: "desc" }, take: 5000, select: { shop: true, type: true, label: true, meta: true, createdAt: true } }),
    prisma.bestSellerCollection.findMany({ select: { shop: true, lastCount: true, lastRunAt: true, createdAt: true } }),
    prisma.featureRequest.findMany({ orderBy: { createdAt: "desc" }, take: 300, select: { id: true, title: true, description: true, status: true, createdByShop: true, createdAt: true, _count: { select: { votes: true } } } }),
  ]);

  const shops = new Set<string>();
  sessions.forEach((s) => shops.add(s.shop));
  appSettings.forEach((s) => shops.add(s.shop));
  storeScans.forEach((s) => shops.add(s.shop));
  events.forEach((s) => shops.add(s.shop));

  // index helpers
  function byShop<T extends { shop: string }>(rows: T[]): Map<string, T[]> {
    const m = new Map<string, T[]>();
    for (const r of rows) { const a = m.get(r.shop); if (a) a.push(r); else m.set(r.shop, [r]); }
    return m;
  }
  const settingsMap = new Map(appSettings.map((s) => [s.shop, s]));
  const subMap = new Map(subs.map((s) => [s.shop, s]));
  const reportsBy = byShop(aiReports);
  const scansBy = byShop(storeScans);
  const jobsBy = byShop(priceJobs);
  const researchBy = byShop(priceResearch);
  const usageBy = byShop(usage);
  const adsMap = new Map(ads.map((a) => [a.shop, a]));
  const monitorMap = new Map(monitors.map((m) => [m.shop, m]));
  const reviewMap = new Map(reviews.map((r) => [r.shop, r]));
  const eventsBy = byShop(events);
  const bestMap = new Map(bestSellers.map((b) => [b.shop, b]));

  // Resolve shop name/domain/email — from cached AppSettings.storeDetails.__meta, else live (capped).
  let liveFetches = 0;
  async function shopMeta(shop: string): Promise<{ name: string; email: string; domain: string; domainUrl: string }> {
    const cached: any = (settingsMap.get(shop)?.storeDetails as any)?.__meta;
    // `domain` was added later — treat an old cache that predates it as stale so we backfill it.
    const fresh = cached?.fetchedAt && Date.now() - new Date(cached.fetchedAt).getTime() < 7 * 864e5 && cached.domain !== undefined;
    if (fresh) return { name: cached.name || "", email: cached.email || "", domain: cached.domain || "", domainUrl: cached.domainUrl || "" };
    if (liveFetches >= MAX_LIVE_META) return { name: cached?.name || "", email: cached?.email || "", domain: cached?.domain || "", domainUrl: cached?.domainUrl || "" };
    liveFetches++;
    try {
      const { admin } = await unauthenticated.admin(shop);
      const r = await admin.graphql(`#graphql query { shop { name email primaryDomain { host url } } }`);
      const d = await r.json();
      const s = d?.data?.shop;
      const meta = {
        name: s?.name || "",
        email: s?.email || "",
        domain: s?.primaryDomain?.host || "",
        domainUrl: s?.primaryDomain?.url || "",
        fetchedAt: new Date().toISOString(),
      };
      const prev = (settingsMap.get(shop)?.storeDetails as any) || {};
      await prisma.appSettings.updateMany({ where: { shop }, data: { storeDetails: { ...prev, __meta: meta } } }).catch(() => {});
      return { name: meta.name, email: meta.email, domain: meta.domain, domainUrl: meta.domainUrl };
    } catch {
      return { name: cached?.name || "", email: cached?.email || "", domain: cached?.domain || "", domainUrl: cached?.domainUrl || "" };
    }
  }

  const now = Date.now();
  const rows = await Promise.all([...shops].map(async (shop) => {
    const st = settingsMap.get(shop);
    const sub = subMap.get(shop);
    const reports = reportsBy.get(shop) || [];
    const scans = scansBy.get(shop) || [];
    const jobs = jobsBy.get(shop) || [];
    const applied = researchBy.get(shop) || [];
    const usageRows = usageBy.get(shop) || [];
    const adRow = adsMap.get(shop);
    const mon = monitorMap.get(shop);
    const rev = reviewMap.get(shop);
    const evs = eventsBy.get(shop) || [];
    const best = bestMap.get(shop);
    const meta = await shopMeta(shop);

    // ── Per-scan issue breakdowns (summarized from StoreScan.result) ──
    const scanRows: ScanRow[] = scans
      .filter((s) => s.status !== "NEEDS_PASSWORD")
      .map((s) => {
        const summary = summarizeScanResult(s.type, s.result || {});
        return { ...summary, at: new Date(s.createdAt).getTime(), status: s.status };
      })
      .sort((a, b) => b.at - a.at);
    const issuesFound = scanRows.reduce((n, s) => n + (s.totalIssues || 0), 0);
    const autofixableFound = scanRows.reduce((n, s) => n + (s.autofixable || 0), 0);

    // ── Product-import field reports (from ActivityEvent meta) ──
    const importRows: ImportRow[] = evs
      .filter((e) => e.type === "product_import" && e.meta && typeof e.meta === "object")
      .map((e) => {
        const m: any = e.meta;
        return {
          at: new Date(e.createdAt).getTime(),
          success: !!m.success,
          productName: String(m.productName || ""),
          sourceUrl: String(m.sourceUrl || ""),
          missingFields: Array.isArray(m.missingFields) ? m.missingFields : [],
          fetched: m.fetched || {},
        };
      })
      .sort((a, b) => b.at - a.at);
    const importsOk = importRows.filter((i) => i.success).length;

    // Build a merged activity timeline (precise ActivityEvent rows + derived milestones).
    const timeline: Ev[] = [];
    const push = (at: Date | number | string | null | undefined, type: string, label: string) => { if (at) timeline.push({ at: new Date(at).getTime(), type, label }); };
    // ActivityEvent rows — but product_import & store_scan are shown in their own detailed
    // sections, so keep the timeline to the other event types to avoid duplication.
    evs.filter((e) => e.type !== "product_import").forEach((e) => push(e.createdAt, e.type, e.label || TYPE_META[e.type]?.label || e.type));
    reports.forEach((r) => push(r.updatedAt, r.kind === "campaign_plan" ? "campaign_plan" : "profit_report", r.kind === "campaign_plan" ? "Built a Google Ads campaign plan" : "Generated an AI profit report"));
    scanRows.forEach((s) => push(s.at, "store_scan", `${s.scanType} scan · ${s.totalIssues} issue${s.totalIssues === 1 ? "" : "s"}${s.status !== "COMPLETE" ? ` (${String(s.status).toLowerCase()})` : ""}`));
    jobs.forEach((j) => push(j.createdAt, "price_research", `Bulk price research · ${j.productCount} products`));
    if (applied.length) { const last = Math.max(0, ...applied.map((a) => (a.appliedAt ? new Date(a.appliedAt).getTime() : 0))); if (last) push(last, "price_apply", `Applied competitive prices · ${applied.length}`); }
    const importedTotal = usageRows.reduce((s, u) => s + (u.productsCreated || 0), 0);
    if (adRow?.enabled) push(adRow.updatedAt, "ads_connected", "Connected Google Ads");
    if (mon?.enabled) push(mon.lastRunAt || undefined, "monitor", "Store monitor active");
    if (rev && rev.rating > 0) push(rev.updatedAt, "review", `Left a ${rev.rating}★ review`); // rating 0 = prompt dismissed without rating — not a real review
    if (best) push(best.lastRunAt || best.createdAt, "bestseller_collection", `Best-sellers collection · ${best.lastCount} products`);
    if (sub) push(sub.createdAt, "subscribed", `Subscribed · ${sub.plan?.name || "plan"}`);
    if (st) push(st.createdAt, "install", "Installed ShopFlix AI");
    timeline.sort((a, b) => b.at - a.at);

    const lastActiveCandidates = [
      timeline.length ? timeline[0].at : 0,
      scanRows.length ? scanRows[0].at : 0,
      importRows.length ? importRows[0].at : 0,
    ];
    const lastActive = Math.max(0, ...lastActiveCandidates) || (st ? new Date(st.updatedAt).getTime() : 0);
    const installedAt = st ? new Date(st.createdAt).getTime() : (timeline.length ? timeline[timeline.length - 1].at : 0);
    const activityCount = evs.length + reports.length + scanRows.length + jobs.length + (applied.length ? 1 : 0) + (importedTotal > 0 ? 1 : 0);

    return {
      shop,
      name: meta.name || shop.replace(/\.myshopify\.com$/, ""),
      domain: meta.domain || "",
      domainUrl: meta.domainUrl || (meta.domain ? `https://${meta.domain}` : ""),
      email: meta.email || "",
      plan: sub?.plan?.name || (sub?.status === "active" ? "Active" : "Free"),
      planStatus: sub?.status || "free",
      installedAt, lastActive,
      counts: {
        reports: reports.length,
        scans: scanRows.length,
        issuesFound,
        autofixableFound,
        priceJobs: jobs.length,
        pricesApplied: applied.length,
        productsImported: importedTotal,
        imports: importRows.length,
        importsOk,
        adsConnected: !!adRow?.enabled,
        bestSellers: best?.lastCount || 0,
      },
      activityCount,
      timeline: timeline.slice(0, 40),
      scans: scanRows.slice(0, 15),
      imports: importRows.slice(0, 20),
    };
  }));

  rows.sort((a, b) => b.lastActive - a.lastActive);

  const active30 = rows.filter((r) => r.lastActive > now - 30 * 864e5).length;
  const totals = {
    installs: rows.length,
    active30,
    reports: rows.reduce((s, r) => s + r.counts.reports, 0),
    scans: rows.reduce((s, r) => s + r.counts.scans, 0),
    issuesFound: rows.reduce((s, r) => s + r.counts.issuesFound, 0),
    imports: rows.reduce((s, r) => s + r.counts.imports, 0),
    importsOk: rows.reduce((s, r) => s + r.counts.importsOk, 0),
    campaigns: aiReports.filter((r) => r.kind === "campaign_plan").length,
    bestSellerCollections: bestSellers.length,
    adsConnected: rows.filter((r) => r.counts.adsConnected).length,
    paying: rows.filter((r) => r.planStatus === "active").length,
  };

  const recent: Array<Ev & { shop: string; name: string; domain: string }> = [];
  for (const r of rows) for (const e of r.timeline.slice(0, 6)) recent.push({ ...e, shop: r.shop, name: r.name, domain: r.domain });
  recent.sort((a, b) => b.at - a.at);

  // Feature requests — WHO asked (store name/domain/email) + WHEN + votes + status.
  const metaByShop = new Map(rows.map((r) => [r.shop, { name: r.name, email: r.email, domain: r.domain }]));
  const featureRequests = featureReqs.map((f: any) => {
    const m = metaByShop.get(f.createdByShop);
    return {
      id: f.id, title: f.title, description: f.description, status: f.status,
      votes: f._count?.votes || 0,
      createdAt: new Date(f.createdAt).getTime(),
      shop: f.createdByShop,
      creatorName: m?.name || f.createdByShop.replace(/\.myshopify\.com$/, ""),
      creatorEmail: m?.email || "",
      creatorDomain: m?.domain || "",
    };
  });

  return json({ rows, totals, recent: recent.slice(0, 50), featureRequests, generatedAt: Date.now(), liveFetches });
}

// ── UI ────────────────────────────────────────────────────────────────────────
function fmtDate(ms: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function fmtDateTime(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function ago(ms: number): string {
  if (!ms) return "—";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  if (d < 30) return `${d}d ago`;
  return fmtDate(ms);
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" tone="subdued" variant="bodySm">{label}</Text>
        <Text as="p" variant="headingLg" fontWeight="bold">{typeof value === "number" ? value.toLocaleString() : value}</Text>
      </BlockStack>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <Box background="bg-surface-secondary" padding="200" borderRadius="200">
      <Text as="p" variant="headingMd" fontWeight="bold">{typeof value === "number" ? value.toLocaleString() : value}</Text>
      <Text as="p" tone="subdued" variant="bodySm">{label}</Text>
    </Box>
  );
}

const SEV_COLOR: Record<string, string> = { High: "#d72c0d", Medium: "#b98900", Low: "#6b7280" };
function Pill({ text, bg, color }: { text: string; bg: string; color: string }) {
  return <span style={{ background: bg, color, fontSize: 11, fontWeight: 700, padding: "1px 8px", borderRadius: 10, whiteSpace: "nowrap" }}>{text}</span>;
}

function ScanDetail({ scans }: { scans: ScanRow[] }) {
  if (!scans.length) return <Text as="p" tone="subdued" variant="bodySm">No scans run yet.</Text>;
  return (
    <BlockStack gap="300">
      {scans.map((s, i) => (
        <Box key={i} background="bg-surface-secondary" padding="300" borderRadius="200">
          <BlockStack gap="200">
            <InlineStack gap="200" align="space-between" blockAlign="center" wrap>
              <InlineStack gap="200" blockAlign="center" wrap>
                <Badge tone="attention">{s.scanType || "SCAN"}</Badge>
                {s.status !== "COMPLETE" ? <Badge tone={s.status === "FAILED" ? "critical" : undefined}>{String(s.status).toLowerCase()}</Badge> : null}
                <Text as="span" variant="bodySm" fontWeight="semibold">{s.totalIssues} issue{s.totalIssues === 1 ? "" : "s"}</Text>
                {s.overallRisk ? <Pill text={`${s.overallRisk} risk`} bg="#fdeceb" color="#b42318" /> : null}
              </InlineStack>
              <Text as="span" tone="subdued" variant="bodySm">{fmtDateTime(s.at)}</Text>
            </InlineStack>
            <InlineStack gap="150" wrap>
              {s.severity.High > 0 ? <Pill text={`${s.severity.High} High`} bg="#fdeceb" color={SEV_COLOR.High} /> : null}
              {s.severity.Medium > 0 ? <Pill text={`${s.severity.Medium} Medium`} bg="#fdf3d8" color={SEV_COLOR.Medium} /> : null}
              {s.severity.Low > 0 ? <Pill text={`${s.severity.Low} Low`} bg="#f1f2f4" color={SEV_COLOR.Low} /> : null}
              {s.autofixable > 0 ? <Pill text={`${s.autofixable} auto-fixable`} bg="#e8f6ef" color="#0c6b47" /> : null}
              {s.affectedProducts != null ? <Pill text={`${s.affectedProducts} products affected`} bg="#eef1ff" color="#3b4ce2" /> : null}
              {s.pagesScanned != null ? <Pill text={`${s.pagesScanned} pages scanned`} bg="#f1f2f4" color="#5c6570" /> : null}
            </InlineStack>
            {Object.keys(s.byCategory).length ? (
              <InlineStack gap="150" wrap>
                {Object.entries(s.byCategory).map(([cat, n]) => (
                  <Text key={cat} as="span" variant="bodySm" tone="subdued">{cat}: <b style={{ color: "#1a1c1e" }}>{n}</b></Text>
                ))}
              </InlineStack>
            ) : null}
            {s.samples.length ? (
              <details>
                <summary style={{ cursor: "pointer", fontSize: 12.5, color: "#5c6570" }}>Sample issues ({s.samples.length})</summary>
                <BlockStack gap="100">
                  {s.samples.map((it, j) => (
                    <InlineStack key={j} gap="150" blockAlign="start" wrap={false}>
                      <span style={{ marginTop: 2 }}><Pill text={it.severity} bg="#f1f2f4" color={SEV_COLOR[it.severity] || "#5c6570"} /></span>
                      <Text as="span" variant="bodySm">
                        {it.title}
                        {it.product ? <span style={{ color: "#8a94a2" }}> — {it.product}</span> : null}
                        {it.autofixable ? <span style={{ color: "#0c6b47", fontWeight: 600 }}> · auto-fixable</span> : null}
                      </Text>
                    </InlineStack>
                  ))}
                </BlockStack>
              </details>
            ) : null}
          </BlockStack>
        </Box>
      ))}
    </BlockStack>
  );
}

const IMPORT_FIELDS: Array<{ key: string; label: string }> = [
  { key: "title", label: "Title" }, { key: "description", label: "Description" },
  { key: "vendor", label: "Vendor" }, { key: "productType", label: "Type" },
  { key: "tags", label: "Tags" }, { key: "price", label: "Price" },
  { key: "compareAtPrice", label: "Compare-at" }, { key: "sku", label: "SKU" },
  { key: "barcode", label: "Barcode" }, { key: "weight", label: "Weight" },
];
function shortUrl(u: string): string {
  try { const x = new URL(u); return (x.hostname + x.pathname).replace(/\/$/, "").slice(0, 48); } catch { return String(u || "").slice(0, 48); }
}
function ImportDetail({ imports }: { imports: ImportRow[] }) {
  if (!imports.length) return <Text as="p" tone="subdued" variant="bodySm">No product imports recorded yet.</Text>;
  return (
    <BlockStack gap="300">
      {imports.map((im, i) => {
        const f = im.fetched || {};
        return (
          <Box key={i} background="bg-surface-secondary" padding="300" borderRadius="200">
            <BlockStack gap="200">
              <InlineStack gap="200" align="space-between" blockAlign="center" wrap>
                <InlineStack gap="200" blockAlign="center" wrap>
                  <Badge tone={im.success ? "success" : "warning"}>{im.success ? "Fetched OK" : "Incomplete"}</Badge>
                  <Text as="span" variant="bodySm" fontWeight="semibold">{im.productName || "(untitled)"}</Text>
                </InlineStack>
                <Text as="span" tone="subdued" variant="bodySm">{fmtDateTime(im.at)}</Text>
              </InlineStack>
              {im.sourceUrl && im.sourceUrl !== "manual-upload" ? (
                <a href={im.sourceUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#3b4ce2", wordBreak: "break-all" }}>{shortUrl(im.sourceUrl)}</a>
              ) : <Text as="span" variant="bodySm" tone="subdued">manual upload</Text>}
              <InlineStack gap="100" wrap>
                {IMPORT_FIELDS.map((fld) => {
                  const ok = !!f[fld.key];
                  return <Pill key={fld.key} text={`${ok ? "✓" : "✕"} ${fld.label}`} bg={ok ? "#e8f6ef" : "#fdeceb"} color={ok ? "#0c6b47" : "#b42318"} />;
                })}
                <Pill text={`${f.images || 0} images`} bg={f.images ? "#e8f6ef" : "#fdeceb"} color={f.images ? "#0c6b47" : "#b42318"} />
                {f.variants ? <Pill text={`${f.variants} variants`} bg="#eef1ff" color="#3b4ce2" /> : null}
                {f.options ? <Pill text={`${f.options} options`} bg="#eef1ff" color="#3b4ce2" /> : null}
              </InlineStack>
              {im.missingFields.length ? (
                <Text as="span" variant="bodySm" tone="critical">Missing: {im.missingFields.join(", ")}</Text>
              ) : null}
            </BlockStack>
          </Box>
        );
      })}
    </BlockStack>
  );
}

function StoreSection({ r, open, onToggle }: { r: any; open: boolean; onToggle: () => void }) {
  return (
    <Card>
      <BlockStack gap="0">
        {/* Header — always visible */}
        <div style={{ cursor: "pointer" }} onClick={onToggle}>
          <InlineStack gap="300" align="space-between" blockAlign="center" wrap>
            <BlockStack gap="050">
              <InlineStack gap="200" blockAlign="center" wrap>
                <Text as="h3" variant="headingSm">{r.name}</Text>
                <Badge tone={r.planStatus === "active" ? "success" : undefined}>{r.plan}</Badge>
                {r.counts.adsConnected ? <Badge tone="info">Ads</Badge> : null}
              </InlineStack>
              <InlineStack gap="200" blockAlign="center" wrap>
                {r.domainUrl ? (
                  <a href={r.domainUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ fontSize: 12.5, color: "#3b4ce2", fontWeight: 600 }}>{r.domain || r.domainUrl}</a>
                ) : <Text as="span" tone="subdued" variant="bodySm">{r.shop}</Text>}
                <Text as="span" tone="subdued" variant="bodySm">· {r.shop}</Text>
                {r.email ? <Text as="span" tone="subdued" variant="bodySm">· {r.email}</Text> : null}
              </InlineStack>
            </BlockStack>
            <InlineStack gap="300" blockAlign="center" wrap={false}>
              <BlockStack gap="0">
                <Text as="span" variant="bodySm" alignment="end" fontWeight="semibold">{ago(r.lastActive)}</Text>
                <Text as="span" variant="bodySm" tone="subdued" alignment="end">{r.activityCount} actions</Text>
              </BlockStack>
              <Button variant="tertiary" size="slim" disclosure={open ? "up" : "down"} onClick={(e?: any) => { e?.stopPropagation?.(); onToggle(); }}>{open ? "Hide" : "Details"}</Button>
            </InlineStack>
          </InlineStack>
        </div>

        {open ? (
          <BlockStack gap="300">
            <Box paddingBlockStart="300"><Divider /></Box>
            <InlineGrid columns={{ xs: 2, sm: 3, md: 6 }} gap="200">
              <MiniStat label="Scans" value={r.counts.scans} />
              <MiniStat label="Issues found" value={r.counts.issuesFound} />
              <MiniStat label="Auto-fixable" value={r.counts.autofixableFound} />
              <MiniStat label="Imports" value={r.counts.imports} />
              <MiniStat label="Products" value={r.counts.productsImported} />
              <MiniStat label="Reports" value={r.counts.reports} />
              <MiniStat label="Price jobs" value={r.counts.priceJobs} />
              <MiniStat label="Prices applied" value={r.counts.pricesApplied} />
              <MiniStat label="Best-sellers" value={r.counts.bestSellers} />
              <MiniStat label="Installed" value={fmtDate(r.installedAt)} />
            </InlineGrid>

            <Layout>
              <Layout.Section variant="oneHalf">
                <BlockStack gap="200">
                  <Text as="h4" variant="headingSm">Store scans — issues detected</Text>
                  <ScanDetail scans={r.scans} />
                </BlockStack>
              </Layout.Section>
              <Layout.Section variant="oneHalf">
                <BlockStack gap="200">
                  <Text as="h4" variant="headingSm">Product imports — fields fetched</Text>
                  <ImportDetail imports={r.imports} />
                </BlockStack>
              </Layout.Section>
            </Layout>

            <Divider />
            <Text as="h4" variant="headingSm">Activity timeline</Text>
            <BlockStack gap="150">
              {r.timeline.length === 0 ? <Text as="p" tone="subdued" variant="bodySm">No recorded activity yet.</Text> : null}
              {r.timeline.map((e: Ev, i: number) => {
                const m = TYPE_META[e.type] || { label: e.type, tone: "info" as const };
                return (
                  <InlineStack key={i} gap="200" align="space-between" blockAlign="center" wrap={false}>
                    <InlineStack gap="200" blockAlign="center" wrap={false}>
                      <Badge tone={m.tone}>{m.label}</Badge>
                      <Text as="span" variant="bodySm">{e.label}</Text>
                    </InlineStack>
                    <Text as="span" tone="subdued" variant="bodySm">{ago(e.at)}</Text>
                  </InlineStack>
                );
              })}
            </BlockStack>
          </BlockStack>
        ) : null}
      </BlockStack>
    </Card>
  );
}

export default function AdminAnalytics() {
  const { rows, totals, recent, featureRequests, generatedAt } = useLoaderData<typeof loader>();
  const [openShops, setOpenShops] = useState<Set<string>>(() => new Set(rows[0] ? [rows[0].shop] : []));
  const [query, setQuery] = useState("");

  const toggle = (shop: string) => setOpenShops((prev) => {
    const n = new Set(prev);
    if (n.has(shop)) n.delete(shop); else n.add(shop);
    return n;
  });
  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter((r) => [r.name, r.shop, r.domain, r.email].some((v) => String(v || "").toLowerCase().includes(q)))
    : rows;

  const importRate = totals.imports ? Math.round((totals.importsOk / totals.imports) * 100) : 0;

  return (
    <Page
      title="ShopFlix Admin — Analytics"
      subtitle={`${totals.installs} installs · ${totals.active30} active in the last 30 days · updated ${ago(generatedAt)}`}
    >
      <BlockStack gap="400">
        {/* KPI row */}
        <InlineGrid columns={{ xs: 2, sm: 3, md: 5 }} gap="300">
          <Stat label="Total installs" value={totals.installs} />
          <Stat label="Active (30 days)" value={totals.active30} />
          <Stat label="Paying stores" value={totals.paying} />
          <Stat label="Store scans run" value={totals.scans} />
          <Stat label="Issues detected" value={totals.issuesFound} />
          <Stat label="Product imports" value={totals.imports} />
          <Stat label="Import success" value={`${importRate}%`} />
          <Stat label="Google Ads connected" value={totals.adsConnected} />
          <Stat label="Profit reports" value={totals.reports} />
          <Stat label="Best-seller collections" value={totals.bestSellerCollections} />
        </InlineGrid>

        {/* Per-store sections (sorted by last activity, descending) */}
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="300" align="space-between" blockAlign="center" wrap>
              <Text as="h2" variant="headingMd">Stores — by most recent activity</Text>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search store, domain, email…"
                style={{ padding: "6px 10px", border: "1px solid #d2d5d9", borderRadius: 8, fontSize: 13, minWidth: 220 }}
              />
            </InlineStack>
            {filtered.length === 0 ? (
              <Text as="p" tone="subdued">No stores match “{query}”.</Text>
            ) : (
              <BlockStack gap="200">
                {filtered.map((r) => (
                  <StoreSection key={r.shop} r={r} open={openShops.has(r.shop)} onToggle={() => toggle(r.shop)} />
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>

        {/* Global recent activity */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Recent activity — all stores</Text>
            <BlockStack gap="150">
              {recent.map((e, i) => {
                const m = TYPE_META[e.type] || { label: e.type, tone: "info" as const };
                return (
                  <InlineStack key={i} gap="200" align="space-between" blockAlign="center" wrap={false}>
                    <InlineStack gap="200" blockAlign="center" wrap={false}>
                      <Badge tone={m.tone}>{m.label}</Badge>
                      <Text as="span" variant="bodySm" fontWeight="semibold">{e.name}</Text>
                      {e.domain ? <Text as="span" variant="bodySm" tone="subdued">({e.domain})</Text> : null}
                      <Text as="span" variant="bodySm" tone="subdued">{e.label}</Text>
                    </InlineStack>
                    <Text as="span" tone="subdued" variant="bodySm">{ago(e.at)}</Text>
                  </InlineStack>
                );
              })}
              {recent.length === 0 ? <Text as="p" tone="subdued" variant="bodySm">No activity recorded yet.</Text> : null}
            </BlockStack>
          </BlockStack>
        </Card>

        {/* Feature requests — who asked, when, votes, status */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Feature requests ({featureRequests.length})</Text>
            <div style={{ overflowX: "auto", margin: "0 -16px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#6b7280", fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    <th style={{ padding: "10px 16px" }}>Request</th>
                    <th style={{ padding: "10px 8px" }}>Requested by</th>
                    <th style={{ padding: "10px 8px" }}>When</th>
                    <th style={{ padding: "10px 8px", textAlign: "center" }}>Votes</th>
                    <th style={{ padding: "10px 16px" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {featureRequests.map((f) => {
                    const st = FR_STATUS[f.status] || { label: f.status, tone: undefined };
                    return (
                      <tr key={f.id} style={{ borderTop: "1px solid #f1f2f4", verticalAlign: "top" }}>
                        <td style={{ padding: "12px 16px", maxWidth: 380 }}>
                          <div style={{ fontWeight: 600, color: "#1a1c1e" }}>{f.title}</div>
                          {f.description ? <div style={{ color: "#5c6570", fontSize: 12, marginTop: 2, lineHeight: 1.45 }}>{f.description.length > 180 ? f.description.slice(0, 180) + "…" : f.description}</div> : null}
                        </td>
                        <td style={{ padding: "12px 8px" }}>
                          <div style={{ fontWeight: 600, color: "#1a1c1e" }}>{f.creatorName}</div>
                          {f.creatorDomain ? <div style={{ color: "#3b4ce2", fontSize: 12 }}>{f.creatorDomain}</div> : null}
                          {f.creatorEmail ? <div style={{ color: "#5c6570", fontSize: 12 }}>{f.creatorEmail}</div> : null}
                          <div style={{ color: "#8a94a2", fontSize: 11.5 }}>{f.shop}</div>
                        </td>
                        <td style={{ padding: "12px 8px", color: "#5c6570", whiteSpace: "nowrap" }}>{fmtDate(f.createdAt)}<div style={{ fontSize: 11, color: "#8a94a2" }}>{ago(f.createdAt)}</div></td>
                        <td style={{ padding: "12px 8px", textAlign: "center", fontWeight: 700 }}>{f.votes}</td>
                        <td style={{ padding: "12px 16px" }}><Badge tone={st.tone as any}>{st.label}</Badge></td>
                      </tr>
                    );
                  })}
                  {featureRequests.length === 0 ? <tr><td colSpan={5} style={{ padding: 24, textAlign: "center", color: "#8a94a2" }}>No feature requests yet.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
