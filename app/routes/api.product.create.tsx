import { json, ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { canCreateProduct } from "../utils/billing.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  // Check subscription and product limit
  const canCreate = await canCreateProduct(session.shop);
  if (!canCreate) {
    return json({ 
      errors: [{ 
        message: "Product limit reached. Please upgrade your subscription or wait for the next billing cycle." 
      }] 
    }, { status: 403 });
  }

  const formData = await request.formData();
  const productDataString = formData.get("productData");

  if (!productDataString) {
    return json({ errors: [{ message: "Missing product data." }] }, { status: 400 });
  }

  let payload;
  try {
    payload = JSON.parse(productDataString as string);
  } catch (error) {
    return json({ errors: [{ message: "Invalid JSON in product data." }] }, { status: 400 });
  }

  const {
    productName,
    description,
    status,
    vendor,
    productType,
    tags,
    price,
    compareAtPrice,
    costPerItem,
    chargeTaxes,
    sku,
    barcode,
    trackQuantity,
    continueSellingOutOfStock,
    weight,
    weightUnit,
    options,
    variants,
    images,
    category,
    seoTitle,
    seoDescription,
    seoUrl,
  } = payload;

  console.log("Product Create API - Received category:", category);
  console.log("Product Create API - Full payload:", JSON.stringify(payload, null, 2));

  if (!productName) {
    return json({ errors: [{ message: "Product name is required." }] }, { status: 400 });
  }

  const mapWeightUnit = (unit: string) => {
    if (!unit) return undefined;
    const lowerUnit = unit.toLowerCase();
    switch (lowerUnit) {
        case 'kg': return 'KILOGRAMS';
        case 'g': return 'GRAMS';
        case 'lb': return 'POUNDS';
        case 'oz': return 'OUNCES';
        default: return undefined;
    }
  };

  const parseCost = (cost: any) => {
    if (cost === null || cost === undefined || cost === '') return null;
    const parsedCost = parseFloat(cost);
    return isNaN(parsedCost) ? null : parsedCost;
  };

  // Clean up description HTML - remove spacing paragraphs around headings
  const cleanDescription = (html: string) => {
    if (!html) return html;
    
    // Remove <p><br></p> before headings
    let cleaned = html.replace(/<p><br><\/p>\s*<h([1-6])/g, '<h$1');
    
    // Remove <p><br></p> after headings
    cleaned = cleaned.replace(/<\/h([1-6])>\s*<p><br><\/p>/g, '</h$1>');
    
    // Remove leading <p><br></p> at the start
    cleaned = cleaned.replace(/^<p><br><\/p>\s*/g, '');
    
    // Remove trailing <p><br></p> at the end
    cleaned = cleaned.replace(/\s*<p><br><\/p>$/g, '');
    
    return cleaned;
  };

  const productInput: any = {
    title: productName,
    descriptionHtml: cleanDescription(description),
    status: status ? status.toUpperCase() : 'ACTIVE',
    vendor: vendor,
    productType: productType,
    tags: tags ? tags.split(",").map((tag: string) => tag.trim()) : [],
    seo: {
      title: seoTitle || productName,
      description: seoDescription || null,
    },
  };

  if (seoUrl) {
    productInput.handle = seoUrl;
  }

  if (variants && variants.length > 0) {
    productInput.options = options.map((opt: any) => opt.name);
  }

  // Note: Category will be set after product creation using productSet mutation
  // as it's not supported in ProductCreateInput

  const media = [];
  if (images && images.length > 0) {
    for (const image of images) {
      media.push({
        originalSource: image,
        mediaContentType: "IMAGE",
      });
    }
  }

  try {
    console.log("Sending to Shopify - productInput:", JSON.stringify(productInput, null, 2));
    console.log("Sending to Shopify - media:", JSON.stringify(media, null, 2));
    
    const response = await admin.graphql(
      `#graphql
      mutation productCreate($input: ProductCreateInput!, $media: [CreateMediaInput!]) {
        productCreate(product: $input, media: $media) {
          product {
            id
            title
            category {
              id
            }
            variants(first: 10) {
              edges {
                node {
                  id
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          input: productInput,
          media,
        },
      }
    );

    const responseJson = await response.json();

    console.log("Product Create Response:", JSON.stringify(responseJson, null, 2));

    if (responseJson.data.productCreate.userErrors.length > 0) {
      console.error("Product Create User Errors:", responseJson.data.productCreate.userErrors);
      return json({ errors: responseJson.data.productCreate.userErrors }, { status: 422 });
    }

    const createdProduct = responseJson.data.productCreate.product;
    const productId = createdProduct.id;

    // Set category using productSet mutation if provided
    if (category && category.trim() !== '') {
      console.log("Setting category for product", productId, "with category ID:", category);
      try {
        const categoryResponse = await admin.graphql(
          `#graphql
          mutation productSet($input: ProductSetInput!) {
            productSet(input: $input) {
              product {
                id
                category {
                  id
                }
              }
              userErrors {
                field
                message
              }
            }
          }`,
          {
            variables: {
              input: {
                id: productId,
                category: category.trim(),
              },
            },
          }
        );
        
        const categoryResponseJson = await categoryResponse.json();
        console.log("Category Set Response:", JSON.stringify(categoryResponseJson, null, 2));
        
        if (categoryResponseJson.data.productSet.userErrors.length > 0) {
          console.error("Category Set Errors:", categoryResponseJson.data.productSet.userErrors);
          // Don't fail the whole product creation, just log the error
        }
      } catch (categoryError: any) {
        console.error("Error setting category:", categoryError.message);
        // Don't fail the whole product creation
      }
    }

    const createdVariants = createdProduct.variants.edges.map((edge: any) => edge.node);

    if (variants && variants.length > 0) {
      const variantsToUpdate = variants.map((variant: any, index: number) => ({
        id: createdVariants[index].id,
        price: variant.price,
        compareAtPrice: variant.compareAtPrice,
        barcode: variant.barcode,
        inventoryItem: {
          cost: parseCost(variant.costPerItem),
          sku: variant.sku,
          tracked: variant.trackQuantity,
        },
        inventoryPolicy: variant.continueSellingOutOfStock ? 'CONTINUE' : 'DENY',
        taxable: variant.chargeTaxes,
        options: variant.options,
      }));

      await admin.graphql(
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
            productId: productId,
            variants: variantsToUpdate,
          },
        }
      );
    } else {
      // Handle single-variant product update
      const variantToUpdate = {
        id: createdVariants[0].id,
        price: price,
        compareAtPrice: compareAtPrice,
        barcode: barcode,
        inventoryItem: {
          cost: parseCost(costPerItem),
          sku: sku,
          tracked: trackQuantity,
        },
        inventoryPolicy: continueSellingOutOfStock ? 'CONTINUE' : 'DENY',
        taxable: chargeTaxes,
      };
      await admin.graphql(
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
            productId: productId,
            variants: [variantToUpdate],
          },
        }
      );
    }

    return json({ product: createdProduct });
  } catch (error) {
    console.error("Error creating product:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to create product";
    return json({ errors: [{ message: errorMessage }] }, { status: 500 });
  }
};
