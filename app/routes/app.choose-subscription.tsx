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
  getEffectiveProductLimit
} from "../utils/billing.server";

// What one credit buys across the app — shown as a transparency card above the
// plans, grouped by the merchant journey (import → scan → fix → protect).
// Keep in sync with SCAN_CREDITS (api.store-scan), FIX_CREDIT_COSTS (auto-fix),
// suspension-recovery (10), image-fixer (10 + 2/fix), monitor (2).
const CREDIT_MENU: Array<{
  section: string;
  items: Array<{ icon: string; label: string; sub: string; cost: string; free?: boolean; note?: string }>;
}> = [
  {
    section: "Import",
    items: [
      { icon: "📦", label: "AI Product Import", sub: "Amazon, eBay, AliExpress & 11 major platforms", cost: "1 credit / product" },
    ],
  },
  {
    section: "Scan & diagnose",
    items: [
      { icon: "🔍", label: "Basic Scan", sub: "Store fundamentals & legal compliance", cost: "10 credits", note: "First scan free" },
      { icon: "🔬", label: "Advanced Scan", sub: "Product feed — GTINs, pricing, descriptions", cost: "20 credits" },
      { icon: "🛡️", label: "Deep Scan", sub: "Full suspension-risk audit", cost: "30 credits" },
    ],
  },
  {
    section: "Fix & recover",
    items: [
      { icon: "⚡", label: "AI Auto-Fix", sub: "Policy pages, footer links, contact info & more", cost: "1–5 credits / fix" },
      { icon: "🖼️", label: "AI Image Fixer", sub: "Clean white backgrounds, watermark removal", cost: "10 + 2 / image" },
      { icon: "🛟", label: "Suspension Recovery", sub: "Diagnosis, fix plan & reinstatement appeal letter", cost: "10 credits" },
    ],
  },
  {
    section: "Protect",
    items: [
      { icon: "🔔", label: "Always-On Monitoring", sub: "Scheduled re-checks with email alerts", cost: "2 credits / check" },
      { icon: "🧩", label: "Structured Data (JSON-LD)", sub: "Rich-results theme block, one-click enable", cost: "Free", free: true },
    ],
  },
];

const creditPill = (free?: boolean): React.CSSProperties => ({
  fontSize: "12px", fontWeight: 600, whiteSpace: "nowrap",
  padding: "3px 10px", borderRadius: "999px",
  background: free ? "#f0fdf4" : "#f4f5f7",
  color: free ? "#166534" : "#374151",
  border: `1px solid ${free ? "#86efac" : "#e3e5e8"}`,
});
const creditIconChip: React.CSSProperties = {
  width: "32px", height: "32px", borderRadius: "8px", background: "#f4f6f8",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontSize: "16px", flexShrink: 0,
};
const creditSectionLabel: React.CSSProperties = {
  fontSize: "11px", fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase",
  color: "#8c9196", margin: "14px 0 2px",
};

// Per-plan highlights ("best items") keyed by plan name; generic fallback below.
const PLAN_DETAILS: Record<string, { tagline: string; features: string[] }> = {
  "Free Plan": {
    tagline: "See your store the way Google sees it — free.",
    features: [
      "First Basic compliance scan FREE (a 10-credit value)",
      "2 one-time credits to try AI imports or quick fixes",
      "Free JSON-LD structured data for rich results",
    ],
  },
  "Starter": {
    tagline: "New stores getting Google-ready.",
    features: [
      "Up to 20 AI product imports per month",
      "GMC compliance scans + one-click AI auto-fixes",
      "Suspension Recovery: diagnosis + appeal letter draft",
      "Example month: 1 Basic scan + 10 auto-fixes — or 20 imports",
    ],
  },
  "Basic": {
    tagline: "Growing catalogs that need a clean, compliant feed.",
    features: [
      "Up to 50 AI product imports per month",
      "Basic + Advanced scans (product feed, GTINs, pricing)",
      "AI Image Fixer for Google-rejected photos",
      "Always-on monitoring with email alerts",
      "Example month: both scans + ~20 auto-fixes",
    ],
  },
  "Professional": {
    tagline: "Serious about GMC compliance & suspension recovery.",
    features: [
      "Up to 100 AI product imports per month",
      "Full scan suite incl. Deep suspension-risk audit",
      "Suspension Recovery with AI appeal letter",
      "AI Image Fixer + always-on monitoring",
      "Example month: all 3 scans + recovery + 30 fixes or imports",
    ],
  },
  "Advanced": {
    tagline: "Recovery and protection at scale.",
    features: [
      "Up to 150 AI product imports per month",
      "Everything in Professional with 50% more headroom",
      "Image-fix sessions for your whole catalog",
      "Weekly monitoring without counting credits",
      "Example month: full suite + recovery + 25 image fixes + weekly checks",
    ],
  },
  "Enterprise": {
    tagline: "High-volume stores & agencies.",
    features: [
      "Up to 999 AI product imports per month",
      "Run every scan, fix and import without counting",
      "Recover and protect multiple large catalogs",
      "Monitoring, image fixes & recovery at volume",
    ],
  },
};

