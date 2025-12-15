import { useState, useEffect } from "react";
import { useFetcher } from "@remix-run/react";
import {
  Card,
  BlockStack,
  Text,
  List,
  Badge,
} from "@shopify/polaris";

interface StoreIssuesReportProps {
  onLoadingChange: (isLoading: boolean) => void;
}

export function StoreIssuesReport({ onLoadingChange }: StoreIssuesReportProps) {
  const storeCheckFetcher = useFetcher();
  const fetchHtmlFetcher = useFetcher();
  const [storeIssues, setStoreIssues] = useState<any>(null);
  const [rawHtmlContent, setRawHtmlContent] = useState<string | null>(null);

  // Initial fetch for HTML content on component mount
  useEffect(() => {
    const storeUrl = "https://mobilecasez.com";
    // Report loading state to parent immediately
    onLoadingChange(true);
    fetchHtmlFetcher.submit(
      { store_url: storeUrl },
      { method: "post", action: "/api/fetch-store-html" }
    );
  }, []); // Empty dependency array ensures this runs once on mount

  useEffect(() => {
    console.log("StoreIssuesReport: fetchHtmlFetcher.data changed. State:", fetchHtmlFetcher.state, "Data:", fetchHtmlFetcher.data);
    if (fetchHtmlFetcher.data && (fetchHtmlFetcher.data as any).rawHtmlContent) {
      setRawHtmlContent((fetchHtmlFetcher.data as any).rawHtmlContent);
    } else if (fetchHtmlFetcher.data && (fetchHtmlFetcher.data as any).error) {
      console.error("StoreIssuesReport: Error fetching HTML:", (fetchHtmlFetcher.data as any).error);
      setStoreIssues({}); // Indicate no issues or error occurred
      onLoadingChange(false); // Turn off loading if HTML fetch fails
    }
  }, [fetchHtmlFetcher.data, fetchHtmlFetcher.state, onLoadingChange]);

  useEffect(() => {
    console.log("StoreIssuesReport: rawHtmlContent or fetchHtmlFetcher.state changed. rawHtmlContent present:", !!rawHtmlContent, "fetchHtmlFetcher.state:", fetchHtmlFetcher.state);
    if (rawHtmlContent && fetchHtmlFetcher.state === "idle") {
      console.log("StoreIssuesReport: Submitting to AI store check.");
      const storeUrl = "https://mobilecasez.com";
      storeCheckFetcher.submit(
        { store_url: storeUrl, raw_html_content: rawHtmlContent },
        { method: "post", action: "/api/ai/store-check-report" }
      );
      setRawHtmlContent(null);
    }
  }, [rawHtmlContent, fetchHtmlFetcher.state]);

  useEffect(() => {
    console.log("StoreIssuesReport: storeCheckFetcher.data changed. State:", storeCheckFetcher.state, "Data:", storeCheckFetcher.data);
    if (storeCheckFetcher.data) {
      if ((storeCheckFetcher.data as any).pointers) {
        setStoreIssues((storeCheckFetcher.data as any).pointers);
      } else if ((storeCheckFetcher.data as any).error) {
        console.error("StoreIssuesReport: Error from AI store check:", (storeCheckFetcher.data as any).error);
        setStoreIssues({}); // Indicate no issues or error occurred
      }
      onLoadingChange(false); // Turn off loading when AI response is received (success or error)
      if ((storeCheckFetcher.data as any).debugPrompt) {
        console.log("AI Store Check Report Prompt (from response):", (storeCheckFetcher.data as any).debugPrompt);
      }
    }
  }, [storeCheckFetcher.data, storeCheckFetcher.state, onLoadingChange]);

  const getBadgeTone = (severity: string) => {
    switch (severity) {
      case "High":
        return "critical";
      case "Medium":
        return "warning";
      case "Low":
        return "attention";
      default:
        return "info";
    }
  };

  // Render content only when storeIssues is not null (meaning data fetching has completed)
  // The parent's CentralizedLoader will handle the loading state when storeIssues is null.
  if (storeIssues === null) {
    return null;
  }

  return (
    <BlockStack gap="500">
      <Text as="h2" variant="headingMd">
        Store Related Issues Report
      </Text>
      <div className="store-issues-box" style={{ position: 'relative' }}>
        {storeIssues && Object.keys(storeIssues).length > 0 ? (
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
                          <BlockStack gap="100">
                            <Text as="p" variant="bodyMd">
                              <b>Issue:</b> {issue.issue_description}
                            </Text>
                            <Text as="p" variant="bodySm">
                              <b>Fix:</b> {issue.suggested_fix}
                            </Text>
                          </BlockStack>
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
            No store issues to display.
          </Text>
        )}
      </div>
    </BlockStack>
  );
}
