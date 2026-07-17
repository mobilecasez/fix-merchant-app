import { useEffect, useMemo, useRef, useState } from "react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useRevalidator, Link } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { getCpcSnapshot } from "../utils/google-ads.server";
import { getShopCurrency } from "../utils/product-analytics.server";
import { fixCurrencyDeep } from "../utils/currency-text.server";
import { getAiJob, jobView } from "../utils/ai-jobs.server";
import prisma from "../db.server";

const MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', 'SFMono-Regular', Menlo, Consolas, monospace";
const CL = {
  ink: "#1B2430", inkDeep: "#101A24", sub: "#8A95A3", sub2: "#9AA7B6", sub3: "#7A8696",
  line: "#E5E9EE", line2: "#EDF0F4", line3: "#F2F5F8", strong: "#BAC3CD",
  teal: "#0E9384", tealDeep: "#0B6E63", tealBg: "#E6F4F1",
  green: "#147A45", greenDot: "#1AA458", greenBg: "#DBF3E3", amberBg: "#FBEFD6", amberFg: "#955B0C",
  purple: "#7C3AED", purpleDeep: "#5B21B6", purpleBg: "#F3EDFF",
};
const card: any = { background: "#fff", border: `1px solid ${CL.line}`, borderRadius: 16 };

// Target-country options for campaign creation (code → geo target constants resolved server-side).
const COUNTRIES: Array<[string, string]> = [
  ["", "All countries (feed default)"],
  ["IN", "India"], ["US", "United States"], ["GB", "United Kingdom"], ["CA", "Canada"],
  ["AU", "Australia"], ["AE", "United Arab Emirates"], ["SA", "Saudi Arabia"], ["SG", "Singapore"],
  ["MY", "Malaysia"], ["ID", "Indonesia"], ["PH", "Philippines"], ["NZ", "New Zealand"],
  ["DE", "Germany"], ["FR", "France"], ["NL", "Netherlands"], ["ES", "Spain"], ["IT", "Italy"],
  ["SE", "Sweden"], ["IE", "Ireland"], ["ZA", "South Africa"], ["BR", "Brazil"], ["MX", "Mexico"],
];
const CURRENCY_COUNTRY: Record<string, string> = { INR: "IN", USD: "US", GBP: "GB", CAD: "CA", AUD: "AU", AED: "AE", SAR: "SA", SGD: "SG", MYR: "MY", IDR: "ID", PHP: "PH", NZD: "NZ", SEK: "SE", ZAR: "ZA", BRL: "BR", MXN: "MX" };

// Tier accents: card top border + budget-bar segment colour.
const TIER: Record<string, { accent: string; bg: string; fg: string; label: string }> = {
  winners: { accent: "#1AA458", bg: CL.greenBg, fg: CL.green, label: "Winners" },
  alpha: { accent: "#1AA458", bg: CL.greenBg, fg: CL.green, label: "Alpha" },
  growers: { accent: "#0E9384", bg: CL.tealBg, fg: CL.tealDeep, label: "Growers" },
  testing: { accent: "#E0900F", bg: CL.amberBg, fg: CL.amberFg, label: "Testing" },
  "hidden-gems": { accent: "#7C3AED", bg: CL.purpleBg, fg: CL.purpleDeep, label: "Hidden gems" },
  longtail: { accent: "#E0900F", bg: CL.amberBg, fg: CL.amberFg, label: "Long tail" },
  "everything-else": { accent: "#8A95A3", bg: "#EEF1F5", fg: "#6B7787", label: "Catch-all" },
};
const tierOf = (c: any) => TIER[c?.catchAll ? "everything-else" : c?.tier] || TIER["everything-else"];

const PAGE_STYLE = `
  .ac-btn { cursor:pointer; transition:filter .12s, transform .08s; }
  .ac-btn:hover:not(:disabled) { filter:brightness(0.96); }
  .ac-btn:active:not(:disabled) { transform:scale(0.985); }
  .ac-btn:disabled { opacity:0.5; cursor:default; }
  .ac-in { border:1.5px solid ${CL.strong}; border-radius:10px; background:#fff; height:38px; padding:0 10px; font-family:${MONO}; font-size:13.5px; font-weight:600; color:${CL.ink}; outline:none; min-width:0; }
  .ac-in:focus { border-color:${CL.teal}; }
  @keyframes acspin { to { transform:rotate(360deg); } }
  .ac-spin { display:inline-block; width:13px; height:13px; border:2px solid rgba(255,255,255,.35); border-top-color:#fff; border-radius:50%; animation:acspin .7s linear infinite; }
  .ac-overlay { position:fixed; inset:0; z-index:2147483000; display:flex; align-items:center; justify-content:center; background:rgba(16,26,36,0.28); backdrop-filter:blur(1.5px); }
  .ac-grid { display:grid; gap:14px; grid-template-columns:repeat(auto-fill, minmax(330px, 1fr)); }
  .ac-ads { display:grid; gap:12px; grid-template-columns:repeat(auto-fill, minmax(175px, 1fr)); }
  .ac-plist { max-height:240px; overflow-y:auto; border:1px solid ${CL.line2}; border-radius:10px; }
  .ac-prow { display:flex; align-items:center; gap:9px; padding:7px 10px; border-bottom:1px solid ${CL.line3}; }
  .ac-prow:last-child { border-bottom:none; }
  .ac-clamp2 { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
`;

