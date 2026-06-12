import { json, type ActionFunctionArgs } from "@remix-run/node";
import crypto from "node:crypto";
import prisma from "../db.server";
import { webSessionStorage, getWebSession } from "../utils/web-session.server";

const emailOk = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(e);

// Password hashing with Node's scrypt (no external dependency). Stored as
// "salt:hash" — never plaintext.
function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = (stored || "").split(":");
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(pw, salt, 64).toString("hex");
  const a = Buffer.from(h), b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, { status: 405 });

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }
  const intent = String(body?.intent || "");
  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");

  if (!emailOk(email)) return json({ ok: false, error: "Please enter a valid email address." }, { status: 400 });
  if (password.length < 6) return json({ ok: false, error: "Password must be at least 6 characters." }, { status: 400 });

  const setSession = async (em: string) => {
    const session = await getWebSession(request);
    session.set("email", em);
    return { "Set-Cookie": await webSessionStorage.commitSession(session) };
  };

  try {
    if (intent === "signup") {
      const existing = await prisma.webUser.findUnique({ where: { email } });
      if (existing && existing.passwordHash) {
        // Account exists — treat as login attempt for convenience.
        if (!verifyPassword(password, existing.passwordHash)) {
          return json({ ok: false, error: "An account with this email already exists. Please log in." }, { status: 409 });
        }
        await prisma.webUser.update({ where: { email }, data: { lastLogin: new Date() } });
        return json({ ok: true, email }, { headers: await setSession(email) });
      }
      await prisma.webUser.upsert({
        where: { email },
        update: { passwordHash: hashPassword(password), lastLogin: new Date() },
        create: { email, passwordHash: hashPassword(password), lastLogin: new Date() },
      });
      return json({ ok: true, email }, { headers: await setSession(email) });
    }

    if (intent === "login") {
      const user = await prisma.webUser.findUnique({ where: { email } });
      if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
        return json({ ok: false, error: "Incorrect email or password." }, { status: 401 });
      }
      await prisma.webUser.update({ where: { email }, data: { lastLogin: new Date() } });
      return json({ ok: true, email }, { headers: await setSession(email) });
    }

    return json({ ok: false, error: "Unknown action." }, { status: 400 });
  } catch (error) {
    console.error("[web-auth] error:", error);
    return json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
