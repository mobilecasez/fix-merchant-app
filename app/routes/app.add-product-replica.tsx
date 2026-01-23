import React, { useState, useCallback, useEffect, useRef } from "react";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { json, LoaderFunction } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getProductCategories } from "../utils/categories.server";
import { getOrCreateSubscription, incrementProductUsage, getProductsUsed } from "../utils/billing.server";
import {
  Page,
  Layout,
  Card,
  TextField,
  Button,
  FormLayout,
  Select,
  Checkbox,
  Thumbnail,
  Frame,
  Toast,
  PageActions,
  Link,
  BlockStack,
  Icon,
  Box,
  InlineGrid,
  InlineStack,
  Text,
  LegacyStack,
  Collapsible,
  Spinner,
} from "@shopify/polaris";
import { useDropzone } from "react-dropzone";
import RichTextEditor from "../components/RichTextEditor";
import HierarchicalSelect from "../components/HierarchicalSelect";
import ShopFlixLoader from "../components/ShopFlixLoader";
import { XIcon } from '@shopify/polaris-icons';

export const loader: LoaderFunction = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const categories = getProductCategories();
  
  // Get or create subscription (auto-initializes with free trial if new shop)
  const subscription = await getOrCreateSubscription(session.shop);
  
  // Calculate products used on server side
  const productsUsed = getProductsUsed(subscription);
  const productLimit = subscription.plan.productLimit;
  
  return json({ categories, productsUsed, productLimit, subscription });
};

