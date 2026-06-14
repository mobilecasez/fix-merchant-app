import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import nodemailer from "nodemailer";
import { runMonitoringScan, extractBasicIssues } from "../utils/store-scanner.server";
import {
  incrementProductUsage, getOrCreateSubscription, getProductsUsed, getEffectiveProductLimit,
} from "../utils/billing.server";

const APP_URL = process.env.SHOPIFY_APP_URL || "https://shopflixai-production.up.railway.app";
const MONITOR_CREDIT = 2; // credits consumed per automated monitoring check

const FREQUENCY_MS: Record<string, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

function isDue(monitor: any): boolean {
  if (!monitor.enabled) return false;
  if (!monitor.lastRunAt) return true;
  const interval = FREQUENCY_MS[monitor.frequency] || FREQUENCY_MS.weekly;
  // Small grace (1h) so an hourly/daily cron reliably catches the boundary.
  return Date.now() - new Date(monitor.lastRunAt).getTime() >= interval - 60 * 60 * 1000;
}

function sevColor(s: string) {
  const x = (s || "").toLowerCase();
  if (x === "high") return "#d72c0d";
  if (x === "medium") return "#b98900";
  return "#637381";
}

function buildEmail(shopName: string, storeUrl: string, newIssues: any[], totalOpen: number, firstRun: boolean): { subject: string; html: string } {
  const subject = firstRun
    ? `✅ Compliance monitoring is on — ${shopName}`
    : `⚠️ ${newIssues.length} new compliance issue${newIssues.length !== 1 ? "s" : ""} detected — ${shopName}`;

  const issueRows = newIssues.map((i: any) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee;">
        <span style="display:inline-block;font-size:11px;font-weight:700;color:#fff;background:${sevColor(i.severity)};border-radius:4px;padding:2px 7px;margin-right:8px;">${i.severity}</span>
        <span style="font-size:14px;color:#212121;">${i.label}</span>
      </td>
    </tr>`).join("");

  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:600px;margin:0 auto;color:#212121;">
    <div style="background:linear-gradient(135deg,#1a4a5a,#2A5B6D);padding:24px;border-radius:10px 10px 0 0;color:#fff;text-align:center;">
      <div style="font-size:30px;">🛡️</div>
      <h1 style="margin:8px 0 0;font-size:20px;">ShopFlix AI — Store Monitoring</h1>
      <p style="margin:6px 0 0;font-size:13px;opacity:.85;">${shopName} · ${storeUrl}</p>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;padding:24px;">
      ${firstRun ? `
        <p style="font-size:15px;line-height:1.6;">Monitoring is now active for your store. We'll automatically re-check your store's Google Merchant Center compliance and email you only when a <strong>new</strong> issue appears.</p>
        ${newIssues.length ? `<p style="font-size:14px;color:#92400e;">We found ${newIssues.length} issue${newIssues.length !== 1 ? "s" : ""} on this first check:</p>` : `<p style="font-size:14px;color:#166534;">✓ No issues found — your store is clean right now.</p>`}
      ` : `
        <p style="font-size:15px;line-height:1.6;">Our latest automated check detected <strong>${newIssues.length} new compliance issue${newIssues.length !== 1 ? "s" : ""}</strong> on your store. These can put your Google Shopping listings at risk — we recommend fixing them soon.</p>
      `}
      ${newIssues.length ? `<table style="width:100%;border-collapse:collapse;margin:12px 0;">${issueRows}</table>` : ""}
      <p style="font-size:13px;color:#666;">Total open issues right now: <strong>${totalOpen}</strong></p>
      <div style="text-align:center;margin:20px 0 8px;">
        <a href="${APP_URL}/app/store-error-report" style="display:inline-block;background:#1a4a5a;color:#fff;text-decoration:none;padding:11px 24px;border-radius:8px;font-weight:700;font-size:14px;">Open ShopFlix AI &amp; fix now →</a>
      </div>
      <p style="font-size:11px;color:#9ca3af;text-align:center;margin-top:16px;">You're receiving this because store monitoring is enabled. Manage it in ShopFlix AI → Protect & Grow.</p>
    </div>
  </div>`;

  return { subject, html };
}

/** Process all due monitors. Shared by GET and POST. */
async function runMonitorBatch(): Promise<any> {
  const monitors = await (prisma as any).storeMonitor.findMany({ where: { enabled: true } });
  const due = monitors.filter(isDue);

  // Send report emails via the same Zoho SMTP used elsewhere in the app.
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const mailer = (smtpUser && smtpPass)
    ? nodemailer.createTransport({ host: "smtp.zoho.in", port: 465, secure: true, auth: { user: smtpUser, pass: smtpPass } })
    : null;

  const summary: any[] = [];

  for (const m of due) {
    try {
      // Each automated check consumes MONITOR_CREDIT credits. Skip (without
      // updating lastRunAt) when the shop can't cover it, so it resumes once
      // they top up rather than silently losing the check.
      const sub = await getOrCreateSubscription(m.shop);
      const used = getProductsUsed(sub);
      const limit = getEffectiveProductLimit(sub);
      if (used + MONITOR_CREDIT > limit) {
        summary.push({ shop: m.shop, status: "skipped (insufficient credits)" });
        continue;
      }

      const result = await runMonitoringScan(m.storeUrl);
      if (!result) {
        // Unreachable / password-protected — record the attempt, skip alerting.
        await (prisma as any).storeMonitor.update({
          where: { id: m.id },
          data: { lastRunAt: new Date() },
        });
        summary.push({ shop: m.shop, status: "skipped (unreachable/locked)" });
        continue;
      }

      // Charge for the completed check (a reachable store that produced a result).
      for (let i = 0; i < MONITOR_CREDIT; i++) await incrementProductUsage(m.shop);

      const issues = extractBasicIssues(result);
      const currentFps = issues.map(i => i.fp);
      const baseline: string[] = Array.isArray(m.baseline) ? m.baseline : [];
      const firstRun = !m.lastRunAt;

      const baseSet = new Set(baseline);
      const newIssues = issues.filter(i => !baseSet.has(i.fp));

      // Email on: first run (welcome/summary) OR any new issue appeared.
      const shouldEmail = mailer && m.email && (firstRun || newIssues.length > 0);
      if (shouldEmail) {
        const shopName = m.shop.replace(/\.myshopify\.com$/, "");
        const { subject, html } = buildEmail(shopName, m.storeUrl, newIssues, issues.length, firstRun);
        // Zoho requires the From address to match the authenticated SMTP user.
        await mailer!.sendMail({
          from: `ShopFlix AI <${smtpUser}>`,
          to: m.email,
          subject,
          html,
        }).catch((e: any) => console.error(`[monitor] email failed for ${m.shop}:`, e));
      }

      await (prisma as any).storeMonitor.update({
        where: { id: m.id },
        data: { lastRunAt: new Date(), baseline: currentFps, lastIssueCount: issues.length },
      });

      summary.push({ shop: m.shop, totalIssues: issues.length, newIssues: newIssues.length, emailed: !!shouldEmail });
    } catch (e: any) {
      console.error(`[monitor] failed for ${m.shop}:`, e);
      summary.push({ shop: m.shop, status: "error", error: e.message });
    }
  }

  return { processed: due.length, total: monitors.length, summary };
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // must be configured to run
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || request.headers.get("x-cron-secret") || "";
  return token === secret;
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (!authorized(request)) return json({ error: "Unauthorized" }, { status: 401 });
  const result = await runMonitorBatch();
  return json({ ok: true, ...result });
}

export async function action({ request }: ActionFunctionArgs) {
  if (!authorized(request)) return json({ error: "Unauthorized" }, { status: 401 });
  const result = await runMonitorBatch();
  return json({ ok: true, ...result });
}
