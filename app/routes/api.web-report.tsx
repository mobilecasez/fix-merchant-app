import { json, type LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { getWebEmail } from "../utils/web-session.server";

// Returns the FULL scan report (issues incl. fix instructions) — gated behind a
// verified payment AND a matching logged-in session.
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

  return json({
    ok: true,
    storeUrl: scan.storeUrl,
    storeDomain: scan.storeDomain,
    score: scan.score,
    riskLevel: scan.riskLevel,
    totalIssues: scan.totalIssues,
    highCount: scan.highCount,
    paidTier: scan.paidTier,
    issues: scan.fullResult || [], // [{ sev, title, why, fix, cat }]
  });
}
