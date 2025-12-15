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
  const storeCheckFetcher = useFetcher();
  const fetchHtmlFetcher = useFetcher();
  const [storeIssues, setStoreIssues] = useState<any>(null);
  const [rawHtmlContent, setRawHtmlContent] = useState<string | null>(null);
  const [isStoreCheckLoading, setIsStoreCheckLoading] = useState(false);

  useEffect(() => {
    console.log("StoreIssuesSection: fetchHtmlFetcher.data changed. State:", fetchHtmlFetcher.state, "Data:", fetchHtmlFetcher.data);
    if (fetchHtmlFetcher.data && (fetchHtmlFetcher.data as any).rawHtmlContent) {
      setRawHtmlContent((fetchHtmlFetcher.data as any).rawHtmlContent);
    } else if (fetchHtmlFetcher.data && (fetchHtmlFetcher.data as any).error) {
      console.error("StoreIssuesSection: Error fetching HTML:", (fetchHtmlFetcher.data as any).error);
      setIsStoreCheckLoading(false);
    }
  }, [fetchHtmlFetcher.data, fetchHtmlFetcher.state]); // Added fetchHtmlFetcher.state to dependencies

  useEffect(() => {
    console.log("StoreIssuesSection: rawHtmlContent or fetchHtmlFetcher.state changed. rawHtmlContent present:", !!rawHtmlContent, "fetchHtmlFetcher.state:", fetchHtmlFetcher.state);
    if (rawHtmlContent && fetchHtmlFetcher.state === "idle") {
      console.log("StoreIssuesSection: Submitting to AI store check.");
      const storeUrl = "https://mobilecasez.com";
      storeCheckFetcher.submit(
        { store_url: storeUrl, raw_html_content: rawHtmlContent },
        { method: "post", action: "/api/ai/store-check" }
      );
      setRawHtmlContent(null);
    }
  }, [rawHtmlContent, fetchHtmlFetcher.state]);

  useEffect(() => {
    console.log("StoreIssuesSection: storeCheckFetcher.data changed. State:", storeCheckFetcher.state, "Data:", storeCheckFetcher.data);
    if (storeCheckFetcher.data && (storeCheckFetcher.data as any).pointers) {
      setStoreIssues((storeCheckFetcher.data as any).pointers);
      setIsStoreCheckLoading(false);
      if ((storeCheckFetcher.data as any).debugPrompt) {
        console.log("AI Store Check Prompt (from response):", (storeCheckFetcher.data as any).debugPrompt);
      }
    } else if (storeCheckFetcher.data && (storeCheckFetcher.data as any).error) {
      console.error("StoreIssuesSection: Error from AI store check:", (storeCheckFetcher.data as any).error);
      setIsStoreCheckLoading(false);
      if ((storeCheckFetcher.data as any).debugPrompt) {
        console.log("AI Store Check Prompt (from error response):", (storeCheckFetcher.data as any).debugPrompt);
      }
    }
  }, [storeCheckFetcher.data, storeCheckFetcher.state]); // Added storeCheckFetcher.state to dependencies

  const getBadgeTone = (severity: string) => {
    switch (severity) {
      case "High":
        return "critical";
      case "Medium":
        return "warning";
      case "Low":
        return "attention";
    }
  };

  return (
    <Card>
      <BlockStack gap="500">
        <Text as="h2" variant="headingMd">
          Store Related Issues
        </Text>
        <div className="store-issues-box" style={{ height: '500px', overflowY: 'auto', position: 'relative' }}>
          {isStoreCheckLoading && (
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              backgroundColor: 'rgba(255, 255, 255, 0.7)',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              zIndex: 10,
            }}>
              <Spinner />
            </div>
          )}
          {storeIssues ? (
            <BlockStack gap="200">
              {Object.entries(storeIssues).map(([category, issues]: [string, any]) => (
                <Card key={category}>
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm">
                      <b>{category.replace(/_/g, ' ').toUpperCase()}</b>
                    </Text>
                    <List type="bullet">
                      {issues.length > 0 ? (
                        issues.map((issue: any, index: number) => (
                          <List.Item key={index}>
                            <Badge tone={getBadgeTone(issue.severity)}>
                              {issue.severity}
                            </Badge>{" "}
                            {issue.message}
                          </List.Item>
                        ))
                      ) : (
                        <List.Item>No issues found for this category.</List.Item>
                      )}
                    </List>
                  </BlockStack>
                </Card>
              ))}
            </BlockStack>
          ) : (
            <Text as="p" variant="bodyMd">
              Click "Run Store Check" to analyze store-related issues.
            </Text>
          )}
        </div>
        <InlineStack align="center">
          <Button
            variant="primary"
            onClick={() => {
              setIsStoreCheckLoading(true);
              setStoreIssues(null);
              const storeUrl = "https://mobilecasez.com";
              fetchHtmlFetcher.submit(
                { store_url: storeUrl },
                { method: "post", action: "/api/fetch-store-html" }
              );
            }}
            loading={isStoreCheckLoading}
          >
            Run Store Check
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
