import { json, type ActionFunctionArgs } from "@remix-run/node";
import crypto from "node:crypto";
import { Resend } from "resend";
import prisma from "../db.server";
import { webSessionStorage, getWebSession } from "../utils/web-session.server";

const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_15MIN = 4;

const emailOk = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(e);
const hashCode = (email: string, code: string) =>
  crypto.createHash("sha256").update(`${email.toLowerCase()}:${code}`).digest("hex");

function ip(request: Request): string {
  return (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, { status: 405 });

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }
  const intent = String(body?.intent || "");
  const email = String(body?.email || "").trim().toLowerCase();

  if (!emailOk(email)) return json({ ok: false, error: "Please enter a valid email address." }, { status: 400 });

  // ── Request a one-time code ────────────────────────────────────────────────
  if (intent === "request") {
    const since = new Date(Date.now() - 15 * 60 * 1000);
    const recent = await prisma.webOtp.count({ where: { email, createdAt: { gte: since } } });
    if (recent >= MAX_CODES_PER_15MIN) {
      return json({ ok: false, error: "Too many codes requested. Please wait a few minutes." }, { status: 429 });
    }

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    await prisma.webOtp.create({
      data: {
        email,
        codeHash: hashCode(email, code),
        expiresAt: new Date(Date.now() + CODE_TTL_MIN * 60 * 1000),
      },
    });

    const resendKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
    if (resendKey) {
      const resend = new Resend(resendKey);
      await resend.emails.send({
        from: `ShopFlix AI <${from}>`,
        to: [email],
        subject: `${code} is your ShopFlix AI code`,
        html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:460px;margin:0 auto;padding:24px;color:#0f172a">
          <h2 style="margin:0 0 6px;font-size:18px">Your login code</h2>
          <p style="margin:0 0 18px;color:#64748b;font-size:14px">Enter this code to unlock your store scan report. It expires in ${CODE_TTL_MIN} minutes.</p>
          <div style="font-size:32px;font-weight:800;letter-spacing:8px;background:#f1f5f9;border-radius:10px;padding:16px;text-align:center">${code}</div>
          <p style="margin:18px 0 0;color:#94a3b8;font-size:12px">If you didn't request this, you can ignore this email.</p>
        </div>`,
      }).catch((e: any) => console.error("[web-auth] email send failed:", e?.message || e));
    } else {
      console.warn("[web-auth] RESEND_API_KEY not set — code for", email, "is", code);
    }
    return json({ ok: true, sent: true });
  }

  // ── Verify the code ────────────────────────────────────────────────────────
  if (intent === "verify") {
    const code = String(body?.code || "").replace(/\D/g, "");
    if (code.length !== 6) return json({ ok: false, error: "Enter the 6-digit code." }, { status: 400 });

    const otp = await prisma.webOtp.findFirst({
      where: { email, consumed: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!otp) return json({ ok: false, error: "Code expired — please request a new one." }, { status: 400 });
    if (otp.attempts >= MAX_ATTEMPTS) return json({ ok: false, error: "Too many attempts. Request a new code." }, { status: 429 });

    if (otp.codeHash !== hashCode(email, code)) {
      await prisma.webOtp.update({ where: { id: otp.id }, data: { attempts: otp.attempts + 1 } });
      return json({ ok: false, error: "Incorrect code. Please try again." }, { status: 400 });
    }

    await prisma.webOtp.update({ where: { id: otp.id }, data: { consumed: true } });
    await prisma.webUser.upsert({
      where: { email },
      update: { lastLogin: new Date() },
      create: { email },
    });
    // also delete other outstanding codes for this email
    await prisma.webOtp.deleteMany({ where: { email, consumed: false } }).catch(() => {});

    const session = await getWebSession(request);
    session.set("email", email);
    session.set("ip", ip(request));
    return json(
      { ok: true, email },
      { headers: { "Set-Cookie": await webSessionStorage.commitSession(session) } }
    );
  }

  return json({ ok: false, error: "Unknown action." }, { status: 400 });
}
