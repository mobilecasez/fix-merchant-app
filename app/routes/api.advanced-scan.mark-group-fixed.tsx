import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * Marks an entire Advanced-scan violation group (e.g. "Missing Identifiers") as
 * manually fixed — no AI, no Shopify writes, no credits. Lets a merchant clear a
 * group they fixed themselves (or don't want auto-fixed). Pass `unmark: true` to
 * revert. Persists on the scan record so it survives a page refresh.
 */
export async function action({ request }: ActionFunctionArgs) {
  const bodyClone = request.clone();
  const { session } = await authenticate.admin(request);
  if (!session) return json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try { body = await bodyClone.json(); } catch {
    return json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { scanId, violationType, unmark } = body;
  if (!scanId || !violationType) {
    return json({ error: "Missing scanId or violationType." }, { status: 400 });
  }

  try {
    const scan = await (prisma as any).storeScan.findUnique({ where: { id: scanId } });
    if (!scan || scan.shop !== session.shop) {
      return json({ error: "Scan not found." }, { status: 404 });
    }

    const existing = (scan.result as any) || {};
    const groupFixes = existing.group_fixes || {};
    groupFixes[violationType] = {
      ...(groupFixes[violationType] || {}),
      manuallyFixed: !unmark,
      manuallyFixedAt: unmark ? null : new Date().toISOString(),
    };

    await (prisma as any).storeScan.update({
      where: { id: scanId },
      data: { result: { ...existing, group_fixes: groupFixes } },
    });

    return json({ success: true });
  } catch (err: any) {
    return json({ error: err.message || "Could not update scan." }, { status: 500 });
  }
}