function money(n: number | null | undefined, currency: string) {
  if (n == null || !Number.isFinite(n)) return "—";
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n); }
  catch { return `${n} ${currency}`; }
}
function symbolFor(c: string) {
  try { return new Intl.NumberFormat("en", { style: "currency", currency: c }).formatToParts(0).find((p) => p.type === "currency")?.value || c; } catch { return c; }
}
function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); }
  catch { return String(iso).slice(0, 10); }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const cpc = await getCpcSnapshot(shop);
  const settings = await prisma.googleAdsSettings.findUnique({ where: { shop } });
  // The store's own currency (₹ for an Indian store) — throttle-safe with a DB-cached fallback.
  // `null` means genuinely unknown; a saved plan's persisted value beats guessing USD.
  const freshCurrency = await getShopCurrency(admin, shop);
  // Saved plan (re-open for free; credits only on regenerate) + whether a profit report exists.
  const planRow = await prisma.aiReport.findUnique({ where: { shop_kind: { shop, kind: "campaign_plan" } } }).catch(() => null);
  const profitRow = await prisma.aiReport.findUnique({ where: { shop_kind: { shop, kind: "profit_advisor" } } }).catch(() => null);
  const planJob = jobView(await getAiJob(shop, "campaign_plan_job"));
  const publishedCount = await prisma.adsCampaign.count({ where: { shop } }).catch(() => 0);
  // Fallback order matters: the ads-account currency (verified against Google) outranks the
  // payload's own storeCurrency — a past generation once PERSISTED "USD" into an INR store's
  // payload, so the payload is the one source that may be poisoned. It comes last.
  const storeCurrency = freshCurrency || settings?.currencyCode || (planRow ? (planRow.data as any)?.storeCurrency : null) || null;
  const adsCurrency = settings?.currencyCode || storeCurrency || null;
  // Sanitize the saved payload at read time: rewrites any "$"/"USD" text a past generation leaked
  // and pins the currency fields to today's best-known values — retro-fixes old saved plans free.
  let savedPlan: any = planRow ? (storeCurrency ? fixCurrencyDeep(planRow.data as any, storeCurrency) : (planRow.data as any)) : null;
  if (savedPlan) savedPlan = { ...savedPlan, storeCurrency: storeCurrency || savedPlan.storeCurrency, adsCurrency: adsCurrency || savedPlan.adsCurrency };
  return json({
    configured: cpc.configured,
    storeCurrency,
    // currencyKnown distinguishes "we verified the store currency" from a fallback — the
    // ads-vs-store mismatch banner must only ever show for a VERIFIED mismatch.
    currencyKnown: !!freshCurrency,
    adsCurrency,
    shop,
    savedPlan,
    planJob,
    published: publishedCount,
    profitReportAt: profitRow ? (((profitRow.meta as any)?.generatedAt as string) || profitRow.updatedAt.toISOString()) : null,
  });
}

const PLAN_CREDITS = 30; // mirrors PLAN_CREDITS in ad-campaign.server.ts (can't import .server here)

function Notice({ tone, children }: { tone: "info" | "ok" | "warn"; children: any }) {
  const T = tone === "ok" ? { bg: CL.greenBg, bd: "#C7E4DF", fg: CL.green }
    : tone === "warn" ? { bg: CL.amberBg, bd: "#EBD9AE", fg: CL.amberFg }
    : { bg: "#F0F6FF", bd: "#CFE0FA", fg: "#1E50C9" };
  return <div style={{ background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 12, padding: "12px 16px", fontSize: 13, lineHeight: 1.5, color: T.fg }}>{children}</div>;
}

function Thumb({ src, size = 30 }: { src: string | null; size?: number }) {
  return src
    ? <img src={src} alt="" style={{ width: size, height: size, borderRadius: 8, objectFit: "cover", border: `1.5px solid #fff`, boxShadow: "0 0 0 1px " + CL.line, flex: "0 0 auto", background: "#fff" }} />
    : <div style={{ width: size, height: size, borderRadius: 8, background: "repeating-linear-gradient(135deg,#EEF2F6 0 5px,#E6EBF1 5px 10px)", border: `1.5px solid #fff`, boxShadow: "0 0 0 1px " + CL.line, flex: "0 0 auto" }} />;
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, color: CL.sub2, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 13.5, fontWeight: 700, fontFamily: MONO, color: color || CL.ink, marginTop: 1 }}>{value}</div>
    </div>
  );
}

const VERDICT: Record<string, { l: string; bg: string; fg: string; icon: string }> = {
  throttled: { l: "Throttled", bg: CL.amberBg, fg: CL.amberFg, icon: "⚠️" },
  inefficient: { l: "Losing money", bg: "#FDE8E8", fg: "#B42318", icon: "🔴" },
  starved: { l: "Scale up", bg: CL.greenBg, fg: CL.green, icon: "🚀" },
  learning: { l: "Learning", bg: "#EAF1FF", fg: "#1E50C9", icon: "⏳" },
  healthy: { l: "Healthy", bg: CL.greenBg, fg: CL.green, icon: "✅" },
  paused: { l: "Paused", bg: "#EEF1F5", fg: "#6B7787", icon: "⏸" },
};

