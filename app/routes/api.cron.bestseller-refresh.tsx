import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { refreshBestSellerCollection } from "../utils/bestseller-collection.server";

// Monthly cron: re-rank each shop's best sellers (last 30 days, net of ad cost) and re-tag the
// products so their auto-updating "Best Sellers" smart collection stays current. CRON_SECRET-gated,
// same pattern as the weekly digest. Fire-and-forget so a long batch outlives the curl timeout.

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || request.headers.get("x-cron-secret") || "";
  return token === secret;
}

async function runBatch(): Promise<void> {
  const rows = await prisma.bestSellerCollection.findMany({
    where: { enabled: true }, orderBy: { updatedAt: "asc" }, take: 1000,
  });
  console.log(`[bestseller-cron] refreshing ${rows.length} collections`);
  for (const row of rows) {
    try {
      const { admin } = await unauthenticated.admin(row.shop); // throws if the shop uninstalled
      const res = await refreshBestSellerCollection(admin as any, row.shop, {});
      console.log("[bestseller-cron] %s → ok=%s count=%s %s", row.shop, res.ok, res.count ?? 0, res.error || "");
    } catch (e: any) {
      console.error("[bestseller-cron] %s failed:", row.shop, e?.message || e);
    }
  }
}

async function handle(request: Request): Promise<Response> {
  if (!authorized(request)) return json({ error: "Unauthorized" }, { status: 401 });
  void runBatch().catch((e) => console.error("[bestseller-cron] batch failed:", e?.message || e));
  return json({ ok: true, started: true }, { status: 202 });
}

export async function loader({ request }: LoaderFunctionArgs) { return handle(request); }
export async function action({ request }: ActionFunctionArgs) { return handle(request); }
