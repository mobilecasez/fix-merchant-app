import { json, type ActionFunctionArgs } from "@remix-run/node";
import crypto from "node:crypto";
import prisma from "../db.server";
import { getWebEmail } from "../utils/web-session.server";

// USD prices (smallest unit = cents). Mirrors the website PLANS.
const PLAN_PRICE_CENTS: Record<string, number> = { basic: 399, advanced: 599, deep: 999 };
const PLAN_NAME: Record<string, string> = { basic: "Basic Scan", advanced: "Advanced Scan", deep: "Deep Scan" };

const RECOVERY_SECRET = process.env.WEB_SESSION_SECRET || process.env.SHOPIFY_API_SECRET || "shopflix-recovery-dev";
// Keyed hash of the recovery token. Irreversible: a DB breach exposes only this
// hash, which cannot be turned back into a usable token (attacker also lacks the secret).
export function recoveryHashOf(token: string): string {
  return crypto.createHmac("sha256", RECOVERY_SECRET).update(token).digest("hex");
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, { status: 405 });

  const email = await getWebEmail(request);
  if (!email) return json({ ok: false, error: "Please sign in first." }, { status: 401 });

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }
  const intent = String(body?.intent || "");
  const planId = String(body?.planId || "");
  const scanId = String(body?.scanId || "");

  if (!PLAN_PRICE_CENTS[planId]) return json({ ok: false, error: "Unknown plan." }, { status: 400 });

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  // ── Create a Razorpay order ────────────────────────────────────────────────
  if (intent === "create") {
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
        return json({ ok: false, error: "Could not start checkout. Please try again." }, { status: 502 });
      }
      return json({ ok: true, configured: true, orderId: order.id, keyId, amount, currency: "USD", planName: PLAN_NAME[planId], email });
    } catch (e) {
      console.error("[web-pay] create error:", e);
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
      return json({ ok: false, error: "Could not confirm your payment. Please contact support." }, { status: 502 });
    }

    const isPaid = order.status === "paid" || Number(order.amount_paid) === Number(order.amount);
    if (!isPaid) return json({ ok: false, error: "Payment not completed." }, { status: 400 });

    const paidScanId = String(order?.notes?.scanId || "");
    const paidPlanId = String(order?.notes?.planId || "");
    if (!paidScanId || !PLAN_PRICE_CENTS[paidPlanId]) {
      return json({ ok: false, error: "Payment metadata invalid." }, { status: 400 });
    }
    if (Number(order.amount) !== PLAN_PRICE_CENTS[paidPlanId]) {
      console.warn("[web-pay] amount mismatch", order.amount, "expected", PLAN_PRICE_CENTS[paidPlanId]);
      return json({ ok: false, error: "Payment amount mismatch." }, { status: 400 });
    }

    // Issue a one-time recovery token (stored only as an HMAC hash). Mark paid using
    // the authoritative scanId/planId from the order, never the client-supplied ones.
    const recoveryToken = `SFX-${crypto.randomBytes(15).toString("base64url")}`;
    await prisma.webScan.update({
      where: { id: paidScanId },
      data: { paidTier: paidPlanId, email, recoveryHash: recoveryHashOf(recoveryToken) },
    }).catch((e) => console.error("[web-pay] mark paid failed:", e));

    return json({ ok: true, recoveryToken });
  }

  return json({ ok: false, error: "Unknown action." }, { status: 400 });
}
