// This app authenticates admin requests with OFFLINE access tokens only, so the
// `Session.accountOwner` column (which Shopify's session storage only populates for
// ONLINE/per-user tokens) is never set — it's always false, for every shop.
//
// Querying the Admin GraphQL `StaffMember` object (tried first) turned out to be
// gated behind the `read_users` scope, which Shopify only grants to finance apps on
// Shopify Plus/Advanced stores — a dead end for a normal app.
//
// The universally-available mechanism is a direct ONLINE token exchange: the same
// session token every embedded-app request already carries can be exchanged for a
// short-lived per-user access token whose response includes `associated_user.account_owner`.
// This needs no extra scope — it's core embedded-app OAuth, not a data-access grant.
const SESSION_TOKEN_PARAM = "id_token";

function getRawSessionToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7);
  const url = new URL(request.url);
  return url.searchParams.get(SESSION_TOKEN_PARAM);
}

// One online token-exchange → the logged-in user's { account_owner, email }. Callers that need
// both (e.g. the embedded layout, which also gates the owner-only Admin link) reuse this single
// exchange instead of doing two.
export async function getAssociatedUser(request: Request, shop?: string | null): Promise<{ accountOwner: boolean; email: string | null }> {
  if (!shop) return { accountOwner: false, email: null };
  const sessionToken = getRawSessionToken(request);
  if (!sessionToken) {
    console.error("[account-owner] no session token on request", { shop, url: request.url });
    return { accountOwner: false, email: null };
  }
  try {
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: sessionToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
        requested_token_type: "urn:shopify:params:oauth:token-type:online-access-token",
      }),
    });
    if (!res.ok) {
      console.error("[account-owner] token exchange failed", res.status, (await res.text().catch(() => "")).slice(0, 300));
      return { accountOwner: false, email: null };
    }
    const body = await res.json();
    return { accountOwner: Boolean(body?.associated_user?.account_owner), email: body?.associated_user?.email || null };
  } catch (e: any) {
    console.error("[account-owner] threw", e?.message || e);
    return { accountOwner: false, email: null };
  }
}

export async function isCurrentUserAccountOwner(request: Request, shop?: string | null): Promise<boolean> {
  return (await getAssociatedUser(request, shop)).accountOwner;
}
