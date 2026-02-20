import { useEffect } from "react";
import type { LoaderFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createSubscription, changePlan } from "../utils/billing.server";

/**
 * This route handles the callback from Shopify after billing confirmation  
 */
export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);
  const planId = url.searchParams.get("planId");
  const actionType = url.searchParams.get("action");
  const chargeId = url.searchParams.get("charge_id");

  // ✅ Use authenticate.admin - we're in the iframe so session cookies work
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  console.log(`[Billing Callback] Received callback - Shop: ${shop}, Plan: ${planId}, Charge: ${chargeId}`);

  if (!planId || !chargeId) {
    console.error("[Billing Callback] Missing required parameters");
    return json({ 
      success: false, 
      error: "missing_params",
      message: "Missing required billing parameters" 
    });
  }

  try {

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
      
      console.log("✅ [Billing Callback] Plan updated successfully");
      // ✅ Return JSON - client will handle navigation
      return json({ 
        success: true, 
        shop,
        planId,
        changed: true,
        message: "Plan upgraded successfully!"
      });
    }

    // Create new subscription
    console.log(`[Billing Callback] Creating new subscription for plan: ${plan.name}`);
    await createSubscription(shop, planId, shopifyChargeId);
    
    console.log("✅ [Billing Callback] Subscription created successfully");
    // ✅ Return JSON - client will handle navigation
    return json({ 
      success: true, 
      shop,
      planId,
      changed: false,
      message: "Subscription activated successfully!"
    });

  } catch (error) {
    console.error("[Billing Callback] Error processing billing:", error);
    return json({ 
      success: false, 
      error: "billing_failed",
      message: "Failed to process billing. Please try again."
    });
  }
};

// Component with client-side navigation
export default function BillingCallback() {
  const navigate = useNavigate();
  const data = useLoaderData<typeof loader>();

  useEffect(() => {
    // ✅ Client-Side Redirect after success
    // Since we're already inside the iframe, React Router handles this smoothly
    if (data.success) {
      const timer = setTimeout(() => {
        // Navigate with success params so dashboard can show banner
        navigate(`/app?success=true&planId=${data.planId}&changed=${data.changed}`);
      }, 1500);
      
      return () => clearTimeout(timer);
    } else if (data.error) {
      // Navigate to subscription page with error
      const timer = setTimeout(() => {
        navigate(`/app/choose-subscription?error=${data.error}`);
      }, 2000);
      
      return () => clearTimeout(timer);
    }
  }, [data, navigate]);

  return (
    <div style={{ 
      display: "flex", 
      flexDirection: "column",
      alignItems: "center", 
      justifyContent: "center", 
      height: "100vh",
      fontFamily: "system-ui, -apple-system, sans-serif",
      backgroundColor: "#f6f6f7"
    }}>
      {data.success ? (
        <>
          {/* Success UI */}
          <div style={{ fontSize: "60px", marginBottom: "20px" }}>🎉</div>
          <h1 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "10px", color: "#202223" }}>
            Payment Approved!
          </h1>
          <p style={{ color: "#6d7175", fontSize: "16px" }}>
            {data.message || "Updating your account..."}
          </p>
        </>
      ) : (
        <>
          {/* Error UI */}
          <div style={{ fontSize: "60px", marginBottom: "20px" }}>⚠️</div>
          <h1 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "10px", color: "#202223" }}>
            Something went wrong
          </h1>
          <p style={{ color: "#6d7175", fontSize: "16px" }}>
            {data.message || "Redirecting you back..."}
          </p>
        </>
      )}
    </div>
  );
}
