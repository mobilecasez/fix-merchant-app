import { json, type ActionFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { getWebEmail } from "../utils/web-session.server";
import { runWebTierScan } from "../utils/web-tier-scan.server";

// Re-run the scan for an already-paid report (e.g. after the merchant fixes issues),
// at the tier they own. Gated on a verified payment + matching session. The scan runs
// in the background; the report screen polls scanStatus until it's COMPLETE.
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, { status: 405 });
  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }
  const scanId = String(body?.scanId || "");
  if (!scanId) return json({ ok: false, error: "Missing scan id." }, { status: 400 });

  const email = await getWebEmail(request);
  if (!email) return json({ ok: false, error: "Please sign in." }, { status: 401 });

  const scan = await prisma.webScan.findUnique({ where: { id: scanId } });
  if (!scan || !scan.paidTier || scan.email !== email) {
    return json({ ok: false, error: "This report isn't unlocked on this account." }, { status: 402 });
  }

  await prisma.webScan.update({ where: { id: scanId }, data: { scanStatus: "PROCESSING" } }).catch(() => {});
  setImmediate(() => {
    runWebTierScan(scanId, scan.paidTier as string).catch((e) => console.error("[web-rescan] error:", e));
  });
  return json({ ok: true, scanStatus: "PROCESSING" });
}
