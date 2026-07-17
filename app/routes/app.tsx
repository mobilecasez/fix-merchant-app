import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { RatingPrompt } from "../components/RatingPrompt";
import { getAssociatedUser } from "../utils/account-owner.server";
import { isAdminShop, isAdminEmail } from "../utils/admin-access.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // One online token-exchange → account-owner flag + email; email gates the owner-only Admin link.
  const user = await getAssociatedUser(request, session.shop);
  const isAccountOwner = user.accountOwner;
  const isAdmin = isAdminShop(session.shop) || isAdminEmail(user.email);

  // Get or create app settings for this shop
  let settings = await prisma.appSettings.findUnique({
    where: { shop: session.shop },
  });

  if (!settings) {
    settings = await prisma.appSettings.create({
      data: {
        shop: session.shop,
        addProductReplicaEnabled: true,
        dashboardEnabled: true,
        additionalEnabled: true,
        reportEnabled: true,
        storeErrorReportEnabled: true,
      },
    });
  } else if (
    !settings.dashboardEnabled ||
    !settings.additionalEnabled ||
    !settings.reportEnabled ||
    !settings.storeErrorReportEnabled
  ) {
    settings = await prisma.appSettings.update({
      where: { shop: session.shop },
      data: {
        dashboardEnabled: true,
        additionalEnabled: true,
        reportEnabled: true,
        storeErrorReportEnabled: true,
      },
    });
  }

  // Get subscription info
  const subscription = await prisma.shopSubscription.findUnique({
    where: { shop: session.shop },
    include: { plan: true },
  });

  // Review state for the global rating prompt (so already-rated shops aren't re-asked)
  const review = await prisma.shopReview.findUnique({ where: { shop: session.shop } }).catch(() => null);

  return json({
    apiKey: process.env.SHOPIFY_API_KEY || "",
    settings,
    isAccountOwner,
    isAdmin, // owner-only Admin console — gated by ADMIN_EMAILS (default: your emails) / ADMIN_SHOPS
    subscription,
    reviewRating: review?.rating || 0,
    reviewDismissed: review?.dismissed || false,
    // Deep-link that opens the "Write a review" modal on our App Store listing.
    // Falls back to the hardcoded listing so happy merchants are always routed to a
    // public review even when SHOPIFY_APP_LISTING_URL isn't set in the environment.
    reviewUrl: process.env.SHOPIFY_APP_LISTING_URL || "https://apps.shopify.com/shopflix-ai#modal-show=WriteReviewModal",
  });
};

export default function App() {
  const { apiKey, settings, isAccountOwner, isAdmin, subscription, reviewRating, reviewDismissed, reviewUrl } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        {/* The first link is the required home link (Shopify NavMenu). Dashboard
            and Additional page are intentionally hidden from the nav. */}
        <Link to="/app" rel="home">
          Home
        </Link>
        {settings.addProductReplicaEnabled && (
          <Link to="/app/add-product-replica">AI Product Import</Link>
        )}
        {settings.storeErrorReportEnabled && (
          <Link to="/app/store-error-report">GMC Compliance Fix</Link>
        )}
        {settings.reportEnabled && (
          <Link to="/app/report">Products Repair</Link>
        )}
        {settings.merchandisingEnabled !== false && (
          <Link to="/app/merchandising">Boost Sales</Link>
        )}
        <Link to="/app/price-radar">Price Radar</Link>
        <Link to="/app/ad-campaigns">Ad Campaigns</Link>
        <Link to="/app/growth">Protect & Grow</Link>
        <Link to="/app/requests">Feature Requests</Link>
        {subscription && (
          <>
            <Link to="/app/usage-analytics">Usage & Limits</Link>
            <Link to="/app/choose-subscription">Plans & Billing</Link>
          </>
        )}

        {isAccountOwner && (
          <>
            <Link to="/app/subscription-plans">Manage Plans</Link>
            <Link to="/app/settings">Settings</Link>
          </>
        )}
        {isAdmin && <Link to="/app/admin">Admin</Link>}
      </NavMenu>
      <Outlet />
      <RatingPrompt initialRating={reviewRating} initialDismissed={reviewDismissed} reviewUrl={reviewUrl} />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
