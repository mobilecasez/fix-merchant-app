import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  Button,
  List,
  Spinner,
  Pagination,
  Badge,
  Layout,
  Box,
  Divider,
  InlineStack,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useState, useEffect } from "react";
import { ProductCorrectionSection } from "../components/ProductCorrectionSection";
import { StoreIssuesSection } from "../components/StoreIssuesSection";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  
  // Check if dashboard is enabled
  const settings = await prisma.appSettings.findUnique({
    where: { shop: session.shop },
  });

  if (!settings?.dashboardEnabled) {
    throw new Response("This page is not enabled", { status: 403 });
  }
  
  const response = await admin.graphql(
    `#graphql
      query shopName {
        shop {
          name
        }
      }`
  );
  const data = await response.json();
  return json({ shopName: data.data.shop.name });
};

const PRODUCTS_PER_PAGE = 10;

export default function DashboardPage() {
  const { shopName } = useLoaderData<typeof loader>();

  return (
    <Page fullWidth>
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="500">
            <Text as="h1" variant="headingLg">
              <b>{shopName} : AI-Powered Store Assistant</b>
            </Text>
            <Text as="p" variant="bodyMd">
              Leverage intelligent automation to perfect your product listings,
              enhancing content, boost SEO, resolving critical merchant center
              issues and maintain a healthy Google Merchant Center account.
            </Text>
          </BlockStack>
        </Card>
        <Layout>
          <Layout.Section variant="oneHalf">
            <ProductCorrectionSection key="product-correction-section" />
          </Layout.Section>
          <Layout.Section variant="oneHalf">
            <StoreIssuesSection key="store-issues-section" />
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
