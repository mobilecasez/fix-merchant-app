import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/** GET — return the monitoring config for this shop. */
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  if (!session) return json({ error: "Unauthorized" }, { status: 401 });
  const monitor = await (prisma as any).storeMonitor.findUnique({ where: { shop: session.shop } }).catch(() => null);
  return json({ monitor });
}

/** POST — save the monitoring config (enable/disable, frequency, email). */
export async function action({ request }: ActionFunctionArgs) {
  const bodyClone = request.clone();
  const { admin, session } = await authenticate.admin(request);
  if (!session) return json({ error: "Unauthorized" }, { status: 401 });

  const body = await bodyClone.json().catch(() => ({}));
  const enabled = !!body.enabled;
  const frequency = body.frequency === "daily" ? "daily" : "weekly";
  let email = (body.email || "").toString().trim();

  // Resolve store URL (+ a default email) from the shop.
  let storeUrl = `https://${session.shop}`;
  try {
    const r = await admin.graphql(`#graphql query { shop { primaryDomain { url } contactEmail email } }`);
    const d = await r.json();
    storeUrl = d?.data?.shop?.primaryDomain?.url || storeUrl;
    if (!email) email = d?.data?.shop?.contactEmail || d?.data?.shop?.email || "";
  } catch { /* non-fatal */ }

  if (enabled && !email) {
    return json({ error: "An email address is required to enable monitoring." }, { status: 400 });
  }

  const existing = await (prisma as any).storeMonitor.findUnique({ where: { shop: session.shop } }).catch(() => null);

  // Re-enabling after being off resets the baseline so the next run re-establishes
  // a fresh state (and sends a welcome summary) rather than diffing stale data.
  const resetBaseline = enabled && (!existing || !existing.enabled);

  const monitor = await (prisma as any).storeMonitor.upsert({
    where: { shop: session.shop },
    create: { shop: session.shop, enabled, frequency, email, storeUrl, baseline: null },
    update: {
      enabled, frequency, email, storeUrl,
      ...(resetBaseline ? { baseline: null, lastRunAt: null } : {}),
    },
  });

  return json({ success: true, monitor });
}
