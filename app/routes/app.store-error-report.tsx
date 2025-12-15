import { Page, Layout, Text, Card, BlockStack } from "@shopify/polaris";
import { StoreIssuesReport } from "../components/StoreIssuesReport";
import { CentralizedLoader } from "../components/CentralizedLoader"; // Import CentralizedLoader
import { useState } from "react"; // Import useState
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  // Check if store error report is enabled
  const settings = await prisma.appSettings.findUnique({
    where: { shop: session.shop },
  });

  if (!settings?.storeErrorReportEnabled) {
    throw new Response("This page is not enabled", { status: 403 });
  }

  return json({});
};

export default function StoreErrorReportPage() {
  const [isLoading, setIsLoading] = useState(true); // State to manage loading

  return (
    <Page fullWidth>
      <CentralizedLoader loading={isLoading} /> {/* Use CentralizedLoader */}
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="500">
            <Text as="h1" variant="headingLg">
              <b>Store Error Report</b>
            </Text>
            <Text as="p" variant="bodyMd">
              This report provides a detailed view of all store-related issues.
            </Text>
          </BlockStack>
        </Card>
        <Layout>
          <Layout.Section>
            <Card>
              <StoreIssuesReport onLoadingChange={setIsLoading} /> {/* Pass loading state setter */}
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
