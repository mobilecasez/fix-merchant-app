import { useState, useEffect } from "react";
import { useFetcher } from "@remix-run/react";
import {
  Card,
  BlockStack,
  Text,
  Button,
  List,
  Spinner,
  Badge,
  InlineStack,
} from "@shopify/polaris";

export function StoreIssuesSection() {
  const [issues, setIssues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const fetcher = useFetcher();

  useEffect(() => {
    fetcher.load("/api/store-issues");
  }, []);

  useEffect(() => {
    if (fetcher.data) {
      setIssues((fetcher.data as any).issues);
      setLoading(false);
    }
  }, [fetcher.data]);

  return (
    <Card>
      <BlockStack gap="500">
        <Text as="h2" variant="headingMd">
          Store-Wide Issues
        </Text>
        {loading ? (
          <Spinner accessibilityLabel="Loading store issues" size="large" />
        ) : (
          <List type="bullet">
            {issues.map((issue, index) => (
              <List.Item key={index}>
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd">
                    <b>{issue.title}</b>
                  </Text>
                  <Text as="p" variant="bodySm">
                    {issue.description}
                  </Text>
                  <Button
                    url={issue.actionUrl}
                    target="_blank"
                    variant="primary"
                    size="slim"
                  >
                    {issue.actionTitle}
                  </Button>
                </BlockStack>
              </List.Item>
            ))}
          </List>
        )}
      </BlockStack>
    </Card>
  );
}
