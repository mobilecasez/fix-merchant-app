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
import { 
  createSubscription, 
  hasUsedTrial, 
  startFreeTrial, 
  changePlan,
  requestBilling,
  startPlanTrial,
  hasTriedPlan 
} from "../utils/billing.server";

export const loader: LoaderFunction = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  // Get all active plans (exclude old Free Trial plan)
  const plans = await prisma.subscriptionPlan.findMany({
    where: { 
      isActive: true,
      NOT: {
        name: { contains: 'Free Trial' }
      }
    },
    orderBy: { price: 'asc' },
  });

  // Get current subscription
  const currentSubscription = await prisma.shopSubscription.findUnique({
    where: { shop: session.shop },
    include: { plan: true },
  });

  // Get which plans have been tried (for per-plan trial tracking)
  const triedPlanIds = currentSubscription?.triedPlanIds 
    ? currentSubscription.triedPlanIds.split(',').filter((id: string) => id.length > 0)
    : [];

  return json({ 
    plans, 
    currentSubscription, 
    shop: session.shop,
    triedPlanIds 
  });
};

export const action: ActionFunction = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const planId = formData.get("planId") as string;
  const actionType = formData.get("action") as string;
  const isTrial = formData.get("isTrial") === "true";

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

    // Handle per-plan trial (2 free products)
    if (isTrial) {
      const alreadyTried = await hasTriedPlan(session.shop, planId);
      
      if (alreadyTried) {
        return json({ 
          error: "You've already tried this plan. Please purchase to continue." 
        }, { status: 400 });
      }

      await startPlanTrial(session.shop, planId);
      return redirect("/app/subscription-success?planId=" + planId + "&trial=true");
    }

    // Handle plan change (upgrade/downgrade) from active subscription
    if (currentSubscription?.status === "active" && actionType === "change") {
      // Request new billing for the plan change
      const confirmationUrl = await requestBilling(
        request,
        planId,
        `${process.env.SHOPIFY_APP_URL}/app/billing-callback?planId=${planId}&action=change`
      );
      
      return redirect(confirmationUrl);
    }

    // Handle upgrade from trial to paid plan
    if (currentSubscription?.status === "trial" && actionType === "upgrade") {
      const confirmationUrl = await requestBilling(
        request,
        planId,
        `${process.env.SHOPIFY_APP_URL}/app/billing-callback?planId=${planId}&action=upgrade`
      );
      
      return redirect(confirmationUrl);
    }

    // For new paid plan subscription, request Shopify billing
    const confirmationUrl = await requestBilling(
      request,
      planId,
      `${process.env.SHOPIFY_APP_URL}/app/billing-callback?planId=${planId}`
    );
    
    return redirect(confirmationUrl);

  } catch (error) {
    console.error("Subscription error:", error);
    return json({ 
      error: error instanceof Error ? error.message : "Failed to process subscription" 
    }, { status: 500 });
  }
};

