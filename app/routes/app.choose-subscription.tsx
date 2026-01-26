import type { LoaderFunction, ActionFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData, useRouteError, isRouteErrorResponse } from "@remix-run/react";
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
import { useState, useCallback, useEffect } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { 
  createSubscription, 
  changePlan,
  startPlanTrial,
  hasTriedPlan 
} from "../utils/billing.server";

export const loader: LoaderFunction = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  console.log("[choose-subscription] Loading plans for shop:", session.shop);

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
  console.log("[choose-subscription] Found plans:", plans.length, plans.map(p => p.name));

  // Get current subscription
  const currentSubscription = await prisma.shopSubscription.findUnique({
    where: { shop: session.shop },
    include: { plan: true },
  });
  console.log("[choose-subscription] Current subscription:", currentSubscription?.id || "none");

  // Get which plans have been tried (for per-plan trial tracking)
  const triedPlanIds = currentSubscription?.triedPlanIds 
    ? currentSubscription.triedPlanIds.split(',').filter((id: string) => id.length > 0)
    : [];
  console.log("[choose-subscription] Tried plan IDs:", triedPlanIds);

  return json({ 
    plans, 
    currentSubscription, 
    shop: session.shop,
    triedPlanIds 
  });
};

export const action: ActionFunction = async ({ request }) => {
  console.log('[Choose Subscription Action] Starting...');
  const { session, admin } = await authenticate.admin(request);
  console.log('[Choose Subscription Action] Authenticated for shop:', session.shop);
  
  const formData = await request.formData();
  const planId = formData.get("planId") as string;
  const actionType = formData.get("action") as string;
  const isTrial = formData.get("isTrial") === "true";

  console.log('[Choose Subscription Action] Form data:', { planId, actionType, isTrial });

  try {
    // Get plan details
    const plan = await prisma.subscriptionPlan.findUnique({
      where: { id: planId },
    });

    console.log('[Choose Subscription Action] Plan found:', plan?.name);

    if (!plan || !plan.isActive) {
      console.error('[Choose Subscription Action] Invalid plan');
      return json({ error: "Invalid plan" }, { status: 400 });
    }

    // Check if upgrading/downgrading from existing subscription
    const currentSubscription = await prisma.shopSubscription.findUnique({
      where: { shop: session.shop },
    });

    // Handle per-plan trial (2 free products) - FREE, no billing needed
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

    // For PAID plans, create Shopify recurring charge via GraphQL
    console.log(`[Billing] Creating Shopify recurring charge for plan: ${plan.name} ($${plan.price})`);
    
    const returnUrl = `${process.env.SHOPIFY_APP_URL}/app/billing-callback?planId=${planId}&action=${actionType || 'new'}`;
    const isTest = process.env.NODE_ENV !== "production";
    
    const response = await admin.graphql(
      `#graphql
      mutation AppSubscriptionCreate($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $returnUrl: URL!, $test: Boolean) {
        appSubscriptionCreate(
          name: $name
          returnUrl: $returnUrl
          test: $test
          lineItems: $lineItems
        ) {
          userErrors {
            field
            message
          }
          confirmationUrl
          appSubscription {
            id
            status
          }
        }
      }`,
      {
        variables: {
          name: plan.name,
          returnUrl: returnUrl,
          test: isTest,
          lineItems: [
            {
              plan: {
                appRecurringPricingDetails: {
                  price: { amount: plan.price, currencyCode: "USD" },
                  interval: "EVERY_30_DAYS"
                }
              }
            }
          ]
        }
      }
    );

    const responseJson = await response.json();
    console.log('[Billing] GraphQL response:', JSON.stringify(responseJson, null, 2));
    const data = responseJson.data?.appSubscriptionCreate;

    if (!data || data.userErrors?.length > 0) {
      console.error("[Billing] GraphQL errors:", data?.userErrors);
      return json({ 
        error: data?.userErrors?.[0]?.message || "Failed to create billing charge. Please ensure your app is set to 'App-managed pricing' in Partner Dashboard." 
      }, { status: 500 });
    }

    if (!data.confirmationUrl) {
      console.error("[Billing] No confirmation URL in response:", data);
      return json({ 
        error: "No confirmation URL received from Shopify. Please try again." 
      }, { status: 500 });
    }

    console.log(`[Billing] Shopify charge created successfully:`, data.appSubscription?.id);
    console.log(`[Billing] Redirecting to confirmation URL:`, data.confirmationUrl);
    
    // For embedded apps, return the URL and handle redirect on client side
    // Return 200 (not error) to avoid flash of error page
    return json({ 
      redirectUrl: data.confirmationUrl,
      success: true 
    }, { status: 200 });

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
  const actionData = useActionData<typeof action>();
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<'trial' | 'purchase' | 'change' | null>(null);
  const [isRedirecting, setIsRedirecting] = useState(false);

  const isLoading = navigation.state === "submitting" || isRedirecting;

  // Log all state changes
  console.log('[Choose Subscription Component] Render:', {
    navigationState: navigation.state,
    hasActionData: !!actionData,
    actionDataKeys: actionData ? Object.keys(actionData) : [],
    actionDataError: actionData && 'error' in actionData ? actionData.error : null,
    actionDataRedirectUrl: actionData && 'redirectUrl' in actionData ? actionData.redirectUrl : null,
    isRedirecting,
    isLoading
  });

  // Handle billing redirect using useEffect - watch for confirmationUrl in actionData
  useEffect(() => {
    // Clear redirect flag when component mounts (in case of back navigation)
    if (!actionData) {
      sessionStorage.removeItem('isRedirectingToBilling');
      return;
    }
    
    // If we receive a redirectUrl (confirmationUrl), perform full-frame redirect
    if (actionData && 'redirectUrl' in actionData && actionData.redirectUrl) {
      console.log('[Choose Subscription] Detected redirectUrl in actionData:', actionData.redirectUrl);
      
      // Set flag FIRST in sessionStorage to suppress errors during redirect
      sessionStorage.setItem('isRedirectingToBilling', 'true');
      
      // Mark as redirecting to show loading screen
      setIsRedirecting(true);
      
      // Perform immediate full-frame redirect to break out of iframe
      // This MUST be window.top to redirect the parent frame, not just the iframe
      console.log('[Choose Subscription] Executing immediate redirect to parent frame');
      
      // Use a small timeout to ensure state updates complete before redirect
      setTimeout(() => {
        window.top!.location.href = actionData.redirectUrl;
      }, 0);
    }
  }, [actionData]);
  
  // Check if we're in the middle of a redirect (persists across renders and error boundaries)
  const isCurrentlyRedirecting = isRedirecting || 
    (typeof window !== 'undefined' && sessionStorage.getItem('isRedirectingToBilling') === 'true');
  
  // IMMEDIATELY return loading screen if redirectUrl is present - prevent any other rendering
  if (actionData && 'redirectUrl' in actionData && actionData.redirectUrl) {
    console.log('[Choose Subscription] Rendering redirect screen immediately due to redirectUrl presence');
    return (
      <Frame>
        <Page title="Redirecting..." narrowWidth>
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Redirecting to Shopify billing page...</Text>
                  <Text as="p" tone="subdued">Please wait while we redirect you...</Text>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        </Page>
      </Frame>
    );
  }

  const handleSelectPlan = useCallback((planId: string, actionType: 'trial' | 'purchase' | 'change') => {
    console.log('[Choose Subscription] User clicked plan:', { planId, actionType });
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
    console.log('[Choose Subscription] Submitting form with data:', Object.fromEntries(formData));
    submit(formData, { method: "post" });
  }, [submit, currentSubscription]);

  console.log('[Choose Subscription] Rendering main page, checking error banner:', {
    shouldShowError: actionData?.error && !actionData?.redirectUrl,
    hasError: !!actionData?.error,
    hasRedirectUrl: !!actionData?.redirectUrl
  });

  return (
    <Frame>
      <Page 
        title="Choose Your Subscription Plan" 
        narrowWidth
        backAction={{ content: "Dashboard", url: "/app" }}
      >
        <Layout>
          {actionData?.error && !actionData?.redirectUrl && (
            <Layout.Section>
              <Banner tone="critical">
                <Text as="p">{actionData.error}</Text>
              </Banner>
            </Layout.Section>
          )}

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

// Error boundary to suppress ALL errors during billing redirect
export function ErrorBoundary() {
  const error = useRouteError();
  
  // If we're redirecting to billing, suppress ALL errors (they're expected)
  const isRedirecting = typeof window !== 'undefined' && sessionStorage.getItem('isRedirectingToBilling') === 'true';
  
  console.log('[Choose Subscription ErrorBoundary] Error caught:', {
    error,
    errorType: error?.constructor?.name,
    errorMessage: error instanceof Error ? error.message : 'Unknown',
    isRedirecting
  });
  
  if (isRedirecting) {
    console.log('[Choose Subscription] Suppressing error during redirect');
    return (
      <Frame>
        <Page title="Redirecting..." narrowWidth>
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Redirecting to Shopify billing page...</Text>
                  <Text as="p" tone="subdued">Please wait...</Text>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        </Page>
      </Frame>
    );
  }
  
  // For other errors, show error message
  let errorMessage = "An error occurred";
  if (isRouteErrorResponse(error)) {
    errorMessage = error.data?.message || error.statusText;
  } else if (error instanceof Error) {
    errorMessage = error.message;
  }
  
  return (
    <Frame>
      <Page title="Error" narrowWidth>
        <Layout>
          <Layout.Section>
            <Banner tone="critical">
              <Text as="p">{errorMessage}</Text>
            </Banner>
          </Layout.Section>
        </Layout>
      </Page>
    </Frame>
  );
}
