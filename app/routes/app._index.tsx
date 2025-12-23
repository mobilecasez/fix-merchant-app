import { useState, useCallback, useMemo, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useSubmit, useLoaderData, Link } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Box,
  InlineStack,
  Spinner,
  Modal,
  TextField,
  Pagination,
  DataTable,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import RichTextEditor from "../components/RichTextEditor";
import DOMPurify from "dompurify";
import "../styles/modal-overrides.css";
import "../styles/dashboard.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  // Get subscription info
  const subscription = await prisma.shopSubscription.findUnique({
    where: { shop: session.shop },
    include: { plan: true },
  });
  
  return json({ subscription });
};

// Action to handle updating a product
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const id = formData.get("id") as string;
  const title = formData.get("title") as string | null;
  const description = formData.get("description") as string | null;
  const gtin = formData.get("gtin") as string | null;
  const tags = formData.get("tags") as string | null;
  const handle = formData.get("handle") as string | null;
  const metaDescription = formData.get("meta_description") as string | null;

  const productInput: any = { id };
  if (title) productInput.title = title;
  if (description) productInput.descriptionHtml = description;
  if (tags) productInput.tags = tags.split(',').map(tag => tag.trim());
  if (handle) productInput.handle = handle;
  if (metaDescription) {
    productInput.seo = { description: metaDescription };
  }

  if (gtin) {
    // Since we need to update a variant, we first need to get the variant ID.
    // For simplicity, we'll update the first variant.
    const variantResponse = await admin.graphql(
      `#graphql
        query getProductVariantId($id: ID!) {
          product(id: $id) {
            variants(first: 1) {
              edges {
                node {
                  id
                }
              }
            }
          }
        }`,
      { variables: { id } },
    );
    const variantResponseJson = await variantResponse.json();
    const variantId = variantResponseJson.data.product?.variants.edges[0]?.node.id;

    if (variantId) {
      const variantInput = { productVariantId: variantId, barcode: gtin };
      await admin.graphql(
        `#graphql
          mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              productVariants {
                id
                barcode
              }
              userErrors {
                field
                message
              }
            }
          }`,
        { variables: { productId: id, variants: [variantInput] } },
      );
    }
  }

  if (gtin) {
    const variantResponse = await admin.graphql(
      `#graphql
        query getProductVariantId($id: ID!) {
          product(id: $id) {
            variants(first: 1) {
              edges {
                node {
                  id
                }
              }
            }
          }
        }`,
      { variables: { id } },
    );
    const variantResponseJson = await variantResponse.json();
    const variantId = variantResponseJson.data.product?.variants.edges[0]?.node.id;

    if (variantId) {
      await admin.graphql(
        `#graphql
          mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              productVariants {
                id
                barcode
              }
              userErrors {
                field
                message
              }
            }
          }`,
        { variables: { productId: id, variants: [{ productVariantId: variantId, barcode: gtin }] } },
      );
    }
  }

  const response = await admin.graphql(
    `#graphql
      mutation productUpdate($product: ProductUpdateInput!) {
        productUpdate(product: $product) {
          product {
            id
            title
            descriptionHtml
            handle
            tags
            seo {
              description
            }
            variants(first: 1) {
              edges {
                node {
                  barcode
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
    { variables: { product: productInput } },
  );

  const responseJson = await response.json();
  if (responseJson.data.productUpdate.userErrors.length > 0) {
    return json({ errors: responseJson.data.productUpdate.userErrors }, { status: 422 });
  }

  return json({ product: responseJson.data.productUpdate.product });
};

const PRODUCTS_PER_PAGE = 10;

export default function Index() {
  const loaderData = useLoaderData<typeof loader>();
  const subscription = loaderData?.subscription;
  
  const [products, setProducts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [activeProduct, setActiveProduct] = useState<any | null>(null);
  const [editField, setEditField] = useState<"title" | "description" | "gtin" | "tags" | null>(null);
  const [originalValue, setOriginalValue] = useState("");
  const [newValue, setNewValue] = useState("");
  const [activeTitle, setActiveTitle] = useState("");

  // State for Auto Fix Modal
  const [isAutoFixModalOpen, setIsAutoFixModalOpen] = useState(false);
  const [isAutoFixLoading, setIsAutoFixLoading] = useState(false);
  const [autoFixData, setAutoFixData] = useState<any | null>(null);
  const [activeProductForAutoFix, setActiveProductForAutoFix] = useState<any | null>(null);
  const [isFindingGtin, setIsFindingGtin] = useState(false);

  const submit = useSubmit();
  const updateFetcher = useFetcher<typeof action>();
  const isUpdating = updateFetcher.state !== "idle";

  const handleSync = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/products");
      if (!response.ok) throw new Error("Failed to fetch products");
      const data = await response.json();
      setProducts(data.products || []);
      setCurrentPage(1);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const openRewriteModal = async (product: any, field: "title" | "description" | "gtin" | "tags") => {
    setActiveProduct(product);
    setEditField(field);
    setActiveTitle(product.title);
    const original = field === "title" ? product.title : field === "description" ? product.descriptionHtml || "No description." : field === "gtin" ? product.variants.edges[0]?.node.barcode || "No GTIN." : product.tags.join(", ");
    setOriginalValue(original);
    setNewValue(""); // Clear previous suggestion
    setIsModalOpen(true);
    setIsAiLoading(true);

    try {
      const response = await fetch("/api/ai/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field,
          title: product.title,
          description: product.descriptionHtml,
        }),
      });
      const data = await response.json();
      console.log("Received HTML from API:", data.suggestion);
      if (!response.ok) {
        throw new Error(data.error || "AI suggestion failed.");
      }
      setNewValue(data.suggestion);
    } catch (e: any) {
      setNewValue(`Error: ${e.message}`);
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleConfirmUpdate = () => {
    if (!activeProduct) return;

    let finalValue = newValue;
    if (editField === 'description') {
      // Remove the spacing paragraphs before saving
      finalValue = finalValue.replace(/<p><br><\/p><h3>/g, '<h3>');
      finalValue = finalValue.replace(/<\/h3><p><br><\/p>/g, '</h3>');
    }

    const formData = new FormData();
    formData.append("id", activeProduct.id);
    if (editField === "title") {
      formData.append("title", finalValue);
    } else if (editField === "description") {
      formData.append("description", finalValue);
    } else if (editField === "gtin") {
      formData.append("gtin", finalValue);
    } else if (editField === "tags") {
      formData.append("tags", finalValue);
    }
    
    updateFetcher.submit(formData, { method: "POST" });
    setIsModalOpen(false);
  };

  const handleAutoFix = async (product: any) => {
    setActiveProductForAutoFix(product);
    setIsAutoFixModalOpen(true);
    setIsAutoFixLoading(true);
    setAutoFixData(null);

    try {
      const response = await fetch("/api/ai/autofix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ original_product_data: product }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Auto-fix analysis failed.");
      }
      setAutoFixData(data.rewrittenData);
    } catch (e: any) {
      console.error(e);
      // Optionally, set an error state to show in the modal
    } finally {
      setIsAutoFixLoading(false);
    }
  };

  const handleFindGtin = async () => {
    if (!activeProductForAutoFix) return;
    setIsFindingGtin(true);
    try {
      const response = await fetch("/api/ai/find-gtin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: autoFixData.title,
          product: activeProductForAutoFix,
          variant: activeProductForAutoFix.variants.edges[0]?.node,
        }),
      });
      const data = await response.json();
      if (data.gtin) {
        setAutoFixData({ ...autoFixData, gtin: data.gtin });
      }
    } catch (e: any) {
      console.error(e);
    } finally {
      setIsFindingGtin(false);
    }
  };

  const handleSaveAutoFix = () => {
    if (!autoFixData || !activeProductForAutoFix) return;

    const formData = new FormData();
    formData.append("id", activeProductForAutoFix.id);
    formData.append("title", autoFixData.title);
    formData.append("description", autoFixData.description);
    formData.append("tags", autoFixData.tags.join(","));
    formData.append("handle", autoFixData.handle);
    formData.append("meta_description", autoFixData.meta_description);

    updateFetcher.submit(formData, { method: "POST" });
    setIsAutoFixModalOpen(false);
  };

  useEffect(() => {
    if (updateFetcher.data && "product" in updateFetcher.data) {
      const { product: updatedProduct } = updateFetcher.data;
      if (updatedProduct) {
        const updatedProducts = products.map((p) => {
          if (p.id === updatedProduct.id) {
            return { ...p, ...updatedProduct };
          }
          return p;
        });
        setProducts(updatedProducts);
      }
    }
  }, [updateFetcher.data]);

  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * PRODUCTS_PER_PAGE;
    const end = start + PRODUCTS_PER_PAGE;
    return products.slice(start, end);
  }, [products, currentPage]);

  const productRows = useMemo(() => paginatedProducts.map(product => [
    product.title,
    <InlineStack gap="200">
      <Button size="slim" onClick={() => openRewriteModal(product, 'title')}>Rewrite Title</Button>
      <Button size="slim" onClick={() => openRewriteModal(product, 'description')}>Rewrite Desc</Button>
      <Button size="slim" onClick={() => openRewriteModal(product, 'gtin')}>Get GTIN</Button>
      <Button size="slim" onClick={() => openRewriteModal(product, 'tags')}>Get Tags</Button>
      <Button size="slim" variant="primary" onClick={() => handleAutoFix(product)}>Auto Fix</Button>
    </InlineStack>
  ]), [paginatedProducts]);

  return (
    <Page fullWidth>
      <TitleBar title="ShopFlix AI" />
      <BlockStack gap="500">
        {!subscription && (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingLg">Choose a Subscription Plan</Text>
              <Text variant="bodyMd" as="p">
                Get started by selecting a subscription plan to import and optimize your products.
              </Text>
              <Link to="/app/choose-subscription">
                <Button variant="primary" size="large">
                  View Plans
                </Button>
              </Link>
            </BlockStack>
          </Card>
        )}
        
        {subscription && (
          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h3" variant="headingMd">Current Plan: {subscription.plan.name}</Text>
                  <Text variant="bodyMd" as="p" tone="subdued">
                    Products used: {subscription.productsUsed} / {subscription.plan.productLimit} this month
                  </Text>
                </BlockStack>
                <Link to="/app/choose-subscription">
                  <Button>Manage Subscription</Button>
                </Link>
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        {/* Hero Section - AI Product Import */}
        <Card>
          <Box background="bg-surface-success-subdued" borderRadius="300" padding="600">
            <BlockStack gap="400">
              <BlockStack gap="200">
                <Text as="h2" variant="headingLg" tone="success">
                  🤖 AI-Powered Product Import
                </Text>
                <Text variant="bodyMd" as="p">
                  Import products from 11+ e-commerce platforms with AI-optimized descriptions. Get professional product listings in seconds, not hours.
                </Text>
              </BlockStack>
              <Link to="/app/add-product-replica">
                <Button variant="primary" size="large">
                  Start Importing Products
                </Button>
              </Link>
            </BlockStack>
          </Box>
        </Card>

        {/* Quick Stats */}
        <Layout>
          <Layout.Section oneThird>
            <Card>
              <BlockStack gap="300">
                <Box>
                  <Text as="h2" variant="headingMd" tone="subdued">
                    📊 Products Imported
                  </Text>
                </Box>
                <Text as="p" variant="headingLg">
                  {subscription?.productsUsed || 0}
                </Text>
                <Text variant="bodySm" tone="subdued">
                  out of {subscription?.plan.productLimit || 0} this month
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section oneThird>
            <Card>
              <BlockStack gap="300">
                <Box>
                  <Text as="h2" variant="headingMd" tone="subdued">
                    ✨ Plan Type
                  </Text>
                </Box>
                <Text as="p" variant="headingMd">
                  {subscription?.plan.name || "Free Trial"}
                </Text>
                <Text variant="bodySm" tone="subdued">
                  ${subscription?.plan.price || 0}/month
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section oneThird>
            <Card>
              <BlockStack gap="300">
                <Box>
                  <Text as="h2" variant="headingMd" tone="subdued">
                    🚀 Next Steps
                  </Text>
                </Box>
                <Link to="/app/add-product-replica">
                  <Button fullWidth variant="secondary">
                    Import Products
                  </Button>
                </Link>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Platform Showcase */}
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="200">
              <Text as="h2" variant="headingLg">
                🌍 Supported e-Commerce Platforms
              </Text>
              <Text variant="bodyMd" tone="subdued">
                Import products from any of these 11+ global platforms
              </Text>
            </BlockStack>
            <Box borderColor="border" borderWidth="025" borderRadius="200">
              <InlineStack wrap gap="400" blockAlign="center" align="start" style={{ padding: "24px", flexWrap: "wrap" }}>
                {["Amazon", "eBay", "Walmart", "AliExpress", "Shopee", "Taobao", "JD.com", "Temu", "Mercado Libre", "Coupang", "Flipkart"].map((platform) => (
                  <Box key={platform} background="bg-surface-secondary" borderRadius="200" padding="300" style={{ flex: "0 0 calc(25% - 12px)", minWidth: "120px", textAlign: "center" }}>
                    <Text as="p" variant="bodyMd" fontWeight="bold">
                      {platform}
                    </Text>
                  </Box>
                ))}
              </InlineStack>
            </Box>
          </BlockStack>
        </Card>

        {/* Features Highlight */}
        <Layout>
          <Layout.Section oneThird>
            <Card>
              <BlockStack gap="300">
                <Box>
                  <Text as="h3" variant="headingMd">
                    🤖 AI Descriptions
                  </Text>
                </Box>
                <Text variant="bodySm">
                  Automatically generate SEO-optimized product descriptions using advanced AI.
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section oneThird>
            <Card>
              <BlockStack gap="300">
                <Box>
                  <Text as="h3" variant="headingMd">
                    🔍 GTIN Finder
                  </Text>
                </Box>
                <Text variant="bodySm">
                  AI-powered GTIN/UPC finder automatically identifies missing product codes.
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section oneThird>
            <Card>
              <BlockStack gap="300">
                <Box>
                  <Text as="h3" variant="headingMd">
                    ✅ Compliance Check
                  </Text>
                </Box>
                <Text variant="bodySm">
                  Automatically check Google Merchant Center compliance for all products.
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Getting Started Guide */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingLg">
              🚀 Getting Started
            </Text>
            <Box borderColor="border-divider" borderWidth="025">
              <BlockStack gap="0">
                <Box borderBottomColor="border-divider" borderBottomWidth="025" padding="400">
                  <InlineStack gap="400" align="start" blockAlign="start">
                    <Box>
                      <Box background="bg-surface-selected" borderRadius="600" style={{ width: "40px", height: "40px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Text as="span" variant="headingMd" tone="subdued">1</Text>
                      </Box>
                    </Box>
                    <BlockStack gap="100" style={{ flex: 1 }}>
                      <Text as="h3" variant="headingMd">Choose Your Subscription Plan</Text>
                      <Text variant="bodySm" tone="subdued">Select a plan that fits your needs (Free Trial includes 2 products)</Text>
                      <Link to="/app/choose-subscription">
                        <Button size="small" variant="secondary">View Plans</Button>
                      </Link>
                    </BlockStack>
                  </InlineStack>
                </Box>
                <Box borderBottomColor="border-divider" borderBottomWidth="025" padding="400">
                  <InlineStack gap="400" align="start" blockAlign="start">
                    <Box>
                      <Box background="bg-surface-selected" borderRadius="600" style={{ width: "40px", height: "40px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Text as="span" variant="headingMd" tone="subdued">2</Text>
                      </Box>
                    </Box>
                    <BlockStack gap="100" style={{ flex: 1 }}>
                      <Text as="h3" variant="headingMd">Find a Product You Want to Import</Text>
                      <Text variant="bodySm" tone="subdued">Copy the product URL from Amazon, eBay, Walmart, or any of 11+ supported platforms</Text>
                    </BlockStack>
                  </InlineStack>
                </Box>
                <Box borderBottomColor="border-divider" borderBottomWidth="025" padding="400">
                  <InlineStack gap="400" align="start" blockAlign="start">
                    <Box>
                      <Box background="bg-surface-selected" borderRadius="600" style={{ width: "40px", height: "40px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Text as="span" variant="headingMd" tone="subdued">3</Text>
                      </Box>
                    </Box>
                    <BlockStack gap="100" style={{ flex: 1 }}>
                      <Text as="h3" variant="headingMd">Let AI Optimize Your Product</Text>
                      <Text variant="bodySm" tone="subdued">Our AI automatically generates SEO-optimized titles, descriptions, and finds missing GTINs</Text>
                    </BlockStack>
                  </InlineStack>
                </Box>
                <Box padding="400">
                  <InlineStack gap="400" align="start" blockAlign="start">
                    <Box>
                      <Box background="bg-surface-selected" borderRadius="600" style={{ width: "40px", height: "40px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Text as="span" variant="headingMd" tone="subdued">4</Text>
                      </Box>
                    </Box>
                    <BlockStack gap="100" style={{ flex: 1 }}>
                      <Text as="h3" variant="headingMd">Review & Publish</Text>
                      <Text variant="bodySm" tone="subdued">Review the AI suggestions, customize if needed, and publish directly to your Shopify store</Text>
                      <Link to="/app/add-product-replica">
                        <Button size="small" variant="primary">Start Now</Button>
                      </Link>
                    </BlockStack>
                  </InlineStack>
                </Box>
              </BlockStack>
            </Box>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Sync Your Existing Products</Text>
            <Text variant="bodyMd" as="p" tone="subdued">Scan and optimize your existing products using AI. Check for Google Merchant Center compliance issues.</Text>
            <Button variant="secondary" size="large" onClick={handleSync} loading={isLoading}>
              {isLoading ? "Syncing..." : "Sync Products"}
            </Button>
          </BlockStack>
        </Card>
      </BlockStack>

      <div className="wide-modal">
        <Modal
          open={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title={`Rewrite ${editField}`}
          primaryAction={{ content: 'Confirm & Save', onAction: handleConfirmUpdate, loading: isUpdating }}
          secondaryActions={[{ content: 'Cancel', onAction: () => setIsModalOpen(false) }]}
        >
        <Modal.Section>
          <BlockStack gap="400">
            {editField === "description" && (
              <Text as="h2" variant="headingMd">{activeTitle}</Text>
            )}
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">Before</Text>
              <div className="before-box">
                <Box
                  borderColor="border"
                  borderWidth="025"
                  borderRadius="200"
                  padding="200"
                  background="bg-surface-secondary"
                >
                {editField === "description" ? (
                  <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(originalValue) }} />
                ) : (
                  <Text as="p" variant="bodyMd">
                    {originalValue}
                  </Text>
                )}
                </Box>
              </div>
            </BlockStack>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">
                After (AI Suggestion)
              </Text>
              {isAiLoading ? (
                <Spinner />
              ) : editField === "description" ? (
                <RichTextEditor value={newValue} onChange={setNewValue} />
              ) : (
                <TextField
                  label=""
                  value={newValue}
                  onChange={setNewValue}
                  autoComplete="off"
                />
              )}
              {editField === "gtin" && (
                <TextField
                  label="GTIN"
                  value={newValue}
                  onChange={setNewValue}
                  autoComplete="off"
                />
              )}
              {editField === "tags" && (
                <TextField
                  label="Tags"
                  value={newValue}
                  onChange={setNewValue}
                  autoComplete="off"
                />
              )}
            </BlockStack>
          </BlockStack>
        </Modal.Section>
        </Modal>
      </div>

      {/* Auto Fix Modal */}
      <div className="wide-modal">
        <Modal
          open={isAutoFixModalOpen}
          onClose={() => setIsAutoFixModalOpen(false)}
          title={`Auto Fix Suggestions for ${activeProductForAutoFix?.title}`}
          primaryAction={{ content: 'Confirm & Save All', onAction: handleSaveAutoFix, loading: isUpdating }}
          secondaryActions={[{ content: 'Cancel', onAction: () => setIsAutoFixModalOpen(false) }]}
        >
          <Modal.Section>
            {isAutoFixLoading ? (
              <Spinner />
            ) : autoFixData ? (
              <BlockStack gap="400">
                <TextField
                  label="Title"
                  value={autoFixData.title || ''}
                  onChange={(value) => setAutoFixData({ ...autoFixData, title: value })}
                  autoComplete="off"
                />
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">Description</Text>
                  <RichTextEditor
                    value={autoFixData.description || ''}
                    onChange={(value) => setAutoFixData({ ...autoFixData, description: value })}
                  />
                </BlockStack>
                <TextField
                  label="Tags"
                  value={autoFixData.tags?.join(', ') || ''}
                  onChange={(value) => setAutoFixData({ ...autoFixData, tags: value.split(',').map(tag => tag.trim()) })}
                  autoComplete="off"
                />
                <TextField
                  label="URL Handle"
                  value={autoFixData.handle || ''}
                  onChange={(value) => setAutoFixData({ ...autoFixData, handle: value })}
                  autoComplete="off"
                />
                <TextField
                  label="Meta Description"
                  value={autoFixData.meta_description || ''}
                  onChange={(value) => setAutoFixData({ ...autoFixData, meta_description: value })}
                  autoComplete="off"
                  multiline={4}
                />
                <TextField
                  label="GTIN New"
                  value={autoFixData.gtin || ''}
                  onChange={(value) => setAutoFixData({ ...autoFixData, gtin: value })}
                  autoComplete="off"
                  connectedRight={
                    <Button onClick={handleFindGtin} loading={isFindingGtin}>
                      Find GTIN
                    </Button>
                  }
                />
              </BlockStack>
            ) : (
              <Text as="p">Could not load auto-fix suggestions.</Text>
            )}
          </Modal.Section>
        </Modal>
      </div>
    </Page>
  );
}
