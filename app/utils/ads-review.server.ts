import prisma from "../db.server";
import { getAccessToken, searchStream, adsMutate, type AdsCreds } from "./google-ads.server";

// Live Performance Max REVIEW + one-click FIX engine. Pulls each enabled PMax campaign's real
// numbers, scores them against the store's breakeven ROAS, and proposes a concrete fix (lower an
// unreachable tROAS, pause a money-loser, scale a starved winner) that applyCampaignFix() pushes
// straight to Google Ads. Diagnosis logic mirrors the manual analysis: a tROAS above what the
// campaign actually delivers makes Google throttle serving → high cost, low sales.

const n = (v: any) => Number(v || 0);
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const CAMP_Q = (during: string) => `
SELECT campaign.resource_name, campaign.id, campaign.name, campaign.status,
       campaign.bidding_strategy_type, campaign.maximize_conversion_value.target_roas,
       campaign_budget.resource_name, campaign_budget.amount_micros,
       metrics.cost_micros, metrics.conversions, metrics.conversions_value,
       metrics.impressions, metrics.clicks
FROM campaign
WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
  AND campaign.status IN ('ENABLED','PAUSED')
  AND segments.date DURING ${during}`;

interface Row {
  resourceName: string; id: string; name: string; status: string; bidding: string;
  targetRoas: number | null; budgetResource: string; dailyBudget: number;
  cost: number; conv: number; convValue: number; impressions: number; clicks: number;
}

function parse(rows: any[]): Map<string, Row> {
  const m = new Map<string, Row>();
  for (const r of rows) {
    const rn = r?.campaign?.resourceName;
    if (!rn) continue;
    const cur = m.get(rn) || {
      resourceName: rn, id: String(r?.campaign?.id || ""), name: r?.campaign?.name || "", status: r?.campaign?.status,
      bidding: r?.campaign?.biddingStrategyType, targetRoas: r?.campaign?.maximizeConversionValue?.targetRoas ?? null,
      budgetResource: r?.campaignBudget?.resourceName || "", dailyBudget: n(r?.campaignBudget?.amountMicros) / 1e6,
      cost: 0, conv: 0, convValue: 0, impressions: 0, clicks: 0,
    };
    cur.cost += n(r?.metrics?.costMicros) / 1e6;
    cur.conv += n(r?.metrics?.conversions);
    cur.convValue += n(r?.metrics?.conversionsValue);
    cur.impressions += n(r?.metrics?.impressions);
    cur.clicks += n(r?.metrics?.clicks);
    m.set(rn, cur);
  }
  return m;
}

export type FixType = "lower_troas" | "remove_troas" | "pause" | "raise_budget" | "lower_budget";
export interface Fix { type: FixType; label: string; current: number | string; next: number; resourceName: string; budgetResource?: string; }
export interface CampaignHealth {
  resourceName: string; name: string; status: string; isShopFlix: boolean; ageDays: number | null;
  dailyBudget: number; targetRoas: number | null;
  cost7: number; conv7: number; roas7: number | null; cpa7: number | null; budgetUtil: number; impressions7: number; ctr7: number | null;
  roas30: number | null; conv30: number;
  verdict: "throttled" | "inefficient" | "starved" | "learning" | "healthy" | "paused";
  severity: "high" | "medium" | "low" | "ok";
  finding: string;
  fix: Fix | null;
}
export interface ReviewResult {
  ok: boolean; error?: string; currency?: string; breakeven?: number;
  campaigns?: CampaignHealth[];
  summary?: { total: number; issues: number; enabled: number };
  generatedAt?: number;
}

async function storeBreakeven(shop: string): Promise<number> {
  const s = await prisma.priceRadarSettings.findUnique({ where: { shop } }).catch(() => null);
  const cogs = (s?.assumedCogsPct ?? 50) / 100;
  const fee = (s?.paymentFeePct ?? 2) / 100;
  const margin = 1 - cogs - fee;
  return clamp(margin > 0.05 ? 1 / margin : 3, 1.5, 6);
}

