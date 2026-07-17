import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { loadAdsCreds, credsComplete, getAccessToken, searchStream } from "../utils/google-ads.server";

// TEMP diagnostic: pull live Google Ads campaign + conversion performance for the shop(s) with a
// connected account, so we can see WHY campaigns underperform. CRON_SECRET-gated (read-only).
// Remove after use. Call: /api/ads-diagnostics?token=<CRON_SECRET>[&shop=xxx.myshopify.com]

function authorized(request: Request): boolean {
  const secrets = [process.env.ADS_DIAG_TOKEN, process.env.CRON_SECRET].filter(Boolean) as string[];
  if (!secrets.length) return false;
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || request.headers.get("x-cron-secret") || "";
  return secrets.includes(token);
}

const n = (v: any) => Number(v || 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

const CAMP_Q = (during: string) => `
SELECT campaign.name, campaign.status, campaign.bidding_strategy_type,
       campaign.maximize_conversion_value.target_roas,
       campaign_budget.amount_micros,
       metrics.cost_micros, metrics.conversions, metrics.conversions_value,
       metrics.impressions, metrics.clicks, metrics.average_cpc
FROM campaign
WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX' AND segments.date DURING ${during}`;

const CONV_Q = `
SELECT conversion_action.name, conversion_action.status, conversion_action.category,
       conversion_action.type, conversion_action.primary_for_goal,
       metrics.all_conversions, metrics.all_conversions_value
FROM conversion_action
WHERE segments.date DURING LAST_30_DAYS`;

const ACCT_Q = (during: string) => `
SELECT metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.clicks, metrics.impressions
FROM customer WHERE segments.date DURING ${during}`;

function aggCampaigns(rows: any[]) {
  const m = new Map<string, any>();
  for (const row of rows) {
    const name = row?.campaign?.name || "(unnamed)";
    const cur = m.get(name) || {
      name, status: row?.campaign?.status,
      bidding: row?.campaign?.biddingStrategyType,
      targetRoas: row?.campaign?.maximizeConversionValue?.targetRoas ?? null,
      dailyBudget: n(row?.campaignBudget?.amountMicros) / 1e6,
      cost: 0, conv: 0, convValue: 0, impressions: 0, clicks: 0,
    };
    cur.cost += n(row?.metrics?.costMicros) / 1e6;
    cur.conv += n(row?.metrics?.conversions);
    cur.convValue += n(row?.metrics?.conversionsValue);
    cur.impressions += n(row?.metrics?.impressions);
    cur.clicks += n(row?.metrics?.clicks);
    m.set(name, cur);
  }
  return [...m.values()].map((c) => ({
    ...c,
    cost: r2(c.cost), convValue: r2(c.convValue), conv: r2(c.conv),
    roas: c.cost > 0 ? r2(c.convValue / c.cost) : null,
    cpa: c.conv > 0 ? r2(c.cost / c.conv) : null,
    ctr: c.impressions > 0 ? r2((c.clicks / c.impressions) * 100) : null,
  })).sort((a, b) => b.cost - a.cost);
}

async function analyzeShop(shop: string) {
  const { creds } = await loadAdsCreds(shop);
  if (!credsComplete(creds)) return { shop, error: "credentials incomplete" };
  const at = await getAccessToken(creds);

  const out: any = { shop };
  try {
    const cr = await searchStream(creds, at, "SELECT customer.descriptive_name, customer.currency_code FROM customer LIMIT 1");
    out.account = { name: cr[0]?.customer?.descriptiveName || "", currency: cr[0]?.customer?.currencyCode || "" };
  } catch (e: any) { out.accountError = String(e?.message || e).slice(0, 200); }

  for (const [key, during] of [["last30d", "LAST_30_DAYS"], ["last7d", "LAST_7_DAYS"]] as const) {
    try { out[key] = aggCampaigns(await searchStream(creds, at, CAMP_Q(during))); }
    catch (e: any) { out[`${key}Error`] = String(e?.message || e).slice(0, 200); }
  }

  try {
    const ar = await searchStream(creds, at, ACCT_Q("LAST_30_DAYS"));
    const a = ar[0]?.metrics;
    const cost = n(a?.costMicros) / 1e6, val = n(a?.conversionsValue);
    out.account30d = { cost: r2(cost), conversions: r2(n(a?.conversions)), conversionValue: r2(val), roas: cost > 0 ? r2(val / cost) : null, clicks: n(a?.clicks), impressions: n(a?.impressions) };
  } catch (e: any) { out.account30dError = String(e?.message || e).slice(0, 200); }

  try {
    const rows = await searchStream(creds, at, CONV_Q);
    out.conversionActions = rows.map((row: any) => ({
      name: row?.conversionAction?.name,
      status: row?.conversionAction?.status,
      category: row?.conversionAction?.category,
      type: row?.conversionAction?.type,
      primaryForGoal: row?.conversionAction?.primaryForGoal,
      conv30d: r2(n(row?.metrics?.allConversions)),
      value30d: r2(n(row?.metrics?.allConversionsValue)),
    }));
  } catch (e: any) { out.conversionActionsError = String(e?.message || e).slice(0, 200); }

  return out;
}

async function handle(request: Request): Promise<Response> {
  if (!authorized(request)) return json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const only = url.searchParams.get("shop");
  const settings = await prisma.googleAdsSettings.findMany({ where: only ? { shop: only } : { OR: [{ enabled: true }, { customerId: { not: null } }] } });
  const shops = settings.map((s) => s.shop);
  const results = [];
  for (const shop of shops) {
    try { results.push(await analyzeShop(shop)); }
    catch (e: any) { results.push({ shop, error: String(e?.message || e).slice(0, 300) }); }
  }
  return json({ ok: true, shops: shops.length, results });
}

export async function loader({ request }: LoaderFunctionArgs) { return handle(request); }
export async function action({ request }: ActionFunctionArgs) { return handle(request); }
