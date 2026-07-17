import { json, type LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { getWebEmail } from "../utils/web-session.server";
import { runWebTierScan } from "../utils/web-tier-scan.server";

// Returns the FULL scan report (issues incl. fix instructions) — gated behind a
// verified payment AND a matching logged-in session. Also reports scanStatus so the
// client can poll while a paid deeper scan runs, and self-heals a stuck scan.
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const scanId = url.searchParams.get("scanId") || "";
  if (!scanId) return json({ ok: false, error: "Missing scan id." }, { status: 400 });

  const email = await getWebEmail(request);
  if (!email) return json({ ok: false, error: "Please sign in." }, { status: 401 });

  const scan = await prisma.webScan.findUnique({ where: { id: scanId } });
  if (!scan) return json({ ok: false, error: "Scan not found." }, { status: 404 });

  if (!scan.paidTier || scan.email !== email) {
    return json({ ok: false, error: "This report hasn't been unlocked on this account." }, { status: 402 });
  }

  // Self-heal the durable background scan: if a paid deeper scan is pending, failed, or
  // has been "processing" too long (e.g. the server restarted mid-scan), re-trigger it
  // here — so simply reopening the report recovers a stuck scan. No-op for Basic.
  let status: string = (scan as any).scanStatus || "COMPLETE";
  if (scan.paidTier !== "basic") {
    const staleMs = Date.now() - new Date(scan.updatedAt).getTime();
    const needsRun = status === "PENDING" || status === "FAILED" || (status === "PROCESSING" && staleMs > 2 * 60 * 1000);
    if (needsRun) {
      await prisma.webScan.update({ where: { id: scan.id }, data: { scanStatus: "PROCESSING" } }).catch(() => {});
      status = "PROCESSING";
      setImmediate(() => {
        runWebTierScan(scan.id, scan.paidTier as string).catch((e) => console.error("[web-report] self-heal scan error:", e));
      });
    }
  } else {
    status = "COMPLETE";
  }

  return json({
    ok: true,
    storeUrl: scan.storeUrl,
    storeDomain: scan.storeDomain,
    score: scan.score,
    riskLevel: scan.riskLevel,
    totalIssues: scan.totalIssues,
    highCount: scan.highCount,
    paidTier: scan.paidTier,
    scanStatus: status,
    productsScanned: (scan as any).productsScanned || 0,
    issues: scan.fullResult || [], // [{ sev, title, why, fix, cat }]
  });
}
