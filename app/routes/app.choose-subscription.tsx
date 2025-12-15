import type { LoaderFunction, ActionFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Button,
  BlockStack,
  InlineStack,
  Text,
  Banner,
  Frame,
  Badge,
  Box,
  Divider,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createSubscription, hasUsedTrial, startFreeTrial, changePlan } from "../utils/billing.server";

export const loader: LoaderFunction = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  // Get all active plans
  const plans = await prisma.subscriptionPlan.findMany({
    where: { isActive: true },
    orderBy: { price: 'asc' },
  });

  // Get current subscription
  const currentSubscription = await prisma.shopSubscription.findUnique({
    where: { shop: session.shop },
    include: { plan: true },
  });

  // Check if trial has been used
  const trialUsed = await hasUsedTrial(session.shop);

  return json({ plans, currentSubscription, shop: session.shop, trialUsed });
};

export const action: ActionFunction = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const planId = formData.get("planId") as string;
  const action = formData.get("action") as string;

  try {
    // Get plan details
    const plan = await prisma.subscriptionPlan.findUnique({
      where: { id: planId },
    });

    if (!plan || !plan.isActive) {
      return json({ error: "Invalid plan" }, { status: 400 });
    }

    // Check if upgrading/downgrading from existing subscription
    const currentSubscription = await prisma.shopSubscription.findUnique({
      where: { shop: session.shop },
    });

    // Handle free trial
    if (plan.price === 0 && plan.name.includes('Trial')) {
      const trialUsed = await hasUsedTrial(session.shop);
      
      if (trialUsed) {
        return json({ error: "Trial already used for this shop" }, { status: 400 });
      }

      await startFreeTrial(session.shop, planId);
      return redirect("/app/subscription-success?planId=" + planId);
    }

    // Handle plan change (upgrade/downgrade)
    if (currentSubscription && action === "change") {
      await changePlan(session.shop, planId);
      return redirect("/app/subscription-success?planId=" + planId + "&changed=true");
    }

    // For paid plans, we would integrate with Shopify billing here
    // For now, just create the subscription directly (development mode)
    await createSubscription(session.shop, planId);
    return redirect("/app/subscription-success?planId=" + planId);

  } catch (error) {
    console.error("Subscription error:", error);
    return json({ 
      error: error instanceof Error ? error.message : "Failed to process subscription" 
    }, { status: 500 });
  }
};

export default function ChooseSubscription() {
  const { plans, currentSubscription, shop, trialUsed } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  const isLoading = navigation.state === "submitting";

  const handleSelectPlan = useCallback((planId: string, isTrial: boolean, isChange: boolean = false) => {
    setSelectedPlanId(planId);
    const formData = new FormData();
    formData.append("planId", planId);
    if (isChange) {
      formData.append("action", "change");
    }
    submit(formData, { method: "post" });
  }, [submit]);

  return (
    <Frame>
      <Page title="Choose Your Subscription Plan" narrowWidth>
        <Layout>
          {currentSubscription && (
            <Layout.Section>
              <Banner tone="info">
                <BlockStack gap="200">
                  <Text as="p">
                    Current Plan: <strong>{currentSubscription.plan.name}</strong>
                  </Text>
                  <Text as="p" tone="subdued">
                    Products used this month: {currentSubscription.productsUsed} / {currentSubscription.plan.productLimit}
                  </Text>
                  <Text as="p" tone="subdued">
                    You can upgrade or downgrade at any time. Changes take effect immediately.
                  </Text>
                </BlockStack>
              </Banner>
            </Layout.Section>
          )}

          {trialUsed && !currentSubscription && (
            <Layout.Section>
              <Banner tone="warning">
                <Text as="p">
                  You've already used your free trial. Choose a paid plan to continue using the app.
                </Text>
              </Banner>
            </Layout.Section>
          )}

          <Layout.Section>
            <BlockStack gap="400">
              {plans.map((plan: any) => {
                const isCurrentPlan = currentSubscription?.planId === plan.id;
                const isTrial = plan.price === 0 && plan.name.includes('Trial');
                const isTrialHidden = isTrial && trialUsed;

                // Don't show trial if already used
                if (isTrialHidden) return null;
                
                return (
                  <Card key={plan.id}>
                    <BlockStack gap="400">
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="100">
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="h2" variant="headingLg">
                              {plan.name}
                            </Text>
                            {isCurrentPlan && (
                              <Badge tone="success">Current Plan</Badge>
                            )}
                            {isTrial && !trialUsed && (
                              <Badge tone="info">Limited Time</Badge>
                            )}
                          </InlineStack>
                          <Text as="p" variant="headingXl" tone="base">
                            ${plan.price.toFixed(2)}
                            <Text as="span" variant="bodyMd" tone="subdued">
                              {isTrial ? " for 7 days" : " /month"}
                            </Text>
                          </Text>
                        </BlockStack>
                      </InlineStack>

                      <Divider />

                      <BlockStack gap="300">
                        <InlineStack gap="200" blockAlign="start">
                          <Text as="span" tone="success">✓</Text>
                          <Text as="p">
                            <strong>{plan.productLimit} products</strong> {isTrial ? "during trial" : "per month"}
                          </Text>
                        </InlineStack>
                        
                        <InlineStack gap="200" blockAlign="start">
                          <Text as="span" tone="success">✓</Text>
                          <Text as="p">
                            Import from 11 major e-commerce platforms
                          </Text>
                        </InlineStack>
                        
                        <InlineStack gap="200" blockAlign="start">
                          <Text as="span" tone="success">✓</Text>
                          <Text as="p">
                            AI-powered product descriptions
                          </Text>
                        </InlineStack>
                        
                        <InlineStack gap="200" blockAlign="start">
                          <Text as="span" tone="success">✓</Text>
                          <Text as="p">
                            Automated image importing
                          </Text>
                        </InlineStack>

                        {plan.description && (
                          <Box paddingBlockStart="200">
                            <Text as="p" tone="subdued">
                              {plan.description}
                            </Text>
                          </Box>
                        )}
                      </BlockStack>

                      <Button
                        variant={isCurrentPlan ? "secondary" : "primary"}
                        size="large"
                        fullWidth
                        onClick={() => handleSelectPlan(plan.id, isTrial, !!currentSubscription && !isCurrentPlan)}
                        loading={isLoading && selectedPlanId === plan.id}
                        disabled={isCurrentPlan || isLoading}
                      >
                        {isCurrentPlan 
                          ? "Current Plan" 
                          : currentSubscription && !isCurrentPlan
                            ? (plan.price > currentSubscription.plan.price ? "Upgrade" : "Downgrade")
                            : isTrial
                              ? "Start Free Trial"
                              : "Choose Plan"
                        }
                      </Button>
                    </BlockStack>
                  </Card>
                );
              })}
            </BlockStack>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  Need help choosing?
                </Text>
                <Text as="p" tone="subdued">
                  {trialUsed 
                    ? "All plans include full access to our product import features. Choose based on how many products you need to add per month. You can upgrade or downgrade at any time."
                    : "Start with a free 7-day trial to test all features. After that, choose a plan based on how many products you need to add per month. You can upgrade or downgrade at any time."
                  }
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </Frame>
  );
}
