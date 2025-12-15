import type { LoaderFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Button,
  BlockStack,
  Text,
  Banner,
  Frame,
  Icon,
} from "@shopify/polaris";
import { CheckCircleIcon } from "@shopify/polaris-icons";
import { useEffect, useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createSubscription } from "../utils/billing.server";

export const loader: LoaderFunction = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const planId = url.searchParams.get("planId");
  const chargeId = url.searchParams.get("charge_id"); // Shopify callback parameter

  if (!planId) {
    return json({ error: "Missing plan ID" }, { status: 400 });
  }

  try {
    // Create or update subscription
    await createSubscription(session.shop, planId, chargeId || undefined);

    // Get plan details
    const plan = await prisma.subscriptionPlan.findUnique({
      where: { id: planId },
    });

    return json({ success: true, plan });
  } catch (error) {
    console.error("Subscription activation error:", error);
    return json({ error: "Failed to activate subscription" }, { status: 500 });
  }
};

export default function SubscriptionSuccess() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    if (data.success) {
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            navigate("/app/add-product-replica");
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [data.success, navigate]);

  if (data.error) {
    return (
      <Frame>
        <Page title="Subscription Error">
          <Layout>
            <Layout.Section>
              <Banner tone="critical">
                <p>{data.error}</p>
              </Banner>
              <div style={{ marginTop: "1rem" }}>
                <Button onClick={() => navigate("/app/choose-subscription")}>
                  Try Again
                </Button>
              </div>
            </Layout.Section>
          </Layout>
        </Page>
      </Frame>
    );
  }

  return (
    <Frame>
      <Page narrowWidth>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="600" inlineAlign="center">
                <div style={{ 
                  width: '80px', 
                  height: '80px', 
                  borderRadius: '50%', 
                  background: 'var(--p-color-bg-success)', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center' 
                }}>
                  <Icon source={CheckCircleIcon} tone="success" />
                </div>

                <BlockStack gap="200" inlineAlign="center">
                  <Text as="h1" variant="headingXl" alignment="center">
                    Subscription Activated!
                  </Text>
                  <Text as="p" variant="bodyLg" alignment="center" tone="subdued">
                    Welcome to the {data.plan.name} plan
                  </Text>
                </BlockStack>

                <Card background="bg-surface-secondary">
                  <BlockStack gap="300">
                    <Text as="p" variant="headingMd" alignment="center">
                      Your Plan Includes:
                    </Text>
                    <BlockStack gap="200">
                      <Text as="p" alignment="center">
                        ✓ <strong>{data.plan.productLimit} products</strong> per month
                      </Text>
                      <Text as="p" alignment="center">
                        ✓ Import from 11 major platforms
                      </Text>
                      <Text as="p" alignment="center">
                        ✓ AI-powered descriptions
                      </Text>
                      <Text as="p" alignment="center">
                        ✓ Automated image importing
                      </Text>
                    </BlockStack>
                  </BlockStack>
                </Card>

                <BlockStack gap="200" inlineAlign="center">
                  <Text as="p" tone="subdued" alignment="center">
                    Redirecting to Add Product page in {countdown} seconds...
                  </Text>
                  <Button 
                    variant="primary" 
                    size="large"
                    onClick={() => navigate("/app/add-product-replica")}
                  >
                    Start Adding Products
                  </Button>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </Frame>
  );
}
