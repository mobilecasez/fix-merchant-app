import { json, type ActionFunctionArgs } from "@remix-run/node";
import crypto from "node:crypto";
import prisma from "../db.server";
import { getWebEmail, getWebSession, webSessionStorage } from "../utils/web-session.server";
import { runWebTierScan } from "../utils/web-tier-scan.server";

// USD prices (smallest unit = cents). Mirrors the website PLANS.
const PLAN_PRICE_CENTS: Record<string, number> = { basic: 399, advanced: 599, deep: 999 };
const PLAN_NAME: Record<string, string> = { basic: "Basic Scan", advanced: "Advanced Scan", deep: "Deep Scan" };
const emailOk = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(e);

const RECOVERY_SECRET = process.env.WEB_SESSION_SECRET || process.env.SHOPIFY_API_SECRET || "shopflix-recovery-dev";
// Keyed hash of the recovery token. Irreversible: a DB breach exposes only this
// hash, which cannot be turned back into a usable token (attacker also lacks the secret).
export function recoveryHashOf(token: string): string {
  return crypto.createHmac("sha256", RECOVERY_SECRET).update(token).digest("hex");
}

// Best-effort client IP (Railway/most PaaS sit behind a proxy → trust x-forwarded-for).
function clientIp(request: Request): string | null {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip") || request.headers.get("cf-connecting-ip") || null;
}

