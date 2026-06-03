import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { processStoreScan, unlockStorefront } from "../utils/store-scanner.server";
import { incrementProductUsage, getOrCreateSubscription, getProductsUsed, getEffectiveProductLimit } from "../utils/billing.server";

const SCAN_CREDITS: Record<string, number> = {
  BASIC: 10,
};

/** GET — return the latest scan for this shop */
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  if (!session) return json({ error: "Unauthorized" }, { status: 401 });

  const scan = await (prisma as any).storeScan.findFirst({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
  });

  return json({ scan });
}

/** POST — start a new scan OR submit a store password for a NEEDS_PASSWORD scan */
export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  if (!session) return json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const intent = (formData.get("intent") as string) || "start_scan";

  // ── Intent: user submitting password for a password-protected store ─────────
  if (intent === "submit_password") {
    const scanId = formData.get("scanId") as string;
    const storePassword = formData.get("storePassword") as string;

    if (!scanId || !storePassword?.trim()) {
      return json({ error: "Scan ID and store password are required." }, { status: 400 });
    }

    // Load the existing scan to get storeUrl
    let existingScan: any;
    try {
      existingScan = await (prisma as any).storeScan.findUnique({ where: { id: scanId } });
    } catch {
      return json({ error: "Could not load scan." }, { status: 500 });
    }

    if (!existingScan || existingScan.status !== "NEEDS_PASSWORD") {
      return json({ error: "Scan not found or is not waiting for a password." }, { status: 400 });
    }

    const storeUrl = (existingScan.result as any)?.store_url;
    if (!storeUrl) {
      return json({ error: "Store URL not found in scan. Please start a new scan." }, { status: 400 });
    }

    // Try to unlock the storefront
    const { cookie, error: unlockError } = await unlockStorefront(storeUrl, storePassword);
    if (!cookie) {
      return json({ error: unlockError || "Incorrect password. Please try again." }, { status: 401 });
    }

    // Reset scan to PENDING and kick off background process with cookie
    await (prisma as any).storeScan.update({
      where: { id: scanId },
      data: { status: "PENDING", error: null },
    });

    setImmediate(() => {
      processStoreScan(scanId, session.shop, storeUrl, cookie).catch((err) =>
        console.error("[StoreScan] Background error:", err)
      );
    });

    return json({ scan: { ...existingScan, status: "PENDING" } });
  }

  // ── Intent: start a brand new scan ─────────────────────────────────────────
  const scanType = (formData.get("scanType") as string) || "BASIC";
  const credits = SCAN_CREDITS[scanType] ?? 10;

  const subscription = await getOrCreateSubscription(session.shop);
  const used = getProductsUsed(subscription);
  const limit = getEffectiveProductLimit(subscription);
  if (used + credits > limit) {
    return json({ error: "Not enough credits to run this scan. Please upgrade your plan." }, { status: 402 });
  }

  const shopResponse = await admin.graphql(`#graphql
    query shopUrl {
      shop { primaryDomain { url } }
    }
  `);
  const shopData = await shopResponse.json();
  const storeUrl = shopData?.data?.shop?.primaryDomain?.url;

  if (!storeUrl) {
    return json({ error: "Could not determine store URL." }, { status: 400 });
  }

  for (let i = 0; i < credits; i++) {
    await incrementProductUsage(session.shop);
  }

  const scan = await (prisma as any).storeScan.create({
    data: { shop: session.shop, type: scanType, status: "PENDING" },
  });

  setImmediate(() => {
    processStoreScan(scan.id, session.shop, storeUrl).catch((err) =>
      console.error("[StoreScan] Background error:", err)
    );
  });

  return json({ scan });
}