function HealthCard({ c, currency, onFix, fixing }: { c: any; currency: string; onFix: (fx?: any) => void; fixing: boolean }) {
  const V = VERDICT[c.verdict] || { l: c.verdict, bg: "#EEF1F5", fg: "#6B7787", icon: "•" };
  const util = Math.round((c.budgetUtil || 0) * 100);
  const roasColor = c.roas7 == null ? CL.sub2 : (c.verdict === "inefficient" ? "#B42318" : CL.green);
  return (
    <div style={{ border: `1px solid ${CL.line}`, borderRadius: 12, padding: "13px 15px", background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 260 }}>{c.name}</span>
          <span style={{ fontSize: 9.5, fontWeight: 700, padding: "2px 7px", borderRadius: 5, whiteSpace: "nowrap", color: c.status === "ENABLED" ? CL.green : "#6B7787", background: c.status === "ENABLED" ? CL.greenBg : "#EEF1F5" }}>{c.status === "ENABLED" ? "● Live" : c.status === "PAUSED" ? "Paused" : "—"}</span>
          {c.isShopFlix ? <span style={{ fontSize: 9.5, fontWeight: 700, color: CL.purpleDeep, background: CL.purpleBg, padding: "2px 6px", borderRadius: 5 }}>ShopFlix</span> : null}
        </div>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: V.fg, background: V.bg, padding: "3px 10px", borderRadius: 999, whiteSpace: "nowrap" }}>{V.icon} {V.l}</span>
      </div>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 10 }}>
        <Metric label="ROAS 7d" value={c.roas7 != null ? c.roas7 + "×" : "—"} color={roasColor} />
        <Metric label="Spend 7d" value={money(c.cost7, currency)} />
        <Metric label="Sales" value={String(c.conv7)} />
        {c.cpa7 != null ? <Metric label="Cost/sale" value={money(c.cpa7, currency)} /> : null}
        {c.targetRoas != null ? <Metric label="Target" value={c.targetRoas + "×"} /> : null}
      </div>
      {c.dailyBudget > 0 && c.status === "ENABLED" ? (
        <div style={{ marginTop: 11 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: CL.sub2, marginBottom: 4 }}>
            <span>Budget used: <b style={{ color: util < 40 ? "#E0900F" : CL.green }}>{util}%</b></span>
            <span>{money(c.cost7 / 7, currency)} / {money(c.dailyBudget, currency)} per day</span>
          </div>
          <div style={{ height: 6, borderRadius: 999, background: CL.line3, overflow: "hidden" }}>
            <div style={{ width: `${Math.min(100, util)}%`, height: "100%", background: util < 40 ? "#E0900F" : "#12B76A" }} />
          </div>
        </div>
      ) : null}
      <div style={{ marginTop: 10, fontSize: 12.5, color: CL.sub, lineHeight: 1.5 }}>{c.finding}</div>
      {c.fix || (c.targetRoas != null && c.status === "ENABLED") ? (
        <div style={{ marginTop: 11, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {c.fix ? (
            <button onClick={() => onFix(c.fix)} disabled={fixing} className="ac-btn" style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 36, padding: "0 15px", border: "none", borderRadius: 9, background: c.verdict === "inefficient" ? "#B42318" : CL.inkDeep, color: "#fff", fontWeight: 700, fontSize: 12.5 }}>
              {fixing ? <span className="ac-spin" /> : "✓"} {c.fix.label}
            </button>
          ) : null}
          {/* Always-available manual control: remove the target ROAS from any campaign that has one. */}
          {c.targetRoas != null && c.status === "ENABLED" && c.fix?.type !== "remove_troas" ? (
            <button onClick={() => onFix({ type: "remove_troas", label: "Remove target ROAS", resourceName: c.resourceName, next: 0 })} disabled={fixing} className="ac-btn" style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 36, padding: "0 15px", borderRadius: 9, border: `1.5px solid ${CL.strong}`, background: "#fff", color: CL.ink, fontWeight: 700, fontSize: 12.5 }}>
              {fixing ? <span className="ac-spin" /> : "✕"} Remove target ROAS ({c.targetRoas}×)
            </button>
          ) : null}
          <span style={{ fontSize: 11, color: CL.sub2 }}>applies to Google Ads instantly</span>
        </div>
      ) : null}
    </div>
  );
}

