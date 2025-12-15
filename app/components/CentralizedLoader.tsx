import { Box, Spinner, LegacyCard } from "@shopify/polaris";
import React from "react";

interface CentralizedLoaderProps {
  loading: boolean;
}

export const CentralizedLoader: React.FC<CentralizedLoaderProps> = ({ loading }) => {
  if (!loading) {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        backgroundColor: "rgba(255, 255, 255, 0.7)", // White with 70% opacity for blur effect
        backdropFilter: "blur(5px)", // Blur background
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 9999, // Ensure it's on top of other content
      }}
    >
      <LegacyCard sectioned>
        <Box padding="400">
          <Spinner accessibilityLabel="Loading" size="large" />
        </Box>
      </LegacyCard>
    </div>
  );
};
