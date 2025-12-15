import type { LoaderFunction } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { createSubscription, changePlan } from "../utils/billing.server";

/**
 * This route handles the callback from Shopify after billing confirmation
 */
export const loader: LoaderFunction = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);
  
  const url = new URL(request.url);
  const planId = url.searchParams.get("planId");
  const actionType = url.searchParams.get("action");
  const chargeId = url.searchParams.get("charge_id");

  if (!planId) {
    return redirect("/app/choose-subscription?error=missing_plan");
  }

  try {
    // Check if the billing was approved
    // Shopify redirects back with charge_id in URL if approved
    if (!chargeId) {
      // User cancelled billing
      return redirect("/app/choose-subscription?error=billing_cancelled");
    }

    // Verify the charge is active
    let isActive = false;
    try {
      const subscriptionCheck = await billing.check({
        isTest: process.env.NODE_ENV === "development",
      });
      
      isActive = subscriptionCheck?.appSubscriptions?.some(
        (sub: any) => sub.status === "ACTIVE"
      ) || false;
    } catch (error) {
      console.error("Error checking billing status:", error);
      // If check fails, assume it's active if we have a chargeId
      isActive = !!chargeId;
    }

    if (!isActive) {
      return redirect("/app/choose-subscription?error=billing_not_active");
    }

    // Handle different action types
    if (actionType === "change" || actionType === "upgrade") {
      // Update existing subscription to new plan
      await changePlan(session.shop, planId);
      return redirect(`/app/subscription-success?planId=${planId}&changed=true`);
    }

    // Create new subscription
    await createSubscription(session.shop, planId, chargeId);
    return redirect(`/app/subscription-success?planId=${planId}`);

  } catch (error) {
    console.error("Billing callback error:", error);
    return redirect("/app/choose-subscription?error=billing_failed");
  }
};
