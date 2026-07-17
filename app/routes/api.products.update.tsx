import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { convertMarkdownToHtml } from "../utils/markdown";
import prisma from "../db.server";

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const productData = await request.json();
  if (!productData || !productData.id) {
    return json({ error: "Invalid product data" }, { status: 400 });
  }

  const {
    id,
    title,
    handle,
    description,
    meta_description,
    brand,
    vendor,
    google_product_category,
    color,
    material,
    condition,
    availability,
    variants,
    tags,
    analysis_summary,
    imagesToAdd, // array of image URLs to add to the product
  } = productData;

  // Only write descriptionHtml when a real description is supplied — an empty/undefined
  // description must NOT blank the merchant's existing product description.
  const descriptionHtml = description && String(description).trim()
    ? await convertMarkdownToHtml(description)
    : undefined;

  const productInput: any = {
    id,
    title,
    handle,
    ...(descriptionHtml ? { descriptionHtml } : {}),
    seo: { description: meta_description },
    tags,
    ...(vendor && vendor.trim() ? { vendor: vendor.trim() } : {}),
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
  addMetafield("availability", availability);

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
    const variantsToUpdate = variants.map((variant: any) => {
      const updateData: any = {
        id: variant.id,
        price: variant.price,
        compareAtPrice: variant.compareAtPrice,
        barcode: (variant.barcode && variant.barcode.trim() !== "null") ? variant.barcode.trim() : "",
      };

      return updateData;
    });

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
      await productVariantsBulkUpdateResponse.json();// Changed log to full response

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

  // Add new images if provided
  if (imagesToAdd && Array.isArray(imagesToAdd) && imagesToAdd.length > 0) {
    const mediaInput = imagesToAdd.map((imgUrl: string) => ({
      originalSource: imgUrl,
      mediaContentType: 'IMAGE',
    }));
    try {
      await admin.graphql(
        `#graphql
          mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
            productCreateMedia(productId: $productId, media: $media) {
              mediaUserErrors { field message }
            }
          }`,
        { variables: { productId: id, media: mediaInput } }
      );
    } catch (imgErr: any) {
      console.warn('Image upload failed (non-fatal):', imgErr?.message);
    }
  }

  // After successful update, intelligently remove resolved issues and mark auto-fix as complete
  let remainingIssues: any[] = [];
  let remainingSuggestions: any[] = [];

  try {
    const existingCheck = await prisma.productAICheck.findUnique({
      where: { productId: id },
    });

    if (existingCheck) {
      const existingResult = (existingCheck.result as any) || {};
      const currentIssues: any[] = existingResult.issues || [];
      const currentSuggestions: any[] = existingResult.suggestions_for_sales_improvement || [];

      // Build a set of keyword groups for each field that was actually saved.
      // If a field has a non-empty value we just saved, any issue whose message
      // contains one of its keywords is considered resolved.
      const savedFieldKeywords: string[][] = [];

      const fieldMap: Record<string, string[]> = {
        gtin:                   ['gtin', 'global trade item', 'upc', 'ean', 'isbn', 'jan', 'barcode'],
        brand:                  ['brand name', 'brand', 'manufacturer'],
        title:                  ['title', 'product name', 'heading'],
        description:            ['description', 'promotional text', 'promotional language', 'call-to-action', 'non-factual', 'pre-order', 'preorder', 'word count', 'detail', 'insufficient'],
        meta_description:       ['meta description', 'seo description', 'snippet'],
        handle:                 ['url', 'handle', 'slug', 'permalink'],
        google_product_category:['product category', 'google product category', 'category'],
        color:                  ['color', 'colour'],
        material:               ['material'],
        condition:              ['condition', 'new', 'used', 'refurbished'],
        availability:           ['availability', 'preorder', 'pre-order', 'in_stock', 'out of stock', 'in stock'],
        tags:                   ['tag', 'keyword'],
      };

      // Determine which fields were saved with real values
      const savedFields: Record<string, any> = {
        gtin:                   productData.variants?.[0]?.barcode,
        brand,
        title,
        description,
        meta_description,
        handle,
        google_product_category,
        color,
        material,
        condition,
        availability,
        tags:                   tags?.length ? tags : null,
      };

      for (const [field, keywords] of Object.entries(fieldMap)) {
        const val = savedFields[field];
        const hasValue = val !== undefined && val !== null && String(val).trim() !== '' && String(val).trim() !== 'null';
        if (hasValue) {
          savedFieldKeywords.push(keywords);
        }
      }

      const isResolved = (text: string): boolean => {
        const lower = text.toLowerCase();
        return savedFieldKeywords.some(keywords =>
          keywords.some(kw => lower.includes(kw))
        );
      };

      remainingIssues = currentIssues.filter(issue => !isResolved(issue.message));
      remainingSuggestions = currentSuggestions.filter(s => !isResolved(s.suggestion));

      await prisma.productAICheck.update({
        where: { productId: id },
        data: {
          autoFixCompleted: true,
          result: {
            ...existingResult,
            issues: remainingIssues,
            suggestions_for_sales_improvement: remainingSuggestions,
          },
        },
      });
    }
  } catch (e) {
    console.warn(`Could not update AI Check status for product ${id}:`, e);
  }

  return json({ success: true, remainingIssues, remainingSuggestions });
}
