import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useRouteError, isRouteErrorResponse } from "@remix-run/react";
import { Page } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useState } from "react";
import { getOrCreateSubscription, getProductsUsed, getEffectiveProductLimit } from "../utils/billing.server";
import { MonitoringPanel, ImageFixerPanel, AutoSchemaPanel } from "../components/growth-tools";
import "../styles/dashboard.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  try {
    const subscription = await getOrCreateSubscription(session.shop);
    const productsUsed = getProductsUsed(subscription);
    const productLimit = getEffectiveProductLimit(subscription);
    const review = await prisma.shopReview.findUnique({ where: { shop: session.shop } }).catch(() => null);
    return json({
      productsUsed, productLimit, review,
      shop: session.shop, apiKey: process.env.SHOPIFY_API_KEY || "",
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw new Response(`Loader error: ${msg}`, { status: 500 });
  }
};

const TOOLS = [
  { key: "monitoring", icon: "🔔", title: "Always-On Monitoring", subtitle: "Catch new issues early", desc: "Automatically re-checks your store on a schedule and emails you only when a new compliance problem appears — never spam. Each automated check uses 2 credits.", cta: "Configure Monitoring" },
  { key: "imagefix", icon: "🖼️", title: "Image Compliance Fixer", subtitle: "Fix GMC image rejections", desc: "Finds product images Google rejects (too small, watermarks, promo text) and fixes them with AI — clean white background, re-uploaded automatically. Scan costs 10 credits; each fix 2 credits.", cta: "Fix Product Images" },
  { key: "schema", icon: "🧩", title: "Auto Structured Data", subtitle: "JSON-LD for rich results", desc: "Adds accurate Product schema (brand, GTIN, MPN, price, availability, ratings) to every product page — one-click enable, no code. Free.", cta: "Enable JSON-LD" },
] as const;