// Append-only payment audit trail. Never throws into the request path.
async function logPay(data: {
  action: string; email?: string | null; scanId?: string | null; planId?: string | null;
  amount?: number | null; currency?: string | null; orderId?: string | null; paymentId?: string | null;
  status?: string | null; storeDomain?: string | null; error?: string | null;
  ip?: string | null; userAgent?: string | null;
}) {
  try {
    await prisma.webPaymentLog.create({ data });
  } catch (e) {
    console.error("[web-pay] audit log write failed:", e);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, { status: 405 });

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }
  const intent = String(body?.intent || "");
  const planId = String(body?.planId || "");
  const scanId = String(body?.scanId || "");
  const ip = clientIp(request);
  const userAgent = request.headers.get("user-agent");

  if (!PLAN_PRICE_CENTS[planId]) return json({ ok: false, error: "Unknown plan." }, { status: 400 });

  // Test vs live key selection, controlled by the RAZORPAY_TEST_MODE flag (true/1/yes/on).
  // When on, Razorpay test-mode keys are used so checkouts can be exercised without real
  // charges; when off (default), the live keys are used. Read once so create + verify use
  // the same pair within a request.
  const testMode = /^(1|true|yes|on)$/i.test((process.env.RAZORPAY_TEST_MODE || "").trim());
  const keyId = testMode ? process.env.RAZORPAY_TEST_KEY_ID : process.env.RAZORPAY_KEY_ID;
  const keySecret = testMode ? process.env.RAZORPAY_TEST_KEY_SECRET : process.env.RAZORPAY_KEY_SECRET;

  // ── Create a Razorpay order ────────────────────────────────────────────────
  if (intent === "create") {
    // No account/password required. We capture the buyer's email here — used for the
    // receipt, report delivery, Razorpay prefill, and the payment audit trail. Falls
    // back to a remembered session email if the client already has one.
    const bodyEmail = String(body?.email || "").trim().toLowerCase();
    const email = emailOk(bodyEmail) ? bodyEmail : await getWebEmail(request);
    if (!email || !emailOk(email)) {
      return json({ ok: false, error: "Please enter a valid email to continue." }, { status: 400 });
    }
    if (!keyId || !keySecret) {
      return json({ ok: false, configured: false, error: "Payments are launching soon. In the meantime, install the Shopify app for the full scan suite." });
    }
    const scan = await prisma.webScan.findUnique({ where: { id: scanId } });
    if (!scan) return json({ ok: false, error: "Scan not found — please re-scan your store." }, { status: 404 });

    const amount = PLAN_PRICE_CENTS[planId];
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const receipt = `sfx_${scanId.slice(0, 18)}_${planId}`;
    try {
      const res = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          amount, currency: "USD", receipt,
          notes: { scanId, planId, email, store: scan.storeDomain },
        }),
      });
      const order = await res.json();
      if (!res.ok || !order?.id) {
        console.error("[web-pay] order create failed:", order);
        await logPay({ action: "create_failed", email, scanId, planId, amount, currency: "USD", storeDomain: scan.storeDomain, status: String(res.status), error: JSON.stringify(order?.error || order || "").slice(0, 500), ip, userAgent });
        return json({ ok: false, error: "Could not start checkout. Please try again." }, { status: 502 });
      }
      await logPay({ action: "create", email, scanId, planId, amount, currency: "USD", orderId: order.id, storeDomain: scan.storeDomain, status: order.status, ip, userAgent });

      // Remember the email in the web session so the buyer can reopen their report in
      // this browser without re-entering it — no password involved.
      const session = await getWebSession(request);
      session.set("email", email);
      return json(
        { ok: true, configured: true, orderId: order.id, keyId, amount, currency: "USD", planName: PLAN_NAME[planId], email },
        { headers: { "Set-Cookie": await webSessionStorage.commitSession(session) } },
      );
    } catch (e) {
      console.error("[web-pay] create error:", e);
      await logPay({ action: "create_error", email, scanId, planId, amount: PLAN_PRICE_CENTS[planId], currency: "USD", error: String((e as any)?.message || e).slice(0, 500), ip, userAgent });
      return json({ ok: false, error: "Could not start checkout. Please try again." }, { status: 502 });
    }
  }

  // ── Verify the payment signature ───────────────────────────────────────────
  if (intent === "verify") {
    if (!keyId || !keySecret) return json({ ok: false, error: "Payments not configured." }, { status: 400 });
    const orderId = String(body?.razorpay_order_id || "");
    const paymentId = String(body?.razorpay_payment_id || "");
    const signature = String(body?.razorpay_signature || "");
    if (!orderId || !paymentId || !signature) return json({ ok: false, error: "Missing payment details." }, { status: 400 });

    const expected = crypto.createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest("hex");
    // timing-safe compare
    const ok = expected.length === signature.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    if (!ok) {
      console.warn("[web-pay] signature mismatch for order", orderId);
      await logPay({ action: "verify_failed", scanId, planId, orderId, paymentId, status: "signature_mismatch", ip, userAgent });
      return json({ ok: false, error: "Payment could not be verified." }, { status: 400 });
    }

    // The signature only proves the order/payment pair is authentic — it does NOT
    // prove which scan/tier/amount was paid. Re-fetch the order from Razorpay and
    // trust ONLY its server-side notes + amount + paid status. This prevents a
    // client from claiming a higher tier than they paid for, or marking an
    // arbitrary (e.g. someone else's) scan paid by passing a forged scanId/planId.
    let order: any;
    try {
      const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
      const res = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      order = await res.json();
      if (!res.ok || !order?.id) throw new Error("order fetch failed");
    } catch (e) {
      console.error("[web-pay] order fetch failed:", e);
      await logPay({ action: "verify_error", orderId, paymentId, status: "order_fetch_failed", error: String((e as any)?.message || e).slice(0, 300), ip, userAgent });
      return json({ ok: false, error: "Could not confirm your payment. Please contact support." }, { status: 502 });
    }

    const paidEmail = String(order?.notes?.email || "");
    const storeDomain = String(order?.notes?.store || "");
    const isPaid = order.status === "paid" || Number(order.amount_paid) === Number(order.amount);
    if (!isPaid) {
      await logPay({ action: "verify_failed", email: paidEmail || null, scanId, orderId, paymentId, amount: Number(order.amount) || null, currency: order.currency, status: order.status || "not_paid", storeDomain, ip, userAgent });
      return json({ ok: false, error: "Payment not completed." }, { status: 400 });
    }

    const paidScanId = String(order?.notes?.scanId || "");
    const paidPlanId = String(order?.notes?.planId || "");
    if (!paidScanId || !PLAN_PRICE_CENTS[paidPlanId]) {
      await logPay({ action: "verify_failed", email: paidEmail || null, orderId, paymentId, status: "metadata_invalid", storeDomain, ip, userAgent });
      return json({ ok: false, error: "Payment metadata invalid." }, { status: 400 });
    }
    if (Number(order.amount) !== PLAN_PRICE_CENTS[paidPlanId]) {
      console.warn("[web-pay] amount mismatch", order.amount, "expected", PLAN_PRICE_CENTS[paidPlanId]);
      await logPay({ action: "amount_mismatch", email: paidEmail || null, scanId: paidScanId, planId: paidPlanId, amount: Number(order.amount), currency: order.currency, orderId, paymentId, status: order.status, storeDomain, ip, userAgent });
      return json({ ok: false, error: "Payment amount mismatch." }, { status: 400 });
    }

    const email = emailOk(paidEmail) ? paidEmail : (await getWebEmail(request)) || "";

    // Issue a one-time recovery token (stored only as an HMAC hash). Mark paid using
    // the authoritative scanId/planId from the order, never the client-supplied ones.
    const recoveryToken = `SFX-${crypto.randomBytes(15).toString("base64url")}`;
    // Advanced/Deep run a deeper scan in the background after payment; Basic's full
    // report is already computed at free-scan time, so it's COMPLETE immediately.
    const isDeeper = paidPlanId === "advanced" || paidPlanId === "deep";
    await prisma.webScan.update({
      where: { id: paidScanId },
      data: {
        paidTier: paidPlanId, email: email || undefined, recoveryHash: recoveryHashOf(recoveryToken),
        scanStatus: isDeeper ? "PROCESSING" : "COMPLETE",
      },
    }).catch((e) => console.error("[web-pay] mark paid failed:", e));

    await logPay({ action: "paid", email: email || null, scanId: paidScanId, planId: paidPlanId, amount: Number(order.amount), currency: order.currency, orderId, paymentId, status: "paid", storeDomain, ip, userAgent });

    // Kick off the purchased tier's deeper scan in the background. It keeps running even
    // if the buyer closes the browser; the report screen polls until it's COMPLETE, and
    // api.web-report self-heals it if the server restarts mid-scan.
    if (isDeeper) {
      setImmediate(() => {
        runWebTierScan(paidScanId, paidPlanId).catch((e) => console.error("[web-pay] background tier scan error:", e));
      });
    }

    // Re-authenticate the session to the buyer's email (no password) so the gated
    // report loads in this browser.
    const session = await getWebSession(request);
    if (email) session.set("email", email);
    return json(
      { ok: true, recoveryToken },
      { headers: { "Set-Cookie": await webSessionStorage.commitSession(session) } },
    );
  }

  return json({ ok: false, error: "Unknown action." }, { status: 400 });
}
