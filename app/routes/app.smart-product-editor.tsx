import React, { useState, useCallback } from "react";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { json, LoaderFunction } from "@remix-run/node";
import { getProductCategories } from "../utils/categories.server";
import {
  Page,
  Card,
  TextField,
  Button,
  Select,
  Checkbox,
  BlockStack,
  InlineStack,
  Text,
  Box,
} from "@shopify/polaris";
import RichTextEditor from "../components/RichTextEditor";
import HierarchicalSelect from "../components/HierarchicalSelect";
import "../styles/smart-product-editor.css";

export const loader: LoaderFunction = async () => {
  const categories = getProductCategories();
  return json({ categories });
};

export default function SmartProductEditor() {
  const { categories } = useLoaderData<typeof loader>();
  
  // Form state
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
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");
  const [trackQuantity, setTrackQuantity] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [weight, setWeight] = useState("");
  const [weightUnit, setWeightUnit] = useState("kg");
  const [category, setCategory] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [seoUrl, setSeoUrl] = useState("");
  const [collections, setCollections] = useState("");
  const [media, setMedia] = useState<File[]>([]);

  const fetcher = useFetcher();

  const handleImport = useCallback(() => {
    if (productUrl) {
      fetcher.submit(
        { url: productUrl, action: "fetch" },
        { method: "post", action: "/api.ai.fetch-product" }
      );
    }
  }, [productUrl, fetcher]);

  const handleDrop = useCallback((acceptedFiles: File[]) => {
    setMedia([...media, ...acceptedFiles]);
  }, [media]);

  const removeMedia = (index: number) => {
    setMedia(media.filter((_, i) => i !== index));
  };

  return (
    <div className="smart-product-editor-page">
      <div className="spe-header">
        <h1 className="spe-title">Edit Product</h1>
        <div className="spe-actions">
          <button className="spe-button spe-button-secondary">Discard</button>
          <button className="spe-button spe-button-primary">Save Product</button>
        </div>
      </div>

      <div className="spe-container">
        {/* Left Column */}
        <div className="spe-main-column">
          {/* Import Card */}
          <div className="spe-card">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Import from URL
                </Text>
                <InlineStack gap="200">
                  <TextField
                    label=""
                    placeholder="Paste external product URL"
                    value={productUrl}
                    onChange={setProductUrl}
                    autoComplete="off"
                  />
                  <Button variant="primary" onClick={handleImport}>
                    Import
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </div>

          {/* Product Info Card */}
          <div className="spe-card">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Product Information
                </Text>
                <TextField
                  label="Title"
                  value={productName}
                  onChange={setProductName}
                  autoComplete="off"
                />
                <div>
                  <Text as="span" variant="bodyMd" tone="subdued">
                    Description
                  </Text>
                  <RichTextEditor value={description} onChange={setDescription} />
                </div>
              </BlockStack>
            </Card>
          </div>

          {/* Media Card */}
          <div className="spe-card">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Media
                </Text>
                <div className="spe-dropzone">
                  <div className="spe-dropzone-content">
                    <div className="spe-upload-icon">📤</div>
                    <Text as="p" variant="bodyMd">
                      Drop files or click to upload
                    </Text>
                  </div>
                  <input type="file" multiple className="spe-file-input" />
                </div>
                {media.length > 0 && (
                  <div className="spe-media-grid">
                    {media.map((file, idx) => (
                      <div key={idx} className="spe-media-item">
                        <div className="spe-media-thumbnail">📷</div>
                        <button
                          onClick={() => removeMedia(idx)}
                          className="spe-media-remove"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </BlockStack>
            </Card>
          </div>

          {/* Category Card */}
          <div className="spe-card">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Product Category
                </Text>
                <HierarchicalSelect
                  categories={categories}
                  onChange={setCategory}
                />
              </BlockStack>
            </Card>
          </div>

          {/* Pricing Card */}
          <div className="spe-card">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Pricing
                </Text>
                <div className="spe-pricing-grid">
                  <TextField
                    label="Price"
                    type="number"
                    value={price}
                    onChange={setPrice}
                    prefix="$"
                    autoComplete="off"
                  />
                  <TextField
                    label="Compare at"
                    type="number"
                    value={compareAtPrice}
                    onChange={setCompareAtPrice}
                    prefix="$"
                    autoComplete="off"
                  />
                </div>
                <Checkbox
                  label="Charge taxes on this product"
                  checked={chargeTaxes}
                  onChange={setChargeTaxes}
                />
                <TextField
                  label="Cost per item"
                  type="number"
                  value={costPerItem}
                  onChange={setCostPerItem}
                  prefix="$"
                  autoComplete="off"
                />
              </BlockStack>
            </Card>
          </div>

          {/* Inventory & Shipping Card */}
          <div className="spe-card">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Inventory & Shipping
                </Text>
                <div className="spe-divider"></div>
                <Text as="h3" variant="headingSm">
                  SKU & Barcode
                </Text>
                <TextField
                  label="SKU"
                  value={sku}
                  onChange={setSku}
                  autoComplete="off"
                />
                <TextField
                  label="Barcode"
                  value={barcode}
                  onChange={setBarcode}
                  autoComplete="off"
                />
                <div className="spe-divider"></div>
                <Checkbox
                  label="Track quantity"
                  checked={trackQuantity}
                  onChange={setTrackQuantity}
                />
                {trackQuantity && (
                  <TextField
                  label="Quantity"
                  type="number"
                  value={quantity}
                  onChange={setQuantity}
                  autoComplete="off"
                />
              )}
              <div className="spe-divider"></div>
              <Text as="h3" variant="headingSm">
                Shipping
              </Text>
              <div className="spe-weight-grid">
                <TextField
                  label="Weight"
                  type="number"
                  value={weight}
                  onChange={setWeight}
                  autoComplete="off"
                />
                <Select
                  label="Unit"
                  options={[
                    { label: "kg", value: "kg" },
                    { label: "g", value: "g" },
                    { label: "lb", value: "lb" },
                    { label: "oz", value: "oz" },
                  ]}
                  value={weightUnit}
                  onChange={setWeightUnit}
                />
              </div>
            </BlockStack>
          </Card>

          {/* SEO Preview Card */}
          <div className="spe-card">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Search Engine Listing
                </Text>
                <TextField
                  label="Page title"
                  value={seoTitle}
                  onChange={setSeoTitle}
                  autoComplete="off"
                />
                <TextField
                  label="Meta description"
                  value={seoDescription}
                  onChange={setSeoDescription}
                  multiline={3}
                  autoComplete="off"
                />
                <TextField
                  label="URL handle"
                  value={seoUrl}
                  onChange={setSeoUrl}
                  autoComplete="off"
                />
                <div className="spe-preview-box">
                  <div className="spe-preview-title">
                    {seoTitle || "Page title"}
                  </div>
                  <div className="spe-preview-url">
                    example.com › {seoUrl || "url-handle"}
                  </div>
                  <div className="spe-preview-description">
                    {seoDescription || "Meta description will appear here..."}
                  </div>
                </div>
              </BlockStack>
            </Card>
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="spe-sidebar">
          {/* Status Card */}
          <div className="spe-card">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Status
                </Text>
                <Select
                  label=""
                  options={[
                    { label: "Draft", value: "draft" },
                    { label: "Active", value: "active" },
                  ]}
                  value={status}
                  onChange={setStatus}
                />
              </BlockStack>
            </Card>
          </div>

          {/* Organization Card */}
          <div className="spe-card">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Organization
                </Text>
                <TextField
                  label="Product type"
                  value={productType}
                  onChange={setProductType}
                  autoComplete="off"
                />
                <TextField
                  label="Vendor"
                  value={vendor}
                  onChange={setVendor}
                  autoComplete="off"
                />
                <TextField
                  label="Collections"
                  value={collections}
                  onChange={setCollections}
                  autoComplete="off"
                />
                <TextField
                  label="Tags"
                  value={tags}
                  onChange={setTags}
                  placeholder="Add tags separated by commas"
                  autoComplete="off"
                />
              </BlockStack>
            </Card>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}
