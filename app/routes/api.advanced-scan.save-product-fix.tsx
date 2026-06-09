import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { convertMarkdownToHtml } from "../utils/markdown";

export async function action({ request }: ActionFunctionArgs) {
  const bodyClone = request.clone();
  const { admin, session } = await authenticate.admin(request);
  if (!session) return json({ error: "Unauthorized" }, { status: 401 });

  const { productId, fixType, fields } = await bodyClone.json();
  if (!productId || !fixType) {
    return json({ error: "productId and fixType are required." }, { status: 400 });
  }

  try {
    if (fixType === "identifiers") {
      const { gtin, mpn } = fields || {};

      // Update variant barcode (GTIN)
      if (gtin?.trim()) {
        const varResp = await admin.graphql(`#graphql
          query getVariant($id: ID!) { product(id: $id) { variants(first: 1) { edges { node { id } } } } }
        `, { variables: { id: productId } });
        const varData = await varResp.json();
        const variantId = varData?.data?.product?.variants?.edges?.[0]?.node?.id;
        if (variantId) {
          const uvResp = await admin.graphql(`#graphql
            mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
              productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                product { id }
                userErrors { field message }
              }
            }
          `, { variables: { productId, variants: [{ id: variantId, barcode: gtin.trim() }] } });
          const uvData = await uvResp.json();
          const uvErrs = uvData?.data?.productVariantsBulkUpdate?.userErrors;
          if (uvErrs?.length) throw new Error(uvErrs[0].message);
        }
      }

      // MPN metafield
      const metafieldsToSet: any[] = [];
      if (mpn?.trim()) metafieldsToSet.push({ ownerId: productId, namespace: "custom", key: "mpn", value: mpn.trim(), type: "single_line_text_field" });
      if (metafieldsToSet.length) {
        const mfResp = await admin.graphql(`#graphql
          mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } }
          }
        `, { variables: { metafields: metafieldsToSet } });
        const mfData = await mfResp.json();
        const mfErrs = mfData?.data?.metafieldsSet?.userErrors;
        if (mfErrs?.length) throw new Error(mfErrs[0].message);
      }

      return json({ success: true, message: "Identifiers saved." });
    }

    if (fixType === "pricing") {
      const { compare_at_price } = fields || {};
      if (!compare_at_price) return json({ error: "compare_at_price is required." }, { status: 400 });

      const varResp = await admin.graphql(`#graphql
        query getVariant($id: ID!) { product(id: $id) { variants(first: 1) { edges { node { id } } } } }
      `, { variables: { id: productId } });
      const varData = await varResp.json();
      const variantId = varData?.data?.product?.variants?.edges?.[0]?.node?.id;
      if (!variantId) return json({ error: "Variant not found." }, { status: 404 });

      const uvResp = await admin.graphql(`#graphql
        mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            product { id }
            userErrors { field message }
          }
        }
      `, { variables: { productId, variants: [{ id: variantId, compareAtPrice: String(compare_at_price) }] } });
      const uvData = await uvResp.json();
      const uvErrs = uvData?.data?.productVariantsBulkUpdate?.userErrors;
      if (uvErrs?.length) throw new Error(uvErrs[0].message);

      return json({ success: true, message: "Compare-at price saved." });
    }

    if (fixType === "description") {
      const { description } = fields || {};
      if (!description?.trim()) return json({ error: "description is required." }, { status: 400 });

      const descHtml = await convertMarkdownToHtml(description);
      const resp = await admin.graphql(`#graphql
        mutation productUpdate($product: ProductUpdateInput!) {
          productUpdate(product: $product) {
            product { id }
            userErrors { field message }
          }
        }
      `, { variables: { product: { id: productId, descriptionHtml: descHtml } } });
      const data = await resp.json();
      const errs = data?.data?.productUpdate?.userErrors;
      if (errs?.length) throw new Error(errs[0].message);

      return json({ success: true, message: "Description saved." });
    }

    return json({ error: `Unknown fixType: ${fixType}` }, { status: 400 });
  } catch (err: any) {
    return json({ error: err.message || "Save failed." }, { status: 500 });
  }
}