function analyze(row: Row, be: number, currency: string, meta?: { isShopFlix: boolean; ageDays: number | null }): CampaignHealth {
  const cost7 = r2(row.cost);
  const conv7 = r2(row.conv);
  const value7 = row.convValue;
  const spentPerDay = cost7 / 7;
  const budgetUtil = row.dailyBudget > 0 ? clamp(spentPerDay / row.dailyBudget, 0, 1) : 0;
  const roas7 = cost7 > 0 ? r2(value7 / cost7) : null;
  const cpa7 = conv7 > 0 ? Math.round(cost7 / conv7) : null;
  const ctr7 = row.impressions > 0 ? r2((row.clicks / row.impressions) * 100) : null;
  const roas = roas7;
  const t = row.targetRoas;
  const ageDays = meta?.ageDays ?? null;
  const isShopFlix = meta?.isShopFlix ?? false;

  const base = {
    resourceName: row.resourceName, name: row.name, status: row.status, isShopFlix, ageDays,
    dailyBudget: r2(row.dailyBudget), targetRoas: t != null ? r1(t) : null,
    cost7, conv7, roas7, cpa7, budgetUtil: r2(budgetUtil), impressions7: row.impressions, ctr7,
    roas30: null as number | null, conv30: 0,
  };

  if (row.status !== "ENABLED") {
    return { ...base, verdict: "paused", severity: "ok", finding: "Paused — not spending. Enable it (or delete it) to review.", fix: null };
  }

  const cur = currency ? currency + " " : "";
  const pct = Math.round(budgetUtil * 100);

  // 1) LOSING MONEY — below breakeven with real spend → pause or cut budget (highest priority).
  if (cost7 > 0 && roas != null && roas < be * 0.85 && budgetUtil >= 0.25) {
    const pause = roas < be * 0.7;
    return {
      ...base, verdict: "inefficient", severity: "high",
      finding: `Running at ${roas}× ROAS — below your ~${r1(be)}× breakeven, so ads on it lose money${cpa7 ? ` (${cur}${cpa7} per sale)` : ""}. ${pause ? "Pause it" : "Halve its budget"} until the feed/prices improve.`,
      fix: pause
        ? { type: "pause", label: "Pause campaign", current: "enabled", next: 0, resourceName: row.resourceName }
        : { type: "lower_budget", label: `Lower budget to ${cur}${Math.round(row.dailyBudget * 0.5)}/day`, current: r2(row.dailyBudget), next: Math.max(1, Math.round(row.dailyBudget * 0.5)), resourceName: row.resourceName, budgetResource: row.budgetResource },
    };
  }

  // 2) THROTTLED by an unreachable tROAS — spending a fraction of budget because the target is
  //    above what it actually delivers. THE core bug we diagnosed.
  if (t != null && t > 0 && budgetUtil < 0.5 && (roas == null || roas < t * 0.95)) {
    return {
      ...base, verdict: "throttled", severity: budgetUtil < 0.3 ? "high" : "medium",
      finding: `Spending only ${pct}% of its ${cur}${r2(row.dailyBudget)}/day budget — its ${r1(t)}× target ROAS is above the ${roas ?? "—"}× it actually delivers, so Google throttles serving to protect that target. A Performance Max campaign with NO target spends its budget and drives far more sales (that's why your untargeted campaign outperformed). Remove the target to unblock it.`,
      fix: { type: "remove_troas", label: "Remove target ROAS", current: r1(t), next: 0, resourceName: row.resourceName },
    };
  }

  // 3) STARVED WINNER — strong ROAS and hitting its budget cap → give it room.
  if (roas != null && roas > be * 1.6 && budgetUtil > 0.7) {
    const next = Math.max(1, Math.round(row.dailyBudget * 1.5));
    return {
      ...base, verdict: "starved", severity: "medium",
      finding: `Strong ${roas}× ROAS and using ${pct}% of budget — it's capped. Raising the budget to ${cur}${next}/day captures more of these profitable sales.`,
      fix: { type: "raise_budget", label: `Raise budget to ${cur}${next}/day`, current: r2(row.dailyBudget), next, resourceName: row.resourceName, budgetResource: row.budgetResource },
    };
  }

  // 4) LEARNING — too young to judge; hold changes.
  if (isShopFlix && ageDays != null && ageDays < 14) {
    return { ...base, verdict: "learning", severity: "low", finding: `Only ${ageDays} day${ageDays === 1 ? "" : "s"} old — still in Google's learning phase (~2 weeks + ~15 conversions to stabilise). Hold changes and re-review after it settles.`, fix: null };
  }

  return { ...base, verdict: "healthy", severity: "ok", finding: `Healthy — ${roas ?? "—"}× ROAS, spending ${pct}% of budget.`, fix: null };
}

