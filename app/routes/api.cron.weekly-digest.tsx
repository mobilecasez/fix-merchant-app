/**
 * Weekly profit digest — pushed, not pulled (the retention pattern every top profit-analytics
 * tool's best reviews cite). For every shop with a saved AI Profit Report (and the digest not
 * turned off), emails a compact summary: headline, profit waterfall, segment chips and the top
 * quick wins, with a deep link back to the full report.
 *
 * Trigger: GitHub Actions weekly cron → GET/POST /api/cron/weekly-digest with x-cron-secret
 * (same CRON_SECRET pattern as /api/cron/monitor).
 */
import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import crypto from "node:crypto";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { sendEmail } from "../utils/email.server";

const APP_CLIENT_ID = "85d12decc346b5ec3cdfebacdce7f290"; // admin deep-link handle fallback

/** HMAC for the one-click unsubscribe link (keyed off CRON_SECRET — no session needed). */
function unsubSig(shop: string): string {
  return crypto.createHmac("sha256", process.env.CRON_SECRET || "no-secret").update(`digest-unsub:${shop}`).digest("hex").slice(0, 32);
}

const BUCKET_LABEL: Record<string, string> = {
  MARGIN_IMPOSSIBLE: "Margin impossible", BLEEDER: "Ad bleeders", RTO_LEAK: "RTO leaks",
  TRUE_DRAIN: "True drains", LOSS_LEADER: "Loss leaders", WINNER: "Winners",
  HIDDEN_GEM: "Hidden gems", RAISE_PRICE: "Raise price", PRICE_TEST: "Price tests",
  WATCH: "Watchlist", ZOMBIE: "Zombies", OK: "Healthy",
};
const CHIP_COLOR: Record<string, string> = {
  MARGIN_IMPOSSIBLE: "#B42318", BLEEDER: "#B42318", RTO_LEAK: "#B54708", TRUE_DRAIN: "#B42318",
  LOSS_LEADER: "#3538CD", WINNER: "#067647", HIDDEN_GEM: "#6941C6", RAISE_PRICE: "#0E7569",
  PRICE_TEST: "#93700A", WATCH: "#475467", ZOMBIE: "#98A2B3", OK: "#475467",
};

function esc(s: any): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function money(sym: string, n: any): string {
  const v = Number(n) || 0;
  return `${sym}${Math.round(v).toLocaleString("en-IN")}`;
}

function digestHtml(shop: string, report: any, meta: any): string {
  const sym = (() => {
    try {
      const parts = new Intl.NumberFormat("en", { style: "currency", currency: meta.currency || "INR" }).formatToParts(0);
      return parts.find((p) => p.type === "currency")?.value || "₹";
    } catch { return "₹"; }
  })();
  const wf = meta.waterfall || {};
  const sc = meta.screened || {};
  const counts = sc.counts || {};
  const appLink = `https://${shop}/admin/apps/${APP_CLIENT_ID}/app/price-radar`;
  const chips = Object.keys(BUCKET_LABEL)
    .filter((b) => (counts[b] || 0) > 0 && b !== "OK" && b !== "ZOMBIE")
    .map((b) => `<span style="display:inline-block;margin:0 6px 6px 0;padding:3px 10px;border-radius:999px;background:#F2F4F7;color:${CHIP_COLOR[b]};font-size:12px;font-weight:700;">${counts[b]} ${BUCKET_LABEL[b]}</span>`)
    .join("");
  const wins: string[] = (report.quickWins || []).slice(0, 3);
  const wfRow = (label: string, value: string, color: string, bold = false) =>
    `<tr><td style="padding:4px 0;color:#5B6470;font-size:13px;">${label}</td><td align="right" style="padding:4px 0;color:${color};font-size:13px;font-weight:${bold ? 700 : 600};font-family:monospace;">${value}</td></tr>`;
  return `
  <div style="max-width:600px;margin:0 auto;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#101A24;">
    <div style="background:#5B21B6;border-radius:14px;padding:22px 24px;color:#fff;">
      <div style="font-size:19px;font-weight:800;">Your weekly profit digest</div>
      <div style="font-size:12.5px;color:#DDD6FE;margin-top:5px;">${esc(meta.rangeLabel || "")} · ShopFlix AI Profit Advisor</div>
    </div>
    <div style="padding:20px 4px;">
      <div style="font-size:15.5px;font-weight:700;color:#0E7569;line-height:1.45;">${esc(report.headline || "Your profit report is ready.")}</div>
      ${report.summary ? `<div style="font-size:13.5px;color:#3A4452;line-height:1.6;margin-top:8px;">${esc(report.summary)}</div>` : ""}

      ${wf.revenue > 0 ? `
      <div style="border:1px solid #E8ECF1;border-radius:12px;padding:14px 16px;margin-top:16px;background:#FAFBFD;">
        <div style="font-size:11px;font-weight:700;color:#8A94A2;letter-spacing:.04em;margin-bottom:6px;">WHERE THE MONEY WENT</div>
        <table width="100%" cellpadding="0" cellspacing="0">
          ${wfRow("Revenue", money(sym, wf.revenue), "#101A24", true)}
          ${wf.adSpend > 0 ? wfRow("− Ad spend", "−" + money(sym, wf.adSpend), "#B42318") : ""}
          ${wf.shipCost > 0 ? wfRow("− Shipping", "−" + money(sym, wf.shipCost), "#93700A") : ""}
          ${wf.rtoCost > 0 ? wfRow("− RTO", "−" + money(sym, wf.rtoCost), "#B54708") : ""}
          ${wfRow(wf.profit >= 0 ? "= Net profit" : "= Net loss", money(sym, wf.profit), wf.profit >= 0 ? "#067647" : "#B42318", true)}
        </table>
      </div>` : ""}

      ${chips ? `<div style="margin-top:16px;">${sc.total ? `<div style="font-size:12.5px;font-weight:700;color:#0E7569;margin-bottom:8px;">✓ All ${Number(sc.total).toLocaleString()} products screened</div>` : ""}${chips}</div>` : ""}

      ${wins.length ? `
      <div style="border:1px solid #C7E4DF;border-radius:12px;padding:14px 16px;margin-top:16px;background:#F2FBF8;">
        <div style="font-size:13px;font-weight:700;color:#0E7569;margin-bottom:8px;">Quick wins — do these today</div>
        ${wins.map((w) => `<div style="font-size:13px;color:#2C6E63;line-height:1.55;margin:5px 0;">✓ ${esc(w)}</div>`).join("")}
      </div>` : ""}

      <div style="text-align:center;margin:24px 0 8px;">
        <a href="${appLink}" style="display:inline-block;background:#0E7569;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 26px;border-radius:10px;">Open the full report</a>
      </div>
      <div style="font-size:11px;color:#8A94A2;text-align:center;margin-top:14px;">
        Sent because a Profit Advisor report is saved for ${esc(shop)}. Regenerate it any time from Price Radar for fresh numbers.<br/>
        <a href="${(process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "")}/api/cron/weekly-digest?unsub=1&amp;shop=${encodeURIComponent(shop)}&amp;sig=${unsubSig(shop)}" style="color:#8A94A2;text-decoration:underline;">Unsubscribe from this digest</a>
      </div>
    </div>
  </div>`;
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || request.headers.get("x-cron-secret") || "";
  return token === secret;
}