export default function GrowthProtection() {
  const { productsUsed, productLimit, review: initialReview, shop, apiKey } = useLoaderData<typeof loader>();
  const credits = productLimit - productsUsed;
  const [active, setActive] = useState<string | null>(null);

  const [reviewBannerDismissed, setReviewBannerDismissed] = useState((initialReview as any)?.dismissed || false);
  const [userRating, setUserRating] = useState<number | null>((initialReview as any)?.rating || null);
  const [showRatingThankYou, setShowRatingThankYou] = useState(false);

  const handleRating = async (rating: number) => {
    setUserRating(rating);
    setShowRatingThankYou(true);
    try {
      await fetch("/api/submit-rating", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating, dismissed: false }) });
    } catch { /* ignore */ }
    setTimeout(() => setShowRatingThankYou(false), 2000);
  };
  const handleDismiss = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    setReviewBannerDismissed(true);
    try {
      await fetch("/api/submit-rating", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dismissed: true }) });
    } catch { /* ignore */ }
  };

  const activeMeta = TOOLS.find(t => t.key === active);

  return (
    <div className="landing-page">
      <Page fullWidth>
        <div className="landing-container">

          {/* Header */}
          <div className="header-section">
            <div className="header-content">
              <div className="logo-icon">🚀</div>
              <h1 className="app-title">Protect & Grow</h1>
            </div>
          </div>

          {/* Review Banner */}
          {!reviewBannerDismissed && (
            <div className="review-banner">
              <div className="review-content">
                <div className="review-left">
                  {!showRatingThankYou ? (
                    <>
                      <p className="review-text">How's your experience with ShopFlix AI?</p>
                      <p className="review-subtext">
                        <a href="#" onClick={handleDismiss} className="review-link">Rate us by clicking on stars. Dismiss.</a>
                      </p>
                    </>
                  ) : (
                    <p className="review-text">✓ Thank you for your feedback!</p>
                  )}
                </div>
                <div className="review-stars">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button key={star} className={`star-button ${userRating && star <= userRating ? "rated" : ""}`}
                      onClick={() => handleRating(star)} aria-label={`Rate ${star} stars`} disabled={showRatingThankYou}>
                      {userRating && star <= userRating ? "⭐" : "☆"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Intro */}
          <div className="intro-card">
            <h2 className="intro-heading">Protect Your Store, Grow Your Sales.</h2>
            <p className="intro-paragraph">
              Three advanced tools that go beyond scanning: get alerted the moment a new compliance issue appears, fix
              non-compliant product images with AI, and add the structured data Google rewards. Suspension recovery now lives
              alongside the scans on the <strong>GMC Compliance Fix</strong> page. You have <strong>{credits} credits</strong> remaining.
            </p>
          </div>

          {/* Explainer cards */}
          <div className="feature-cards-grid" style={{ marginBottom: "12px" }}>
            <div className="feature-card" style={{ padding: "18px" }}>
              <div style={{ fontSize: "22px", marginBottom: "6px" }}>🛡️</div>
              <p style={{ margin: "0 0 4px 0", fontWeight: 700, fontSize: "14px", color: "#212121" }}>Stay protected</p>
              <p style={{ margin: 0, fontSize: "13px", color: "#6b7280", lineHeight: 1.5 }}>Always-on monitoring catches new compliance regressions before Google does.</p>
            </div>
            <div className="feature-card" style={{ padding: "18px" }}>
              <div style={{ fontSize: "22px", marginBottom: "6px" }}>🖼️</div>
              <p style={{ margin: "0 0 4px 0", fontWeight: 700, fontSize: "14px", color: "#212121" }}>Fix rejections</p>
              <p style={{ margin: 0, fontSize: "13px", color: "#6b7280", lineHeight: 1.5 }}>AI cleans up the product images Google rejects — white background, no overlays.</p>
            </div>
            <div className="feature-card" style={{ padding: "18px" }}>
              <div style={{ fontSize: "22px", marginBottom: "6px" }}>📈</div>
              <p style={{ margin: "0 0 4px 0", fontWeight: 700, fontSize: "14px", color: "#212121" }}>Win in Search</p>
              <p style={{ margin: 0, fontSize: "13px", color: "#6b7280", lineHeight: 1.5 }}>Accurate structured data unlocks rich results and stronger approval rates.</p>
            </div>
          </div>

          {/* Tool cards */}
          <div className="feature-cards-grid">
            {TOOLS.map(t => (
              <div className="feature-card" key={t.key}>
                <div className="feature-card-header">
                  <div className="feature-card-icon">{t.icon}</div>
                  <h3 className="feature-card-title">{t.title}</h3>
                </div>
                <p style={{ margin: "0 0 4px 0", fontSize: "12px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                  {t.subtitle}
                </p>
                <p className="feature-card-description" style={{ marginTop: "8px" }}>{t.desc}</p>
                <button className="feature-card-button" onClick={() => setActive(active === t.key ? null : t.key)}
                  style={active === t.key ? { background: "#0055a8" } : undefined}>
                  {active === t.key ? "▼ Open Below" : t.cta}
                </button>
              </div>
            ))}
          </div>

          {/* Active tool panel */}
          {activeMeta && (
            <div className="intro-card" style={{ marginTop: "4px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
                <span style={{ fontSize: "22px" }}>{activeMeta.icon}</span>
                <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: "#212121" }}>{activeMeta.title}</h3>
              </div>
              {active === "monitoring" && <MonitoringPanel />}
              {active === "imagefix" && <ImageFixerPanel credits={credits} />}
              {active === "schema" && <AutoSchemaPanel shop={shop} apiKey={apiKey} />}
            </div>
          )}

        </div>
      </Page>
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error) ? error.data : error instanceof Error ? error.message : "An unexpected error occurred.";
  return (
    <div className="landing-page">
      <Page fullWidth>
        <div className="landing-container">
          <div className="intro-card" style={{ textAlign: "center" }}>
            <h2 className="intro-heading">Something Went Wrong</h2>
            <p className="intro-paragraph">{message}</p>
          </div>
        </div>
      </Page>
    </div>
  );
}
