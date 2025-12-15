import type { LoaderFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  InlineStack,
  ProgressBar,
  Badge,
  Banner,
  Button,
  Box,
  Grid,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getUsageStats, getUsageWarning } from "../utils/billing.server";

export const loader: LoaderFunction = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  // Get subscription
  const subscription = await prisma.shopSubscription.findUnique({
    where: { shop: session.shop },
    include: { plan: true },
  });

  if (!subscription) {
    return json({ error: "No subscription found" });
  }

  // Get usage stats for last 30 days
  const stats = await getUsageStats(session.shop, 30);
  
  // Get warning level
  const warning = await getUsageWarning(session.shop);

  // Calculate days remaining in billing cycle
  const now = new Date();
  const cycleEnd = subscription.billingCycleEnd || now;
  const daysRemaining = Math.max(0, Math.ceil((cycleEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  return json({
    subscription,
    stats,
    warning,
    daysRemaining,
  });
};

export default function UsageAnalytics() {
  const data = useLoaderData<typeof loader>();

  if (data.error) {
    return (
      <Page title="Usage Analytics">
        <Banner tone="critical">
          <p>{data.error}</p>
        </Banner>
      </Page>
    );
  }

  const { subscription, stats, warning, daysRemaining } = data;
  const usagePercentage = (subscription.productsUsed / subscription.plan.productLimit) * 100;

  return (
    <Page
      title="Usage Analytics"
      subtitle="Track your product import usage and optimize your plan"
      backAction={{ content: "Home", url: "/app" }}
    >
      <Layout>
        {/* Warning Banner */}
        {warning.level !== 'none' && (
          <Layout.Section>
            <Banner
              tone={warning.level === 'critical' ? 'critical' : 'warning'}
              action={
                warning.level === 'critical' 
                  ? { content: 'Upgrade Plan', url: '/app/choose-subscription' }
                  : { content: 'View Plans', url: '/app/choose-subscription' }
              }
            >
              <p>{warning.message}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Current Usage Card */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Current Usage
                  </Text>
                  <Text as="p" tone="subdued">
                    {subscription.plan.name} Plan
                  </Text>
                </BlockStack>
                <Badge tone={subscription.status === 'trial' ? 'info' : 'success'}>
                  {subscription.status === 'trial' ? 'Trial' : 'Active'}
                </Badge>
              </InlineStack>

              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyLg" fontWeight="semibold">
                    {subscription.productsUsed} / {subscription.plan.productLimit}
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    {Math.round(usagePercentage)}% used
                  </Text>
                </InlineStack>
                <ProgressBar
                  progress={usagePercentage}
                  tone={usagePercentage >= 80 ? 'critical' : 'primary'}
                  size="medium"
                />
              </BlockStack>

              <InlineStack gap="400" blockAlign="center">
                <Box>
                  <BlockStack gap="100">
                    <Text as="p" tone="subdued" variant="bodySm">
                      Products Remaining
                    </Text>
                    <Text as="p" variant="headingMd">
                      {subscription.plan.productLimit - subscription.productsUsed}
                    </Text>
                  </BlockStack>
                </Box>
                <Box>
                  <BlockStack gap="100">
                    <Text as="p" tone="subdued" variant="bodySm">
                      Days Remaining
                    </Text>
                    <Text as="p" variant="headingMd">
                      {daysRemaining}
                    </Text>
                  </BlockStack>
                </Box>
                <Box>
                  <BlockStack gap="100">
                    <Text as="p" tone="subdued" variant="bodySm">
                      Plan Price
                    </Text>
                    <Text as="p" variant="headingMd">
                      ${subscription.plan.price.toFixed(2)}
                    </Text>
                  </BlockStack>
                </Box>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Usage Statistics */}
        <Layout.Section>
          <Grid columns={{ xs: 1, sm: 2, md: 3, lg: 3 }}>
            <Grid.Cell>
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingMd">
                    Total Products
                  </Text>
                  <Text as="p" variant="heading2xl">
                    {stats.totalProducts}
                  </Text>
                  <Text as="p" tone="subdued">
                    Last 30 days
                  </Text>
                </BlockStack>
              </Card>
            </Grid.Cell>

            <Grid.Cell>
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingMd">
                    Daily Average
                  </Text>
                  <Text as="p" variant="heading2xl">
                    {stats.avgPerDay.toFixed(1)}
                  </Text>
                  <Text as="p" tone="subdued">
                    Products per day
                  </Text>
                </BlockStack>
              </Card>
            </Grid.Cell>

            <Grid.Cell>
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingMd">
                    Days Tracked
                  </Text>
                  <Text as="p" variant="heading2xl">
                    {stats.daysTracked}
                  </Text>
                  <Text as="p" tone="subdued">
                    With activity
                  </Text>
                </BlockStack>
              </Card>
            </Grid.Cell>
          </Grid>
        </Layout.Section>

        {/* Recommendations */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Recommendations
              </Text>

              {usagePercentage < 50 && (
                <Banner tone="info">
                  <p>
                    You're using {Math.round(usagePercentage)}% of your plan. You're on track! 
                    {subscription.plan.productLimit < 50 && " If you need more products, consider upgrading to a higher plan."}
                  </p>
                </Banner>
              )}

              {usagePercentage >= 50 && usagePercentage < 80 && (
                <Banner tone="info">
                  <p>
                    You've used more than half your limit. Based on your average of {stats.avgPerDay.toFixed(1)} products per day, 
                    you'll reach your limit in approximately {Math.round((subscription.plan.productLimit - subscription.productsUsed) / (stats.avgPerDay || 1))} days.
                  </p>
                </Banner>
              )}

              {usagePercentage >= 80 && usagePercentage < 100 && (
                <Banner
                  tone="warning"
                  action={{ content: 'Upgrade Now', url: '/app/choose-subscription' }}
                >
                  <p>
                    You're approaching your limit. Upgrade now to avoid interruptions in your workflow.
                    {subscription.plan.name === 'Basic' && " The Professional plan offers 50 products/month."}
                    {subscription.plan.name === 'Professional' && " The Premium plan offers 100 products/month."}
                  </p>
                </Banner>
              )}

              {usagePercentage >= 100 && (
                <Banner
                  tone="critical"
                  action={{ content: 'Upgrade Plan', url: '/app/choose-subscription' }}
                >
                  <p>
                    You've reached your product limit. Upgrade your plan to continue importing products.
                  </p>
                </Banner>
              )}

              <InlineStack gap="200">
                <Link to="/app/choose-subscription">
                  <Button>View All Plans</Button>
                </Link>
                {subscription.status === 'trial' && (
                  <Link to="/app/choose-subscription">
                    <Button variant="primary">Upgrade from Trial</Button>
                  </Link>
                )}
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Usage History Chart */}
        {stats.history.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Daily Usage History
                </Text>
                <Box>
                  <BlockStack gap="200">
                    {stats.history.slice(-14).reverse().map((record: any) => {
                      const date = new Date(record.date);
                      const percentage = (record.productsCreated / record.planLimit) * 100;
                      
                      return (
                        <Box key={record.id}>
                          <InlineStack align="space-between" blockAlign="center">
                            <Box minWidth="120px">
                              <Text as="p" variant="bodySm">
                                {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </Text>
                            </Box>
                            <Box width="100%">
                              <ProgressBar
                                progress={Math.min(percentage, 100)}
                                size="small"
                              />
                            </Box>
                            <Box minWidth="60px">
                              <Text as="p" variant="bodySm" alignment="end">
                                {record.productsCreated}
                              </Text>
                            </Box>
                          </InlineStack>
                        </Box>
                      );
                    })}
                  </BlockStack>
                </Box>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
