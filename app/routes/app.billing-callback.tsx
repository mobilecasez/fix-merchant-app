import type { LoaderFunction } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createSubscription, changePlan } from "../utils/billing.server";

/**
 * This route handles the callback from Shopify after billing confirmation
 */
export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const host = url.searchParams.get("host");
  const planId = url.searchParams.get("planId");
  const actionType = url.searchParams.get("action");
  const chargeId = url.searchParams.get("charge_id");

  console.log(`[Billing Callback] Received callback - Shop: ${shop}, Host: ${host}, Plan: ${planId}, Charge: ${chargeId}`);

  // If coming from Shopify billing (no embedded context), redirect to embedded app
  if (shop && !host) {
    console.log("[Billing Callback] No host param - redirecting to embedded app context");
    const redirectUrl = `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}/billing-callback?${url.searchParams.toString()}`;
    return redirect(redirectUrl);
  }

  // Now authenticate with full context
  const { session, admin, billing } = await authenticate.admin(request);

  console.log(`[Billing Callback] Received callback for shop: ${session.shop}`);
  console.log(`[Billing Callback] Plan ID: ${planId}, Charge ID: ${chargeId}, Action: ${actionType}`);

  if (!planId) {
    console.error("[Billing Callback] Missing planId parameter");
    return redirect("/app/choose-subscription?error=missing_plan");
  }

  try {
    // Check if the billing was approved
    // Shopify redirects back with charge_id in URL if approved
    if (!chargeId) {
      // User cancelled billing
      console.log("[Billing Callback] No charge_id - user cancelled");
      return redirect("/app/choose-subscription?error=billing_cancelled");
    }

    // Get plan details
    const plan = await prisma.subscriptionPlan.findUnique({
      where: { id: planId },
    });

    if (!plan) {
      console.error("[Billing Callback] Plan not found:", planId);
      return redirect("/app/choose-subscription?error=invalid_plan");
    }

    // Verify the charge is active using GraphQL
    console.log("[Billing Callback] Verifying charge status with Shopify GraphQL...");
    
    const response = await admin.graphql(`
      query {
        currentAppInstallation {
          activeSubscriptions {
            id
            name
            status
            test
            lineItems {
              plan {
                pricingDetails {
                  ... on AppRecurringPricing {
                    price {
                      amount
                    }
                  }
                }
              }
            }
          }
        }
      }
    `);

    const data = await response.json();
    const activeSubscriptions = data.data?.currentAppInstallation?.activeSubscriptions || [];
    
    console.log(`[Billing Callback] Found ${activeSubscriptions.length} active subscriptions`);
    
    // Find the subscription matching our plan
    const activeSubscription = activeSubscriptions.find(
      (sub: any) => sub.name === plan.name && sub.status === "ACTIVE"
    );

    if (!activeSubscription) {
      console.error("[Billing Callback] No active subscription found for plan:", plan.name);
      return redirect("/app/choose-subscription?error=billing_not_active");
    }

    console.log("[Billing Callback] Subscription verified as ACTIVE");
    console.log(`[Billing Callback] Subscription ID: ${activeSubscription.id}`);

    // Extract Shopify charge ID from the subscription ID
    const shopifyChargeId = activeSubscription.id.split("/").pop();

    // Handle different action types
    if (actionType === "change" || actionType === "upgrade") {
      // Update existing subscription to new plan
      console.log(`[Billing Callback] Updating subscription to new plan: ${plan.name}`);
      await changePlan(session.shop, planId);
      
      // Store the Shopify charge ID
      await prisma.shopSubscription.update({
        where: { shop: session.shop },
        data: { chargeId: shopifyChargeId },
      });
      
      return redirect(`/app/subscription-success?planId=${planId}&changed=true`);
    }

    // Create new subscription
    console.log(`[Billing Callback] Creating new subscription for plan: ${plan.name}`);
    await createSubscription(session.shop, planId, shopifyChargeId);
    return redirect(`/app/subscription-success?planId=${planId}`);

  } catch (error) {
    console.error("[Billing Callback] Error:", error);
    return redirect("/app/choose-subscription?error=billing_failed");
  }
};

// Default component to show while processing
export default function BillingCallback() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <div style={{ textAlign: 'center' }}>
        <h2>Processing your subscription...</h2>
        <p>Please wait while we complete your purchase.</p>
      </div>
    </div>
  );
}