export default function AdCampaigns() {
  const data = useLoaderData<typeof loader>();
  const plan = useFetcher<any>();
  const create = useFetcher<any>();
  const revalidator = useRevalidator();

  // Editable copy of the AI plan.
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [totalBudget, setTotalBudget] = useState("1000");
  const [status, setStatus] = useState<"PAUSED" | "ENABLED">("PAUSED");
  const [merchantId, setMerchantId] = useState("");
  const [targetCountry, setTargetCountry] = useState(""); // "" = all countries; else ISO-2 code
  const [openProducts, setOpenProducts] = useState<number | null>(null); // which card's product list is expanded

  // The plan generates as a BACKGROUND JOB (pro model, 1-3 min). While it runs we poll a CHEAP
  // status endpoint (zero Shopify API cost — a full revalidate would collide with the job's own
  // Shopify usage and get Throttled), then do ONE full revalidate when it finishes.
  const jobPoll = useFetcher<any>();
  // Live campaign REVIEW + one-click FIX (post-publish optimization loop).
  const review = useFetcher<any>();
  const fix = useFetcher<any>();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [fixingRef, setFixingRef] = useState<string>("");
  const runReview = () => { setReviewOpen(true); review.submit({ intent: "review" }, { method: "post", action: "/api/ad-campaigns" }); };
  const applyFix = (c: any, f?: any) => {
    const fx = f || c.fix;
    if (!fx) return;
    if (!window.confirm(`Apply "${fx.label}" to "${c.name}"?\n\nThis changes your LIVE Google Ads campaign immediately.`)) return;
    setFixingRef(c.resourceName);
    fix.submit(
      { intent: "apply_fix", fixType: fx.type, resourceName: fx.resourceName || c.resourceName, budgetResource: fx.budgetResource || "", value: String(fx.next || "") } as any,
      { method: "post", action: "/api/ad-campaigns", encType: "application/json" },
    );
  };
  const planData = data.savedPlan;
  const planJob = jobPoll.data?.planJob ?? data.planJob;
  const planRunning = planJob?.status === "running" || (plan.data?.started === true && planJob?.status !== "done" && planJob?.status !== "error");

  useEffect(() => {
    if (planData?.plan) {
      setCampaigns(planData.plan.campaigns.map((c: any) => ({ ...c })));
      if (planData.plan.suggestedDailyBudget > 0) setTotalBudget(String(planData.plan.suggestedDailyBudget));
      if (planData.merchantId) setMerchantId(planData.merchantId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planData?.generatedAt]);

  useEffect(() => {
    if (!planRunning) return;
    const t = setInterval(() => { if (jobPoll.state === "idle") jobPoll.load("/api/ad-campaigns"); }, 6000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planRunning]);
  // Job finished → ONE full revalidate to pull the fresh plan / error state.
  const prevPlanStatus = useState<{ v: string | null }>(() => ({ v: null }))[0];
  useEffect(() => {
    const s = planJob?.status || null;
    if (prevPlanStatus.v === "running" && (s === "done" || s === "error")) revalidator.revalidate();
    prevPlanStatus.v = s;
  }, [planJob?.status, revalidator, prevPlanStatus]);
  // After a fix is applied to Google Ads, re-pull the live numbers so the card updates.
  useEffect(() => {
    if (fix.state === "idle" && fix.data?.ok) { setFixingRef(""); runReview(); }
    else if (fix.state === "idle" && fix.data && fix.data.ok === false) setFixingRef("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix.data, fix.state]);
  // Auto-pull the LIVE Google Ads state once when the page opens (Google Ads connected) so the
  // Campaign health panel reflects reality — actual Enabled/Paused status and current budgets —
  // instead of the create form's reset-to-default preview.
  const autoReviewed = useRef(false);
  useEffect(() => {
    if (!autoReviewed.current && data.configured) { autoReviewed.current = true; runReview(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.configured]);
  // Default the target country to the store's own (from its currency) — most merchants advertise
  // where they sell/ship. Runs once when currency is known; the user can still pick any option.
  const countryDefaulted = useRef(false);
  useEffect(() => {
    if (countryDefaulted.current) return;
    const c = CURRENCY_COUNTRY[String(data.adsCurrency || data.storeCurrency || "").toUpperCase()];
    if (c) { setTargetCountry(c); countryDefaulted.current = true; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.adsCurrency, data.storeCurrency]);

  // Display currencies: budgets bill in the ADS-ACCOUNT currency; product prices are the store's.
  // Loader values are authoritative (fresh), never the saved payload (an old payload once carried
  // a wrong USD fallback).
  // Display fallbacks: verified store currency → ads-account currency → USD (last resort only).
  const storeCurrency = data.storeCurrency || data.adsCurrency || "USD";
  const adsCurrency = data.adsCurrency || storeCurrency;
  const sym = symbolFor(adsCurrency);
  const productInfo = planData?.productInfo || {};
  const busy = plan.state !== "idle" || create.state !== "idle";
  const pctSum = campaigns.reduce((s, c) => s + (Number(c.budgetPct) || 0), 0);
  const budgetNum = parseFloat(totalBudget.replace(/[^0-9.]/g, "")) || 0;

  const generate = () => {
    if (planRunning) return;
    if (!window.confirm(`${planData ? "Regenerate" : "Generate"} the AI campaign plan? This uses ${PLAN_CREDITS} credits and takes 1-3 minutes — the plan will appear here when ready.`)) return;
    plan.submit({ intent: "plan", days: "30" }, { method: "post", action: "/api/ad-campaigns" });
  };
  const doCreate = () => {
    if (!window.confirm(`Create ${campaigns.length} campaign(s) in Google Ads with a total daily budget of ${money(budgetNum, adsCurrency)}? They will be created ${status === "PAUSED" ? "PAUSED (recommended — review in Google Ads, then enable)" : "ENABLED and may start spending immediately"}.`)) return;
    create.submit(
      { intent: "create", merchantId, totalBudget: budgetNum, status, campaigns, countries: targetCountry ? [targetCountry] : [] } as any,
      { method: "post", action: "/api/ad-campaigns", encType: "application/json" },
    );
  };

  const upd = (i: number, key: string, val: any) => setCampaigns((cs) => cs.map((c, j) => (j === i ? { ...c, [key]: val } : c)));

  // Ad preview uses the first (winners) campaign's products.
  const previewProducts = useMemo(() => {
    const first = campaigns.find((c) => !c.catchAll);
    if (!first) return [];
    return (first.productTitles || []).map((t: string) => productInfo[t]).filter(Boolean).slice(0, 4);
  }, [campaigns, productInfo]);

  const domain = (planData?.storeDomain || "").replace(/^https?:\/\//, "") || data.shop.replace(".myshopify.com", ".com");

  return (
    <div style={{ background: "#F4F6F8", minHeight: "100%", padding: "22px 24px 80px", color: CL.ink }}>
      <style>{PAGE_STYLE}</style>
      {busy ? (
        <div className="ac-overlay"><div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, background: "#fff", padding: "22px 30px", borderRadius: 16, boxShadow: "0 20px 50px -20px rgba(16,30,54,0.5)" }}>
          <div className="ac-spin" style={{ width: 34, height: 34, borderWidth: 3, borderColor: "rgba(124,58,237,0.25)", borderTopColor: CL.purple }} />
          <div style={{ fontSize: 13, fontWeight: 600 }}>{plan.state !== "idle" ? "Starting the plan generation…" : "Creating campaigns in Google Ads…"}</div>
        </div></div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* ── header ── */}
        <div style={{ ...card, padding: "20px 22px", background: "linear-gradient(120deg,#FBFAFF 0%,#F4EFFF 55%,#EDF6F4 100%)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: "linear-gradient(135deg,#7C3AED,#5B21B6)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto", boxShadow: "0 10px 20px -10px rgba(91,33,182,0.6)" }}>
              <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="#E9D5FF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l18-8-8 18-2.5-7.5L3 11Z" /></svg>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.015em" }}>Optimized Ad Campaigns</div>
              <div style={{ fontSize: 13, color: CL.sub, marginTop: 2 }}>AI designs your Google Ads structure from Price Radar data{data.profitReportAt ? " + your profit report" : ""} — review, set budget, create.</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button className="ac-btn" onClick={generate} disabled={busy || planRunning || !data.configured} style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 42, padding: "0 18px", border: "none", borderRadius: 11, background: "linear-gradient(135deg,#7C3AED,#5B21B6)", color: "#fff", fontWeight: 700, fontSize: 13.5, boxShadow: "0 8px 16px -8px rgba(91,33,182,0.7)" }}>
              {plan.state !== "idle" || planRunning ? <span className="ac-spin" /> : "✦"} {planRunning ? "Generating…" : planData ? "Regenerate plan" : "Generate AI plan"}
              <span style={{ fontFamily: MONO, fontSize: 12, background: "rgba(233,213,255,0.22)", color: "#EDE0FF", padding: "2px 7px", borderRadius: 6 }}>{PLAN_CREDITS} cr</span>
            </button>
            <Link to="/app/price-radar" style={{ fontSize: 13, color: CL.tealDeep, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}>← Price Radar</Link>
          </div>
        </div>

        {/* ── notices ── */}
        {!data.configured ? (
          <Notice tone="warn">Connect your Google Ads account first in <Link to="/app/settings" style={{ color: "inherit" }}>Settings → Google Ads</Link> — campaign creation needs API access.</Notice>
        ) : null}
        {plan.data && plan.data.ok === false ? <Notice tone="warn">{plan.data.error}</Notice> : null}
        {planRunning ? <Notice tone="info"><strong>Designing your campaigns</strong> with Gemini Pro — takes 1–3 minutes. You can keep using the app; the plan will appear here automatically.</Notice> : null}
        {!planRunning && planJob?.status === "error" ? <Notice tone="warn"><strong>Plan generation failed:</strong> {planJob.error} Your credits were refunded — try again.</Notice> : null}
        {create.data && create.data.ok === false ? <Notice tone="warn">{create.data.error}</Notice> : null}
        {planData?.newStore ? (
          <Notice tone="info"><strong>Starter plan for a new store:</strong> there isn&rsquo;t enough traffic/sales history yet, so this plan was built straight from your catalogue. Once you have a few weeks of data, run the <Link to="/app/price-radar" style={{ color: "inherit", fontWeight: 700 }}>AI Profit Advisor</Link> and regenerate for a much sharper plan.</Notice>
        ) : data.configured && !data.profitReportAt ? (
          <Notice tone="info">Tip: run the <Link to="/app/price-radar" style={{ color: "inherit", fontWeight: 700 }}>AI Profit Advisor on Price Radar</Link> first (10 cr) — the campaign plan gets sharper when it can act on your profit analysis. You can still generate a plan without it.</Notice>
        ) : null}
        {data.currencyKnown && data.storeCurrency && adsCurrency !== data.storeCurrency ? (
          <Notice tone="warn">Your Google Ads account bills in <strong>{adsCurrency}</strong> while your store sells in <strong>{data.storeCurrency}</strong> — budgets below are in {adsCurrency}.</Notice>
        ) : null}

        {/* ── Published campaigns · live review & one-click fix ── */}
        {data.configured ? (
          <div style={{ ...card, padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>Campaign health</span>
                {data.published > 0 ? <span style={{ fontSize: 11.5, fontWeight: 700, color: CL.green, background: CL.greenBg, border: "1px solid #C7E4DF", padding: "3px 10px", borderRadius: 999 }}>✓ {data.published} published via ShopFlix</span> : null}
              </div>
              <button className="ac-btn" onClick={runReview} disabled={review.state !== "idle" || !data.configured}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 38, padding: "0 16px", border: "none", borderRadius: 10, background: CL.inkDeep, color: "#fff", fontWeight: 700, fontSize: 13 }}>
                {review.state !== "idle" ? <span className="ac-spin" /> : "📊"} {reviewOpen ? "Refresh review" : "Review performance"}
              </button>
            </div>
            <div style={{ fontSize: 12.5, color: CL.sub, marginTop: 6, lineHeight: 1.5 }}>
              Pulls your live Google Ads numbers and flags exactly what to fix — targets throttling your winners, money-losing campaigns, and winners worth scaling. Each fix applies to your account in one click.
            </div>

            {review.data && review.data.ok === false ? <div style={{ marginTop: 12 }}><Notice tone="warn">Couldn&rsquo;t pull your campaigns: {review.data.error}</Notice></div> : null}
            {fix.data && fix.data.ok === false ? <div style={{ marginTop: 12 }}><Notice tone="warn">Couldn&rsquo;t apply the change: {fix.data.error}</Notice></div> : null}

            {review.data?.ok && Array.isArray(review.data.campaigns) ? (
              review.data.campaigns.length === 0 ? (
                <div style={{ marginTop: 14 }}><Notice tone="info">No Performance Max campaigns are serving right now. Enable your published campaigns in Google Ads, then review again.</Notice></div>
              ) : (
                <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontSize: 12, color: CL.sub2 }}>
                    Reviewed <b style={{ color: CL.ink }}>{review.data.campaigns.length}</b> campaigns · <b style={{ color: CL.ink }}>{review.data.summary?.issues || 0}</b> need attention · your breakeven ROAS ≈ <b style={{ color: CL.ink }}>{review.data.breakeven}×</b>{review.data.currency ? ` · ${review.data.currency}` : ""}
                  </div>
                  {review.data.campaigns.map((c: any, i: number) => (
                    <HealthCard key={c.resourceName || i} c={c} currency={review.data.currency || adsCurrency} onFix={(fx: any) => applyFix(c, fx)} fixing={fixingRef === c.resourceName && fix.state !== "idle"} />
                  ))}
                </div>
              )
            ) : review.state !== "idle" ? (
              <div style={{ marginTop: 14, fontSize: 13, color: CL.sub }}>Pulling your live campaign numbers…</div>
            ) : null}
          </div>
        ) : null}

        {/* ── strategy ── */}
        {planData?.plan ? (
          <div style={{ ...card, padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>The plan</span>
              {planData.profitBased && planData.basedOnReportAt ? <span style={{ fontSize: 11, fontWeight: 700, color: CL.purpleDeep, background: CL.purpleBg, padding: "3px 10px", borderRadius: 999 }}>built from your profit report · {fmtDay(planData.basedOnReportAt)}</span> : null}
              <span style={{ fontSize: 11, fontWeight: 600, color: CL.sub2, background: CL.line3, padding: "3px 10px", borderRadius: 999 }}>saved {fmtDay(planData.generatedAt)}</span>
            </div>
            <div style={{ background: CL.purpleBg, border: "1px solid #E4D8FB", borderRadius: 12, padding: "13px 16px", fontSize: 13.5, color: "#4C2A8A", lineHeight: 1.6 }}>{planData.plan.strategy}</div>
            {planData.plan.benefits?.length ? (
              <div style={{ background: CL.greenBg, border: "1px solid #C7E4DF", borderRadius: 12, padding: "13px 16px", marginTop: 10 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: CL.green, marginBottom: 7 }}>Why this plan works for your store</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "#2C6E63", lineHeight: 1.7 }}>
                  {planData.plan.benefits.map((b: string, i: number) => <li key={i}>{b}</li>)}
                </ul>
              </div>
            ) : null}
            {planData.plan.notes?.length ? (
              <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 12.5, color: CL.sub, lineHeight: 1.6 }}>
                {planData.plan.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}
              </ul>
            ) : null}
            <div style={{ fontSize: 11.5, color: CL.sub2, marginTop: 10 }}>
              {`AI reviewed ${planData.analysed >= (planData.totalProducts ?? 0) ? `ALL ${planData.totalProducts ?? planData.analysed}` : `${planData.analysed} of ${planData.totalProducts}`} products individually · ${planData.targetableCount} targetable in Google Shopping${planData.model ? ` · model ${planData.model}` : ""}. Every product not named is covered by the catch-all.`}
            </div>
          </div>
        ) : !busy ? (
          <div style={{ ...card, padding: "34px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>No plan yet</div>
            <div style={{ fontSize: 13, color: CL.sub, maxWidth: 520, margin: "0 auto", lineHeight: 1.6 }}>
              Click <strong>Generate AI plan</strong> — Gemini will group your products by performance (top sellers on 60&ndash;70% of budget, an automatic catch-all for the rest) and explain exactly why.
            </div>
          </div>
        ) : null}

        {/* ── budget split bar ── */}
        {campaigns.length ? (
          <div style={{ ...card, padding: 18 }}>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 14, flexWrap: "wrap", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: CL.sub3, textTransform: "uppercase", marginBottom: 6 }}>Total daily budget ({adsCurrency})</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontFamily: MONO, color: CL.sub, fontSize: 15 }}>{sym}</span>
                  <input className="ac-in" value={totalBudget} onChange={(e) => setTotalBudget(e.target.value)} inputMode="decimal" style={{ width: 130, fontSize: 16 }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: pctSum === 100 ? CL.green : "#B42318", marginLeft: 6 }}>{pctSum === 100 ? "split = 100% ✓" : `split is ${pctSum}% — make it 100%`}</span>
                </div>
                {planData?.plan?.suggestedDailyBudget > 0 ? (
                  <button className="ac-btn" onClick={() => setTotalBudget(String(planData.plan.suggestedDailyBudget))} style={{ border: "none", background: "transparent", padding: 0, marginTop: 6, fontSize: 12, fontWeight: 600, color: CL.tealDeep, textAlign: "left", cursor: "pointer" }}>
                    ✦ AI suggests {money(planData.plan.suggestedDailyBudget, adsCurrency)}/day — click to use
                  </button>
                ) : null}
              </div>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                {campaigns.map((c, i) => {
                  const t = tierOf(c);
                  return <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: t.accent }} /><span style={{ color: "#586575", fontWeight: 600, maxWidth: 140, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span><span style={{ fontFamily: MONO, color: CL.sub2 }}>{c.budgetPct}%</span></div>;
                })}
              </div>
            </div>
            <div style={{ display: "flex", height: 16, borderRadius: 999, overflow: "hidden", background: CL.line3 }}>
              {campaigns.map((c, i) => (
                <div key={i} title={`${c.name} — ${c.budgetPct}% (${money(Math.round(budgetNum * (Number(c.budgetPct) || 0)) / 100, adsCurrency)}/day)`}
                  style={{ width: `${Math.max(0, Math.min(100, Number(c.budgetPct) || 0))}%`, background: tierOf(c).accent, transition: "width .2s" }} />
              ))}
            </div>
          </div>
        ) : null}

        {/* ── campaign cards ── */}
        {campaigns.length ? (
          <div className="ac-grid">
            {campaigns.map((c, i) => {
              const t = tierOf(c);
              const daily = Math.round(budgetNum * (Number(c.budgetPct) || 0)) / 100;
              const titles: string[] = c.catchAll ? [] : (c.productTitles || []);
              const infos = titles.map((x) => productInfo[x]).filter(Boolean);
              const open = openProducts === i;
              return (
                <div key={i} style={{ ...card, borderTop: `3px solid ${t.accent}`, padding: 16, display: "flex", flexDirection: "column", gap: 11 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input className="ac-in" value={c.name} onChange={(e) => upd(i, "name", e.target.value)} style={{ flex: 1, height: 34, fontSize: 13 }} />
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999, textTransform: "uppercase", letterSpacing: "0.03em", background: t.bg, color: t.fg, whiteSpace: "nowrap" }}>{t.label}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: CL.sub, lineHeight: 1.55 }}>{c.rationale}</div>
                  {Array.isArray((c as any).searchThemes) && (c as any).searchThemes.length ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {(c as any).searchThemes.map((th: string, j: number) => (
                        <span key={j} title="PMax search theme — added as an asset-group signal" style={{ fontSize: 10.5, fontWeight: 600, color: "#3538CD", background: "#EFF4FF", padding: "3px 10px", borderRadius: 999 }}>🔍 {th}</span>
                      ))}
                    </div>
                  ) : null}

                  <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", background: CL.line3, borderRadius: 12, padding: "10px 12px" }}>
                    <div>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: CL.sub3, textTransform: "uppercase", marginBottom: 4 }}>Budget %</div>
                      <input className="ac-in" value={String(c.budgetPct)} onChange={(e) => upd(i, "budgetPct", e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" style={{ width: 66, height: 34, textAlign: "right", background: "#fff" }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: CL.sub3, textTransform: "uppercase", marginBottom: 4 }}>Target ROAS</div>
                      <input className="ac-in" value={c.targetRoas ?? ""} placeholder="auto" onChange={(e) => upd(i, "targetRoas", e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" style={{ width: 74, height: 34, textAlign: "right", background: "#fff" }} />
                    </div>
                    <div style={{ marginLeft: "auto", textAlign: "right" }}>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: CL.sub3, textTransform: "uppercase" }}>Daily budget</div>
                      <div style={{ fontFamily: MONO, fontSize: 18, fontWeight: 700, color: t.fg }}>{money(daily, adsCurrency)}</div>
                    </div>
                  </div>

                  {!c.catchAll ? (
                    <div>
                      <button className="ac-btn" onClick={() => setOpenProducts(open ? null : i)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", border: "none", background: "transparent", padding: 0, textAlign: "left" }}>
                        <div style={{ display: "flex", alignItems: "center" }}>
                          {infos.slice(0, 6).map((p: any, j: number) => <span key={j} style={{ marginLeft: j ? -9 : 0, zIndex: 6 - j, display: "inline-flex" }}><Thumb src={p.image} /></span>)}
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 600, color: CL.tealDeep }}>
                          {titles.length} product{titles.length === 1 ? "" : "s"} · {open ? "hide" : "view all"}
                          <span style={{ display: "inline-block", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s", marginLeft: 5, fontSize: 9, opacity: 0.7 }}>▼</span>
                        </span>
                      </button>
                      {open ? (
                        <div className="ac-plist" style={{ marginTop: 9 }}>
                          {titles.map((title: string, j: number) => {
                            const p = productInfo[title];
                            return (
                              <div key={j} className="ac-prow">
                                <Thumb src={p?.image || null} size={28} />
                                <span style={{ fontSize: 12, color: CL.ink, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={title}>{title}</span>
                                {p ? <span style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 600, color: CL.sub, flex: "0 0 auto" }}>{money(p.price, storeCurrency)}</span> : null}
                                {p?.revenue ? <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: CL.green, flex: "0 0 auto" }}>{money(p.revenue, storeCurrency)} rev</span> : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: CL.sub2, display: "flex", alignItems: "center", gap: 7 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={CL.sub2} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-3.5-3.5" /></svg>
                      Automatically covers every product not in the campaigns above — including new products you add later.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : null}

        {/* ── settings + preview ── */}
        {campaigns.length ? (
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))" }}>
            <div style={{ ...card, padding: 18 }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Launch settings</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: CL.sub3, textTransform: "uppercase", marginBottom: 6 }}>Create as</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {(["PAUSED", "ENABLED"] as const).map((s) => (
                      <button key={s} className="ac-btn" onClick={() => setStatus(s)} style={{ height: 36, padding: "0 14px", borderRadius: 10, fontWeight: 600, fontSize: 12.5, border: `1.5px solid ${status === s ? CL.teal : CL.line}`, background: status === s ? CL.tealBg : "#fff", color: status === s ? CL.tealDeep : CL.sub }}>
                        {s === "PAUSED" ? "Paused (recommended)" : "Enabled — starts spending"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: CL.sub3, textTransform: "uppercase", marginBottom: 6 }}>Target country</div>
                  <select className="ac-in" value={targetCountry} onChange={(e) => setTargetCountry(e.target.value)} style={{ height: 38, width: 240, cursor: "pointer" }}>
                    {COUNTRIES.map(([c, nm]) => <option key={c} value={c}>{nm}</option>)}
                  </select>
                  <div style={{ fontSize: 11, color: CL.sub2, marginTop: 5, lineHeight: 1.5 }}>Where your ads can show — pick the country you sell &amp; ship to. &ldquo;All countries&rdquo; lets Google serve wherever your feed is eligible.</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: CL.sub3, textTransform: "uppercase", marginBottom: 6 }}>Merchant Center ID</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <input className="ac-in" value={merchantId} onChange={(e) => setMerchantId(e.target.value.replace(/[^0-9]/g, ""))} placeholder="e.g. 123456789" style={{ width: 170 }} />
                    {planData?.merchantId ? <span style={{ fontSize: 11.5, fontWeight: 600, color: CL.green }}>auto-detected ✓</span> : <span style={{ fontSize: 11.5, color: CL.sub2 }}>top-right of Merchant Center</span>}
                  </div>
                </div>
                <div style={{ background: CL.line3, borderRadius: 10, padding: "10px 13px", fontSize: 12, color: CL.sub, lineHeight: 1.55 }}>
                  Feed-only Performance Max: Google builds the ads from your Merchant Center product data — no creatives needed. Campaigns land <strong>{status === "PAUSED" ? "paused" : "enabled"}</strong>; give PMax 1–2 weeks to learn once enabled.
                </div>
              </div>
            </div>

            <div style={{ ...card, padding: 18 }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>How your ads will look</div>
              <div style={{ fontSize: 12, color: CL.sub, marginBottom: 12 }}>Google Shopping ads built from your feed — images, titles &amp; prices come straight from your products.</div>
              <div className="ac-ads">
                {previewProducts.length ? previewProducts.map((p: any, i: number) => (
                  <div key={i} style={{ border: `1px solid ${CL.line}`, borderRadius: 12, overflow: "hidden", background: "#fff" }}>
                    <div style={{ height: 130, background: "#FAFBFC", display: "flex", alignItems: "center", justifyContent: "center", padding: 8 }}>
                      {p.image ? <img src={p.image} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /> : <div style={{ width: "70%", height: "80%", borderRadius: 8, background: "repeating-linear-gradient(135deg,#EEF2F6 0 6px,#E6EBF1 6px 12px)" }} />}
                    </div>
                    <div style={{ padding: "9px 11px", borderTop: `1px solid ${CL.line2}` }}>
                      <div className="ac-clamp2" style={{ fontSize: 12, fontWeight: 500, color: "#1a0dab", lineHeight: 1.35, minHeight: 32 }}>{p.title}</div>
                      <div style={{ fontFamily: MONO, fontSize: 13.5, fontWeight: 700, marginTop: 3, color: CL.ink }}>{money(p.price, storeCurrency)}</div>
                      <div style={{ fontSize: 10.5, color: CL.sub2, marginTop: 2 }}><span style={{ fontWeight: 700, color: "#188038" }}>Sponsored</span> · {domain}</div>
                    </div>
                  </div>
                )) : <div style={{ fontSize: 12.5, color: CL.sub2 }}>Generate a plan to preview the ads.</div>}
              </div>
            </div>
          </div>
        ) : null}

        {/* ── create ── */}
        {campaigns.length ? (
          <div style={{ ...card, padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>Create in Google Ads</div>
                <div style={{ fontSize: 12.5, color: CL.sub, marginTop: 3 }}>{`Preview — will create ${campaigns.length} NEW campaigns · ${money(budgetNum, adsCurrency)}/day total · ${status === "PAUSED" ? "paused (enable after review)" : "enabled immediately"}.`}</div>
                {data.published > 0 ? <div style={{ fontSize: 11.5, color: CL.sub2, marginTop: 4 }}>This doesn&rsquo;t change your already-published campaigns — their <strong>live</strong> status &amp; budget are in <strong>Campaign health</strong> above.</div> : null}
              </div>
              <button className="ac-btn" onClick={doCreate} disabled={busy || pctSum !== 100 || budgetNum <= 0 || !merchantId} title={!merchantId ? "Enter your Merchant Center ID first" : pctSum !== 100 ? "Budget split must equal 100%" : undefined} style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 44, padding: "0 22px", border: "none", borderRadius: 12, background: CL.inkDeep, color: "#fff", fontWeight: 700, fontSize: 14, boxShadow: "0 8px 16px -8px rgba(16,26,36,0.6)" }}>
                {create.state !== "idle" ? <span className="ac-spin" /> : "🚀"} Create campaigns
              </button>
            </div>
            {create.data?.ok ? (
              <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                {(create.data.results || []).map((r: any, i: number) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 13px", borderRadius: 10, background: r.ok ? CL.greenBg : r.skipped ? CL.line3 : "#FDECEC", fontSize: 12.5 }}>
                    <span style={{ fontWeight: 700, color: r.ok ? CL.green : r.skipped ? CL.sub : "#B42318" }}>{r.ok ? "✓" : r.skipped ? "–" : "✗"}</span>
                    <div>
                      <span style={{ fontWeight: 700 }}>{r.name}</span>
                      <span style={{ color: CL.sub, marginLeft: 8 }}>{money(r.dailyBudget, adsCurrency)}/day</span>
                      {r.ok ? <span style={{ color: CL.green, marginLeft: 8 }}>created{create.data.status === "PAUSED" ? " (paused)" : ""}</span> : <div style={{ color: r.skipped ? CL.sub : "#B42318", marginTop: 2 }}>{r.error} {r.step && !r.skipped ? `(step: ${r.step})` : ""}</div>}
                      {r.warning ? <div style={{ color: "#93700A", marginTop: 2, fontSize: 12 }}>⚠ {r.warning}</div> : null}
                    </div>
                  </div>
                ))}
                {Array.isArray(create.data.exclusionNotes) && create.data.exclusionNotes.length ? (
                  <div style={{ fontSize: 12, color: "#93700A", background: "#FEF7E6", borderRadius: 10, padding: "9px 12px" }}>
                    {create.data.exclusionNotes.map((n: string, i: number) => <div key={i}>⚠ {n}</div>)}
                  </div>
                ) : null}
                {create.data.created > 0 ? (
                  <div style={{ fontSize: 12.5, color: CL.sub, marginTop: 4 }}>
                    Review them at <a href="https://ads.google.com" target="_blank" rel="noopener noreferrer" style={{ color: CL.tealDeep, fontWeight: 600 }}>ads.google.com</a> — check products, locations &amp; tracking, then enable. New PMax campaigns typically take a few days to learn.
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <Notice tone="info">Campaigns are created as <strong>feed-only Performance Max</strong> scoped to each group&rsquo;s products, <strong>paused by default</strong> — nothing spends until you enable them in Google Ads. Product targeting uses the item IDs Google has seen for your store; brand-new products fall into the catch-all automatically.</Notice>
      </div>
    </div>
  );
}
