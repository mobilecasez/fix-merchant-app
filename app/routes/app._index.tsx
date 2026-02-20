import { useState, useCallback, useMemo, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useSubmit, useLoaderData, Link, useSearchParams } from "@remix-run/react";
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
  Badge,
  Icon,
  Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getOrCreateSubscription, getProductsUsed } from "../utils/billing.server";
import RichTextEditor from "../components/RichTextEditor";
import DOMPurify from "dompurify";
import "../styles/modal-overrides.css";
import "../styles/dashboard.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  // Get or create subscription (auto-initializes with free trial if new shop)
  const subscription = await getOrCreateSubscription(session.shop);
  
  // Calculate products used on server side
  const productsUsed = getProductsUsed(subscription);
  
  // Get review status
  const review = await prisma.shopReview.findUnique({
    where: { shop: session.shop },
  });
  
  return json({ subscription, review, productsUsed });
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
  const initialReview = loaderData?.review;
  const productsUsed = loaderData?.productsUsed ?? 0;
  
  // Get success parameter from URL (set by billing callback)
  const [searchParams, setSearchParams] = useSearchParams();
  const showSuccessBanner = searchParams.get("success") === "true";
  const planChanged = searchParams.get("changed") === "true";
  
  const [products, setProducts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  // Review banner state
  const [reviewBannerDismissed, setReviewBannerDismissed] = useState(initialReview?.dismissed || false);
  const [userRating, setUserRating] = useState<number | null>(initialReview?.rating || null);
  const [showRatingThankYou, setShowRatingThankYou] = useState(false);

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

  // Video tutorial modal state
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);

  const submit = useSubmit();
  const updateFetcher = useFetcher<typeof action>();
  const isUpdating = updateFetcher.state !== "idle";
  
  // Handle success banner dismissal
  const handleSuccessBannerDismiss = useCallback(() => {
    // Remove success params from URL
    searchParams.delete("success");
    searchParams.delete("changed");
    searchParams.delete("planId");
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams]);

  // Handle rating submission
  const handleRating = useCallback(async (rating: number) => {
    setUserRating(rating);
    setShowRatingThankYou(true);
    
    try {
      await fetch("/api/submit-rating", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, dismissed: false }),
      });
    } catch (error) {
      console.error("Error submitting rating:", error);
    }
    
    // Hide thank you message after 2 seconds
    setTimeout(() => setShowRatingThankYou(false), 2000);
  }, []);

  // Handle dismiss
  const handleDismiss = useCallback(async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    setReviewBannerDismissed(true);
    
    try {
      await fetch("/api/submit-rating", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismissed: true }),
      });
    } catch (error) {
      console.error("Error dismissing banner:", error);
    }
  }, []);

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
    <>
    <div className="landing-page">
    <Page fullWidth>
      <div className="landing-container">
        {/* Success Banner for Billing */}
        {showSuccessBanner && (
          <div style={{ marginBottom: '1rem' }}>
            <Banner
              title={planChanged ? "Plan upgraded successfully!" : "Subscription activated!"}
              tone="success"
              onDismiss={handleSuccessBannerDismiss}
            >
              <p>
                {planChanged 
                  ? "Your subscription plan has been updated. You now have access to your new plan features."
                  : "Your subscription is now active. Thank you for subscribing!"}
              </p>
            </Banner>
          </div>
        )}
        
        {/* 1. App Header & Branding */}
        <div className="header-section">
          <div className="header-content">
            <div className="logo-icon">📦</div>
            <h1 className="app-title">ShopFlix AI</h1>
          </div>
        </div>

        {/* 2. Review Request Banner */}
        {!reviewBannerDismissed && (
          <div className="review-banner">
            <div className="review-content">
              <div className="review-left">
                {!showRatingThankYou ? (
                  <>
                    <p className="review-text">How's your experience with ShopFlix AI?</p>
                    <p className="review-subtext">
                      <a href="#" onClick={handleDismiss} className="review-link">Rate us by clicking on stars. Dismiss.</a>
                    </p>
                  </>
                ) : (
                  <p className="review-text">✓ Thank you for your feedback!</p>
                )}
              </div>
              <div className="review-stars">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button 
                    key={star} 
                    className={`star-button ${userRating && star <= userRating ? 'rated' : ''}`}
                    onClick={() => handleRating(star)}
                    aria-label={`Rate ${star} stars`}
                    disabled={showRatingThankYou}
                  >
                    {userRating && star <= userRating ? '⭐' : '☆'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 3. App Introduction & Roadmap Summary */}
        <div className="intro-card">
          <h2 className="intro-heading">Streamline Your Product Imports.</h2>
          <p className="intro-paragraph">
            Import authorized product details from your suppliers and licensed sources. Extract data from e-commerce platforms like Amazon, Flipkart, AliExpress, and more—perfect for dropshipping, your own products, and licensed items. Get ready for powerful upcoming features, including automated Google Merchant Center compliance checks and full AI-powered SEO rewriting for titles and descriptions.
          </p>
        </div>

        {/* 4. Feature Cards Grid */}
        <div className="feature-cards-grid">
          {/* Left Card - Active: Import Products */}
          <div className="feature-card">
            <div className="feature-card-header">
              <div className="feature-card-icon">📥</div>
              <h3 className="feature-card-title">Import Products</h3>
            </div>
            <p className="feature-card-description">
              Import authorized products from your suppliers or licensed sources. Extract product data to create optimized listings in your store.
            </p>
            <Link to="/app/add-product-replica" style={{ textDecoration: 'none' }}>
              <button className="feature-card-button">
                Go to Product Replica
              </button>
            </Link>
          </div>

          {/* Middle Card - Coming Soon: GMC Compliance */}
          <div className="feature-card">
            <div className="feature-card-header">
              <div className="feature-card-icon">🛡️</div>
              <h3 className="feature-card-title">Google Merchant Center Compliance</h3>
            </div>
            <p className="feature-card-description">
              Automatically scan your entire store inventory to identify and flag GMC policy errors before they cause suspensions.
            </p>
            <button className="feature-card-button" disabled>
              Coming Soon
            </button>
          </div>

          {/* Right Card - Coming Soon: SEO Rewrite */}
          <div className="feature-card">
            <div className="feature-card-header">
              <div className="feature-card-icon">✨</div>
              <h3 className="feature-card-title">AI SEO & GMC Rewrite</h3>
            </div>
            <p className="feature-card-description">
              Utilize AI to rewrite product titles and details specifically optimized for Google's search and merchant standards.
            </p>
            <button className="feature-card-button" disabled>
              Coming Soon
            </button>
          </div>
        </div>

        {/* 5. Onboarding & Tutorial Card */}
        <div className="onboarding-card">
          <h2 className="onboarding-heading">Get Started with ShopFlix AI</h2>
          <p className="onboarding-text">
            Learn how to extract products from external URLs, customize your product details, and import them to your Shopify store in minutes. Just hit play to get started!
          </p>
          <button className="tutorial-button" onClick={() => setIsVideoModalOpen(true)}>
            <span className="play-icon">▶</span>
            Watch Tutorial
          </button>
        </div>

        {/* 6. Subscription & Usage Card */}
        <div className="subscription-card">
          <div className="subscription-content">
            <div className="subscription-left">
              <h2 className="subscription-title">Subscription Plan</h2>
              <p className="subscription-value-prop">
                You're on the Free Tier with 2 product imports. Upgrade now to increase your product import limit and gain early access to Google Merchant Center compliance automation and AI-powered SEO rewriting.
              </p>
            </div>
            <div className="subscription-right">
              <div className="usage-tracker">
                <div className="usage-label-top">Monthly Imports</div>
                <div className="progress-bar-container">
                  <div className="progress-bar-track">
                    <div 
                      className="progress-bar-fill" 
                      style={{ 
                        width: subscription ? 
                          `${(productsUsed / subscription.plan.productLimit) * 100}%` : 
                          '0%' 
                      }}
                    ></div>
                  </div>
                </div>
                <div className="usage-label-bottom">
                  {subscription ? 
                    `${productsUsed} / ${subscription.plan.productLimit} Used` : 
                    '0 / 2 Used'
                  }
                </div>
              </div>
              <Link to="/app/choose-subscription" style={{ textDecoration: 'none' }}>
                <button className="upgrade-button">
                  <span className="crown-icon">👑</span>
                  Upgrade to Pro
                </button>
              </Link>
            </div>
          </div>
        </div>
        <div className="cta-section">
          {!subscription ? (
            <Link to="/app/choose-subscription">
              <Button variant="primary" size="large">
                Choose a Plan to Get Started
              </Button>
            </Link>
          ) : (
            <Link to="/app/add-product-replica">
              <Button variant="primary" size="large">
                Start Importing Products
              </Button>
            </Link>
          )}
        </div>
      </div>
    </Page>
    </div>

    {/* Modals Page */}
    <Page fullWidth>
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

        {/* Video Tutorial Modal */}
        {isVideoModalOpen && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 9999,
            padding: '20px',
          }}>
            <div style={{
              backgroundColor: 'white',
              borderRadius: '8px',
              maxWidth: '900px',
              width: '100%',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'auto',
            }}>
              <div style={{
                padding: '16px',
                borderBottom: '1px solid #e5e5e5',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>ShopFlix AI Tutorial</h2>
                <button
                  onClick={() => setIsVideoModalOpen(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: '24px',
                    cursor: 'pointer',
                    padding: '0',
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
              <div style={{
                flex: 1,
                padding: '16px',
                backgroundColor: '#000',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
              }}>
                <video
                  width="100%"
                  height="auto"
                  controls
                  autoPlay
                  style={{ display: 'block', maxHeight: 'calc(80vh - 100px)' }}
                >
                  <source src="/ShopFlixAI.mp4" type="video/mp4" />
                  Your browser does not support the video tag.
                </video>
              </div>
              <div style={{
                padding: '16px',
                borderTop: '1px solid #e5e5e5',
                display: 'flex',
                justifyContent: 'flex-end',
              }}>
                <button
                  onClick={() => setIsVideoModalOpen(false)}
                  style={{
                    backgroundColor: '#006ECB',
                    color: 'white',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 500,
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Page>
    </>
  );
}
