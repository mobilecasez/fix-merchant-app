import { json, type ActionFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { runMonitoringScan } from "../utils/store-scanner.server";
import { mapBasicResult, toPreview } from "../utils/web-scan.server";
import { recoveryHashOf } from "./api.web-pay";
import { webSessionStorage, getWebSession } from "../utils/web-session.server";

// Redeem a post-payment recovery token: re-runs the scan for the paid store and
// re-authenticates the session so the buyer can view their report again — even
// if the original scan failed. The token is matched by its HMAC hash.
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, { status: 405 });

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }
  const token = String(body?.token || "").trim();
  if (token.length < 8) return json({ ok: false, error: "Enter your recovery key." }, { status: 400 });

  const scan = await prisma.webScan.findFirst({ where: { recoveryHash: recoveryHashOf(token) } });
  if (!scan || !scan.paidTier) {
    return json({ ok: false, error: "Invalid or unknown recovery key." }, { status: 404 });
  }

  // Re-run the live Basic scan; refresh stored results if it succeeds.
  try {
    const result = await runMonitoringScan(scan.storeUrl);
    if (result) {
      const mapped = mapBasicResult(result, scan.storeUrl, scan.storeDomain);
      await prisma.webScan.update({
        where: { id: scan.id },
        data: {
          score: mapped.score, riskLevel: mapped.riskLevel,
          totalIssues: mapped.totalIssues, highCount: mapped.highCount,
          preview: toPreview(mapped, 2), fullResult: mapped.issues as any,
        },
      });
    }
  } catch (e) {
    console.error("[web-recover] re-scan failed (keeping prior results):", e);
  }

  // Re-authenticate the session to the buyer's email so the gated report loads.
  const session = await getWebSession(request);
  if (scan.email) session.set("email", scan.email);

  return json(
    { ok: true, scanId: scan.id, storeUrl: scan.storeUrl, planId: scan.paidTier },
    { headers: { "Set-Cookie": await webSessionStorage.commitSession(session) } }
  );
}
