import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useRouteError, isRouteErrorResponse } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  Button,
  List,
  Pagination,
  Badge,
  Layout,
  Box,
  Divider,
  InlineStack,
  Select,
  Tabs,
  TextField,
  Icon,
  Modal, // Added Modal
  ProgressBar,
  Tooltip,
} from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useState, useEffect, useCallback, useRef } from "react";
import type { ShouldRevalidateFunction } from "@remix-run/react";
import { CentralizedLoader } from "../components/CentralizedLoader";
import RichTextEditor from "../components/RichTextEditor";
import { ClientOnly } from "../components/ClientOnly";
import { getProductsUsed, getEffectiveProductLimit, getOrCreateSubscription } from "../utils/billing.server";
import { CheckCircleIcon } from "@shopify/polaris-icons";

export const shouldRevalidate: ShouldRevalidateFunction = ({
  formAction,
  defaultShouldRevalidate,
}) => {
  if (formAction?.endsWith("/api/ai/check")) {
    return false;
  }
  return defaultShouldRevalidate;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  try {
    // Check if report is enabled
    const settings = await prisma.appSettings.findUnique({
      where: { shop: session.shop },
    });

    if (!settings?.reportEnabled) {
      throw new Response("This page is not enabled", { status: 403 });
    }

    const subscription = await getOrCreateSubscription(session.shop);
    const productsUsed = getProductsUsed(subscription);
    const productLimit = getEffectiveProductLimit(subscription);

    const shopResponse = await admin.graphql(
      `#graphql
        query shopName {
          shop {
            name
          }
        }`
    );
    const shopData = await shopResponse.json();
    const shopName = shopData?.data?.shop?.name ?? 'Your Store';

    // Fetch AI check statuses
    const aiChecks = await prisma.productAICheck.findMany({
      where: { shop: session.shop },
      select: { productId: true, aiCheckCompleted: true, autoFixCompleted: true },
    });

    const completedActions = aiChecks.reduce((acc: any, check) => {
      acc[check.productId] = {
        aiCheck: check.aiCheckCompleted,
        autoFix: check.autoFixCompleted,
      };
      return acc;
    }, {});

    return json({
      shopName,
      productsUsed,
      productLimit,
      completedActions,
    });
  } catch (error) {
    // Re-throw Response errors (like 403) as-is so the ErrorBoundary can handle them
    if (error instanceof Response) throw error;
    console.error('[app.report loader] Unexpected error:', error);
    throw new Response("Failed to load report data. Please try again.", { status: 500 });
  }
};

