import type { LoaderFunction } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { createSubscription, changePlan } from "../utils/billing.server";

/**
 * This route handles the callback from Shopify after billing confirmation  
 */
export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const planId = url.searchParams.get("planId");
  const actionType = url.searchParams.get("action");
  const chargeId = url.searchParams.get("charge_id");

  console.log(`[Billing Callback] Received callback - Shop: ${shop}, Plan: ${planId}, Charge: ${chargeId}`);

  if (!shop || !planId || !chargeId) {
    console.error("[Billing Callback] Missing required parameters");
    return redirect("/app/choose-subscription?error=missing_params");
  }

  try {
    // Use unauthenticated.admin to get admin API access with the shop parameter
    // This allows us to make API calls without requiring embedded context
    const { admin } = await unauthenticated.admin(shop);

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
      await changePlan(shop, planId);
      
      // Store the Shopify charge ID
      await prisma.shopSubscription.update({
        where: { shop: shop },
        data: { chargeId: shopifyChargeId },
      });
      
      return redirect(`/app/subscription-success?planId=${planId}&changed=true`);
    }

    // Create new subscription
    console.log(`[Billing Callback] Creating new subscription for plan: ${plan.name}`);
    await createSubscription(shop, planId, shopifyChargeId);
    return redirect(`/app/subscription-success?planId=${planId}`);

  } catch (error) {
    console.error("[Billing Callback] Error processing billing:", error);
    return redirect("/app/choose-subscription?error=billing_failed");
  }
};

// Default component to show while processing
export default function BillingCallback() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      {/* 🔥 THE CRASH FIX 🔥 
         This script runs before Remix hydration. If history.state is missing
         (which happens after a hard redirect), it creates a fake one. 
         This stops the "null is not an object" error.
      */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            if (!window.history.state) {
              window.history.replaceState({ key: "default" }, "");
            }
          `,
        }}
      />
      
      <div style={{ textAlign: 'center' }}>
        <h2>Processing your subscription...</h2>
        <p>Please wait while we complete your purchase.</p>
      </div>
    </div>
  );
}