async function runDigestBatch(): Promise<void> {
  const FRESH_DAYS = 45;  // don't mail a stale report — nudgeless silence beats wrong numbers
  const RESEND_DAYS = 5;  // idempotence: a manual workflow_dispatch re-run must not double-send
  const reports = await prisma.aiReport.findMany({ where: { kind: "profit_advisor" }, orderBy: { updatedAt: "desc" }, take: 100 });
  const skipped: Array<{ shop: string; reason: string }> = [];
  let sent = 0;
  for (const row of reports) {
    const shop = row.shop;
    try {
      const settings: any = await prisma.priceRadarSettings.findUnique({ where: { shop } });
      if (settings && settings.weeklyDigest === false) { skipped.push({ shop, reason: "digest off" }); continue; }
      if (settings?.lastDigestAt && Date.now() - new Date(settings.lastDigestAt).getTime() < RESEND_DAYS * 86400000) { skipped.push({ shop, reason: "recently sent" }); continue; }
      const meta: any = row.meta || {};
      const generatedAt = meta.generatedAt ? new Date(meta.generatedAt) : row.updatedAt;
      if (Date.now() - generatedAt.getTime() > FRESH_DAYS * 86400000) { skipped.push({ shop, reason: "report stale" }); continue; }
      const { admin } = await unauthenticated.admin(shop); // throws for uninstalled shops → caught below
      const resp: any = await admin.graphql(`#graphql query { shop { email name } }`);
      const shopInfo = (await resp.json())?.data?.shop;
      const to = shopInfo?.email || "";
      if (!to) { skipped.push({ shop, reason: "no shop email" }); continue; }
      const ok = await sendEmail({
        to,
        subject: `Your weekly profit digest — ${(row.data as any)?.headline ? String((row.data as any).headline).slice(0, 80) : "ShopFlix AI"}`,
        html: digestHtml(shop, row.data as any, meta),
      });
      if (ok) {
        sent++;
        await prisma.priceRadarSettings.upsert({
          where: { shop }, update: { lastDigestAt: new Date() } as any, create: { shop, lastDigestAt: new Date() } as any,
        }).catch(() => {});
      } else skipped.push({ shop, reason: "smtp failed" });
    } catch (e: any) {
      skipped.push({ shop, reason: String(e?.message || e).slice(0, 120) });
    }
  }
  console.log(`[weekly-digest] done: ${sent} sent of ${reports.length} candidates; skipped: ${JSON.stringify(skipped)}`);
}

/** One-click unsubscribe (HMAC-signed link from the email — no session required). */
async function handleUnsubscribe(url: URL): Promise<Response> {
  const shop = String(url.searchParams.get("shop") || "");
  const sig = String(url.searchParams.get("sig") || "");
  if (!shop || sig !== unsubSig(shop)) return new Response("Invalid unsubscribe link.", { status: 400 });
  await prisma.priceRadarSettings.upsert({
    where: { shop }, update: { weeklyDigest: false } as any, create: { shop, weeklyDigest: false } as any,
  });
  return new Response(
    `<html><body style="font-family:sans-serif;text-align:center;padding-top:80px;color:#101A24;"><h2>Unsubscribed</h2><p>${shop} will no longer receive the weekly profit digest.<br/>You can turn it back on any time from Price Radar → Shipping &amp; costs.</p></body></html>`,
    { headers: { "Content-Type": "text/html" } },
  );
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.get("unsub") === "1") return handleUnsubscribe(url);
  if (!authorized(request)) return json({ error: "Unauthorized" }, { status: 401 });
  // Detached: a big batch (sequential shop loops + SMTP) can outlive the caller's curl timeout —
  // acknowledge immediately, log the summary (same pattern as the AI background jobs).
  void runDigestBatch().catch((e) => console.error("[weekly-digest] batch failed:", e?.message || e));
  return json({ ok: true, started: true }, { status: 202 });
}

export async function loader({ request }: LoaderFunctionArgs) { return handle(request); }
export async function action({ request }: ActionFunctionArgs) { return handle(request); }
