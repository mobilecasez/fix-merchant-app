import type { LoaderFunction, ActionFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useFetcher, useRouteError, isRouteErrorResponse } from "@remix-run/react";
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
    
    // ✅ CRITICAL: Ensure SHOPIFY_API_KEY is loaded from environment
    const apiKey = process.env.SHOPIFY_API_KEY;
    
    if (!apiKey) {
      console.error("❌ CRITICAL ERROR: SHOPIFY_API_KEY is missing in server environment!");
      return json({ 
        success: false, 
        error: "Server configuration error: API key not found" 
      });
    }
    
    // ✅ CRITICAL: Use Shopify Admin embedding URL so user returns INSIDE the iframe
    // This prevents the blank {} page issue by ensuring proper authentication context
    // IMPORTANT: Include shop parameter so billing-callback can use unauthenticated.admin()
    const returnUrl = `https://${session.shop}/admin/apps/${apiKey}/app/billing-callback?planId=${planId}&action=${actionType || 'new'}&shop=${session.shop}`;
    
    // Log the URL to verify it's correct
    console.log("👉 BILLING RETURN URL:", returnUrl);
    
    // Always use test mode for now (set to false only when ready for production billing)
    const isTest = true;
    
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
  // ALL HOOKS AT THE TOP - NEVER CONDITIONALLY CALLED
  const { plans, currentSubscription, shop, triedPlanIds } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<'trial' | 'purchase' | 'change' | null>(null);

  // useFetcher manages its own loading state
  const isLoading = fetcher.state !== "idle";

  // DEBUG: Log what we receive from the fetcher
  console.log('[Choose Subscription] Fetcher State:', fetcher.state);
  console.log('[Choose Subscription] Fetcher Data:', fetcher.data);

  // THE CLEAN BREAK - Watch for the billing URL and redirect
  useEffect(() => {
    // Only process when fetcher is idle (request complete) and has data
    if (fetcher.state === "idle" && fetcher.data) {
      const data = fetcher.data;
      
      // Check if we got a success status and a valid redirectUrl
      if ('redirectUrl' in data && data.redirectUrl) {
        const url = data.redirectUrl;
        
        console.log('[Choose Subscription] Billing URL received:', url);
        
        // STRICT VALIDATION to prevent "string did not match pattern" error
        if (typeof url === 'string' && 
            url.startsWith('https://') && 
            url.includes('shopify.com')) {
          
          console.log('[Choose Subscription] ✓ Valid Shopify URL, redirecting to:', url);
          
          // Set flag in sessionStorage for ErrorBoundary
          sessionStorage.setItem('isRedirectingToBilling', 'true');
          
          // THE CLEAN BREAK: Force top-level window navigation
          // This breaks out of iframe and bypasses React Router completely
          window.top!.location.href = url;
          
        } else {
          console.error('[Choose Subscription] ✗ Invalid URL received:', {
            url,
            type: typeof url,
            isString: typeof url === 'string',
            startsWithHttps: typeof url === 'string' ? url.startsWith('https://') : false,
            includesShopify: typeof url === 'string' ? url.includes('shopify.com') : false
          });
        }
      }
      
      // Handle errors from server
      if ('error' in data && data.error) {
        console.error('[Choose Subscription] Server error:', data.error);
      }
    }
  }, [fetcher.state, fetcher.data]);

  // SUBMIT HANDLER - Uses fetcher.submit for non-navigational request
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
    
    console.log('[Choose Subscription] Submitting with useFetcher (non-navigational)');
    
    // useFetcher.submit automatically includes auth headers and doesn't trigger navigation
    fetcher.submit(formData, { method: "post" });
  }, [fetcher, currentSubscription]);

  // Early return for redirect - AFTER all hooks to maintain consistent hook order
  if (fetcher.data && 'redirectUrl' in fetcher.data && fetcher.data.redirectUrl) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div style={{ textAlign: 'center' }}>
          <h2>Redirecting to Shopify...</h2>
          <p>Please wait while we redirect you to complete your subscription.</p>
        </div>
      </div>
    );
  }

  return (
    <Frame>
      <Page 
        title="Choose Your Subscription Plan" 
        narrowWidth
        backAction={{ content: "Dashboard", url: "/app" }}
      >
        <Layout>
          {fetcher.data && 'error' in fetcher.data && fetcher.data.error && (
            <Layout.Section>
              <Banner tone="critical">
                <Text as="p">{fetcher.data.error}</Text>
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
