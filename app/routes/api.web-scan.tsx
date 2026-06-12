import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { runMonitoringScan } from "../utils/store-scanner.server";
import { normalizeStoreUrl, mapBasicResult, toPreview, assertPublicHost } from "../utils/web-scan.server";
import { getWebEmail } from "../utils/web-session.server";

const PREVIEW_COUNT = 2; // free issues shown in the preview; the rest are locked
const IP_HOURLY_LIMIT = 12; // soft abuse cap per IP per hour

function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

export async function loader() {
  return json({ error: "Method not allowed" }, { status: 405 });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, { status: 405 });

  let body: any = {};
  try { body = await request.json(); } catch { /* tolerate form posts below */ }
  if (!body || !body.url) {
    try { const fd = await request.formData(); body = { url: fd.get("url") }; } catch { /* ignore */ }
  }

  const norm = normalizeStoreUrl(String(body?.url || ""));
  if (!norm) {
    return json({ ok: false, error: "Please enter a valid store URL (e.g. mystore.com)." }, { status: 400 });
  }
  const { url, domain } = norm;
  const ip = clientIp(request);
  const userAgent = (request.headers.get("user-agent") || "").slice(0, 300);
  const sessionEmail = await getWebEmail(request); // null if not signed in

  try {
    // Soft per-IP rate limit.
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await prisma.webScan.count({ where: { ip, createdAt: { gte: since } } });
    if (recent >= IP_HOURLY_LIMIT) {
      return json({ ok: false, error: "Too many scans from your network. Please try again later." }, { status: 429 });
    }

    // Dedup: one free Basic scan per store domain. If already scanned, return the
    // saved preview and prompt to unlock — don't run another free scan.
    const existing = await prisma.webScan.findFirst({
      where: { storeDomain: domain },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      const prev = (((existing.preview as any[]) || []).slice(0, PREVIEW_COUNT));
      // "owned": this store was paid for AND the current visitor is signed in as
      // the buyer. They get their full report straight from the DB — no re-scan,
      // no re-payment, no recovery key needed.
      const owned = !!existing.paidTier && !!sessionEmail && existing.email === sessionEmail;
      return json({
        ok: true,
        alreadyScanned: true,
        scanId: existing.id,
        storeUrl: existing.storeUrl,
        storeDomain: existing.storeDomain,
        score: existing.score,
        riskLevel: existing.riskLevel,
        totalIssues: existing.totalIssues,
        highCount: existing.highCount,
        pagesScanned: 7,
        checksRun: 38,
        freePreview: prev,
        lockedCount: Math.max(0, existing.totalIssues - prev.length),
        paid: !!existing.paidTier,
        paidTier: existing.paidTier || null,
        owned,
      });
    }

    // SSRF guard: confirm the host resolves to a public IP before any server-side fetch.
    if (!(await assertPublicHost(domain))) {
      return json({ ok: false, error: "That store URL could not be reached as a public store." }, { status: 400 });
    }
    // Run the real Basic scan against the live storefront.
    const result = await runMonitoringScan(url);
    if (!result) {
      return json({
        ok: false,
        error: "We couldn't reach that store. Make sure it's a live, public Shopify store URL (not password-protected).",
      }, { status: 422 });
    }

    const mapped = mapBasicResult(result, url, domain);
    const preview = toPreview(mapped, PREVIEW_COUNT);

    const saved = await prisma.webScan.create({
      data: {
        storeDomain: domain,
        storeUrl: url,
        ip,
        userAgent,
        score: mapped.score,
        riskLevel: mapped.riskLevel,
        totalIssues: mapped.totalIssues,
        highCount: mapped.highCount,
        preview,
        fullResult: mapped.issues as any, // gated; only returned after payment
      },
    });

    return json({
      ok: true,
      alreadyScanned: false,
      scanId: saved.id,
      storeUrl: url,
      storeDomain: domain,
      score: mapped.score,
      riskLevel: mapped.riskLevel,
      totalIssues: mapped.totalIssues,
      highCount: mapped.highCount,
      pagesScanned: mapped.pagesScanned,
      checksRun: mapped.checksRun,
      freePreview: preview,
      lockedCount: Math.max(0, mapped.totalIssues - preview.length),
      paid: false,
    });
  } catch (error) {
    console.error("[web-scan] failed:", error);
    return json({ ok: false, error: "The scan failed unexpectedly. Please try again." }, { status: 500 });
  }
}
