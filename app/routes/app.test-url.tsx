import { useState } from "react";
import { Page, Layout, Card, TextField, Button, Banner, Text, BlockStack } from "@shopify/polaris";
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useSubmit, useNavigation } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { scrapeAmazonNew } from "../utils/scrapers/amazonNew";

export const loader = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  
  const formData = await request.formData();
  const url = formData.get("url") as string;

  if (!url) {
    return json({ error: "URL is required" }, { status: 400 });
  }

  try {
    console.log('[Test URL] Starting scrape for:', url);
    
    // Call the scraper directly
    const extractedData = await scrapeAmazonNew('', url);
    
    console.log('[Test URL] Scrape completed successfully');

    return json({ success: true, data: extractedData });
  } catch (error) {
    console.error('[Test URL] Error:', error);
    const errorMessage = error instanceof Error ? error.message : "Failed to fetch product data";
    return json({ error: errorMessage }, { status: 500 });
  }
};

export default function TestURL() {
  const [url, setUrl] = useState("");
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const handleImport = () => {
    if (!url.trim()) {
      return;
    }

    const formData = new FormData();
    formData.append("url", url);
    submit(formData, { method: "post" });
  };

  return (
    <Page title="Test URL - Amazon Scraper">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Test Amazon Product URL
              </Text>
              
              <TextField
                label="Amazon Product URL"
                value={url}
                onChange={setUrl}
                placeholder="https://www.amazon.com/dp/..."
                autoComplete="off"
                disabled={isLoading}
              />

              <Button
                primary
                onClick={handleImport}
                loading={isLoading}
                disabled={!url.trim() || isLoading}
              >
                Import
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>

        {actionData?.error && (
          <Layout.Section>
            <Banner tone="critical">
              <p>{actionData.error}</p>
            </Banner>
          </Layout.Section>
        )}

        {actionData?.success && actionData?.data && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Extracted JSON
                </Text>
                
                <div style={{ 
                  backgroundColor: '#f6f6f7', 
                  padding: '16px', 
                  borderRadius: '8px',
                  overflow: 'auto',
                  maxHeight: '600px'
                }}>
                  <pre style={{ 
                    margin: 0, 
                    fontSize: '13px',
                    fontFamily: 'Monaco, Courier, monospace',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word'
                  }}>
                    {JSON.stringify(actionData.data, null, 2)}
                  </pre>
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