export default function AddProductReplica() {
  const { categories, productsUsed, productLimit, subscription } = useLoaderData<typeof loader>();
  const [productUrl, setProductUrl] = useState("");
  const [productName, setProductName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("draft");
  const [vendor, setVendor] = useState("");
  const [productType, setProductType] = useState("");
  const [tags, setTags] = useState("");
  const [price, setPrice] = useState("");
  const [compareAtPrice, setCompareAtPrice] = useState("");
  const [costPerItem, setCostPerItem] = useState("");
  const [chargeTaxes, setChargeTaxes] = useState(false);
  const [profit, setProfit] = useState("");
  const [margin, setMargin] = useState("");
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");
  const [trackQuantity, setTrackQuantity] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [continueSellingOutOfStock, setContinueSellingOutOfStock] = useState(false);
  const [hasSkuOrBarcode, setHasSkuOrBarcode] = useState(false);
  const [physicalProduct, setPhysicalProduct] = useState(true);
  const [packageType, setPackageType] = useState("");
  const [weight, setWeight] = useState("");
  const [weightUnit, setWeightUnit] = useState("kg");
  const [openCustomsInformation, setOpenCustomsInformation] = useState(false);
  const [countryOfOrigin, setCountryOfOrigin] = useState("");
  const [customsTariffCode, setCustomsTariffCode] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [seoUrl, setSeoUrl] = useState("");
  const [media, setMedia] = useState<(File | string)[]>([]);
  const [category, setCategory] = useState("");
  const [categoryPath, setCategoryPath] = useState<(string | null)[] | null>(null);
  const [collections, setCollections] = useState("");
  const [themeTemplate, setThemeTemplate] = useState("default");
  const [toastActive, setToastActive] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastError, setToastError] = useState(false);
  const [hasVariants, setHasVariants] = useState(false);
  const [options, setOptions] = useState([{ name: "", values: "" }]);
  const [variants, setVariants] = useState<any[]>([]);
  const [currentProductsUsed, setCurrentProductsUsed] = useState(productsUsed);
  const fetcher = useFetcher();
  const saveFetcher = useFetcher();
  const processAllFetcher = useFetcher();

  // Loading states for ShopFlix animated loader
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStep, setLoadingStep] = useState('');
  const [showLoader, setShowLoader] = useState(false);
  const [productSource, setProductSource] = useState('the product source');
  const [showManualHtmlInput, setShowManualHtmlInput] = useState(false);
  const [manualHtml, setManualHtml] = useState('');
  const [htmlPanelOpen, setHtmlPanelOpen] = useState(true);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const targetProgressRef = useRef(0);
  const prevFetcherState = useRef(fetcher.state);
  
  // Helper function to detect source from URL
  const getSourceFromUrl = (url: string): string => {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      if (hostname.includes('amazon')) return 'Amazon';
      if (hostname.includes('flipkart')) return 'Flipkart';
      if (hostname.includes('alibaba')) return 'Alibaba';
      if (hostname.includes('ajio')) return 'Ajio';
      if (hostname.includes('meesho')) return 'Meesho';
      if (hostname.includes('snapdeal')) return 'Snapdeal';
      if (hostname.includes('ebay')) return 'eBay';
      if (hostname.includes('etsy')) return 'Etsy';
      if (hostname.includes('walmart')) return 'Walmart';
      if (hostname.includes('target')) return 'Target';
      return 'the product source';
    } catch {
      return 'the product source';
    }
  };
  
  // Smooth progress animation function
  const animateProgress = (targetProgress: number) => {
    targetProgressRef.current = targetProgress;
    
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
    }
    
    progressIntervalRef.current = setInterval(() => {
      setLoadingProgress((currentProgress) => {
        if (currentProgress >= targetProgressRef.current) {
          if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
            progressIntervalRef.current = null;
          }
          return targetProgressRef.current;
        }
        // Increment by 1% every 100ms for smooth animation
        return Math.min(currentProgress + 1, targetProgressRef.current);
      });
    }, 100);
  };
  
  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, []);

  // Simplified loading state that tracks only the main fetch and process operations
  const isFetchingProduct = 
    fetcher.state !== 'idle' || 
    processAllFetcher.state !== 'idle';

  // Update loader based on fetcher states
  useEffect(() => {
    if (fetcher.state === 'submitting') {
      setShowLoader(true);
      setLoadingProgress(0);
      setLoadingStep('Connecting to product source...');
      animateProgress(30);
    } else if (fetcher.state === 'loading') {
      setLoadingStep(`Fetching product data from ${productSource}...`);
      animateProgress(50);
    }
  }, [fetcher.state]);

  useEffect(() => {
    if (processAllFetcher.state === 'submitting') {
      setLoadingStep('Processing with AI...');
      animateProgress(65);
    } else if (processAllFetcher.state === 'loading') {
      setLoadingStep('Cleverly rewriting title and description...');
      animateProgress(80);
    }
  }, [processAllFetcher.state]);

  useEffect(() => {
    // Only process when we get a NEW response (transition from loading to idle)
    // This prevents repopulating with stale/cached fetcher.data
    const isNewResponse = fetcher.state === 'idle' && prevFetcherState.current === 'loading';
    
    if (fetcher.state === 'idle' && fetcher.data && isNewResponse) {
      const scrapedData = fetcher.data as any;
      
      // Log the raw HTML if it's present in the response (for debugging)
      if (scrapedData.debugHtml) {
        console.log("📄 RAW HTML FROM SCRAPER (first 3000 chars):");
        console.log(scrapedData.debugHtml.substring(0, 3000));
        console.log("📄 HTML length:", scrapedData.debugHtml.length);
      }
      
      // Handle manual HTML required response
      if (scrapedData.manualHtmlRequired) {
        if (progressIntervalRef.current) {
          clearInterval(progressIntervalRef.current);
          progressIntervalRef.current = null;
        }
        setShowLoader(false);
        setShowManualHtmlInput(true);
        setHtmlPanelOpen(true); // Auto-expand panel
        setToastMessage(scrapedData.message || "Manual HTML input required");
        setToastError(false);
        setToastActive(true);
        return;
      }
      
      if (scrapedData.error) {
        if (progressIntervalRef.current) {
          clearInterval(progressIntervalRef.current);
          progressIntervalRef.current = null;
        }
        setShowLoader(false);
        setToastMessage(scrapedData.error);
        setToastError(true);
        setToastActive(true);
        return;
      }

      setLoadingStep('Analyzing product data...');
      animateProgress(55);

      // Single unified call to process all AI operations in parallel
      processAllFetcher.submit(
        {
          title: scrapedData.productName,
          description: scrapedData.description,
        },
        { method: 'post', action: '/api/ai/process-all', encType: 'application/json' }
      );
    }
    
    // Update previous state for next comparison
    prevFetcherState.current = fetcher.state;
  }, [fetcher.data, fetcher.state]);

  useEffect(() => {
    if (processAllFetcher.state === 'idle' && processAllFetcher.data) {
      setLoadingStep('Preparing images and final data...');
      animateProgress(85);
      
      const processedData = processAllFetcher.data as any;
      
      if (processedData.error) {
        if (progressIntervalRef.current) {
          clearInterval(progressIntervalRef.current);
          progressIntervalRef.current = null;
        }
        setShowLoader(false);
        setToastMessage(processedData.error);
        setToastError(true);
        setToastActive(true);
        return;
      }

      const scrapedData = fetcher.data as any;
      const { rewrittenTitle, rewrittenDescription, tags: rewrittenTags, seoTitle: seoTitleGenerated, seoDescription: seoDescriptionGenerated, productType: generatedProductType, category } = processedData;

      console.log("Processed data received:", processedData);

      const {
        vendor,
        productType: scrapedProductType,
        price,
        compareAtPrice,
        costPerItem,
        sku,
        barcode,
        weight,
        weightUnit,
        images,
        options: scrapedOptions,
        variants: scrapedVariants,
      } = scrapedData;

      if (rewrittenTitle) {
        setProductName(rewrittenTitle);
        setSeoUrl(rewrittenTitle.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').substring(0, 255));
      }
      if (seoTitleGenerated) {
        setSeoTitle(seoTitleGenerated);
      }
      if (rewrittenDescription) {
        setDescription(rewrittenDescription);
      }
      if (seoDescriptionGenerated) {
        setSeoDescription(seoDescriptionGenerated);
      }
      if (rewrittenTags) {
        setTags(rewrittenTags);
      }
      if (category && category.path) {
        setCategoryPath(category.path);
      }
      if (category && category.id) {
        setCategory(category.id);
      }
      if (vendor) setVendor(vendor);
      if (generatedProductType) {
        setProductType(generatedProductType);
      } else if (scrapedProductType) {
        setProductType(scrapedProductType);
      }
      if (price) {
        const cleanedPrice = price.replace(/[^0-9.]/g, "");
        const numericPrice = parseFloat(cleanedPrice);
        if (!isNaN(numericPrice)) {
          setPrice(numericPrice.toString());
        }
      }
      if (compareAtPrice) {
        const cleanedCompareAtPrice = compareAtPrice.replace(/[^0-9.]/g, "");
        const numericCompareAtPrice = parseFloat(cleanedCompareAtPrice);
        if (!isNaN(numericCompareAtPrice)) {
          setCompareAtPrice(numericCompareAtPrice.toString());
        }
      }
      if (costPerItem) setCostPerItem(costPerItem);
      if (sku) setSku(sku);
      if (barcode) setBarcode(barcode);
      if (weight) setWeight(weight);
      if (weightUnit) setWeightUnit(weightUnit);
      if (images && images.length > 0) {
        console.log("🖼️ SCRAPER IMAGES RECEIVED:", images.length, "images");
        console.log("🖼️ Image URLs from scraper:");
        images.forEach((url: string, index: number) => {
          console.log(`  ${index + 1}. ${url}`);
        });
        setMedia(images);
      } else {
        console.log("⚠️ No images received from scraper");
      }
      if (scrapedOptions && scrapedOptions.length > 0) {
        setHasVariants(true);
        setOptions(scrapedOptions);
      }
      if (scrapedVariants && scrapedVariants.length > 0) {
        setVariants(scrapedVariants);
      }

      setLoadingStep('Finalizing product import...');
      animateProgress(95);

      // Wait for animation to reach 95%
      setTimeout(() => {
        setLoadingStep('Complete! Product is ready.');
        animateProgress(100);
        
        // Wait for animation to complete before hiding
        setTimeout(() => {
          if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
            progressIntervalRef.current = null;
          }
          setShowLoader(false);
          setToastMessage("Product data fetched and rewritten successfully!");
          setToastError(false);
          setToastActive(true);
        }, 600);
      }, 800);
      
      // Increment product usage counter on successful import and update local quota
      (async () => {
        try {
          await fetch("/api/increment-usage", { method: "POST" });
          // Update local usage count immediately after successful increment
          setCurrentProductsUsed((prev: number) => prev + 1);
        } catch (error) {
          console.error("Failed to increment usage:", error);
        }
      })();
    }
  }, [processAllFetcher.data, processAllFetcher.state]);

  const generateVariants = useCallback(() => {
    if (options.length === 0 || options.every(opt => !opt.name || !opt.values)) {
      setVariants([]);
      return;
    }

    const allOptions = options.map(opt => opt.values.split(',').map(v => v.trim()).filter(v => v));
    if (allOptions.some(opt => opt.length === 0)) {
      setVariants([]);
      return;
    }

    const cartesian = (...a: string[][]) => {
      const result: string[][] = [];
      const max = a.length - 1;
      const helper = (arr: string[], i: number) => {
        for (let j = 0, l = a[i].length; j < l; j++) {
          const copy = arr.slice(0);
          copy.push(a[i][j]);
          if (i === max) {
            result.push(copy);
          } else {
            helper(copy, i + 1);
          }
        }
      };
      helper([], 0);
      return result;
    };
    
    const newVariantCombinations = cartesian(...allOptions);

    const newVariants = newVariantCombinations.map(combination => {
      const singleCombination = Array.isArray(combination) ? combination : [combination];
      const title = singleCombination.join(' / ');
      
      const existingVariant = variants.find(v => v.title === title);

      return {
        title: title,
        options: singleCombination,
        price: existingVariant?.price || '',
        sku: existingVariant?.sku || '',
        barcode: existingVariant?.barcode || '',
        quantity: existingVariant?.quantity || '',
      };
    });

    setVariants(newVariants);
  }, [options, variants]);

  useEffect(() => {
    generateVariants();
  }, [options]);

  React.useEffect(() => {
    const priceNum = parseFloat(price);
    const costNum = parseFloat(costPerItem);

    if (!isNaN(priceNum) && !isNaN(costNum)) {
      const calculatedProfit = priceNum - costNum;
      setProfit(calculatedProfit.toFixed(2));

      if (priceNum !== 0) {
        const calculatedMargin = (calculatedProfit / priceNum) * 100;
        setMargin(calculatedMargin.toFixed(2));
      } else {
        setMargin("0.00");
      }
    } else {
      setProfit("");
      setMargin("");
    }
  }, [price, costPerItem]);

  const handleDrop = useCallback((acceptedFiles: File[]) => {
    setMedia((prev) => [...prev, ...acceptedFiles]);
  }, []);

  const { getRootProps, getInputProps, open } = useDropzone({
    onDrop: handleDrop,
    noClick: true,
    noKeyboard: true,
    accept: {
      'image/*': ['.jpeg', '.png', '.gif', '.jpg'],
    },
  });

  const removeMedia = (index: number) => {
    setMedia((prev) => prev.filter((_, i) => i !== index));
  };

  const statusOptions = [
    { label: "Active", value: "active" },
    { label: "Draft", value: "draft" },
  ];

  const weightUnitOptions = [
    { label: "kg", value: "kg" },
    { label: "lb", value: "lb" },
    { label: "oz", value: "oz" },
    { label: "g", value: "g" },
  ];

  useEffect(() => {
    if (saveFetcher.state === 'idle' && saveFetcher.data) {
      const { product, errors } = saveFetcher.data as any;
      if (errors) {
        setToastMessage(errors[0].message);
        setToastError(true);
      } else if (product) {
        setToastMessage(`Product "${product.title}" created successfully!`);
        setToastError(false);
      }
      setToastActive(true);
    }
  }, [saveFetcher.state, saveFetcher.data]);

  const handleSubmit = () => {
    if (!productName) {
      setToastMessage("Product name is required");
      setToastError(true);
      setToastActive(true);
      return;
    }
    if (!price && (!variants || variants.length === 0)) {
      setToastMessage("Price is required for products without variants");
      setToastError(true);
      setToastActive(true);
      return;
    }

    const productData = {
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
      quantity,
      continueSellingOutOfStock,
      physicalProduct,
      weight,
      weightUnit,
      category,
      seoTitle,
      seoDescription,
      seoUrl,
      options: hasVariants ? options.map(opt => ({ name: opt.name, values: opt.values.split(',').map(v => v.trim()) })) : [],
      variants: hasVariants ? variants : [],
      images: media.filter(m => typeof m === 'string'),
    };

    console.log("Frontend - Submitting product data with category:", category);
    console.log("Frontend - Full product data:", JSON.stringify(productData, null, 2));

    const formData = new FormData();
    formData.append("productData", JSON.stringify(productData));

    saveFetcher.submit(formData, {
      method: "post",
      action: "/api/product/create",
    });
  };

  const toggleToastActive = useCallback(
    () => setToastActive((active) => !active),
    []
  );

  const toastMarkup = toastActive ? (
    <Toast
      content={toastMessage}
      onDismiss={toggleToastActive}
      error={toastError}
    />
  ) : null;

  const handleFetchProduct = () => {
    // Check if user has reached their usage limit
    if (currentProductsUsed >= productLimit) {
      setToastMessage(`Limit Exceeded with current plan (${subscription.plan.name}). Please upgrade to continue using.`);
      setToastError(true);
      setToastActive(true);
      return;
    }

    // Detect source from URL
    const source = getSourceFromUrl(productUrl);
    setProductSource(source);
    
    const formData = new FormData();
    formData.append("url", productUrl);
    
    // If manual HTML is provided, include it
    if (manualHtml && manualHtml.trim()) {
      formData.append("manualHtml", manualHtml);
      console.log("Including manual HTML, length:", manualHtml.length);
    }
    
    fetcher.submit(formData, {
      method: "post",
      action: "/api/ai/fetch-product",
    });
  };

  // Top Import button - clears manual HTML and starts fresh
  const handleFetchProductFromUrl = () => {
    // Clear any pasted HTML content
    setManualHtml('');
    setHtmlPanelOpen(false);
    
    // Clear all form fields to prevent old data from showing
    setProductName('');
    setDescription('');
    setPrice('');
    setCompareAtPrice('');
    setMedia([]);
    setVendor('');
    setProductType('');
    setTags('');
    setCostPerItem('');
    setProfit('');
    setMargin('');
    setSku('');
    setBarcode('');
    setWeight('');
    setWeightUnit('kg');
    setOptions([]);
    setVariants([]);
    
    // DON'T call handleFetchProduct() - it would include stale manualHtml from closure
    // Instead, submit directly with fresh FormData that explicitly excludes manual HTML
    if (!productUrl) {
      setToastMessage("Please enter a product URL");
      setToastError(true);
      setToastActive(true);
      return;
    }

    const source = getSourceFromUrl(productUrl);
    setProductSource(source);
    
    const formData = new FormData();
    formData.append("url", productUrl);
    // Explicitly DON'T include manualHtml - fresh auto-fetch only
    
    fetcher.submit(formData, {
      method: "post",
      action: "/api/ai/fetch-product",
    });
  };

  return (
    <Frame>
      <ShopFlixLoader 
        isVisible={showLoader} 
        currentStep={loadingStep} 
        progress={loadingProgress} 
      />
      <Page
        title={`Add product (${currentProductsUsed}/${productLimit} used)`}
        backAction={{ content: "Products", url: "/app" }}
        primaryAction={{
          content: "Save product",
          onAction: handleSubmit,
          disabled: !productName || saveFetcher.state === "submitting",
          loading: saveFetcher.state === "submitting",
        }}
        secondaryActions={[
          {
            content: "Discard",
            onAction: () => {
              setProductName("");
              setDescription("");
              setPrice("");
              setMedia([]);
            },
          },
        ]}
      >
        <BlockStack gap="500">
          {/* Fetch Product Section - Redesigned */}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text variant="headingMd" as="h2">
                    Import from URL
                  </Text>
                  <Text variant="bodySm" as="p" tone="subdued">
                    Automatically fetch product details from any e-commerce platform
                  </Text>
                </BlockStack>
              </InlineStack>
              <FormLayout>
                <TextField
                  label="Product URL"
                  value={productUrl}
                  onChange={setProductUrl}
                  autoComplete="off"
                  placeholder="https://example.com/product/..."
                  helpText="Supports Amazon, Flipkart, eBay, and most e-commerce websites"
                  connectedRight={
                    <Button 
                      onClick={handleFetchProductFromUrl} 
                      loading={isFetchingProduct} 
                      disabled={isFetchingProduct || !productUrl}
                      variant="primary"
                    >
                      {isFetchingProduct ? "Importing..." : "Import"}
                    </Button>
                  }
                />
                
                {/* Manual HTML Input - shown when auto-fetch is blocked */}
                {(showManualHtmlInput || manualHtml) && (
                  <Box 
                    borderWidth="025" 
                    borderRadius="200" 
                    borderColor="border"
                    padding="0"
                  >
                    <Box 
                      padding="400" 
                      borderBlockEndWidth={htmlPanelOpen ? "025" : "0"} 
                      borderColor="border"
                      style={{ cursor: 'pointer' }}
                      onClick={() => setHtmlPanelOpen(!htmlPanelOpen)}
                    >
                      <InlineStack align="space-between" blockAlign="center">
                        <Text variant="headingMd" as="h3">
                          🔒 Manual HTML Import {manualHtml.trim() && `(${Math.round(manualHtml.length / 1024)}KB)`}
                        </Text>
                        <Button 
                          plain
                          onClick={(e) => {
                            e.stopPropagation();
                            setHtmlPanelOpen(!htmlPanelOpen);
                          }}
                        >
                          {htmlPanelOpen ? '▲ Collapse' : '▼ Expand'}
                        </Button>
                      </InlineStack>
                    </Box>
                    
                    <Collapsible open={htmlPanelOpen} id="manual-html-panel">
                      <Box padding="400">
                        <BlockStack gap="400">
                          {showManualHtmlInput && (
                            <Box 
                              borderWidth="025" 
                              borderRadius="200" 
                              borderColor="border"
                              padding="400"
                              background="bg-surface-warning"
                            >
                              <BlockStack gap="200">
                                <Text variant="headingSm" as="h3">
                                  Website Blocking Detected
                                </Text>
                                <Text variant="bodySm" as="p">
                                  The website is blocking automated access. Follow these steps:
                                </Text>
                                <Box paddingBlockStart="200">
                                  <BlockStack gap="100">
                                    <Text variant="bodyXs" as="p">1. Open the product URL in your browser</Text>
                                    <Text variant="bodyXs" as="p" fontWeight="semibold">2. Press Ctrl+U (Windows) or Cmd+Option+U (Mac) to view page source</Text>
                                    <Text variant="bodyXs" as="p" tone="subdued">(If right-click is disabled, use keyboard shortcut above)</Text>
                                    <Text variant="bodyXs" as="p">3. Select all HTML (Ctrl+A / Cmd+A) and copy it</Text>
                                    <Text variant="bodyXs" as="p">4. Paste below and click Import</Text>
                                  </BlockStack>
                                </Box>
                              </BlockStack>
                            </Box>
                          )}
                          
                          <div style={{ position: 'relative' }}>
                            <label style={{ 
                              display: 'block', 
                              marginBottom: '8px', 
                              fontWeight: 500,
                              fontSize: '14px'
                            }}>
                              Paste HTML Source Code
                            </label>
                            <div style={{ 
                              height: '250px',
                              border: '1px solid #c9cccf',
                              borderRadius: '8px',
                              overflow: 'hidden',
                              backgroundColor: '#f6f6f7'
                            }}>
                              <textarea
                                value={manualHtml}
                                onChange={(e) => setManualHtml(e.target.value)}
                                placeholder="Paste the complete HTML source code here..."
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  padding: '12px',
                                  border: 'none',
                                  outline: 'none',
                                  fontFamily: 'Monaco, Courier, monospace',
                                  fontSize: '13px',
                                  resize: 'none',
                                  backgroundColor: 'transparent'
                                }}
                              />
                            </div>
                            <div style={{ 
                              marginTop: '8px', 
                              fontSize: '13px', 
                              color: '#6d7175'
                            }}>
                              {manualHtml.trim() 
                                ? `Ready to import - Click Import button below`
                                : "Paste HTML and click Import button below"}
                            </div>
                          </div>
                          
                          <InlineStack gap="200">
                            <Button 
                              variant="primary"
                              onClick={() => {
                                handleFetchProduct();
                                setHtmlPanelOpen(false);
                              }}
                              loading={isFetchingProduct}
                              disabled={!manualHtml.trim() || isFetchingProduct || !productUrl}
                            >
                              {isFetchingProduct ? 'Importing...' : 'Import Product'}
                            </Button>
                            <Button 
                              onClick={() => setManualHtml('')}
                              disabled={!manualHtml.trim()}
                              tone="critical"
                            >
                              Clear HTML
                            </Button>
                          </InlineStack>
                        </BlockStack>
                      </Box>
                    </Collapsible>
                  </Box>
                )}
              </FormLayout>
            </BlockStack>
          </Card>

          <Layout>
            <Layout.Section>
              {/* Title and Description */}
              <BlockStack gap="500">
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">
                      Product information
                    </Text>
                    <FormLayout>
                      <TextField
                        label="Title"
                        value={productName}
                        onChange={setProductName}
                        autoComplete="off"
                        placeholder="Enter product name"
                        requiredIndicator
                      />
                      <div>
                        <Box paddingBlockEnd="200">
                          <Text variant="bodyMd" as="p" fontWeight="medium">
                            Description
                          </Text>
                        </Box>
                        <RichTextEditor
                          value={description}
                          onChange={setDescription}
                        />
                      </div>
                    </FormLayout>
                  </BlockStack>
                </Card>

                {/* Media Section - Redesigned */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text variant="headingMd" as="h2">
                        Media
                      </Text>
                      <Button onClick={open} size="slim">Add files</Button>
                    </InlineStack>
                    <div {...getRootProps()}>
                      <input {...getInputProps()} />
                      {media.length > 0 ? (
                        <Box 
                          borderWidth="025" 
                          borderRadius="200" 
                          borderColor="border"
                          padding="400"
                          background="bg-surface-secondary"
                        >
                          <InlineGrid columns={{ xs: 4, sm: 5, md: 6, lg: 7 }} gap="400">
                            {media.map((item, index) => (
                              <Box key={index} position="relative">
                                <Box 
                                  borderWidth="025" 
                                  borderRadius="200" 
                                  borderColor="border"
                                  background="bg-surface"
                                >
                                  <Thumbnail
                                    source={typeof item === 'string' ? item : URL.createObjectURL(item)}
                                    alt={typeof item === 'string' ? 'product image' : item.name}
                                    size="large"
                                  />
                                </Box>
                                <div style={{ position: 'absolute', top: '-8px', right: '-8px' }}>
                                  <Button
                                    icon={XIcon}
                                    onClick={() => removeMedia(index)}
                                    accessibilityLabel="Remove media"
                                    variant="plain"
                                    size="micro"
                                    tone="critical"
                                  />
                                </div>
                              </Box>
                            ))}
                          </InlineGrid>
                        </Box>
                      ) : (
                        <Box
                          borderWidth="025"
                          borderRadius="200"
                          borderColor="border"
                          padding="800"
                          background="bg-surface-secondary"
                        >
                          <BlockStack gap="200" inlineAlign="center">
                            <div style={{ 
                              width: '56px', 
                              height: '56px', 
                              borderRadius: '50%', 
                              background: 'var(--p-color-bg-surface-active)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '32px'
                            }}>
                              📸
                            </div>
                            <BlockStack gap="100" inlineAlign="center">
                              <Text variant="bodyMd" as="p" fontWeight="semibold">
                                Add images
                              </Text>
                              <Text variant="bodySm" as="p" tone="subdued">
                                Accepts images in .jpg, .png, or .gif format
                              </Text>
                            </BlockStack>
                            <Button onClick={open}>Add files</Button>
                          </BlockStack>
                        </Box>
                      )}
                    </div>
                  </BlockStack>
                </Card>

                {/* Category Selection - Redesigned */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text variant="headingMd" as="h2">
                          Product category
                        </Text>
                        <Text variant="bodySm" as="p" tone="subdued">
                          Categorize this product for better organization
                        </Text>
                      </BlockStack>
                    </InlineStack>
                    {fetcher.data && processAllFetcher.state !== 'idle' ? (
                      <Box padding="400">
                        <BlockStack gap="300" inlineAlign="center">
                          <Spinner accessibilityLabel="Loading category" size="large" />
                          <Text variant="bodySm" as="p" tone="subdued">
                            Analyzing product category...
                          </Text>
                        </BlockStack>
                      </Box>
                    ) : (
                      <>
                        <HierarchicalSelect categories={categories} onChange={setCategory} path={categoryPath} />
                        {category && (
                          <Box 
                            padding="300" 
                            background="bg-surface-success"
                            borderRadius="200"
                          >
                            <Text as="p" variant="bodySm" tone="success">
                              Category selected: {category}
                            </Text>
                          </Box>
                        )}
                      </>
                    )}
                  </BlockStack>
                </Card>

                {/* Pricing Section - Redesigned */}
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">
                      Pricing
                    </Text>
                    <FormLayout>
                      <FormLayout.Group condensed>
                        <TextField
                          label="Price"
                          value={price}
                          onChange={setPrice}
                          autoComplete="off"
                          type="number"
                          prefix="₹"
                          placeholder="0.00"
                        />
                        <TextField
                          label="Compare-at price"
                          value={compareAtPrice}
                          onChange={setCompareAtPrice}
                          autoComplete="off"
                          type="number"
                          prefix="₹"
                          placeholder="0.00"
                          helpText="Show a discount by setting a higher price"
                        />
                      </FormLayout.Group>
                      <Checkbox
                        label="Charge taxes on this product"
                        checked={chargeTaxes}
                        onChange={setChargeTaxes}
                      />
                      <Box
                        padding="400"
                        background="bg-surface-secondary"
                        borderRadius="200"
                      >
                        <FormLayout>
                          <FormLayout.Group condensed>
                            <TextField
                              label="Cost per item"
                              value={costPerItem}
                              onChange={setCostPerItem}
                              autoComplete="off"
                              type="number"
                              prefix="₹"
                              placeholder="0.00"
                              helpText="Customers won't see this"
                            />
                            <TextField
                              label="Profit"
                              value={profit}
                              readOnly
                              autoComplete="off"
                              prefix="₹"
                            />
                            <TextField
                              label="Margin"
                              value={margin}
                              readOnly
                              autoComplete="off"
                              suffix="%"
                            />
                          </FormLayout.Group>
                        </FormLayout>
                      </Box>
                    </FormLayout>
                  </BlockStack>
                </Card>

                {/* Inventory Section - Redesigned */}
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">
                      Inventory
                    </Text>
                    <FormLayout>
                      <Checkbox
                        label="Track quantity"
                        checked={trackQuantity}
                        onChange={setTrackQuantity}
                      />
                      {trackQuantity && (
                        <TextField
                          label="Quantity"
                          value={quantity}
                          onChange={setQuantity}
                          autoComplete="off"
                          type="number"
                          placeholder="0"
                        />
                      )}
                      <Checkbox
                        label="Continue selling when out of stock"
                        checked={continueSellingOutOfStock}
                        onChange={setContinueSellingOutOfStock}
                      />
                      <Checkbox
                        label="This product has a SKU or barcode"
                        checked={hasSkuOrBarcode}
                        onChange={setHasSkuOrBarcode}
                      />
                      {hasSkuOrBarcode && (
                        <FormLayout.Group>
                          <TextField
                            label="SKU (Stock Keeping Unit)"
                            value={sku}
                            onChange={setSku}
                            autoComplete="off"
                            placeholder="SKU-123"
                          />
                          <TextField
                            label="Barcode (ISBN, UPC, GTIN, etc.)"
                            value={barcode}
                            onChange={setBarcode}
                            autoComplete="off"
                            placeholder="123456789012"
                          />
                        </FormLayout.Group>
                      )}
                    </FormLayout>
                  </BlockStack>
                </Card>

                {/* Shipping Section - Redesigned */}
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">
                      Shipping
                    </Text>
                    <FormLayout>
                      <Checkbox
                        label="This is a physical product"
                        checked={physicalProduct}
                        onChange={setPhysicalProduct}
                      />
                      {physicalProduct && (
                        <>
                          <FormLayout.Group condensed>
                            <TextField
                              label="Weight"
                              value={weight}
                              onChange={setWeight}
                              autoComplete="off"
                              type="number"
                              placeholder="0.0"
                            />
                            <Select
                              label="Unit"
                              options={weightUnitOptions}
                              onChange={setWeightUnit}
                              value={weightUnit}
                            />
                          </FormLayout.Group>
                          <Button
                            variant="plain"
                            onClick={() => setOpenCustomsInformation(!openCustomsInformation)}
                            aria-expanded={openCustomsInformation}
                            aria-controls="customs-collapsible"
                            disclosure={openCustomsInformation ? "up" : "down"}
                          >
                            Customs information
                          </Button>
                          <Collapsible
                            open={openCustomsInformation}
                            id="customs-collapsible"
                            expandOnPrint
                          >
                            <Box
                              paddingBlockStart="400"
                              paddingBlockEnd="400"
                            >
                              <FormLayout>
                                <TextField
                                  label="Country/Region of origin"
                                  value={countryOfOrigin}
                                  onChange={setCountryOfOrigin}
                                  autoComplete="off"
                                  placeholder="India"
                                  helpText="Where was this product manufactured?"
                                />
                                <TextField
                                  label="HS code"
                                  value={customsTariffCode}
                                  onChange={setCustomsTariffCode}
                                  autoComplete="off"
                                  placeholder="1234.56.78"
                                  helpText="Used to calculate duties and taxes"
                                />
                              </FormLayout>
                            </Box>
                          </Collapsible>
                        </>
                      )}
                    </FormLayout>
                  </BlockStack>
                </Card>

                {/* Variants Section - Redesigned */}
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">
                      Variants
                    </Text>
                    <Checkbox
                      label="This product has options, like size or color"
                      checked={hasVariants}
                      onChange={(checked) => {
                        setHasVariants(checked);
                        if (!checked) {
                          setOptions([{ name: "", values: "" }]);
                          setVariants([]);
                        }
                      }}
                    />
                    {hasVariants && (
                      <BlockStack gap="400">
                        <Box
                          padding="400"
                          background="bg-surface-secondary"
                          borderRadius="200"
                        >
                          <BlockStack gap="400">
                            {options.map((option, index) => (
                              <FormLayout key={index}>
                                <FormLayout.Group condensed>
                                  <TextField
                                    label="Option name"
                                    value={option.name}
                                    onChange={(value) => {
                                      const newOptions = [...options];
                                      newOptions[index].name = value;
                                      setOptions(newOptions);
                                    }}
                                    autoComplete="off"
                                    placeholder="Size, Color, Material..."
                                  />
                                  <TextField
                                    label="Option values"
                                    value={option.values}
                                    onChange={(value) => {
                                      const newOptions = [...options];
                                      newOptions[index].values = value;
                                      setOptions(newOptions);
                                    }}
                                    autoComplete="off"
                                    placeholder="Small, Medium, Large"
                                    helpText="Separate values with commas"
                                  />
                                </FormLayout.Group>
                              </FormLayout>
                            ))}
                            <Button 
                              onClick={() => setOptions([...options, { name: "", values: "" }])}
                              variant="plain"
                            >
                              Add another option
                            </Button>
                          </BlockStack>
                        </Box>
                        {variants.length > 0 && (
                          <BlockStack gap="300">
                            <InlineStack align="space-between" blockAlign="center">
                              <Text variant="headingSm" as="h3">
                                Variant preview
                              </Text>
                              <Text variant="bodySm" as="p" tone="subdued">
                                {variants.length} {variants.length === 1 ? 'variant' : 'variants'}
                              </Text>
                            </InlineStack>
                            {variants.map((variant, index) => (
                              <Card key={index}>
                                <BlockStack gap="300">
                                  <Text as="p" fontWeight="semibold">{variant.title}</Text>
                                  <FormLayout>
                                    <FormLayout.Group condensed>
                                      <TextField
                                        label="Price"
                                        type="number"
                                        prefix="₹"
                                        value={variant.price}
                                        onChange={(value) => {
                                          const newVariants = [...variants];
                                          newVariants[index].price = value;
                                          setVariants(newVariants);
                                        }}
                                        autoComplete="off"
                                        placeholder="0.00"
                                      />
                                      <TextField
                                        label="SKU"
                                        value={variant.sku}
                                        onChange={(value) => {
                                          const newVariants = [...variants];
                                          newVariants[index].sku = value;
                                          setVariants(newVariants);
                                        }}
                                        autoComplete="off"
                                        placeholder="SKU-123"
                                      />
                                      <TextField
                                        label="Barcode"
                                        value={variant.barcode}
                                        onChange={(value) => {
                                          const newVariants = [...variants];
                                          newVariants[index].barcode = value;
                                          setVariants(newVariants);
                                        }}
                                        autoComplete="off"
                                        placeholder="123456789012"
                                      />
                                    </FormLayout.Group>
                                  </FormLayout>
                                </BlockStack>
                              </Card>
                            ))}
                          </BlockStack>
                        )}
                      </BlockStack>
                    )}
                  </BlockStack>
                </Card>

                {/* Search Engine Listing - Redesigned */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text variant="headingMd" as="h2">
                          Search engine listing
                        </Text>
                        <Text variant="bodySm" as="p" tone="subdued">
                          Optimize how this product appears in search results
                        </Text>
                      </BlockStack>
                    </InlineStack>
                    <FormLayout>
                      <TextField
                        label="Page title"
                        value={seoTitle}
                        onChange={setSeoTitle}
                        autoComplete="off"
                        placeholder="Product name - Store name"
                        helpText={`${seoTitle.length}/70 characters used`}
                        maxLength={70}
                      />
                      <TextField
                        label="Meta description"
                        value={seoDescription}
                        onChange={setSeoDescription}
                        autoComplete="off"
                        multiline={3}
                        placeholder="Brief description for search engines"
                        helpText={`${seoDescription.length}/320 characters used`}
                        maxLength={320}
                      />
                      <TextField
                        label="URL handle"
                        value={seoUrl}
                        onChange={setSeoUrl}
                        autoComplete="off"
                        placeholder="product-name"
                        prefix="https://your-store.myshopify.com/products/"
                      />
                    </FormLayout>
                  </BlockStack>
                </Card>
              </BlockStack>
            </Layout.Section>

            <Layout.Section variant="oneThird">
              <BlockStack gap="500">
                {/* Status Card - Redesigned */}
                <Card>
                  <BlockStack gap="300">
                    <Text variant="headingMd" as="h2">
                      Status
                    </Text>
                    <Select
                      label="Product status"
                      labelHidden
                      options={statusOptions}
                      onChange={setStatus}
                      value={status}
                    />
                  </BlockStack>
                </Card>

                {/* Product Organization - Redesigned */}
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">
                      Organization
                    </Text>
                    <FormLayout>
                      <TextField
                        label="Product type"
                        value={productType}
                        onChange={setProductType}
                        autoComplete="off"
                        placeholder="e.g., Shirts, Shoes"
                      />
                      <TextField
                        label="Vendor"
                        value={vendor}
                        onChange={setVendor}
                        autoComplete="off"
                        placeholder="e.g., Nike, Apple"
                      />
                      <TextField
                        label="Collections"
                        value={collections}
                        onChange={setCollections}
                        autoComplete="off"
                        placeholder="Search or create collection"
                      />
                      <TextField
                        label="Tags"
                        value={tags}
                        onChange={setTags}
                        autoComplete="off"
                        placeholder="summer, sale, featured"
                        helpText="Separate tags with commas"
                      />
                    </FormLayout>
                  </BlockStack>
                </Card>
              </BlockStack>
            </Layout.Section>
          </Layout>
        </BlockStack>
      </Page>
      {toastMarkup}
    </Frame>
  );
}
