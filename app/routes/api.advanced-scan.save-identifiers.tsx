import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

interface IdentifierRow {
  productId: string;   // Shopify product GID
  brand: string | null;
  gtin: string | null;
  mpn: string | null;
}

export async function action({ request }: ActionFunctionArgs) {
  const bodyClone = request.clone();
  const { admin, session } = await authenticate.admin(request);
  if (!session) return json({ error: "Unauthorized" }, { status: 401 });

  const { scanId, rows }: { scanId: string; rows: IdentifierRow[] } = await bodyClone.json();

  if (!scanId || !Array.isArray(rows) || rows.length === 0) {
    return json({ error: "scanId and rows[] are required." }, { status: 400 });
  }

  const results: Array<{ productId: string; success: boolean; error?: string }> = [];

  for (const row of rows) {
    try {
      const { productId, brand, gtin, mpn } = row;

      // ── 1. Fetch the first variant ID for this product ──────────────────────
      const variantResp = await admin.graphql(`#graphql
        query getVariant($id: ID!) {
          product(id: $id) {
            variants(first: 1) {
              edges { node { id } }
            }
          }
        }
      `, { variables: { id: productId } });

      const variantData = await variantResp.json();
      const variantId = variantData?.data?.product?.variants?.edges?.[0]?.node?.id;

      // ── 2. Update product vendor (brand) ───────────────────────────────────
      if (brand?.trim()) {
        const productUpdateResp = await admin.graphql(`#graphql
          mutation productUpdate($product: ProductUpdateInput!) {
            productUpdate(product: $product) {
              product { id vendor }
              userErrors { field message }
            }
          }
        `, { variables: { product: { id: productId, vendor: brand.trim() } } });

        const pu = await productUpdateResp.json();
        const puErrors = pu?.data?.productUpdate?.userErrors;
        if (puErrors?.length > 0) {
          throw new Error(`Brand update failed: ${puErrors[0].message}`);
        }
      }

      // ── 3. Update variant barcode (GTIN) ───────────────────────────────────
      if (variantId && gtin?.trim()) {
        const variantUpdateResp = await admin.graphql(`#graphql
          mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              product { id }
              userErrors { field message }
            }
          }
        `, {
          variables: {
            productId,
            variants: [{ id: variantId, barcode: gtin.trim() }],
          },
        });

        const vu = await variantUpdateResp.json();
        const vuErrors = vu?.data?.productVariantsBulkUpdate?.userErrors;
        if (vuErrors?.length > 0) {
          throw new Error(`GTIN update failed: ${vuErrors[0].message}`);
        }
      }

      // ── 4. Set metafields: gmc brand + custom mpn ──────────────────────────
      const metafieldsToSet: any[] = [];

      if (brand?.trim()) {
        metafieldsToSet.push({
          ownerId: productId,
          namespace: "google_merchant_center",
          key: "brand",
          value: brand.trim(),
          type: "single_line_text_field",
        });
      }

      if (mpn?.trim()) {
        metafieldsToSet.push({
          ownerId: productId,
          namespace: "custom",
          key: "mpn",
          value: mpn.trim(),
          type: "single_line_text_field",
        });
      }

      if (metafieldsToSet.length > 0) {
        const mfResp = await admin.graphql(`#graphql
          mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              metafields { id key value }
              userErrors { field message }
            }
          }
        `, { variables: { metafields: metafieldsToSet } });

        const mfData = await mfResp.json();
        const mfErrors = mfData?.data?.metafieldsSet?.userErrors;
        if (mfErrors?.length > 0) {
          throw new Error(`Metafield update failed: ${mfErrors[0].message}`);
        }
      }

      results.push({ productId, success: true });
    } catch (err: any) {
      results.push({ productId: row.productId, success: false, error: err.message });
    }
  }

  // ── Persist save status on the scan record ──────────────────────────────────
  try {
    const scan = await (prisma as any).storeScan.findUnique({ where: { id: scanId } });
    if (scan) {
      const existing = (scan.result as any) || {};
      const groupFixes = existing.group_fixes || {};
      if (groupFixes["Missing Identifiers"]) {
        groupFixes["Missing Identifiers"].savedAt = new Date().toISOString();
        groupFixes["Missing Identifiers"].saveResults = results;
      }
      await (prisma as any).storeScan.update({
        where: { id: scanId },
        data: { result: { ...existing, group_fixes: groupFixes } },
      });
    }
  } catch (e) {
    console.warn("[SaveIdentifiers] Could not persist save record:", e);
  }

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  return json({
    success: true,
    results,
    message: `Saved ${successCount} product${successCount !== 1 ? "s" : ""}${failCount > 0 ? `, ${failCount} failed` : ""}.`,
  });
}
