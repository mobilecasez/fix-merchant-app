import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * Marks an issue as manually fixed without running AI or charging credits.
 * Used when the merchant completes a partial fix (e.g. saves in Theme Editor).
 */
export async function action({ request }: ActionFunctionArgs) {
  const bodyClone = request.clone();
  const { session } = await authenticate.admin(request);
  if (!session) return json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try { body = await bodyClone.json(); } catch {
    return json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { scanId, autoFixType, unmark } = body;
  if (!scanId || !autoFixType) {
    return json({ error: "Missing scanId or autoFixType." }, { status: 400 });
  }

  try {
    const scan = await (prisma as any).storeScan.findUnique({ where: { id: scanId } });
    if (!scan || scan.shop !== session.shop) {
      return json({ error: "Scan not found." }, { status: 404 });
    }

    const result = (scan.result as any) || {};
    const appliedFixes: any[] = result.applied_fixes || [];

    // Remove any existing entry for this fix type/key…
    const filtered = appliedFixes.filter((f: any) => f.autoFixType !== autoFixType);
    // …and re-add it as fixed, unless the caller is undoing the manual mark.
    if (!unmark) {
      filtered.push({ autoFixType, appliedAt: new Date().toISOString(), manual: true });
    }

    await (prisma as any).storeScan.update({
      where: { id: scanId },
      data: { result: { ...result, applied_fixes: filtered } },
    });

    return json({ success: true });
  } catch (err: any) {
    return json({ error: err.message }, { status: 500 });
  }
}
