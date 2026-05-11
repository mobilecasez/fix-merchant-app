import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  Button,
  List,
  Spinner,
  Banner,
  Layout
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useState, useEffect } from "react";
import "../styles/store-error-report.css";
import { getOrCreateSubscription, getProductsUsed, getEffectiveProductLimit, incrementProductUsage } from "../utils/billing.server";
import { StoreIssuesSection } from "../components/StoreIssuesSection";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await prisma.appSettings.findUnique({
    where: { shop: session.shop },
  });

  if (!settings?.storeErrorReportEnabled) {
    throw new Response("This page is not enabled", { status: 403 });
  }

  const subscription = await getOrCreateSubscription(session.shop);
  const productsUsed = getProductsUsed(subscription);
  const productLimit = getEffectiveProductLimit(subscription);

  return json({ productsUsed, productLimit });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const creditsToDeduct = Number(formData.get("creditsToDeduct"));

  if (creditsToDeduct > 0) {
    for (let i = 0; i < creditsToDeduct; i++) {
      await incrementProductUsage(session.shop);
    }
  }

  return json({ success: true, message: `Scan initiated and ${creditsToDeduct} credits deducted.` });
};

export default function StoreErrorReport() {
  const { productsUsed, productLimit } = useLoaderData<typeof loader>();
  const [showScanResults, setShowScanResults] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetcher = useFetcher();

  const handleRunScan = (scanType: string, creditCost: number) => {
    if (productsUsed + creditCost > productLimit) {
      setError("You do not have enough credits to run this scan. Please upgrade your plan.");
      return;
    }

    setIsScanning(true);
    setError(null);
    const formData = new FormData();
    formData.append("creditsToDeduct", String(creditCost));
    formData.append("scanType", scanType);
    fetcher.submit(formData, { method: "post" });
  };
  
  useEffect(() => {
    if (fetcher.data && fetcher.state === "idle") {
      setIsScanning(false);
      setShowScanResults(true);
    }
  }, [fetcher.data, fetcher.state]);

  return (
    <Page>
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="500">
            <Text as="h1" variant="headingLg">
              Store-wide GMC Compliance Scan
            </Text>
            <Text as="p" variant="bodyMd">
              A deep analysis of your entire store to identify and fix issues that could lead to Google Merchant Center suspensions. This comprehensive scan checks for missing product information, policy violations, and other critical errors.
            </Text>
            <Text as="p" variant="bodyMd">
              You have <strong>{productLimit - productsUsed} credits</strong> remaining.
            </Text>
            {error && <Banner tone="critical">{error}</Banner>}
          </BlockStack>
        </Card>

        {!showScanResults && (
          <div className="scan-options-container">
            <div className="scan-option-card">
              <h3>Basic Scanning</h3>
              <p>A fast scan that checks for common, high-priority issues across all your products.</p>
              <div className="credit-cost">10 Credits</div>
              <button
                className="scan-button"
                onClick={() => handleRunScan("basic", 10)}
                disabled={isScanning}
              >
                {isScanning ? <Spinner size="small" /> : "Run Basic Scan"}
              </button>
            </div>

            <div className="scan-option-card">
              <h3>Advanced Scanning</h3>
              <p>A more thorough scan that includes all basic checks plus a deeper analysis of product data and image quality.</p>
              <div className="credit-cost">20 Credits</div>
              <button
                className="scan-button"
                disabled={true}
              >
                Coming Soon
              </button>
            </div>

            <div className="scan-option-card">
              <h3>Deep Scanning</h3>
              <p>Our most comprehensive scan, covering all advanced checks plus a full site-wide crawl to find broken links and policy violations.</p>
              <div className="credit-cost">30 Credits</div>
              <button
                className="scan-button"
                disabled={true}
              >
                Coming Soon
              </button>
            </div>
          </div>
        )}

        {showScanResults && (
          <div className="scan-results-container">
            <StoreIssuesSection />
          </div>
        )}
      </BlockStack>
    </Page>
  );
}
