import { json, LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit } from "@remix-run/react";
import { useState, useCallback } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Checkbox,
  Button,
  Banner,
  Frame,
  Toast,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  // Check if user is account owner
  const sessionData = await prisma.session.findFirst({
    where: { shop: session.shop },
  });

  if (!sessionData?.accountOwner) {
    throw new Response("Unauthorized", { status: 403 });
  }

  // Get or create app settings
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

  return json({
    settings: {
      addProductReplicaEnabled: settings.addProductReplicaEnabled,
      dashboardEnabled: settings.dashboardEnabled,
      additionalEnabled: settings.additionalEnabled,
      reportEnabled: settings.reportEnabled,
      storeErrorReportEnabled: settings.storeErrorReportEnabled,
    },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  // Check if user is account owner
  const sessionData = await prisma.session.findFirst({
    where: { shop: session.shop },
  });

  if (!sessionData?.accountOwner) {
    return json({ error: "Unauthorized" }, { status: 403 });
  }

  const formData = await request.formData();
  const settings = JSON.parse(formData.get("settings") as string);

  await prisma.appSettings.upsert({
    where: { shop: session.shop },
    update: settings,
    create: {
      shop: session.shop,
      ...settings,
    },
  });

  return json({ success: true });
};

export default function Settings() {
  const { settings } = useLoaderData<typeof loader>();
  const submit = useSubmit();

  const [addProductReplicaEnabled, setAddProductReplicaEnabled] = useState(settings.addProductReplicaEnabled);
  const [dashboardEnabled, setDashboardEnabled] = useState(settings.dashboardEnabled);
  const [additionalEnabled, setAdditionalEnabled] = useState(settings.additionalEnabled);
  const [reportEnabled, setReportEnabled] = useState(settings.reportEnabled);
  const [storeErrorReportEnabled, setStoreErrorReportEnabled] = useState(settings.storeErrorReportEnabled);
  
  const [toastActive, setToastActive] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(() => {
    setSaving(true);
    const formData = new FormData();
    formData.append("settings", JSON.stringify({
      addProductReplicaEnabled,
      dashboardEnabled,
      additionalEnabled,
      reportEnabled,
      storeErrorReportEnabled,
    }));

    submit(formData, { method: "post" });
    
    setTimeout(() => {
      setSaving(false);
      setToastActive(true);
    }, 500);
  }, [submit, addProductReplicaEnabled, dashboardEnabled, additionalEnabled, reportEnabled, storeErrorReportEnabled]);

  const toggleToastActive = useCallback(() => setToastActive((active) => !active), []);

  const toastMarkup = toastActive ? (
    <Toast content="Settings saved successfully!" onDismiss={toggleToastActive} />
  ) : null;

  return (
    <Frame>
      <Page
        title="App Settings"
        subtitle="Control which features are accessible to users"
        backAction={{ content: "Dashboard", url: "/app" }}
        primaryAction={{
          content: "Save",
          onAction: handleSave,
          loading: saving,
        }}
      >
        <Layout>
          <Layout.Section>
            <Banner tone="info">
              <p>
                Only the app owner can access this settings page. Enable or disable features to control what users can see in the app.
              </p>
            </Banner>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Page Accessibility
                </Text>
                <Text as="p" tone="subdued">
                  Control which pages are visible and accessible to users of the app.
                </Text>

                <BlockStack gap="300">
                  <Checkbox
                    label="Add Product Replica"
                    checked={addProductReplicaEnabled}
                    onChange={setAddProductReplicaEnabled}
                    helpText="Allow users to fetch and add products from external URLs"
                  />

                  <Checkbox
                    label="Dashboard"
                    checked={dashboardEnabled}
                    onChange={setDashboardEnabled}
                    helpText="Show the main dashboard with product listings"
                  />

                  <Checkbox
                    label="Additional Features"
                    checked={additionalEnabled}
                    onChange={setAdditionalEnabled}
                    helpText="Enable additional features page"
                  />

                  <Checkbox
                    label="Reports"
                    checked={reportEnabled}
                    onChange={setReportEnabled}
                    helpText="Enable product reports functionality"
                  />

                  <Checkbox
                    label="Store Error Reports"
                    checked={storeErrorReportEnabled}
                    onChange={setStoreErrorReportEnabled}
                    helpText="Enable store-wide error checking and reports"
                  />
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  About Settings
                </Text>
                <Text as="p">
                  Changes to these settings will take effect immediately. Users will need to refresh their browser to see navigation changes.
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
      {toastMarkup}
    </Frame>
  );
}
