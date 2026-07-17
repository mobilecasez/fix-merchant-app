import { type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { fetchOrderClassifications, getImportMeta, resolveRange, type OrderExportRow } from "../utils/product-analytics.server";

// Escape a value for CSV: always quote, double any embedded quotes, strip newlines to a space.
function csvCell(v: string | number): string {
  const s = String(v ?? "").replace(/\r?\n/g, " ").replace(/"/g, '""');
  return `"${s}"`;
}

const COLUMNS: [keyof OrderExportRow, string][] = [
  ["name", "Order"],
  ["createdAt", "Date"],
  ["payment", "Payment"],
  ["gateways", "Payment gateways"],
  ["countedAs", "Counted as"],
  ["reason", "Why (signals)"],
  ["fulfillmentStatus", "Shopify fulfillment status"],
  ["returnStatus", "Shopify return status"],
  ["trackingStatus", "Tracking status"],
  ["note", "Order note"],
  ["tags", "Tags"],
  ["orderTotal", "Order total"],
  ["countedRevenue", "Counted revenue"],
  ["products", "Products"],
];

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);

  const grantedScopes = String((session as any).scope || "");
  if (!/read_orders/.test(grantedScopes)) {
    return new Response("The read_orders permission is required to export orders.", { status: 403 });
  }

  const url = new URL(request.url);
  const importMeta = await getImportMeta(session.shop);
  const range = resolveRange(url, importMeta.earliest);

  const rows = await fetchOrderClassifications(admin, range);

  const header = COLUMNS.map(([, label]) => csvCell(label)).join(",");
  const body = rows.map((r) => COLUMNS.map(([key]) => csvCell(r[key])).join(",")).join("\r\n");
  // BOM so Excel opens UTF-8 (₹ etc.) correctly.
  const csv = "﻿" + header + "\r\n" + body + "\r\n";

  const fname = `price-radar-orders_${range.since.toISOString().slice(0, 10)}_${range.until.toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fname}"`,
      "Cache-Control": "no-store",
    },
  });
}
