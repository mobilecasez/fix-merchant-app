import prisma from "../db.server";

// Best-effort append-only activity logger. Never throws into the caller — a failed
// audit write must not break the merchant action it's recording. Powers /app/admin.
export async function logActivity(shop: string, type: string, label = "", meta?: any): Promise<void> {
  if (!shop) return;
  try {
    await prisma.activityEvent.create({ data: { shop, type, label, meta: meta ?? undefined } });
  } catch (e: any) {
    console.warn("[activity] log failed:", e?.message || e);
  }
}