export default function ChooseSubscription() {
  const { plans, currentSubscription, shop, triedPlanIds } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<'trial' | 'purchase' | 'change' | null>(null);

  const isLoading = navigation.state === "submitting";

  const handleSelectPlan = useCallback((planId: string, actionType: 'trial' | 'purchase' | 'change') => {
    setSelectedPlanId(planId);
    setSelectedAction(actionType);
    const formData = new FormData();
    formData.append("planId", planId);
    formData.append("isTrial", actionType === 'trial' ? "true" : "false");
    if (actionType === 'change') {
      formData.append("action", "change");
    } else if (currentSubscription?.status === "trial" && actionType === 'purchase') {
      formData.append("action", "upgrade");
    }
    submit(formData, { method: "post" });
  }, [submit, currentSubscription]);

  return (
    <Frame>
      <Page title="Choose Your Subscription Plan" narrowWidth>
        <Layout>
          {currentSubscription && currentSubscription.status === "active" && (
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
                    You can upgrade or downgrade at any time.
                  </Text>
                </BlockStack>
              </Banner>
            </Layout.Section>
          )}

          {currentSubscription && currentSubscription.status === "trial" && (
            <Layout.Section>
              <Banner tone="success">
                <BlockStack gap="200">
                  <Text as="p">
                    <strong>Trial Active: {currentSubscription.plan.name}</strong>
                  </Text>
                  <Text as="p" tone="subdued">
                    You've used {currentSubscription.trialProductsUsed} of 2 free trial products. 
                    Upgrade to a paid plan to continue after your trial.
                  </Text>
                </BlockStack>
              </Banner>
            </Layout.Section>
          )}

          <Layout.Section>
            <BlockStack gap="400">
              {plans.map((plan: any) => {
                const isCurrentPlan = currentSubscription?.planId === plan.id;
                const hasTriedThisPlan = triedPlanIds.includes(plan.id);
                const isOnTrial = currentSubscription?.status === "trial";
                const canTry = !hasTriedThisPlan && !isCurrentPlan;
                
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
                            {hasTriedThisPlan && !isCurrentPlan && (
                              <Badge tone="info">Previously Tried</Badge>
                            )}
                          </InlineStack>
                          <Text as="p" variant="headingXl" tone="base">
                            ${plan.price.toFixed(2)}
                            <Text as="span" variant="bodyMd" tone="subdued">
                              {" "}/month
                            </Text>
                          </Text>
                        </BlockStack>
                      </InlineStack>

                      <Divider />

                      <BlockStack gap="300">
                        <InlineStack gap="200" blockAlign="start">
                          <Text as="span" tone="success">✓</Text>
                          <Text as="p">
                            <strong>{plan.productLimit} products</strong> per month
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

                        {canTry && (
                          <Box paddingBlockStart="200">
                            <Banner tone="info">
                              <Text as="p" fontWeight="semibold">
                                🎁 Try this plan FREE with 2 product imports!
                              </Text>
                            </Banner>
                          </Box>
                        )}
                      </BlockStack>

                      <InlineStack gap="200">
                        {canTry && (
                          <Button
                            variant="secondary"
                            size="large"
                            onClick={() => handleSelectPlan(plan.id, 'trial')}
                            loading={isLoading && selectedPlanId === plan.id && selectedAction === 'trial'}
                            disabled={isLoading}
                          >
                            Try for Free (2 products)
                          </Button>
                        )}
                        
                        <Button
                          variant={isCurrentPlan ? "secondary" : "primary"}
                          size="large"
                          onClick={() => handleSelectPlan(plan.id, 
                            currentSubscription && !isCurrentPlan ? 'change' : 'purchase'
                          )}
                          loading={isLoading && selectedPlanId === plan.id && selectedAction !== 'trial'}
                          disabled={isCurrentPlan || isLoading}
                        >
                          {isCurrentPlan 
                            ? "Current Plan" 
                            : currentSubscription?.status === "active" && !isCurrentPlan
                              ? (plan.price > currentSubscription.plan.price ? "Upgrade" : "Downgrade")
                              : isOnTrial && !isCurrentPlan
                                ? "Upgrade to This Plan"
                                : "Choose Plan"
                          }
                        </Button>
                      </InlineStack>
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
                  How Trials Work
                </Text>
                <Text as="p" tone="subdued">
                  Try any plan for free with 2 product imports. Each plan can be tried once. 
                  After using your free trial products, upgrade to continue importing.
                </Text>
                <Text as="p" tone="subdued">
                  All plans include full access to our features: multi-platform import, 
                  AI-powered descriptions, and Google Merchant Center compliance checking.
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  Need help choosing?
                </Text>
                <Text as="p" tone="subdued">
                  {triedPlanIds.length > 0
                    ? "All plans include full access to our product import features. Choose based on how many products you need to add per month. You can upgrade or downgrade at any time."
                    : "Start with a free trial to test all features. Each plan offers 2 free product imports. After that, choose a plan based on how many products you need to add per month."
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
