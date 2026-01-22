import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { convertMarkdownToHtml } from "../utils/markdown";

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const productData = await request.json();
  console.log("API Product Update - Received productData:", JSON.stringify(productData, null, 2));

  if (!productData || !productData.id) {
    return json({ error: "Invalid product data" }, { status: 400 });
  }

  const {
    id,
    title,
    handle,
    description,
    meta_description,
    brand, // Added brand to destructuring
    google_product_category, // Added google_product_category to destructuring
    color, // Added color to destructuring
    material, // Added material to destructuring
    condition, // Added condition to destructuring
    variants,
    tags, // Added tags to destructuring
    forceUpdate, // Add option to force update regardless of timestamp
  } = productData;

  // Check existing timestamp to prevent overwriting newer data
  if (!forceUpdate) {
    try {
      const existingProductResponse = await admin.graphql(
        `#graphql
          query getProduct($id: ID!) {
            product(id: $id) {
              metafield(namespace: "shopflix_ai", key: "last_updated") {
                value
              }
            }
          }`,
        {
          variables: { id },
        }
      );

      const existingProductData = await existingProductResponse.json();
      const existingTimestamp = existingProductData?.data?.product?.metafield?.value;

      if (existingTimestamp) {
        const existingDate = new Date(existingTimestamp);
        const currentDate = new Date();
        
        // If existing data is less than 5 seconds old, reject the update to prevent race condition
        const timeDiff = currentDate.getTime() - existingDate.getTime();
        if (timeDiff < 5000) {
          console.log("Update rejected: Data was just updated", {
            existingTimestamp,
            timeDiff: `${timeDiff}ms`,
          });
          return json({ 
            error: "Product was recently updated. Please refresh to see the latest version.",
            existingTimestamp,
          }, { status: 409 }); // 409 Conflict
        }
      }
    } catch (error) {
      console.error("Error checking existing timestamp:", error);
      // Continue with update if timestamp check fails
    }
  }

  const descriptionHtml = await convertMarkdownToHtml(description);

  const productInput = {
    id,
    title,
    handle,
    descriptionHtml,
    seo: {
      description: meta_description,
    },
    tags, // Added tags to productInput
  };

  const productUpdateResponse = await admin.graphql(
    `#graphql
      mutation productUpdate($product: ProductUpdateInput!) {
        productUpdate(product: $product) {
          product {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        product: productInput,
      },
    }
  );

  const productUpdateData = await productUpdateResponse.json();

  // Prepare metafields for Google Merchant Center attributes
  const metafieldsToSet: { ownerId: string; namespace: string; key: string; value: string; type: string; }[] = [];

  // Helper to add metafield if value is not empty or null
  const addMetafield = (key: string, value: any) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      metafieldsToSet.push({
        ownerId: id,
        namespace: "google_merchant_center",
        key: key,
        value: String(value).trim(), // Ensure value is a string and trimmed
        type: "single_line_text_field",
      });
    }
  };

  addMetafield("brand", brand);
  addMetafield("google_product_category", google_product_category);
  addMetafield("color", color);
  addMetafield("material", material);
  addMetafield("condition", condition);
  
  // Add last_updated timestamp to track version
  metafieldsToSet.push({
    ownerId: id,
    namespace: "shopflix_ai",
    key: "last_updated",
    value: new Date().toISOString(),
    type: "single_line_text_field",
  });

  if (metafieldsToSet.length > 0) {
    const metafieldsSetResponse = await admin.graphql(
      `#graphql
        mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields {
              id
              key
              value
            }
            userErrors {
              field
              message
            }
          }
        }`,
      {
        variables: {
          metafields: metafieldsToSet,
        },
      }
    );

    const metafieldsSetData = await metafieldsSetResponse.json();
    console.log("Shopify metafieldsSet full response:", JSON.stringify(metafieldsSetData, null, 2));

    if (
      metafieldsSetData.data.metafieldsSet.userErrors &&
      metafieldsSetData.data.metafieldsSet.userErrors.length > 0
    ) {
      console.error("Shopify metafieldsSet errors:", metafieldsSetData.data.metafieldsSet.userErrors);
      return json(
        {
          error:
            metafieldsSetData.data.metafieldsSet.userErrors[0].message,
        },
        { status: 400 }
      );
    }
  }

  if (
    productUpdateData.data.productUpdate.userErrors &&
    productUpdateData.data.productUpdate.userErrors.length > 0
  ) {
    return json(
      { error: productUpdateData.data.productUpdate.userErrors[0].message },
      { status: 400 }
    );
  }

  if (variants && variants.length > 0) {
    // Map the incoming variants data to the structure expected by Shopify's productVariantsBulkUpdate
    const variantsToUpdate = variants.map((variant: any) => ({
      id: variant.id, // Reverted to 'id' as per Shopify API documentation
      price: variant.price,
      compareAtPrice: variant.compareAtPrice,
      barcode: (variant.barcode && variant.barcode.trim() !== "null") ? variant.barcode.trim() : "",
      weight: variant.weight ? parseFloat(variant.weight) : null,
      weightUnit: variant.weightUnit,
    }));

    console.log("Variants to update payload:", JSON.stringify(variantsToUpdate, null, 2)); // Added log

    const productVariantsBulkUpdateResponse = await admin.graphql(
      `#graphql
        mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            product {
              id
            }
            userErrors {
              field
              message
            }
          }
        }`,
      {
        variables: {
          productId: id,
          variants: variantsToUpdate,
        },
      }
    );

    const productVariantsBulkUpdateData =
      await productVariantsBulkUpdateResponse.json();

    console.log("Shopify productVariantsBulkUpdate full response:", JSON.stringify(productVariantsBulkUpdateData, null, 2)); // Changed log to full response

    if (
      productVariantsBulkUpdateData.data.productVariantsBulkUpdate.userErrors &&
      productVariantsBulkUpdateData.data.productVariantsBulkUpdate.userErrors
        .length > 0
    ) {
      console.error("Shopify productVariantsBulkUpdate errors:", productVariantsBulkUpdateData.data.productVariantsBulkUpdate.userErrors);
      return json(
        {
          error:
            productVariantsBulkUpdateData.data.productVariantsBulkUpdate
              .userErrors[0].message,
        },
        { status: 400 }
      );
    }
  }

  return json({ success: true });
}
