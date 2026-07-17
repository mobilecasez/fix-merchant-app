// Owner-only (app-developer) gating for the /app/admin analytics page.
//
// This app authenticates with OFFLINE tokens, so there is no built-in "developer" identity.
// We gate by an allowlist of admin EMAILS (ADMIN_EMAILS) and/or shop DOMAINS (ADMIN_SHOPS).
// The logged-in user's email is read from the same online token-exchange used for
// account-owner detection (see account-owner.server.ts) — no extra scope required.
//
// Defaults include the developer's known emails so the page works out-of-the-box for them and
// nobody else; set ADMIN_EMAILS / ADMIN_SHOPS in the environment to lock it down precisely.

const SESSION_TOKEN_PARAM = "id_token";

function rawSessionToken(request: Request): string | null {
  const h = request.headers.get("authorization");
  if (h?.startsWith("Bearer ")) return h.slice(7);
  return new URL(request.url).searchParams.get(SESSION_TOKEN_PARAM);
}

export function adminEmails(): string[] {
  return String(process.env.ADMIN_EMAILS || "zsellr.in@gmail.com,mobilecasez.in@gmail.com")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function adminShops(): string[] {
  return String(process.env.ADMIN_SHOPS || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// Cheap synchronous check (no network) — use for showing/hiding the nav link.
export function isAdminShop(shop?: string | null): boolean {
  return !!shop && adminShops().includes(shop.toLowerCase());
}

// Sync email check against the allowlist (caller already has the email from a token-exchange).
export function isAdminEmail(email?: string | null): boolean {
  return !!email && adminEmails().includes(email.toLowerCase());
}

// The logged-in user's email via online token-exchange. Returns null if unavailable.
export async function currentUserEmail(request: Request, shop?: string | null): Promise<string | null> {
  if (!shop) return null;
  const token = rawSessionToken(request);
  if (!token) return null;
  try {
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: token,
        subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
        requested_token_type: "urn:shopify:params:oauth:token-type:online-access-token",
      }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.associated_user?.email || null;
  } catch {
    return null;
  }
}

// Full gate: admin shop OR admin email. Async (may do a token-exchange).
export async function isAppAdmin(request: Request, shop?: string | null): Promise<boolean> {
  if (isAdminShop(shop)) return true;
  const email = await currentUserEmail(request, shop);
  const ok = !!email && adminEmails().includes(email.toLowerCase());
  if (!ok) console.warn("[admin-access] denied", { shop, email: email ? email.replace(/(.{2}).*(@.*)/, "$1***$2") : null });
  return ok;
}

// Throws 404 (not 403 — don't reveal the page exists) when the caller isn't an app admin.
export async function requireAppAdmin(request: Request, shop?: string | null): Promise<void> {
  if (await isAppAdmin(request, shop)) return;
  throw new Response("Not Found", { status: 404 });
}
