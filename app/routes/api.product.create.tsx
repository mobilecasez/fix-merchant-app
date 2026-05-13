import { json, ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { canCreateProduct } from "../utils/billing.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);// Check subscription and product limit
  const canCreate = await canCreateProduct(session.shop);
  if (!canCreate) {return json({ 
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

  const parsePrice = (priceValue: any) => {
    if (priceValue === null || priceValue === undefined || priceValue === '') return null;
    const parsed = parseFloat(priceValue);
    return isNaN(parsed) ? null : parsed;
  };
  
  const parseCost = parsePrice; // Alias for parsePrice

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
  
  const media = [];
  if (images && images.length > 0) {
    for (const image of images) {
      media.push({
        originalSource: image,
        mediaContentType: "IMAGE",
      });
    }
  }

  try {const response = await admin.graphql(
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
    if (responseJson.data.productCreate.userErrors.length > 0) {
      console.error("Product Create User Errors:", responseJson.data.productCreate.userErrors);
      return json({ errors: responseJson.data.productCreate.userErrors }, { status: 422 });
    }

    const createdProduct = responseJson.data.productCreate.product;
    const productId = createdProduct.id;

    // Set category using productSet mutation if provided
    if (category && category.trim() !== '') {try {
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
      // Shopify creates only 1 default variant, so we need to:
      // 1. Update the default variant with the first variant's data
      // 2. Create additional variants if there are more than 1
      
      if (!createdVariants[0] || !createdVariants[0].id) {
        console.error('Default variant missing ID:', createdVariants[0]);
        return json({ 
          errors: [{ 
            message: "Product created but default variant ID is missing. Please try again or manually update the product." 
          }] 
        }, { status: 422 });
      }

      // Update the first (default) variant
      const firstVariant = variants[0];
      
      const variantPrice = parsePrice(firstVariant.price) || parsePrice(price);
      const variantCompareAtPrice = parsePrice(firstVariant.compareAtPrice) || parsePrice(compareAtPrice);
      
      const variantToUpdate = {
        id: createdVariants[0].id,
        price: variantPrice,
        compareAtPrice: variantCompareAtPrice,
        barcode: firstVariant.barcode || '',
        inventoryItem: {
          cost: parseCost(firstVariant.costPerItem),
          sku: firstVariant.sku || '',
          tracked: firstVariant.trackQuantity,
        },
        inventoryPolicy: firstVariant.continueSellingOutOfStock ? 'CONTINUE' : 'DENY',
        taxable: firstVariant.chargeTaxes,
      };

      const variantUpdateResponse = await admin.graphql(
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

      const variantUpdateData = await variantUpdateResponse.json();
      if (variantUpdateData.data.productVariantsBulkUpdate.userErrors.length > 0) {
        console.error("Default Variant Update Errors:", variantUpdateData.data.productVariantsBulkUpdate.userErrors);
        return json({ errors: variantUpdateData.data.productVariantsBulkUpdate.userErrors }, { status: 422 });
      }

      // Create additional variants if there are more than 1
      if (variants.length > 1) {
        const variantsToCreate = variants.slice(1).map((variant: any) => {
          const varPrice = parsePrice(variant.price) || parsePrice(price);
          const varCompareAtPrice = parsePrice(variant.compareAtPrice) || parsePrice(compareAtPrice);
          
          return {
            price: varPrice,
            compareAtPrice: varCompareAtPrice,
            barcode: variant.barcode || '',
            inventoryItem: {
              cost: parseCost(variant.costPerItem),
              sku: variant.sku || '',
              tracked: variant.trackQuantity,
            },
            inventoryPolicy: variant.continueSellingOutOfStock ? 'CONTINUE' : 'DENY',
            taxable: variant.chargeTaxes,
            options: variant.options,
          };
        });

        const createVariantsResponse = await admin.graphql(
          `#graphql
            mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
              productVariantsBulkCreate(productId: $productId, variants: $variants) {
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
              variants: variantsToCreate,
            },
          }
        );

        const createVariantsData = await createVariantsResponse.json();
        if (createVariantsData.data.productVariantsBulkCreate.userErrors.length > 0) {
          console.error(`Variant Creation Errors:`, createVariantsData.data.productVariantsBulkCreate.userErrors);
          return json({ errors: createVariantsData.data.productVariantsBulkCreate.userErrors }, { status: 422 });
        }
      }
    } else {
      // Handle single-variant product update (no variants provided, use top-level fields)
      if (!createdVariants[0] || !createdVariants[0].id) {
        console.error('Default variant missing ID:', createdVariants[0]);
        return json({ 
          errors: [{ 
            message: "Product created but default variant ID is missing. Please try again or manually update the product." 
          }] 
        }, { status: 422 });
      }

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

      const variantUpdateResponse = await admin.graphql(
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

      const variantUpdateData = await variantUpdateResponse.json();
      if (variantUpdateData.data.productVariantsBulkUpdate.userErrors.length > 0) {
        console.error("Single Variant Update Errors:", variantUpdateData.data.productVariantsBulkUpdate.userErrors);
        return json({ errors: variantUpdateData.data.productVariantsBulkUpdate.userErrors }, { status: 422 });
      }
    }

    // Note: Usage counter is incremented in fetch-product endpoint (when AI processes data)
    // This prevents users from fetching unlimited products without counting AI token usage

    return json({ product: createdProduct });
  } catch (error) {
    console.error("Error creating product:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to create product";
    return json({ errors: [{ message: errorMessage }] }, { status: 500 });
  }
};