const GENERIC_PLAN_FEATURES = [
  "AI product imports from 11 major platforms",
  "GMC compliance scans + one-click AI auto-fixes",
  "Suspension Recovery with AI appeal letter",
  "AI Image Fixer & always-on monitoring",
];

export const loader: LoaderFunction = async ({ request }) => {
  const { session } = await authenticate.admin(request);// Get all active plans
  const plans = await prisma.subscriptionPlan.findMany({
    where: { 
      isActive: true
    },
    orderBy: { price: 'asc' },
  });// Get current subscription
  const currentSubscription = await prisma.shopSubscription.findUnique({
    where: { shop: session.shop },
    include: { plan: true },
  });
  return json({ 
    plans, 
    currentSubscription, 
    shop: session.shop,
    currentEffectiveLimit: currentSubscription ? getEffectiveProductLimit(currentSubscription) : null,
  });
};

export const action: ActionFunction = async ({ request }) => {const { session, admin } = await authenticate.admin(request);
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
      console.error('[Choose Subscription Action] Invalid plan');
      return json({ error: "Invalid plan" }, { status: 400 });
    }

    // Check if upgrading/downgrading from existing subscription
    const currentSubscription = await prisma.shopSubscription.findUnique({
      where: { shop: session.shop },
    });

    // For PAID plans (except Free Plan), create Shopify recurring charge via GraphQL
    // Free Plan users are automatically on active status, no charge needed
    if (plan.price === 0) {
      // Free plan downgrade: cancel any existing Shopify paid subscription first
      if (currentSubscription?.chargeId) {
        try {
          await admin.graphql(
            `#graphql
            mutation AppSubscriptionCancel($id: ID!) {
              appSubscriptionCancel(id: $id) {
                appSubscription { id status }
                userErrors { field message }
              }
            }`,
            {
              variables: {
                id: `gid://shopify/AppSubscription/${currentSubscription.chargeId}`,
              }
            }
          );
        } catch (_) {
          // Ignore cancellation errors — subscription may already be cancelled
        }
      }
      await changePlan(session.shop, planId);
      return redirect(`/app?success=true&changed=true&planId=${planId}`);
    }

    // For PAID plans, create Shopify recurring charge via GraphQL// Get API key for deep link
    const apiKey = process.env.SHOPIFY_API_KEY;
    if (!apiKey) {
      console.error("❌ CRITICAL ERROR: SHOPIFY_API_KEY is missing!");
      return json({ 
        success: false, 
        error: "Server configuration error: API key not found" 
      });
    }
    
    // ✅ Use Shopify Admin Deep Link - this keeps us in the iframe and preserves session
    const returnUrl = `https://${session.shop}/admin/apps/${apiKey}/app/billing-callback?planId=${planId}&action=${actionType || 'new'}&shop=${session.shop}`;
    
    // Log the URL to verify it's correct// Use test mode only in development
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
    }// For embedded apps, return the URL and handle redirect on client side
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
  const { plans, currentSubscription, shop, currentEffectiveLimit } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<'trial' | 'purchase' | 'change' | null>(null);
  const [pendingDowngrade, setPendingDowngrade] = useState<{ plan: any } | null>(null);

  // useFetcher manages its own loading state
  const isLoading = fetcher.state !== "idle";

  // THE CLEAN BREAK - Watch for the billing URL and redirect
  useEffect(() => {
    // Only process when fetcher is idle (request complete) and has data
    if (fetcher.state === "idle" && fetcher.data) {
      const data = fetcher.data;
      
      // Check if we got a success status and a valid redirectUrl
      if ('redirectUrl' in data && data.redirectUrl) {
        const url = data.redirectUrl;// STRICT VALIDATION to prevent "string did not match pattern" error
        if (typeof url === 'string' && 
            url.startsWith('https://') && 
            url.includes('shopify.com')) {// Set flag in sessionStorage for ErrorBoundary
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

  // Submit the plan change (called directly or after downgrade confirmation)
  const submitPlan = useCallback((planId: string, actionType: 'trial' | 'purchase' | 'change') => {
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
    fetcher.submit(formData, { method: "post" });
  }, [fetcher, currentSubscription]);

  // SUBMIT HANDLER - intercepts downgrades to show confirmation first
  const handleSelectPlan = useCallback((planId: string, actionType: 'trial' | 'purchase' | 'change') => {
    if (!currentSubscription) {
      submitPlan(planId, actionType);
      return;
    }
    const plan = plans.find((p: any) => p.id === planId);
    const isDowngrade = plan && plan.productLimit < currentSubscription.plan.productLimit;
    if (isDowngrade && actionType === 'change') {
      // Show confirmation banner instead of immediately submitting
      setPendingDowngrade({ plan });
      return;
    }
    submitPlan(planId, actionType);
  }, [submitPlan, currentSubscription, plans]);

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
        title="Plans & Billing"
        fullWidth
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
                    Credits used this month: {currentSubscription.productsUsed} / {currentSubscription.plan.productLimit}
                  </Text>
                  <Text as="p" tone="subdued">
                    You can upgrade or downgrade at any time.
                  </Text>
                </BlockStack>
              </Banner>
            </Layout.Section>
          )}

          {pendingDowngrade && currentSubscription && (() => {
            const effectiveLimit = currentEffectiveLimit ?? currentSubscription.plan.productLimit;
            const remaining = effectiveLimit - currentSubscription.productsUsed;
            const pluralCredits = (n: number) => n === 1 ? "credit" : "credits";
            return (
              <Layout.Section>
                <Banner
                  title={`Downgrade to ${pendingDowngrade.plan.name}?`}
                  tone="warning"
                  onDismiss={() => setPendingDowngrade(null)}
                >
                  <BlockStack gap="300">
                    <Text as="p">
                      You have <strong>{remaining}</strong> unused{" "}
                      {pluralCredits(remaining)} remaining in your current billing period.
                      These credits will <strong>carry over</strong> to your new plan — you won't lose them.
                    </Text>
                    <Text as="p">
                      Starting from your <strong>next billing cycle</strong>, you'll be on the{" "}
                      <strong>{pendingDowngrade.plan.name}</strong> with{" "}
                      <strong>{pendingDowngrade.plan.productLimit} {pluralCredits(pendingDowngrade.plan.productLimit)}</strong>{" "}
                      per month.
                    </Text>
                    <InlineStack gap="200">
                      <Button
                        variant="primary"
                        tone="critical"
                        loading={isLoading}
                        onClick={() => {
                          const plan = pendingDowngrade.plan;
                          setPendingDowngrade(null);
                          submitPlan(plan.id, 'change');
                        }}
                      >
                        Confirm Downgrade
                      </Button>
                      <Button onClick={() => setPendingDowngrade(null)} disabled={isLoading}>
                        Cancel
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Banner>
              </Layout.Section>
            );
          })()}



          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  One credit pool. Every feature.
                </Text>
                <Text as="p" tone="subdued">
                  Every plan unlocks the full app. Plans differ only in how many credits you
                  receive each month — spend them on whatever your store needs:
                </Text>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
                  gap: "4px 28px",
                }}>
                  {CREDIT_MENU.map((group) => (
                    <div key={group.section}>
                      <p style={creditSectionLabel}>{group.section}</p>
                      {group.items.map((item, idx) => (
                        <div
                          key={item.label}
                          style={{
                            display: "flex", alignItems: "center", gap: "12px",
                            padding: "10px 0",
                            borderBottom: idx < group.items.length - 1 ? "1px solid #f1f2f4" : "none",
                          }}
                        >
                          <div style={creditIconChip}>{item.icon}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                              <span style={{ fontSize: "13.5px", fontWeight: 600, color: "#202223" }}>{item.label}</span>
                              {item.note && <span style={creditPill(true)}>{item.note}</span>}
                            </div>
                            <span style={{ fontSize: "12px", color: "#6d7175" }}>{item.sub}</span>
                          </div>
                          <span style={creditPill(item.free)}>{item.cost}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "16px",
              alignItems: "stretch",
            }}>
              {plans.map((plan: any) => {
                const isCurrentPlan = currentSubscription?.planId === plan.id;
                const isFreeplan = plan.price === 0;
                const details = PLAN_DETAILS[plan.name];

                return (
                  <div
                    key={plan.id}
                    style={{
                      display: "flex", flexDirection: "column", height: "100%",
                      background: "#fff", borderRadius: "14px", padding: "20px",
                      border: isCurrentPlan ? "2px solid #1a4a5a" : "1px solid #e3e5e8",
                      boxShadow: isCurrentPlan ? "0 4px 14px rgba(26,74,90,0.14)" : "0 1px 3px rgba(16,24,40,0.05)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <Text as="h2" variant="headingMd">{plan.name}</Text>
                      {isCurrentPlan && <Badge tone="success">Current Plan</Badge>}
                      {isFreeplan && <Badge tone="info">Free Forever</Badge>}
                    </div>

                    <div style={{ margin: "8px 0 2px" }}>
                      <span style={{ fontSize: "26px", fontWeight: 800, color: "#1a1a1a" }}>
                        ${plan.price.toFixed(2)}
                      </span>
                      <span style={{ fontSize: "13px", color: "#6d7175" }}> /month</span>
                    </div>
                    {details?.tagline && (
                      <p style={{ margin: "0 0 4px", fontSize: "12.5px", color: "#6d7175", lineHeight: 1.45 }}>
                        {details.tagline}
                      </p>
                    )}

                    <div style={{ borderTop: "1px solid #f1f2f4", margin: "12px 0" }} />

                    <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
                      <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                        <span style={{ color: "#108043", fontWeight: 700, lineHeight: "19px" }}>✓</span>
                        <span style={{ fontSize: "13px", color: "#202223", lineHeight: 1.5 }}>
                          {isFreeplan ? (
                            <><strong>{plan.productLimit} one-time credits</strong> — try the app, no renewal needed</>
                          ) : (
                            <><strong>{plan.productLimit} credits</strong> per month — use them on imports, scans & fixes</>
                          )}
                        </span>
                      </div>

                      {(details?.features || GENERIC_PLAN_FEATURES).map((feature) => (
                        <div key={feature} style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                          <span style={{ color: "#108043", fontWeight: 700, lineHeight: "19px" }}>✓</span>
                          <span style={{ fontSize: "13px", color: "#42474c", lineHeight: 1.5 }}>{feature}</span>
                        </div>
                      ))}
                    </div>

                    <div style={{ marginTop: "auto", paddingTop: "18px" }}>
                      <Button
                        variant={isCurrentPlan ? "secondary" : "primary"}
                        size="large"
                        fullWidth
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
                            : isFreeplan
                              ? "Select Free Plan"
                              : "Choose Plan"
                        }
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  Need help choosing?
                </Text>
                <Text as="p" tone="subdued">
                  Start free: every store gets its first Basic compliance scan FREE, plus 2 one-time
                  credits to try AI imports and fixes. Getting your store Google-ready? Starter covers
                  a scan plus the fixes it finds. Suspended or at risk? Professional covers the full
                  scan suite and Suspension Recovery in one month.
                </Text>
                <Text as="p" tone="subdued">
                  Every plan unlocks every feature — AI product import, compliance scans, one-click
                  auto-fixes, the AI Image Fixer, Suspension Recovery and always-on monitoring.
                  Plans differ only in monthly credits, and you can upgrade or downgrade anytime.
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
  if (isRedirecting) {return (
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