export default function ReportPage() {
  const { shopName, productsUsed, productLimit, completedActions: initialCompletedActions } = useLoaderData<typeof loader>();
  const seoFetcher = useFetcher();

  const [products, setProducts] = useState<any[]>([]);
  const [pageInfo, setPageInfo] = useState<any>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState('20');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortKey, setSortKey] = useState('CREATED_AT');
  const [reverse, setReverse] = useState(false); // Changed to false for newest to oldest default
  const [selectedTab, setSelectedTab] = useState(0);
  const [isSearchActive, setIsSearchActive] = useState(false); // New state for search visibility
  const [processingAll, setProcessingAll] = useState(false); // New state for overall processing
  const [isModalOpen, setIsModalOpen] = useState(false); // For AI Report confirmation
  const [modalMessage, setModalMessage] = useState('');
  const [modalEmail, setModalEmail] = useState('');

  const [isTestEmailModalOpen, setIsTestEmailModalOpen] = useState(false); // For Test Email
  const [testEmailRecipient, setTestEmailRecipient] = useState('');
  const [isSendingTestEmail, setIsSendingTestEmail] = useState(false);
  const [testEmailMessage, setTestEmailMessage] = useState('');
  const [credits, setCredits] = useState({ used: productsUsed, limit: productLimit });
  const [completedActions, setCompletedActions] = useState<{ [productId: string]: { aiCheck?: boolean, autoFix?: boolean } }>(initialCompletedActions || {});

  const [isSavingAutoFixChanges, setIsSavingAutoFixChanges] = useState(false); // New state for save button loader

  interface AutoFixProductData {
    id?: string;
    title?: string;
    handle?: string;
    description?: string;
    meta_description?: string;
    gtin?: string;
    vendor?: string;
    brand?: string;
    google_product_category?: string;
    color?: string;
    material?: string;
    condition?: string;
    availability?: string;
    price?: number;
    compareAtPrice?: number;
    analysis_summary?: any;
    variants?: any;
    tags?: string[];
  }

  const [isAutoFixReviewModalOpen, setIsAutoFixReviewModalOpen] = useState(false);
  const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false);
  const [autoFixProductData, setAutoFixProductData] = useState<AutoFixProductData | null>(null);
  const [autoFixAnalysisSummary, setAutoFixAnalysisSummary] = useState<any>(null);
  const [isAutoFixingProduct, setIsAutoFixingProduct] = useState(false);
  const [autoFixMessage, setAutoFixMessage] = useState('');
  const [currentProductForAutoFix, setCurrentProductForAutoFix] = useState<any>(null);
  const [originalProductForReview, setOriginalProductForReview] = useState<any>(null);
  const [originalTagsForReview, setOriginalTagsForReview] = useState<string[]>([]);
  const [aiGeneratedTagsForDisplay, setAiGeneratedTagsForDisplay] = useState<string[]>([]);

  const [isAICheckModalOpen, setIsAICheckModalOpen] = useState(false);
  const [aiCheckProgress, setAiCheckProgress] = useState(0);
  const [aiCheckStepText, setAiCheckStepText] = useState("");

  const gtinFetcher = useFetcher();
  const [gtinSearchTerm, setGtinSearchTerm] = useState('');

  // Ref to track if initial load has happened
  const initialLoadRef = useRef(true);

  useEffect(() => {
    if (gtinFetcher.data) {
      if ((gtinFetcher.data as { gtin?: string }).gtin) {
        setAutoFixProductData((prev: any) => ({
          ...prev,
          gtin: (gtinFetcher.data as { gtin?: string }).gtin,
        }));
      } else if ((gtinFetcher.data as { error?: string }).error) {
        console.error("GTIN Fetcher Error:", (gtinFetcher.data as { error?: string }).error);
        setAutoFixMessage(`GTIN search failed: ${(gtinFetcher.data as { error?: string }).error}`);
      }
    }
  }, [gtinFetcher.data, gtinFetcher.state]);

  // Helper function for truncation and tooltip
  const truncateWithTooltip = useCallback((text: string, maxLength: number) => {
    if (!text) return { display: '', tooltip: '' };
    if (text.length > maxLength) {
      return {
        display: `${text.substring(0, maxLength)}...`,
        tooltip: text,
      };
    }
    return { display: text, tooltip: text };
  }, []);

  const handlePageSizeChange = useCallback((value: string) => {
    setPageSize(value);
    setCursor(null); // Reset cursor on page size change
    setCurrentPage(1);
  }, []);

  const handleSearchTermChange = useCallback((value: string) => {
    setSearchTerm(value);
    setCursor(null); // Reset cursor on search term change
    setCurrentPage(1);
  }, []);

  const handleSortChange = useCallback((value: string) => {
    const [key, rev] = value.split(':');
    setSortKey(key);
    setReverse(rev === 'true');
    setCursor(null); // Reset cursor on sort change
    setCurrentPage(1);
  }, []);

  const handleTabChange = useCallback((selectedTabIndex: number) => {
    setSelectedTab(selectedTabIndex);
    setStatusFilter(["", "status:active", "status:draft"][selectedTabIndex]);
    setCursor(null); // Reset cursor on tab change
    setCurrentPage(1);
  }, []);

  // Fetch products whenever filters/pagination change (including on initial mount)
  useEffect(() => {
    const finalQuery = `${statusFilter} ${searchTerm}`.trim();
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    params.set("count", pageSize);
    if (finalQuery) params.set("query", finalQuery);
    params.set("sortKey", sortKey);
    params.set("reverse", String(reverse));
    seoFetcher.load(`/api/seo-check?${params.toString()}`);
  }, [cursor, pageSize, searchTerm, statusFilter, sortKey, reverse]);

  // Effect for processing seoFetcher data
  useEffect(() => {
    if (!seoFetcher.data) return;

    const { products: newProducts, pageInfo: newPageInfo, totalCount: newTotalCount } = seoFetcher.data as any;

    // Guard: if the response is an error (no products array) don't wipe the existing list
    if (!newProducts || !Array.isArray(newProducts)) {
      console.error('seoFetcher returned no products — keeping previous list. Response:', seoFetcher.data);
      return;
    }

    const updatedProducts = newProducts.map((p: any) => ({
      ...p,
      isChecking: false,
    }));

    setProducts(updatedProducts);
    setPageInfo(newPageInfo);
    setTotalCount(newTotalCount);
    initialLoadRef.current = false;

    if (processingAll) setProcessingAll(false);
  }, [seoFetcher.data, processingAll]);

  const handleFindGtin = useCallback(async (productData: any) => {
    if (!productData) {
      console.warn("No product data provided for GTIN search.");
      return;
    }
    const productPayload = {
      id: productData.id,
      title: productData.title,
      brand: productData.brand || currentProductForAutoFix?.vendor || '',
      existingBarcode: currentProductForAutoFix?.variants?.nodes?.[0]?.barcode || '',
    };
    const encodedProduct = encodeURIComponent(JSON.stringify(productPayload));
    gtinFetcher.load(`/api/ai/find-gtin?product=${encodedProduct}`);
  }, [gtinFetcher, currentProductForAutoFix]);

  useEffect(() => {
    if (!gtinFetcher.data) return;
    const gtinData = gtinFetcher.data as {
      gtin?: string;
      confidence?: string;
      source?: string;
      conflictDetected?: boolean;
      message?: string;
    };

    if (gtinData.gtin) {
      setAutoFixProductData((prev: any) => ({ ...prev, gtin: gtinData.gtin }));
    }

    // Surface the message to the user via the modal message field
    if (gtinData.message) {
      const tone = gtinData.conflictDetected
        ? `⚠️ ${gtinData.message}`
        : gtinData.confidence === 'high'
          ? `✅ ${gtinData.message}`
          : `ℹ️ ${gtinData.message}`;
      setAutoFixMessage(tone);
    }
  }, [gtinFetcher.data]);

  // Function to run AI check for a single product (remains for individual button)
  const runAICheck = useCallback(async (productToProcess: any) => {
    setIsAICheckModalOpen(true);
    setAiCheckProgress(10);
    setAiCheckStepText("Reading Product Details...");

    setProducts(prevProducts =>
      prevProducts.map(p =>
        p.id === productToProcess.id ? { ...p, isChecking: true } : p
      )
    );

    const productForAI = {
      id: productToProcess.id,
      title: productToProcess.title,
      handle: productToProcess.handle,
      description: productToProcess.descriptionHtml,
      metaDescription: productToProcess.seo?.description || '',
      price: productToProcess.variants?.nodes?.[0]?.price,
      compareAtPrice: productToProcess.variants?.nodes?.[0]?.compareAtPrice,
      barcode: productToProcess.variants?.nodes?.[0]?.barcode || null,
      vendor: productToProcess.vendor || null,
      status: productToProcess.status || null,
      totalImages: productToProcess.totalImages ?? 0,
    };

    const formData = new FormData();
    formData.append("product", JSON.stringify(productForAI));

    try {
      // Progress simulation during API call
      const step1 = setTimeout(() => {
        setAiCheckProgress(40);
        setAiCheckStepText("Validating against Google Merchant Center Policies...");
      }, 1500);

      const step2 = setTimeout(() => {
        setAiCheckProgress(70);
        setAiCheckStepText("Generating Optimization Suggestions...");
      }, 4000);

      const response = await fetch("/api/ai/check", {
        method: "POST",
        body: formData,
      });

      clearTimeout(step1);
      clearTimeout(step2);

      if (!response.ok) {
        setIsAICheckModalOpen(false);
        let errorDetails = `API responded with status ${response.status}`;
        try {
          const errorJson = await response.json();
          if (errorJson.issues && Array.isArray(errorJson.issues)) {
            setProducts(prevProducts =>
              prevProducts.map(p =>
                p.id === productToProcess.id
                  ? {
                      ...p,
                      issues: errorJson.issues,
                      suggestions_for_sales_improvement: errorJson.suggestions_for_sales_improvement || [],
                      isChecking: false,
                    }
                  : p
              )
            );
            return;
          } else if (errorJson.error) {
            errorDetails += `: ${errorJson.error}`;
            if (errorJson.details) {
              errorDetails += ` - Details: ${errorJson.details}`;
            }
          } else {
            errorDetails += `: ${JSON.stringify(errorJson)}`;
          }
        } catch (parseError) {
          const errorText = await response.text();
          errorDetails += `: ${errorText}`;
        }
        throw new Error(errorDetails);
      }

      const aiResponse = await response.json();

      setAiCheckProgress(100);
      setAiCheckStepText("Finalizing Report...");

      setProducts(prevProducts =>
        prevProducts.map(p =>
          p.id === productToProcess.id // Matched using productToProcess.id instead of aiResponse.id
            ? {
                ...p,
                issues: aiResponse.issues || [],
                suggestions_for_sales_improvement: aiResponse.suggestions_for_sales_improvement || [],
                isChecking: false,
              }
            : p
        )
      );

      setCompletedActions(prev => ({ ...prev, [productToProcess.id]: { ...prev[productToProcess.id], aiCheck: true } }));
      setCredits(prev => ({ ...prev, used: prev.used + 1 }));

      setTimeout(() => {
        setIsAICheckModalOpen(false);
      }, 800);

    } catch (error: any) {
      console.error(`Error running AI check for product ${productToProcess.id}:`, error);
      setIsAICheckModalOpen(false);
      setProducts(prevProducts =>
        prevProducts.map(p =>
          p.id === productToProcess.id
            ? {
                ...p,
                issues: [{ message: `AI check failed: ${error.message}`, severity: "High" }],
                suggestions_for_sales_improvement: [],
                isChecking: false,
              }
            : p
        )
      );
    }
  }, []);

  // Handler for "Run AI Check for All" button (now triggers background process)
  const handleRunAllAICheck = useCallback(async () => {setProcessingAll(true); // Show button loading spinner
  if (!products || products.length === 0) {
      console.warn("No products to generate report for.");
      setModalMessage("No products available to generate a report. Please ensure products are loaded.");
      setModalEmail('');
      setIsModalOpen(true);
      setProcessingAll(false);
      return;
    }

    const productsForReport = products.map(({ id, title, handle, descriptionHtml, seo, variants }) => ({
      id,
      title,
      handle,
      description: descriptionHtml,
      metaDescription: seo?.description || '',
      price: variants.nodes[0]?.price,
      compareAtPrice: variants.nodes[0]?.compareAtPrice,
    }));
    try {
      const response = await fetch("/api/ai/report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json", // Explicitly set Content-Type
        },
        body: JSON.stringify(productsForReport), // Send products directly as JSON body
      });
      if (!response.ok) {
        let errorText = await response.text();
        console.error("API error response:", response.status, errorText);
        setModalMessage(`Error generating report: ${errorText || 'Unknown error'}`);
        setModalEmail('');
        setIsModalOpen(true);
        return;
      }

      const result = await response.json();

      if (result.success) {
        setModalMessage(`A detailed AI Report will take time to process and will be sent to the email ${result.shopOwnerEmail || 'registered with your store'} once done.`);
        setModalEmail(result.shopOwnerEmail || '');
        setIsModalOpen(true);
      } else {
        setModalMessage(`Error generating report: ${result.message || 'Unknown error'}`);
        setModalEmail('');
        setIsModalOpen(true);
      }
    } catch (error: any) {
      console.error("Error triggering AI report generation:", error);
      setModalMessage(`Failed to trigger report generation: ${error.message}`);
      setModalEmail('');
      setIsModalOpen(true);
    } finally {
      setProcessingAll(false); // Reset loader once the initial API call is complete
    }
  }, [products]);

  const handleModalClose = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const handleOpenTestEmailModal = useCallback(() => {
    setIsTestEmailModalOpen(true);
    setTestEmailRecipient(''); // Clear previous recipient
    setTestEmailMessage(''); // Clear previous message
  }, []);

  const handleCloseTestEmailModal = useCallback(() => {
    setIsTestEmailModalOpen(false);
    setTestEmailRecipient('');
    setTestEmailMessage('');
  }, []);

  const handleSendTestEmail = useCallback(async () => {
    setIsSendingTestEmail(true);
    setTestEmailMessage('');

    try {
      const response = await fetch("/api/ai/send-test-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ recipientEmail: testEmailRecipient }),
      });

      const result = await response.json();
      if (response.ok) {
        setTestEmailMessage(result.message);
      } else {
        setTestEmailMessage(`Error: ${result.error || 'Unknown error'}`);
      }
    } catch (error: any) {
      console.error("Error sending test email:", error);
      setTestEmailMessage(`Failed to send test email: ${error.message}`);
    } finally {
      setIsSendingTestEmail(false);
    }
  }, [testEmailRecipient]);

  const modalMarkup = isModalOpen ? (
    <Modal
      open={isModalOpen}
      onClose={handleModalClose}
      title="AI Report Generation"
      primaryAction={{
        content: 'OK',
        onAction: handleModalClose,
      }}
    >
      <Modal.Section>
        <BlockStack gap="200">
          <Text as="p" variant="bodyMd">
            {modalMessage}
          </Text>
        </BlockStack>
      </Modal.Section>
    </Modal>
  ) : null;

  const testEmailModalMarkup = isTestEmailModalOpen ? (
    <Modal
      open={isTestEmailModalOpen}
      onClose={handleCloseTestEmailModal}
      title="Send Test Email"
      primaryAction={{
        content: 'Send Email',
        onAction: handleSendTestEmail,
        loading: isSendingTestEmail,
        disabled: isSendingTestEmail || !testEmailRecipient.includes('@'),
      }}
      secondaryActions={[
        {
          content: 'Cancel',
          onAction: handleCloseTestEmailModal,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="200">
          <TextField
            label="Recipient Email"
            value={testEmailRecipient}
            onChange={setTestEmailRecipient}
            type="email"
            autoComplete="email"
            placeholder="e.g., test@example.com"
          />
          {testEmailMessage && (
            <Text as="p" variant="bodyMd" tone={testEmailMessage.startsWith('Error') ? 'critical' : 'success'}>
              {testEmailMessage}
            </Text>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  ) : null;

  const handleAutoFixReviewModalClose = useCallback(() => {
    setIsAutoFixReviewModalOpen(false);
    setAutoFixProductData(null);
    setAutoFixAnalysisSummary(null);
    setAutoFixMessage('');
    setCurrentProductForAutoFix(null);
  }, []);

  const handleAutoFixWithAIMagic = useCallback(async (productToFix: any) => {
    setCurrentProductForAutoFix(productToFix);
    setOriginalProductForReview(productToFix); // Store original product data
    setIsAutoFixingProduct(true);
    setAutoFixMessage('');

    const originalProductData = {
      id: productToFix.id,
      title: productToFix.title,
      handle: productToFix.handle,
      description: productToFix.descriptionHtml,
      metaDescription: productToFix.seo?.description || '',
      price: productToFix.variants.nodes[0]?.price,
      compareAtPrice: productToFix.variants.nodes[0]?.compareAtPrice,
      variants: productToFix.variants,
      tags: productToFix.tags,
      brand: productToFix.vendor,
      barcode: productToFix.variants?.nodes?.[0]?.barcode || productToFix.barcode || null,
      status: productToFix.status || null,
      totalImageCount: productToFix.images?.nodes?.length ?? productToFix.media?.nodes?.length ?? 0,
    };

    const geminiAnalysis = productToFix.issues && productToFix.suggestions_for_sales_improvement ? {
      issues: productToFix.issues,
      suggestions_for_sales_improvement: productToFix.suggestions_for_sales_improvement,
    } : null;

    try {
      const response = await fetch("/api/ai/autofix", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ original_product_data: originalProductData, gemini_analysis: geminiAnalysis }),
      });
      const result = await response.json();
      if (response.ok && result.success) {
        const aiSuggestedGtin = result.rewrittenData.gtin;
        const originalBarcode = productToFix?.variants?.nodes?.[0]?.barcode || productToFix?.barcode;
        const originalBrand = productToFix?.vendor;

        const existingGmcMetafields = productToFix.metafields?.nodes?.reduce((acc: any, metafield: any) => {
          if (metafield.namespace === "google_merchant_center") {
            acc[metafield.key] = metafield.value;
          }
          return acc;
        }, {});

        setAutoFixProductData({
          ...result.rewrittenData,
          gtin: aiSuggestedGtin || originalBarcode || '',
          brand: result.rewrittenData.brand || originalBrand || existingGmcMetafields?.brand || '',
          vendor: productToFix.vendor || '',
          google_product_category: result.rewrittenData.google_product_category || existingGmcMetafields?.google_product_category || '',
          color: result.rewrittenData.color || existingGmcMetafields?.color || '',
          material: result.rewrittenData.material || existingGmcMetafields?.material || '',
          condition: result.rewrittenData.condition || existingGmcMetafields?.condition || '',
          availability: 'in_stock', // Always default to in_stock; user can change via dropdown
          tags: (result.rewrittenData.tags && result.rewrittenData.tags.length > 0)
            ? result.rewrittenData.tags
            : (productToFix.tags || []),
        });
        setAutoFixAnalysisSummary(result.rewrittenData.analysis_summary);
        setIsAutoFixReviewModalOpen(true);
      } else {
        const errorMessage = result.error || result.message || 'Unknown error';
        setAutoFixMessage(`Auto-fix failed: ${errorMessage}`);
        setIsAutoFixReviewModalOpen(true);
        console.error("Auto-fix API returned error:", errorMessage);
      }
    } catch (error: any) {
      console.error("Error during auto-fix fetch (network/parsing error):", error);
      setAutoFixMessage(`Auto-fix failed: ${error.message}`);
      setIsAutoFixReviewModalOpen(true);
    } finally {
      setIsAutoFixingProduct(false);
    }
  }, []);

  const refreshProducts = useCallback(() => {
    const finalQuery = `${statusFilter} ${searchTerm}`.trim();
    const params = new URLSearchParams();
    // When refreshing, we want to stay on the current page, so we use the current cursor
    if (cursor) params.set("cursor", cursor);
    params.set("count", pageSize);
    if (finalQuery) params.set("query", finalQuery);
    params.set("sortKey", sortKey);
    params.set("reverse", String(reverse));
    seoFetcher.load(`/api/seo-check?${params.toString()}`);
  }, [cursor, pageSize, searchTerm, statusFilter, sortKey, reverse]);

  const handleSaveAutoFixChanges = useCallback(async () => {
    if (!autoFixProductData || !currentProductForAutoFix) {
      setAutoFixMessage("No product data to save.");
      return;
    }

    setIsSavingAutoFixChanges(true);
    setAutoFixMessage('');

    const cleanedHandle = (autoFixProductData.handle || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special characters except spaces and hyphens
      .replace(/\s+/g, '-') // Replace spaces with single hyphens
      .replace(/^-+|-+$/g, ''); // Trim hyphens from start/end

    const cleanedMetaDescription = (autoFixProductData.meta_description || '').trim(); // Clean meta description

    const allTagsToSave = Array.from(new Set([
      ...(currentProductForAutoFix.tags || []), // Original tags from the product
      ...(autoFixProductData.tags || []), // AI-generated tags
    ])).map(tag => tag.trim()); // Ensure all tags are trimmed

    const payload = {
      ...autoFixProductData,
      id: currentProductForAutoFix.id, // Ensure the correct GID is used
      handle: cleanedHandle, // Use cleaned handle
      meta_description: cleanedMetaDescription, // Use cleaned meta description
      vendor: autoFixProductData.vendor || '', // Include vendor for Shopify product vendor field
      brand: autoFixProductData.brand || '', // Include brand in the payload
      price: autoFixProductData.price !== undefined ? String(autoFixProductData.price) : undefined, // Ensure price is string
      compareAtPrice: autoFixProductData.compareAtPrice !== undefined ? String(autoFixProductData.compareAtPrice) : undefined, // Ensure compareAtPrice is string
      variants: currentProductForAutoFix.variants.nodes.map((variant: any) => {
        const cleanedGtin = (autoFixProductData.gtin || '').toString().trim();
        return {
          id: variant.id, // Ensure variant ID is explicitly included
          price: autoFixProductData.price !== undefined ? String(autoFixProductData.price) : undefined, // Use autoFixProductData's price, ensure string
          compareAtPrice: autoFixProductData.compareAtPrice !== undefined ? String(autoFixProductData.compareAtPrice) : undefined, // Use autoFixProductData's compareAtPrice, ensure string
          barcode: cleanedGtin === "null" ? "" : cleanedGtin, // Ensure barcode is a clean string or empty
        };
      }),
      tags: allTagsToSave, // Send the combined set of tags
      analysis_summary: autoFixAnalysisSummary, // Pass the analysis summary for intelligent issue removal
    };// Updated log for clarity

    try {
      const response = await fetch("/api/products/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      let result;
      if (response.ok) {
        result = await response.json();
      } else {
        const errorText = await response.text();
        console.error("Raw error response text:", errorText); // Log raw error text
        try {
          result = JSON.parse(errorText);
        } catch (parseError) {
          result = { error: `Server responded with non-JSON: ${errorText}` };
        }
      }

      if (response.ok && result.success) {
        setCompletedActions(prev => ({ ...prev, [currentProductForAutoFix.id]: { ...prev[currentProductForAutoFix.id], autoFix: true } }));
        setCredits(prev => ({ ...prev, used: prev.used + 1 }));

        // Immediately update the product's issues in state using what the server
        // calculated as remaining — no need to wait for a full refresh.
        const savedProductId = currentProductForAutoFix.id;
        if (result.remainingIssues !== undefined) {
          setProducts(prev => prev.map(p =>
            p.id === savedProductId
              ? {
                  ...p,
                  issues: result.remainingIssues,
                  suggestions_for_sales_improvement: result.remainingSuggestions ?? [],
                }
              : p
          ));
        }

        setIsSuccessModalOpen(true);
        // Refresh the product list to pull updated Shopify data (title, handle, etc.)
        refreshProducts();
        // Close the modal after a short delay to show the success message
        setTimeout(() => {
          handleAutoFixReviewModalClose();
        }, 1500);
      } else {
        const errorMessage = result.error || result.message || 'Unknown error during save.';
        setAutoFixMessage(`Failed to save changes: ${errorMessage}`);
        console.error("Error saving auto-fix changes:", errorMessage);
      }
    } catch (error: any) {
      setAutoFixMessage(`Failed to save changes: ${error.message}`);
      console.error("Network error saving auto-fix changes:", error);
    } finally {
      setIsSavingAutoFixChanges(false);
    }
  }, [autoFixProductData, currentProductForAutoFix, refreshProducts, handleAutoFixReviewModalClose]);

  const successModalMarkup = isSuccessModalOpen ? (
    <Modal
      open={isSuccessModalOpen}
      onClose={() => setIsSuccessModalOpen(false)}
      title="Success"
      primaryAction={{
        content: "OK",
        onAction: () => setIsSuccessModalOpen(false),
      }}
    >
      <Modal.Section>
        <Text as="p" variant="bodyMd">
          Product saved successfully!
        </Text>
      </Modal.Section>
    </Modal>
  ) : null;

  const aiCheckProgressModalMarkup = isAICheckModalOpen ? (
    <Modal
      open={isAICheckModalOpen}
      onClose={() => {}} // User shouldn't close it while it's processing
      title="Running AI Diagnostics"
    >
      <Modal.Section>
        <BlockStack gap="400" align="center">
          <Text as="h2" variant="headingMd" alignment="center">
            {aiCheckStepText}
          </Text>
          <ProgressBar progress={aiCheckProgress} size="small" tone="primary" />
          <Text as="p" variant="bodySm" alignment="center" tone="subdued">
            This might take a few seconds...
          </Text>
        </BlockStack>
      </Modal.Section>
    </Modal>
  ) : null;

  const autoFixReviewModalMarkup = isAutoFixReviewModalOpen ? (
    <Modal
      open={isAutoFixReviewModalOpen}
      onClose={handleAutoFixReviewModalClose}
      title="Review AI Fixes"
      primaryAction={{
        content: 'Save Changes',
        onAction: handleSaveAutoFixChanges,
        loading: isSavingAutoFixChanges, // Use new loading state
        disabled: isSavingAutoFixChanges, // Disable while saving
      }}
      secondaryActions={[
        {
          content: 'Cancel',
          onAction: handleAutoFixReviewModalClose,
          disabled: isSavingAutoFixChanges, // Disable while saving
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          {autoFixMessage && (
            <Text as="p" variant="bodyMd" tone={autoFixMessage.startsWith('Failed to save changes') || autoFixMessage.startsWith('Error:') ? 'critical' : 'success'}>
              {autoFixMessage}
            </Text>
          )}
          {autoFixProductData && (
            <BlockStack gap="200">
              <Text as="h3" variant="headingMd">AI Suggested Changes</Text>
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">Title</Text>
                {originalProductForReview?.title && (
                  <Text as="p" variant="bodySm" tone="critical">
                    <b>Original Title:</b>{" "}
                    <span
                      className="original-value-label"
                      title={truncateWithTooltip(originalProductForReview.title, 70).tooltip}
                    >
                      {truncateWithTooltip(originalProductForReview.title, 70).display}
                    </span>
                  </Text>
                )}
                <TextField
                  label="Title"
                  labelHidden
                  value={autoFixProductData.title || ''}
                  onChange={(value) => setAutoFixProductData((prev: any) => ({ ...prev, title: value }))}
                  multiline={false}
                  autoComplete="off"
                />
              </BlockStack>
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">Description</Text>
                {originalProductForReview?.descriptionHtml && (
                  <Text as="p" variant="bodySm" tone="critical">
                    <b>Original Description:</b>{" "}
                    <span
                      className="original-value-label"
                      title={truncateWithTooltip(originalProductForReview.descriptionHtml, 150).tooltip}
                    >
                      {truncateWithTooltip(originalProductForReview.descriptionHtml, 150).display}
                    </span>
                  </Text>
                )}
                <ClientOnly>
                  <RichTextEditor
                    value={autoFixProductData.description || ''}
                    onChange={(value) => {
                      setAutoFixProductData((prev: any) => ({ ...prev, description: value }));
                    }}
                  />
                </ClientOnly>
              </BlockStack>
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">Handle</Text>
                {originalProductForReview?.handle && (
                  <Text as="p" variant="bodySm" tone="critical">
                    <b>Original Handle:</b>{" "}
                    <span
                      className="original-value-label"
                      title={truncateWithTooltip(originalProductForReview.handle, 70).tooltip}
                    >
                      {truncateWithTooltip(originalProductForReview.handle, 70).display}
                    </span>
                  </Text>
                )}
                <TextField
                  label="Handle"
                  labelHidden
                  value={autoFixProductData.handle || ''}
                  onChange={(value) => setAutoFixProductData((prev: any) => ({ ...prev, handle: value }))}
                  multiline={false}
                  autoComplete="off"
                />
              </BlockStack>
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">Meta Description</Text>
                {originalProductForReview?.seo?.description && (
                  <Text as="p" variant="bodySm" tone="critical">
                    <b>Original Meta Description:</b>{" "}
                    <span
                      className="original-value-label"
                      title={truncateWithTooltip(originalProductForReview.seo.description, 100).tooltip}
                    >
                      {truncateWithTooltip(originalProductForReview.seo.description, 100).display}
                    </span>
                  </Text>
                )}
                <TextField
                  label="Meta Description"
                  labelHidden
                  value={autoFixProductData.meta_description || ''}
                  onChange={(value) => setAutoFixProductData((prev: any) => ({ ...prev, meta_description: value }))}
                  multiline={2}
                  autoComplete="off"
                />
              </BlockStack>
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="p" variant="bodyMd">GTIN</Text>
                </InlineStack>
                <div style={{ background: '#fff4f4', border: '1px solid #fca5a5', borderRadius: '6px', padding: '6px 10px', display: 'inline-block' }}>
                  <Text as="p" variant="bodySm" tone="critical">
                    Searches UPCitemdb + AI. <strong>Always verify before submitting to Google Merchant Center.</strong>
                  </Text>
                </div>
                {originalProductForReview?.barcode && (
                  <Text as="p" variant="bodySm" tone="critical">
                    <b>Original GTIN:</b>{" "}
                    <span
                      className="original-value-label"
                      title={truncateWithTooltip(originalProductForReview.barcode, 20).tooltip}
                    >
                      {truncateWithTooltip(originalProductForReview.barcode, 20).display}
                    </span>
                  </Text>
                )}
                <InlineStack gap="200">
                  <div style={{ flexGrow: 1 }}>
                    <TextField
                      label="GTIN"
                      labelHidden
                      value={autoFixProductData.gtin || ''}
                      onChange={(value) => {
                        setAutoFixProductData((prev: any) => ({ ...prev, gtin: value }));
                      }}
                      multiline={false}
                      autoComplete="off"
                    />
                  </div>
                  <Button
                    onClick={() => handleFindGtin(autoFixProductData)}
                    loading={gtinFetcher.state === 'loading'}
                  >
                    Find GTIN
                  </Button>
                </InlineStack>
                {(gtinFetcher.data as any)?.confidence && (
                  <InlineStack gap="100" blockAlign="center">
                    <Badge
                      tone={
                        (gtinFetcher.data as any).conflictDetected
                          ? 'warning'
                          : (gtinFetcher.data as any).confidence === 'high'
                            ? 'success'
                            : 'info'
                      }
                    >
                      {(gtinFetcher.data as any).conflictDetected
                        ? 'Conflict — already used by another product'
                        : (gtinFetcher.data as any).confidence === 'high'
                          ? `Verified via ${(gtinFetcher.data as any).source === 'upcitemdb' ? 'UPCitemdb' : 'AI'}`
                          : 'Approximate match — please verify'}
                    </Badge>
                    {(gtinFetcher.data as any).storeBarcodesChecked !== undefined && (
                      <Text as="span" variant="bodySm" tone="subdued">
                        ({(gtinFetcher.data as any).storeBarcodesChecked} store barcodes checked)
                      </Text>
                    )}
                  </InlineStack>
                )}
              </BlockStack>
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">Vendor</Text>
                <TextField
                  label="Vendor"
                  labelHidden
                  value={autoFixProductData.vendor || ''}
                  onChange={(value) => setAutoFixProductData((prev: any) => ({ ...prev, vendor: value }))}
                  multiline={false}
                  autoComplete="off"
                  helpText="The vendor/brand name stored on the Shopify product"
                />
              </BlockStack>
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">Brand</Text>
                <TextField
                  label="Brand"
                  labelHidden
                  value={autoFixProductData.brand || ''}
                  onChange={(value) => setAutoFixProductData((prev: any) => ({ ...prev, brand: value }))}
                  multiline={false}
                  autoComplete="off"
                />
              </BlockStack>
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">Google Product Category</Text>
                <TextField
                  label="Google Product Category"
                  labelHidden
                  value={autoFixProductData.google_product_category || ''}
                  onChange={(value) => setAutoFixProductData((prev: any) => ({ ...prev, google_product_category: value }))}
                  multiline={false}
                  autoComplete="off"
                />
              </BlockStack>
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">Color</Text>
                <TextField
                  label="Color"
                  labelHidden
                  value={autoFixProductData.color || ''}
                  onChange={(value) => setAutoFixProductData((prev: any) => ({ ...prev, color: value }))}
                  multiline={false}
                  autoComplete="off"
                />
              </BlockStack>
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">Material</Text>
                <TextField
                  label="Material"
                  labelHidden
                  value={autoFixProductData.material || ''}
                  onChange={(value) => setAutoFixProductData((prev: any) => ({ ...prev, material: value }))}
                  multiline={false}
                  autoComplete="off"
                />
              </BlockStack>
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">Condition</Text>
                <TextField
                  label="Condition"
                  labelHidden
                  value={autoFixProductData.condition || ''}
                  onChange={(value) => setAutoFixProductData((prev: any) => ({ ...prev, condition: value }))}
                  multiline={false}
                  autoComplete="off"
                />
              </BlockStack>
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">Availability</Text>
                <Select
                  label="Availability"
                  labelHidden
                  options={[
                    { label: 'In Stock', value: 'in_stock' },
                    { label: 'Out of Stock', value: 'out_of_stock' },
                    { label: 'Pre-order', value: 'preorder' },
                    { label: 'Backorder', value: 'backorder' },
                  ]}
                  value={autoFixProductData.availability || 'in_stock'}
                  onChange={(value) => setAutoFixProductData((prev: any) => ({ ...prev, availability: value }))}
                />
              </BlockStack>
              <InlineStack gap="200">
                <BlockStack>
                  <Text as="p" variant="bodyMd">Price</Text>
                  {originalProductForReview?.variants?.nodes?.[0]?.price && (
                    <Text as="p" variant="bodySm" tone="critical">
                      <b>Original Price:</b>{" "}
                      <span
                        className="original-value-label"
                        title={`Original Price: ${originalProductForReview.variants.nodes[0].price}`}
                      >
                        {originalProductForReview.variants.nodes[0].price}
                      </span>
                    </Text>
                  )}
                  <TextField
                    label="Price"
                    labelHidden
                    value={autoFixProductData.price !== undefined ? String(autoFixProductData.price) : ''}
                    onChange={(value) => setAutoFixProductData((prev: any) => ({ ...prev, price: parseFloat(value) || 0 }))}
                    type="number"
                    autoComplete="off"
                  />
                </BlockStack>
                <BlockStack>
                  <Text as="p" variant="bodyMd">Compare At Price</Text>
                  {originalProductForReview?.variants?.nodes?.[0]?.compareAtPrice && (
                    <Text as="p" variant="bodySm" tone="critical">
                      <b>Original Compare At Price:</b>{" "}
                      <span
                        className="original-value-label"
                        title={`Original Compare At Price: ${originalProductForReview.variants.nodes[0].compareAtPrice}`}
                      >
                        {originalProductForReview.variants.nodes[0].compareAtPrice}
                      </span>
                    </Text>
                  )}
                  <TextField
                    label="Compare At Price"
                    labelHidden
                    value={autoFixProductData.compareAtPrice !== undefined ? String(autoFixProductData.compareAtPrice) : ''}
                    onChange={(value) => setAutoFixProductData((prev: any) => ({ ...prev, compareAtPrice: parseFloat(value) || 0 }))}
                    type="number"
                    autoComplete="off"
                  />
                </BlockStack>
              </InlineStack>
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">Tags</Text>
                <TextField
                  label="Tags"
                  labelHidden
                  value={autoFixProductData.tags?.join(', ') || ''}
                  onChange={(value) => setAutoFixProductData((prev: any) => ({ ...prev, tags: value.split(',').map(tag => tag.trim()) }))}
                  multiline={false}
                  autoComplete="off"
                />
              </BlockStack>

            </BlockStack>
          )}

          {autoFixAnalysisSummary && (
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">AI Fixes Report</Text>
              {autoFixAnalysisSummary.resolved_issues && autoFixAnalysisSummary.resolved_issues.length > 0 && (
                <BlockStack gap="100">
                  <Text as="h4" variant="headingSm"><strong>Resolved Issues</strong></Text>
                  <List type="bullet">
                    {autoFixAnalysisSummary.resolved_issues.map((issue: string, index: number) => (
                      <List.Item key={`resolved-${index}`}>{issue}</List.Item>
                    ))}
                  </List>
                </BlockStack>
              )}
              {autoFixAnalysisSummary.pending_issues_for_manual_fix && autoFixAnalysisSummary.pending_issues_for_manual_fix.length > 0 && (
                <BlockStack gap="100">
                  <Box paddingBlockStart="400">
                    <Text as="h4" variant="headingSm"><strong>Suggestions</strong></Text>
                  </Box>
                  <List type="bullet">
                    {autoFixAnalysisSummary.pending_issues_for_manual_fix.map((issue: any, index: number) => (
                      <List.Item key={`pending-${index}`}>
                        <Text as="p" variant="bodyMd">
                          <strong>{issue.message}</strong>
                        </Text>
                        <Text as="p" variant="bodySm">
                          {issue.manual_fix_steps}
                        </Text>
                      </List.Item>
                    ))}
                  </List>
                </BlockStack>
              )}
            </BlockStack>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  ) : null;

  const getBadgeTone = (severity: string) => {
    switch (severity) {
      case "High":
        return "critical";
      case "Medium":
        return "warning";
      case "Low":
        return "attention";
    }
  };

  return (
    <Page
      title={`Products Repair (${credits.used}/${credits.limit} used)`}
      fullWidth
    >
      <CentralizedLoader loading={seoFetcher.state === "loading"} />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300"> {/* Reduced gap for less empty space */}
                {isSearchActive ? (
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center" wrap={false}>
                      <div style={{ flexGrow: 1 }}>
                        <TextField
                          label="Search products"
                          labelHidden
                          value={searchTerm}
                          onChange={handleSearchTermChange}
                          prefix={<Icon source={SearchIcon} tone="base" />}
                          placeholder="Search by product title"
                          autoComplete="off"
                          connectedRight={
                            <Button onClick={() => setIsSearchActive(false)}>Cancel</Button>
                          }
                        />
                      </div>
                    </InlineStack>
                    <Tabs
                      tabs={[
                        { id: 'all', content: 'All' },
                        { id: 'active', content: 'Active' },
                        { id: 'draft', content: 'Draft' },
                      ]}
                      selected={selectedTab}
                      onSelect={handleTabChange}
                    />
                  </BlockStack>
                ) : (
                  <InlineStack align="space-between" blockAlign="center" wrap={false}>
                    <Tabs
                      tabs={[
                        { id: 'all', content: 'All' },
                        { id: 'active', content: 'Active' },
                        { id: 'draft', content: 'Draft' },
                      ]}
                      selected={selectedTab}
                      onSelect={handleTabChange}
                    />
                    <InlineStack gap="400">
                      <Button onClick={() => setIsSearchActive(true)} icon={<Icon source={SearchIcon} tone="base" />}>
                        Search
                      </Button>
                      <Select
                        label="Sort by"
                        labelHidden
                        options={[
                          { label: 'Newest', value: 'CREATED_AT:false' }, // Changed value to false
                          { label: 'Oldest', value: 'CREATED_AT:true' },  // Changed value to true
                          { label: 'Title A-Z', value: 'TITLE:false' },
                          { label: 'Title Z-A', value: 'TITLE:true' },
                        ]}
                        value={`${sortKey}:${reverse}`}
                        onChange={handleSortChange}
                      />
                    </InlineStack>
                  </InlineStack>
                )}
                {/* Debug / error display */}
                {seoFetcher.state === 'idle' && seoFetcher.data && !(seoFetcher.data as any).products && (
                  <div style={{ padding: '16px', background: '#fff4f4', border: '1px solid #e74c3c', borderRadius: '8px' }}>
                    <BlockStack gap="200">
                      <Text as="p" variant="bodyMd" tone="critical">
                        <b>Failed to load products.</b> Raw response: {JSON.stringify(seoFetcher.data)}
                      </Text>
                      <Button onClick={refreshProducts} variant="primary">Retry</Button>
                    </BlockStack>
                  </div>
                )}
                {products.length === 0 && seoFetcher.state !== 'loading' && seoFetcher.data !== undefined && (
                  <div style={{ padding: '24px', textAlign: 'center' }}>
                    <Text as="p" variant="bodyMd" tone="subdued">No products found. <Button variant="plain" onClick={refreshProducts}>Reload</Button></Text>
                  </div>
                )}
                <div className="report-correction-box">
                  <BlockStack gap="200">
                    {products.map((product) => {
                      const aiCheckCompleted = completedActions[product.id]?.aiCheck;
                      const autoFixCompleted = completedActions[product.id]?.autoFix;

                      return (
                        <Card key={product.id}>
                          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%' }}>
                            <div style={{ flexGrow: 1 }}>
                              <BlockStack gap="200">
                                <Text as="h3" variant="headingSm">
                                  <b>{product.title}</b>
                                </Text>
                                {product.issues && product.issues.length > 0 ? (
                                  <List type="bullet">
                                    {product.issues.map((issue: any, index: number) => (
                                      <List.Item key={index}>
                                        <Badge tone={getBadgeTone(issue.severity)}>
                                          {issue.severity}
                                        </Badge>{" "}
                                        {issue.message}
                                      </List.Item>
                                    ))}
                                  </List>
                                ) : (
                                  <Badge tone="success">Great!!! No issues found</Badge>
                                )}
                                {product.suggestions_for_sales_improvement &&
                                  product.suggestions_for_sales_improvement.length > 0 && (
                                    <>
                                      <Box paddingBlockStart="200">
                                        <Divider />
                                      </Box>
                                      <Text as="h4" variant="bodyMd">
                                        <b>Sales Improvement Suggestions</b>
                                      </Text>
                                      <List type="bullet">
                                        {product.suggestions_for_sales_improvement.map(
                                          (suggestion: any, index: number) => (
                                            <List.Item key={`suggestion-${index}`}>
                                              <Badge tone={getBadgeTone(suggestion.priority)}>
                                                {suggestion.priority}
                                              </Badge>{" "}
                                              {suggestion.suggestion}
                                            </List.Item>
                                          ),
                                        )}
                                      </List>
                                    </>
                                  )}
                              </BlockStack>
                            </div>
                            <div style={{ alignSelf: 'flex-end', paddingTop: 'var(--p-space-200)' }}>
                              <InlineStack gap="200" blockAlign="center">
                                <Tooltip content={aiCheckCompleted ? "AI Check complete" : "Run AI Check to find issues (1 Credit)"}>
                                  <Button
                                    variant="primary"
                                    size="slim"
                                    onClick={() => runAICheck(product)}
                                    loading={product.isChecking}
                                    disabled={product.isChecking}
                                  >
                                    <InlineStack gap="100" blockAlign="center" wrap={false}>
                                      <span>Run AI Check (1 Credit)</span>
                                      {aiCheckCompleted && <Icon source={CheckCircleIcon} tone="success" />}
                                    </InlineStack>
                                  </Button>
                                </Tooltip>
                                <Tooltip content={autoFixCompleted ? "Auto-Fix complete" : "Automatically fix issues with AI (1 Credit)"}>
                                  <Button
                                    variant="secondary"
                                    size="slim"
                                    onClick={() => handleAutoFixWithAIMagic(product)}
                                    loading={isAutoFixingProduct && currentProductForAutoFix?.id === product.id}
                                    disabled={product.isChecking || (isAutoFixingProduct && currentProductForAutoFix?.id !== product.id)}
                                  >
                                    <InlineStack gap="100" blockAlign="center" wrap={false}>
                                      <span>Auto Fix with AI Magic (1 Credit)</span>
                                      {autoFixCompleted && <Icon source={CheckCircleIcon} tone="success" />}
                                    </InlineStack>
                                  </Button>
                                </Tooltip>
                              </InlineStack>
                            </div>
                          </div>
                        </Card>
                      )
                    })}
                  </BlockStack>
                </div>
                <InlineStack align="end" gap="400" blockAlign="center">
                  <InlineStack gap="200">
                    <Button
                      variant="primary"
                      onClick={handleRunAllAICheck}
                      loading={processingAll}
                      disabled={processingAll}
                    >
                      Generate AI Report (Email)
                    </Button>
                    <Button
                      onClick={handleOpenTestEmailModal}
                      disabled={isSendingTestEmail}
                    >
                      Send Test Email
                    </Button>
                  </InlineStack>
                  <Text as="p" variant="bodyMd">
                    Products per page
                  </Text>
                  <Box width="100px">
                    <Select
                      label="Products per page"
                      labelHidden
                      options={[
                        {label: '5', value: '5'},
                        {label: '10', value: '10'},
                        {label: '20', value: '20'},
                        {label: '50', value: '50'},
                        {label: '100', value: '100'},
                      ]}
                      onChange={handlePageSizeChange}
                      value={pageSize}
                    />
                  </Box>
                  <Text as="p" variant="bodyMd">
                    Showing {products.length} of {totalCount} products
                  </Text>
                  <Pagination
                    hasPrevious={pageInfo?.hasPreviousPage}
                    onPrevious={() => {
                      setCursor(pageInfo.startCursor);
                      setCurrentPage(currentPage - 1);
                    }}
                    hasNext={pageInfo?.hasNextPage}
                    onNext={() => {
                      setCursor(pageInfo.endCursor);
                      setCurrentPage(currentPage + 1);
                    }}
                    label={`${currentPage} of ${
                      totalCount > 0 ? Math.ceil(totalCount / parseInt(pageSize, 10)) : 1
                    }`}
                  />
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
      {modalMarkup} {/* Render the AI Report modal here */}
      {testEmailModalMarkup} {/* Render the Test Email modal here */}
      {autoFixReviewModalMarkup} {/* Render the Auto Fix Review modal here */}
      {successModalMarkup}
      {aiCheckProgressModalMarkup} {/* Render the AI progress modal here */}
    </Page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const is403 = isRouteErrorResponse(error) && error.status === 403;
  const message = isRouteErrorResponse(error)
    ? error.data
    : (error instanceof Error ? error.message : 'An unexpected error occurred.');

  return (
    <Page title="Products Repair">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400" align="center">
              <Text as="h2" variant="headingMd" alignment="center">
                {is403 ? 'Page Not Enabled' : 'Something Went Wrong'}
              </Text>
              <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                {message}
              </Text>
              {!is403 && (
                <Button onClick={() => window.location.reload()} variant="primary">
                  Retry
                </Button>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
