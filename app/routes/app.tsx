import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Check if user is account owner
  const sessionData = await prisma.session.findFirst({
    where: { shop: session.shop },
  });

  // Get or create app settings for this shop
  let settings = await prisma.appSettings.findUnique({
    where: { shop: session.shop },
  });

  if (!settings) {
    settings = await prisma.appSettings.create({
      data: {
        shop: session.shop,
        addProductReplicaEnabled: true,
        dashboardEnabled: false,
        additionalEnabled: false,
        reportEnabled: false,
        storeErrorReportEnabled: false,
      },
    });
  }

  // Get subscription info
  const subscription = await prisma.shopSubscription.findUnique({
    where: { shop: session.shop },
    include: { plan: true },
  });

  return json({
    apiKey: process.env.SHOPIFY_API_KEY || "",
    settings,
    isAccountOwner: sessionData?.accountOwner || false,
    subscription,
  });
};

export default function App() {
  const { apiKey, settings, isAccountOwner, subscription } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Home
        </Link>
        {settings.addProductReplicaEnabled && (
          <Link to="/app/add-product-replica">Add Product Replica</Link>
        )}
        {subscription && (
          <>
            <Link to="/app/choose-subscription">Subscription</Link>
            <Link to="/app/usage-analytics">Usage Analytics</Link>
          </>
        )}
        {settings.dashboardEnabled && (
          <Link to="/app/dashboard">Dashboard</Link>
        )}
        {settings.reportEnabled && (
          <Link to="/app/report">Product Error Detailed Report</Link>
        )}
        {settings.additionalEnabled && (
          <Link to="/app/additional">Additional page</Link>
        )}
        {settings.storeErrorReportEnabled && (
          <Link to="/app/store-error-report">Store Error Report</Link>
        )}
        {isAccountOwner && (
          <>
            <Link to="/app/subscription-plans">Manage Plans</Link>
            <Link to="/app/settings">Settings</Link>
            <Link to="/test-url">Test URL</Link>
          </>
        )}
      </NavMenu>
      <Outlet />
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
