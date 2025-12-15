import { useState, useEffect, useCallback, useMemo } from "react";
import { useFetcher, useNavigate } from "@remix-run/react";
import {
  Card,
  BlockStack,
  Text,
  Button,
  List,
  Spinner,
  Pagination,
  Badge,
  InlineStack,
  DataTable,
  Box,
} from "@shopify/polaris";

const PRODUCTS_PER_PAGE = 10;

export function ProductCorrectionSection() {
  const fetcher = useFetcher();
  const updateFetcher = useFetcher();
  const navigate = useNavigate();
  const [products, setProducts] = useState<any[]>([]);
  const [editedProducts, setEditedProducts] = useState<any>({});
  const [pageInfo, setPageInfo] = useState<any>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false); // New local loading state for products

  useEffect(() => {
    console.log("ProductCorrectionSection: fetcher.load triggered with cursor:", cursor);
    setIsLoadingProducts(true); // Set local loading to true when a fetch is initiated
    fetcher.load(`/api/seo-check?cursor=${cursor || ""}&count=${PRODUCTS_PER_PAGE}&dashboard=true`);
  }, [cursor]);

  useEffect(() => {
    if (fetcher.data) {
      console.log("ProductCorrectionSection: fetcher.data received. State:", fetcher.state);
      const { products: newProducts, pageInfo: newPageInfo, totalCount: newTotalCount } = fetcher.data as any;
      setProducts(newProducts);
      setPageInfo(newPageInfo);
      setTotalCount(newTotalCount);
      const initialEditedProducts: any = {};
      newProducts.forEach((product: any) => {
        initialEditedProducts[product.id] = { ...product };
      });
      setEditedProducts(initialEditedProducts);
      setIsLoadingProducts(false); // Set local loading to false when data arrives
    } else if (fetcher.state === "idle" && isLoadingProducts) {
      // If fetcher becomes idle but no data arrived (e.g., error or no content), stop loading
      setIsLoadingProducts(false);
    }
  }, [fetcher.data, fetcher.state]); // Depend on fetcher.data and fetcher.state

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

  const handleProductChange = (productId: string, field: string, value: any) => {
    setEditedProducts((prev: any) => ({
      ...prev,
      [productId]: {
        ...prev[productId],
        [field]: value,
      },
    }));
  };

  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * PRODUCTS_PER_PAGE;
    const end = start + PRODUCTS_PER_PAGE;
    return products.slice(start, end);
  }, [products, currentPage]);

  const productRows = useMemo(() => paginatedProducts.map(product => [
    product.title,
    <InlineStack gap="200">
      <Button size="slim" onClick={() => console.log('Rewrite Title for', product.id)}>Rewrite Title</Button>
      <Button size="slim" onClick={() => console.log('Rewrite Desc for', product.id)}>Rewrite Desc</Button>
      <Button size="slim" onClick={() => console.log('Get GTIN for', product.id)}>Get GTIN</Button>
      <Button size="slim" onClick={() => console.log('Get Tags for', product.id)}>Get Tags</Button>
      <Button size="slim" variant="primary" onClick={() => console.log('Auto Fix for', product.id)}>Auto Fix</Button>
    </InlineStack>
  ]), [paginatedProducts]);

  return (
    <Card>
      <BlockStack gap="500">
        <Text as="h2" variant="headingMd">
          Products that need Correction
        </Text>
        <div className="correction-box" style={{ height: '500px', overflowY: 'auto', position: 'relative' }}>
          <BlockStack gap="200">
            {products.map((product) => (
              <Card key={product.id}>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    <b>{editedProducts[product.id]?.title || product.title}</b>
                  </Text>
                  <List type="bullet">
                    {product.issues.length > 0 ? (
                      product.issues.map((issue: any, index: number) => (
                        <List.Item key={index}>
                          <Badge tone={getBadgeTone(issue.severity)}>
                            {issue.severity}
                          </Badge>{" "}
                          {issue.message}
                        </List.Item>
                      ))
                    ) : (
                      <List.Item>
                        <Badge tone="success">No issues found</Badge>
                      </List.Item>
                    )}
                  </List>
                </BlockStack>
              </Card>
            ))}
          </BlockStack>
          {isLoadingProducts && ( // Use local loading state for the spinner
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              backgroundColor: 'rgba(255, 255, 255, 0.7)',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              zIndex: 10,
            }}>
              <Spinner />
            </div>
          )}
        </div>
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack align="center" wrap={false}>
            <Button variant="primary" onClick={() => navigate("/app/report")}>
              Run Detailed Check
            </Button>
          </InlineStack>
          <InlineStack align="end" gap="400">
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
                totalCount > 0 ? Math.ceil(totalCount / PRODUCTS_PER_PAGE) : 1
              }`}
            />
          </InlineStack>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