export async function reviewCampaigns(shop: string, creds: AdsCreds): Promise<ReviewResult> {
  try {
    const at = await getAccessToken(creds);
    let currency = "";
    try {
      const cr = await searchStream(creds, at, "SELECT customer.currency_code FROM customer LIMIT 1");
      currency = cr[0]?.customer?.currencyCode || "";
    } catch { /* non-fatal */ }

    const [rows7, rows30] = await Promise.all([
      searchStream(creds, at, CAMP_Q("LAST_7_DAYS")),
      searchStream(creds, at, CAMP_Q("LAST_30_DAYS")).catch(() => []),
    ]);
    const m7 = parse(rows7);
    const m30 = parse(rows30);

    const be = await storeBreakeven(shop);
    const mine = await prisma.adsCampaign.findMany({ where: { shop } }).catch(() => []);
    const byResource = new Map(mine.map((c) => [c.resourceName, c]));
    const now = Date.now();

    const campaigns: CampaignHealth[] = [];
    for (const row of m7.values()) {
      const mineRow = byResource.get(row.resourceName);
      const ageDays = mineRow ? Math.floor((now - new Date(mineRow.createdAt).getTime()) / 864e5) : null;
      const h = analyze(row, be, currency, { isShopFlix: !!mineRow, ageDays });
      const c30 = m30.get(row.resourceName);
      if (c30) { h.roas30 = c30.cost > 0 ? r2(c30.convValue / c30.cost) : null; h.conv30 = r2(c30.conv); }
      campaigns.push(h);
    }
    // Also surface ShopFlix campaigns that exist but had no 7-day rows (never served / just made).
    for (const c of mine) {
      if (m7.has(c.resourceName)) continue;
      campaigns.push({
        resourceName: c.resourceName, name: c.name, status: "UNKNOWN", isShopFlix: true,
        ageDays: Math.floor((now - new Date(c.createdAt).getTime()) / 864e5),
        dailyBudget: c.dailyBudget, targetRoas: c.targetRoas ?? null,
        cost7: 0, conv7: 0, roas7: null, cpa7: null, budgetUtil: 0, impressions7: 0, ctr7: null, roas30: null, conv30: 0,
        verdict: "learning", severity: "low",
        finding: "No spend in the last 7 days yet — either just created, paused, or not serving. Check it's Enabled and its products are approved in Merchant Center.", fix: null,
      });
    }

    campaigns.sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2, ok: 3 } as any;
      return (rank[a.severity] - rank[b.severity]) || (b.cost7 - a.cost7);
    });
    const enabled = campaigns.filter((c) => c.status === "ENABLED").length;
    return { ok: true, currency, breakeven: r1(be), campaigns, summary: { total: campaigns.length, issues: campaigns.filter((c) => c.fix).length, enabled }, generatedAt: now };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 300) };
  }
}

export type FixInput = { type: FixType; resourceName: string; budgetResource?: string; value?: number };

export async function applyCampaignFix(creds: AdsCreds, fix: FixInput): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!fix.resourceName?.startsWith("customers/")) return { ok: false, error: "Invalid campaign reference." };
    const at = await getAccessToken(creds);
    if (fix.type === "pause") {
      await adsMutate(creds, at, "campaigns", [{ update: { resourceName: fix.resourceName, status: "PAUSED" }, updateMask: "status" }]);
    } else if (fix.type === "lower_troas") {
      const v = Number(fix.value);
      if (!(v > 0) || v > 50) return { ok: false, error: "Invalid target ROAS." };
      await adsMutate(creds, at, "campaigns", [{ update: { resourceName: fix.resourceName, maximizeConversionValue: { targetRoas: v } }, updateMask: "maximize_conversion_value.target_roas" }]);
    } else if (fix.type === "remove_troas") {
      // Clear the target so it runs as plain "Maximize conversion value" (no target) — like the
      // untargeted campaign that outperformed. Masking target_roas with an empty message clears it.
      await adsMutate(creds, at, "campaigns", [{ update: { resourceName: fix.resourceName, maximizeConversionValue: {} }, updateMask: "maximize_conversion_value.target_roas" }]);
    } else if (fix.type === "raise_budget" || fix.type === "lower_budget") {
      const v = Number(fix.value);
      if (!fix.budgetResource?.startsWith("customers/")) return { ok: false, error: "Missing budget reference." };
      if (!(v > 0)) return { ok: false, error: "Invalid budget." };
      await adsMutate(creds, at, "campaignBudgets", [{ update: { resourceName: fix.budgetResource, amountMicros: String(Math.round(v * 1e6)) }, updateMask: "amount_micros" }]);
    } else {
      return { ok: false, error: "Unknown fix type." };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 300) };
  }
}
