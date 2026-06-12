import { createCookieSessionStorage } from "@remix-run/node";

// Public-website session (separate from the Shopify embedded-app session).
// Secret reuses an existing server secret so we don't introduce a new one to
// manage; override with WEB_SESSION_SECRET in env if desired.
const secret = process.env.WEB_SESSION_SECRET || process.env.SHOPIFY_API_SECRET || "shopflix-web-dev-secret-change-me";

export const webSessionStorage = createCookieSessionStorage({
  cookie: {
    name: "__sfx_web",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    secrets: [secret],
  },
});

export async function getWebSession(request: Request) {
  return webSessionStorage.getSession(request.headers.get("Cookie"));
}

/** Email of the logged-in website user, or null. */
export async function getWebEmail(request: Request): Promise<string | null> {
  const session = await getWebSession(request);
  const email = session.get("email");
  return typeof email === "string" && email.includes("@") ? email : null;
}
