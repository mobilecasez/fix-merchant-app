import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useRouteError, isRouteErrorResponse } from "@remix-run/react";
import { Page, Spinner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useState, useEffect, useCallback, useRef } from "react";
import { getOrCreateSubscription, getProductsUsed, getEffectiveProductLimit } from "../utils/billing.server";
import "../styles/dashboard.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  try {
    const settings = await prisma.appSettings.findUnique({ where: { shop: session.shop } });
    if (!settings?.storeErrorReportEnabled) {
      throw new Response("This page is not enabled", { status: 403 });
    }

    const subscription = await getOrCreateSubscription(session.shop);
    const productsUsed = getProductsUsed(subscription);
    const productLimit = getEffectiveProductLimit(subscription);

    const review = await prisma.shopReview.findUnique({ where: { shop: session.shop } });

    let latestScan = null;
    try {
      latestScan = await (prisma as any).storeScan.findFirst({
        where: { shop: session.shop },
        orderBy: { createdAt: "desc" },
      });
    } catch (e) {
      console.warn("[store-error-report] storeScan query failed:", e);
    }

    const savedDetails = (settings?.storeDetails as Record<string, string>) || {};
    return json({ productsUsed, productLimit, latestScan, review, savedDetails });
  } catch (error) {
    if (error instanceof Response) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[app.store-error-report loader]", msg);
    throw new Response(`Loader error: ${msg}`, { status: 500 });
  }
};

// ── Plan details data ─────────────────────────────────────────────────────────

const PLAN_DETAILS = {
  basic: {
    icon: "🔍",
    title: "Basic Scan",
    subtitle: "Store Fundamentals & Legal Compliance",
    credits: 10,
    creditLabel: "Low — Store-level crawling only",
    audience: "New stores setting up their foundations or merchants running routine, lightweight weekly health checks.",
    errors: [
      {
        heading: "Missing Essential Pages",
        detail: "Checks for the presence of a Privacy Policy, Terms of Service, Contact Us, Shipping Policy, and Returns/Refunds page in the store's main navigation or footer.",
      },
      {
        heading: "Missing Contact Info",
        detail: "Flags if the store lacks a physical address, support email, or reachable phone number.",
      },
      {
        heading: "Store-Level Broken Links",
        detail: "Scans the main navigation and footer to ensure foundational pages don't return 404 errors.",
      },
    ],
    fixes: [
      "A straightforward checklist highlighting exactly which pages or links need to be created and linked properly in the Shopify theme.",
    ],
  },
  advanced: {
    icon: "🔬",
    title: "Advanced Scan",
    subtitle: "Product Feed Data & Accuracy",
    credits: 20,
    creditLabel: "Medium — Requires looping through product data",
    audience: "Active merchants preparing for sales, managing large catalogs, or dealing with product disapprovals.",
    errors: [
      {
        heading: "Everything in Basic Scan",
        detail: "Includes all store-level fundamental and legal compliance checks.",
      },
      {
        heading: "Basic Feed Syntax Errors",
        detail: "Identifies products missing mandatory fundamental attributes such as Title, ID, Link, or Description.",
      },
      {
        heading: "Missing Product Identifiers",
        detail: "Scans the feed for missing or invalid Global Trade Item Numbers (GTINs), Manufacturer Part Numbers (MPNs), or Brand attributes.",
      },
      {
        heading: "Deceptive Pricing Logic",
        detail: "Validates that the Compare-at Price (MRP) is strictly greater than the Sale Price, and crawls product pages to ensure the final price and stock status match the feed exactly.",
      },
      {
        heading: "Image Violations",
        detail: "Detects images that are too small, contain promotional text overlays, or feature watermarks.",
      },
      {
        heading: "Tax & Shipping Gaps",
        detail: "Checks if shipping weights or rates are missing from the feed or logically conflict with the store's default shipping zones.",
      },
    ],
    fixes: [
      "A list of specific product IDs/variants causing syntax or pricing errors, with direct links to edit them in the Shopify admin.",
      "Flags for non-compliant images, allowing the merchant to update the media files.",
      "Guidance on updating missing GTINs/MPNs to get products approved.",
    ],
  },
  deep: {
    icon: "🧠",
    title: "Deep Scan",
    subtitle: "Misrepresentation & Checkout Audit",
    credits: 30,
    creditLabel: "High — Intensive scraping and simulated checkout",
    audience: "High-volume merchants, agencies, or stores actively trying to appeal a GMC suspension.",
    errors: [
      {
        heading: "Everything in Advanced Scan",
        detail: "Includes all basic and advanced compliance checks across store fundamentals and product feed data.",
      },
      {
        heading: "Schema Markup (Structured Data) Audit",
        detail: "Validates the JSON-LD / schema.org markup in the background of Shopify product pages. Flags mismatches between the hidden code and the visual price.",
      },
      {
        heading: "Deceptive Practices & False Scarcity",
        detail: "Detects aggressive pop-ups, fake countdown timers, or unverified 'buy now' urgency badges that trigger Google's trust bots.",
      },
      {
        heading: "Checkout Flow & Hidden Fees",
        detail: "Simulates a cart addition to check for hidden surcharges at checkout or shipping costs that contradict the product page.",
      },
      {
        heading: "Business Identity Mismatches",
        detail: "Cross-references the business name and domain against the contact page to ensure perfect alignment.",
      },
    ],
    fixes: [
      "A comprehensive, exportable remediation report.",
      "Identification of specific third-party Shopify apps (like aggressive timer apps or faulty schema apps) that need to be paused or fixed.",
      "Step-by-step guidance on aligning Shopify's shipping and tax settings perfectly with the Merchant Center backend.",
    ],
  },
} as const;

type PlanKey = keyof typeof PLAN_DETAILS;

// ── Plan Details Modal ────────────────────────────────────────────────────────

function PlanDetailsModal({ planKey, onClose }: { planKey: PlanKey; onClose: () => void }) {
  const plan = PLAN_DETAILS[planKey];
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 9999, padding: "16px",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "white", borderRadius: "14px", padding: "0",
        maxWidth: "580px", width: "100%", maxHeight: "88vh", overflowY: "auto",
        boxShadow: "0 24px 64px rgba(0,0,0,0.25)",
      }}>
        {/* Header */}
        <div style={{
          background: "linear-gradient(135deg,#1a4a5a,#2A5B6D)",
          borderRadius: "14px 14px 0 0", padding: "24px 28px 20px",
          color: "white",
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
            <div>
              <div style={{ fontSize: "32px", marginBottom: "6px" }}>{plan.icon}</div>
              <h2 style={{ margin: "0 0 4px 0", fontSize: "20px", fontWeight: 700 }}>{plan.title}</h2>
              <p style={{ margin: 0, fontSize: "14px", opacity: 0.85, fontWeight: 500 }}>{plan.subtitle}</p>
            </div>
            <button
              onClick={onClose}
              style={{
                background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "6px",
                color: "white", fontSize: "18px", cursor: "pointer", padding: "4px 10px",
                lineHeight: 1, flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>
          <div style={{ display: "flex", gap: "20px", marginTop: "16px", flexWrap: "wrap" }}>
            <div>
              <p style={{ margin: "0 0 2px 0", fontSize: "10px", fontWeight: 700, opacity: 0.7, textTransform: "uppercase", letterSpacing: "0.6px" }}>Credit Cost</p>
              <p style={{ margin: 0, fontSize: "13px", fontWeight: 600 }}>
                <span style={{
                  background: "rgba(255,255,255,0.2)", padding: "2px 8px",
                  borderRadius: "4px", marginRight: "6px", fontSize: "12px",
                }}>{plan.credits} Credits</span>
                {plan.creditLabel}
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "24px 28px" }}>
          {/* Target Audience */}
          <div style={{
            background: "#f0f9ff", border: "1px solid #bae6fd",
            borderRadius: "8px", padding: "14px 16px", marginBottom: "24px",
          }}>
            <p style={{ margin: "0 0 4px 0", fontSize: "11px", fontWeight: 700, color: "#0369a1", textTransform: "uppercase", letterSpacing: "0.6px" }}>Target Audience</p>
            <p style={{ margin: 0, fontSize: "13px", color: "#0c4a6e", lineHeight: 1.6 }}>{plan.audience}</p>
          </div>

          {/* Errors Identified */}
          <div style={{ marginBottom: "24px" }}>
            <h3 style={{ margin: "0 0 14px 0", fontSize: "15px", fontWeight: 700, color: "#212121", display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ color: "#d72c0d" }}>⚠</span> Errors Identified
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {plan.errors.map((err, i) => (
                <div key={i} style={{
                  borderLeft: "3px solid #fca5a5", paddingLeft: "12px",
                }}>
                  <p style={{ margin: "0 0 3px 0", fontSize: "13px", fontWeight: 700, color: "#212121" }}>{err.heading}</p>
                  <p style={{ margin: 0, fontSize: "13px", color: "#555", lineHeight: 1.6 }}>{err.detail}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Fixes Provided */}
          <div>
            <h3 style={{ margin: "0 0 14px 0", fontSize: "15px", fontWeight: 700, color: "#212121", display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ color: "#12a04a" }}>✓</span> Fixes Provided
            </h3>
            <ul style={{ margin: 0, paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "8px" }}>
              {plan.fixes.map((fix, i) => (
                <li key={i} style={{ fontSize: "13px", color: "#374151", lineHeight: 1.6 }}>{fix}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── helpers ────────────────────────────────────────────────────────────────────

function severityColor(s: string) {
  if (s === "High") return "#d72c0d";
  if (s === "Medium") return "#b98900";
  return "#637381";
}

function severityLabel(s: string) {
  if (s === "High") return { bg: "#fef2f2", color: "#d72c0d", border: "#fca5a5" };
  if (s === "Medium") return { bg: "#fffbeb", color: "#92400e", border: "#fcd34d" };
  return { bg: "#f0f9ff", color: "#0369a1", border: "#7dd3fc" };
}

function riskStyle(r: string) {
  if (r === "High") return { bg: "#fef2f2", color: "#d72c0d", border: "#fca5a5" };
  if (r === "Medium") return { bg: "#fffbeb", color: "#92400e", border: "#fcd34d" };
  return { bg: "#f0fdf4", color: "#166534", border: "#86efac" };
}

function SeverityBadge({ severity }: { severity: string }) {
  const s = severityLabel(severity);
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: "4px",
      fontSize: "11px",
      fontWeight: 700,
      background: s.bg,
      color: s.color,
      border: `1px solid ${s.border}`,
      flexShrink: 0,
    }}>
      {severity}
    </span>
  );
}

// Per-issue auto-fix state
interface IssueFixState {
  confirming: boolean;
  fixing: boolean;
  fixed: boolean;
  error: string;
  verifyUrl?: string;
  creditsCharged?: number;
  fixSummary?: string;
}

// Store details collected before running auto-fix
interface StoreDetails {
  storeName: string;
  contactEmail: string;
  contactPhone: string;
  businessAddress: string;
  returnWindowDays: string;
  shippingEstimate: string;
  shippingCost: string;
  aboutDescription: string;
}

// Which fix types need store details before proceeding
const FIX_TYPES_NEEDING_DETAILS = new Set([
  "privacy_policy", "refund_policy", "shipping_policy",
  "terms_of_service", "contact_page", "about_page", "business_contact",
]);

// Fields shown per fix type
const DETAILS_FIELDS: Record<string, { key: keyof StoreDetails; label: string; placeholder: string; required: boolean }[]> = {
  privacy_policy: [
    { key: "storeName",       label: "Business / Store Name",  placeholder: "e.g. Acme Store",              required: true  },
    { key: "contactEmail",    label: "Contact Email",           placeholder: "e.g. support@acmestore.com",   required: true  },
    { key: "businessAddress", label: "Business Address",        placeholder: "e.g. 123 Main St, City, Country", required: false },
  ],
  refund_policy: [
    { key: "storeName",        label: "Business / Store Name",  placeholder: "e.g. Acme Store",              required: true  },
    { key: "contactEmail",     label: "Contact Email",          placeholder: "e.g. support@acmestore.com",   required: true  },
    { key: "returnWindowDays", label: "Return Window (days)",   placeholder: "e.g. 30",                      required: true  },
  ],
  shipping_policy: [
    { key: "storeName",        label: "Business / Store Name",  placeholder: "e.g. Acme Store",              required: true  },
    { key: "shippingEstimate", label: "Estimated Delivery Time",placeholder: "e.g. 5–10 business days",      required: true  },
    { key: "shippingCost",     label: "Shipping Cost / Policy", placeholder: "e.g. Free over $50, else $5.99", required: true },
  ],
  terms_of_service: [
    { key: "storeName",       label: "Business / Store Name",  placeholder: "e.g. Acme Store",              required: true  },
    { key: "contactEmail",    label: "Contact Email",           placeholder: "e.g. support@acmestore.com",   required: true  },
    { key: "businessAddress", label: "Business Address",        placeholder: "e.g. 123 Main St, City, Country", required: false },
  ],
  contact_page: [
    { key: "storeName",       label: "Business / Store Name",  placeholder: "e.g. Acme Store",              required: true  },
    { key: "contactEmail",    label: "Contact Email",           placeholder: "e.g. support@acmestore.com",   required: true  },
    { key: "contactPhone",    label: "Phone Number (optional)", placeholder: "e.g. +1 800 123 4567",         required: false },
    { key: "businessAddress", label: "Business Address",        placeholder: "e.g. 123 Main St, City, Country", required: false },
  ],
  about_page: [
    { key: "storeName",        label: "Business / Store Name",  placeholder: "e.g. Acme Store",              required: true  },
    { key: "aboutDescription", label: "What does your store sell / stand for?", placeholder: "e.g. We sell eco-friendly home goods focused on sustainability", required: true },
    { key: "contactEmail",     label: "Contact Email",          placeholder: "e.g. support@acmestore.com",   required: false },
  ],
  business_contact: [
    { key: "storeName",       label: "Business / Store Name",   placeholder: "e.g. Acme Store",                 required: true  },
    { key: "contactEmail",    label: "Contact Email",            placeholder: "e.g. support@acmestore.com",      required: true  },
    { key: "contactPhone",    label: "Phone Number (optional)",  placeholder: "e.g. +1 800 123 4567",            required: false },
    { key: "businessAddress", label: "Business Address (optional)", placeholder: "e.g. 123 Main St, City, Country", required: false },
    { key: "aboutDescription", label: "What does your store sell?", placeholder: "e.g. Premium eco-friendly home goods", required: false },
  ],
};

// Issue types that must be fixed before footer_links can be applied
const FOOTER_DEPS = new Set(["privacy_policy", "refund_policy", "shipping_policy", "terms_of_service", "contact_page", "about_page"]);

const EMPTY_DETAILS: StoreDetails = {
  storeName: "", contactEmail: "", contactPhone: "",
  businessAddress: "", returnWindowDays: "30",
  shippingEstimate: "", shippingCost: "", aboutDescription: "",
};

// ── Store Details Modal ────────────────────────────────────────────────────────
function StoreDetailsModal({
  autoFixType,
  creditCost,
  savedDetails,
  onConfirm,
  onCancel,
}: {
  autoFixType: string;
  creditCost: number;
  savedDetails: Partial<StoreDetails>;
  onConfirm: (details: StoreDetails) => void;
  onCancel: () => void;
}) {
  const fields = DETAILS_FIELDS[autoFixType] || [];
  const [values, setValues] = useState<StoreDetails>({ ...EMPTY_DETAILS, ...savedDetails });
  const [errors, setErrors] = useState<Partial<Record<keyof StoreDetails, string>>>({});

  const missingRequired = fields.filter(f => f.required && !values[f.key]?.trim());
  const allSaved = missingRequired.length === 0;

  const handleSubmit = () => {
    const newErrors: typeof errors = {};
    fields.forEach(f => {
      if (f.required && !values[f.key]?.trim()) newErrors[f.key] = "This field is required";
    });
    if (Object.keys(newErrors).length) { setErrors(newErrors); return; }
    onConfirm(values);
  };

  const titleMap: Record<string, string> = {
    privacy_policy: "Privacy Policy", refund_policy: "Refund & Return Policy",
    shipping_policy: "Shipping Policy", terms_of_service: "Terms of Service",
    contact_page: "Contact Us Page", about_page: "About Us Page",
    business_contact: "Business Name & Contact Info",
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 9999, padding: "16px",
    }}>
      <div style={{
        background: "white", borderRadius: "12px", padding: "28px",
        maxWidth: "520px", width: "100%", maxHeight: "90vh", overflowY: "auto",
        boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
          <span style={{ fontSize: "24px" }}>🏪</span>
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "#212121" }}>
            Store Details for {titleMap[autoFixType] || "Auto Fix"}
          </h2>
        </div>
        <p style={{ margin: "0 0 4px 0", fontSize: "13px", color: "#666", lineHeight: 1.5 }}>
          {allSaved
            ? "Your saved details are pre-filled below. Update any field if needed, then confirm."
            : "Fill in your store details — they'll be saved so you don't have to re-enter them for future fixes."}
        </p>
        {allSaved && (
          <p style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#12a04a", fontWeight: 600 }}>
            ✓ All required fields already saved — click confirm to proceed instantly.
          </p>
        )}
        {!allSaved && <div style={{ marginBottom: "16px" }} />}

        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {fields.map(field => (
            <div key={field.key}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "4px" }}>
                {field.label} {field.required && <span style={{ color: "#d72c0d" }}>*</span>}
                {values[field.key]?.trim() && <span style={{ marginLeft: "6px", fontSize: "11px", color: "#12a04a", fontWeight: 400 }}>✓ saved</span>}
              </label>
              <input
                type="text"
                value={values[field.key]}
                onChange={e => { setValues(v => ({ ...v, [field.key]: e.target.value })); setErrors(ev => ({ ...ev, [field.key]: "" })); }}
                placeholder={field.placeholder}
                style={{
                  width: "100%", boxSizing: "border-box", padding: "9px 12px",
                  border: `1px solid ${errors[field.key] ? "#fca5a5" : values[field.key]?.trim() ? "#86efac" : "#d1d5db"}`,
                  borderRadius: "6px", fontSize: "13px", outline: "none",
                }}
              />
              {errors[field.key] && <p style={{ margin: "3px 0 0 0", fontSize: "12px", color: "#d72c0d" }}>{errors[field.key]}</p>}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: "10px", marginTop: "24px" }}>
          <button
            onClick={handleSubmit}
            style={{
              flex: 1, padding: "10px", background: "#1a4a5a", color: "white",
              border: "none", borderRadius: "6px", fontSize: "14px", fontWeight: 600,
              cursor: "pointer",
            }}
          >
            ⚡ Generate & Apply Fix ({creditCost} credits)
          </button>
          <button
            onClick={onCancel}
            style={{
              padding: "10px 16px", background: "white", color: "#374151",
              border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "14px",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function IssueCard({
  issue,
  issueKey,
  scanId,
  fixStates,
  setFixStates,
  credits,
  allIssues,
  savedDetails,
  onDetailsSaved,
}: {
  issue: any;
  issueKey: string;
  scanId: string;
  fixStates: Map<string, IssueFixState>;
  setFixStates: React.Dispatch<React.SetStateAction<Map<string, IssueFixState>>>;
  credits: number;
  allIssues: any[];
  savedDetails: Partial<StoreDetails>;
  onDetailsSaved: (details: StoreDetails) => void;
}) {
  const [stepsOpen, setStepsOpen] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const autoFixFetcher = useFetcher<{ success?: boolean; error?: string; verifyUrl?: string; creditsCharged?: number }>();
  const rawState = fixStates.get(issueKey) || { confirming: false, fixing: false, fixed: false, error: "" };
  const isFetcherLoading = autoFixFetcher.state !== "idle";
  const state = { ...rawState, fixing: rawState.fixing || isFetcherLoading };
  const needsDetails = FIX_TYPES_NEEDING_DETAILS.has(issue.auto_fix_type);

  // For footer_links: check if all dependency issues are fixed
  const footerDepsUnfixed: string[] = issue.auto_fix_type === "footer_links"
    ? allIssues
        .filter((i: any) => FOOTER_DEPS.has(i.auto_fix_type) && i.auto_fixable)
        .filter((i: any) => {
          const key = i.auto_fix_type;
          const s = fixStates.get(key);
          return !s?.fixed;
        })
        .map((i: any) => {
          const labels: Record<string, string> = {
            privacy_policy: "Privacy Policy", refund_policy: "Refund Policy",
            shipping_policy: "Shipping Policy", terms_of_service: "Terms of Service",
            contact_page: "Contact Page", about_page: "About Us Page",
          };
          return labels[i.auto_fix_type] || i.auto_fix_type;
        })
    : [];

  const updateState = (patch: Partial<IssueFixState>) => {
    setFixStates(prev => {
      const next = new Map(prev);
      next.set(issueKey, { ...state, ...patch });
      return next;
    });
  };

  const FIX_SUMMARIES: Record<string, string> = {
    privacy_policy: "AI-generated Privacy Policy page created. A redirect from /policies/privacy-policy is set up automatically.",
    refund_policy: "AI-generated Refund & Return Policy page created. A redirect from /policies/refund-policy is set up automatically.",
    shipping_policy: "AI-generated Shipping Policy page created. A redirect from /policies/shipping-policy is set up automatically.",
    terms_of_service: "AI-generated Terms of Service page created. A redirect from /policies/terms-of-service is set up automatically.",
    contact_page: "Contact Us page created (or updated) with business contact details.",
    about_page: "About Us page created (or updated) with store description and trust content.",
    page_meta: "Homepage meta description updated with an SEO-optimized description.",
    footer_links: "All required GMC policy links added to your store's footer navigation menu.",
    business_contact: "Business name and contact details updated across all policy pages, About Us, Contact page, and footer — ensuring consistent business identity sitewide.",
  };

  const handleAutoFix = (storeDetails?: StoreDetails) => {
    updateState({ fixing: true, error: "" });
    setShowModal(false);
    autoFixFetcher.submit(
      {
        autoFixType: issue.auto_fix_type,
        issueDescription: issue.issue_description || issue.label || "",
        scanId,
        creditCost: issue.credit_cost,
        storeDetails: storeDetails || null,
      } as any,
      { method: "post", action: "/api/store-scan/auto-fix", encType: "application/json" }
    );
  };

  // Track whether we've submitted so we can detect idle-with-no-data (network failure)
  const hasSubmitted = useRef(false);

  // Handle fetcher response
  useEffect(() => {
    if (autoFixFetcher.state === "submitting" || autoFixFetcher.state === "loading") {
      hasSubmitted.current = true;
      return;
    }
    if (autoFixFetcher.state !== "idle") return;
    if (!hasSubmitted.current) return; // not yet submitted — ignore initial idle

    const data = autoFixFetcher.data;
    if (!data) {
      // Fetcher went idle with no data = network/server failure
      updateState({ fixing: false, confirming: false, error: "Request failed. Please try again." });
      hasSubmitted.current = false;
      return;
    }
    hasSubmitted.current = false;
    if (data.success) {
      updateState({
        fixing: false, fixed: true, confirming: false, error: "",
        verifyUrl: data.verifyUrl,
        creditsCharged: data.creditsCharged,
        fixSummary: FIX_SUMMARIES[issue.auto_fix_type] || "Fix applied to your store.",
      });
    } else {
      updateState({ fixing: false, confirming: false, error: data.error || "Auto-fix failed. Please try again." });
    }
  }, [autoFixFetcher.state, autoFixFetcher.data]);

  const steps: string[] = Array.isArray(issue.detailed_fix_steps) ? issue.detailed_fix_steps : [];
  const creditCost = issue.credit_cost ?? 1;

  return (
    <div style={{
      borderLeft: `3px solid ${severityColor(issue.severity || "Low")}`,
      paddingLeft: "14px",
      marginBottom: "20px",
      opacity: state.fixed ? 0.6 : 1,
    }}>
      {/* Top row: badge + description + auto-fix button */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", flexWrap: "wrap", marginBottom: "6px" }}>
        <SeverityBadge severity={issue.severity || "Low"} />
        <p style={{ margin: 0, fontSize: "14px", color: "#212121", fontWeight: 600, lineHeight: 1.5, flex: 1 }}>
          {issue.issue_description || issue.message || issue.label || ""}
          {issue.url ? <span style={{ fontWeight: 400, color: "#555", marginLeft: "6px" }}>— <a href={issue.url} target="_blank" rel="noreferrer" style={{ color: "#006ECB" }}>{issue.url}</a></span> : null}
        </p>
        {issue.auto_fixable && !state.fixed && (() => {
          const depsBlocked = footerDepsUnfixed.length > 0;
          const notEnoughCredits = credits < creditCost;
          const isDisabled = state.fixing || state.confirming || notEnoughCredits || depsBlocked;
          const btnBg = depsBlocked ? "#fef9c3" : notEnoughCredits ? "#e5e7eb" : "#eff6ff";
          const btnColor = depsBlocked ? "#92400e" : notEnoughCredits ? "#999" : "#1d4ed8";
          const btnBorder = depsBlocked ? "#fcd34d" : notEnoughCredits ? "#d1d5db" : "#bfdbfe";
          const btnTitle = depsBlocked
            ? `Fix these issues first: ${footerDepsUnfixed.join(", ")}`
            : notEnoughCredits ? `Need ${creditCost} credits` : `Fix with AI (${creditCost} credits)`;
          return (
            <button
              onClick={() => { if (depsBlocked) return; needsDetails ? setShowModal(true) : updateState({ confirming: true }); }}
              disabled={isDisabled}
              style={{
                display: "inline-flex", alignItems: "center", gap: "6px",
                padding: "5px 12px", background: btnBg, color: btnColor,
                border: `1px solid ${btnBorder}`, borderRadius: "6px",
                fontSize: "13px", fontWeight: 600,
                cursor: isDisabled ? "not-allowed" : "pointer", flexShrink: 0,
              }}
              title={btnTitle}
            >
              {depsBlocked ? "🔒" : "⚡"} Auto Fix with AI
              <span style={{
                display: "inline-block", padding: "1px 6px",
                background: depsBlocked ? "#fef08a" : "#dbeafe",
                color: depsBlocked ? "#92400e" : "#1d4ed8",
                borderRadius: "10px", fontSize: "11px", fontWeight: 700,
              }}>
                {creditCost}
              </span>
            </button>
          );
        })()}
        {state.fixed && (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: "4px",
            padding: "4px 10px", background: "#f0fdf4", color: "#166534",
            border: "1px solid #86efac", borderRadius: "6px", fontSize: "13px", fontWeight: 600,
          }}>
            ✓ Fixed
          </span>
        )}
      </div>

      {/* Suggested fix */}
      {issue.suggested_fix && (
        <p style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#666666", lineHeight: 1.5 }}>
          💡 {issue.suggested_fix}
        </p>
      )}

      {/* Collapsible fix steps */}
      {steps.length > 0 && (
        <div style={{ marginBottom: "8px" }}>
          <button
            onClick={() => setStepsOpen(v => !v)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 600,
              color: "#006ECB",
              padding: 0,
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            {stepsOpen ? "▾" : "▸"} Fix Steps ({steps.length})
          </button>
          {stepsOpen && (
            <ol style={{ margin: "8px 0 0 0", paddingLeft: "20px", color: "#444", fontSize: "13px", lineHeight: 1.8 }}>
              {steps.map((step: string, idx: number) => (
                <li key={idx}>{step}</li>
              ))}
            </ol>
          )}
        </div>
      )}

      {/* Store details modal */}
      {showModal && (
        <StoreDetailsModal
          autoFixType={issue.auto_fix_type}
          creditCost={creditCost}
          savedDetails={savedDetails}
          onConfirm={(details) => { onDetailsSaved(details); handleAutoFix(details); }}
          onCancel={() => setShowModal(false)}
        />
      )}

      {/* Confirmation dialog (inline) — only for fixes that don't need store details */}
      {state.confirming && !state.fixing && !needsDetails && (
        <div style={{
          padding: "12px 16px",
          background: "#fffbeb",
          border: "1px solid #fcd34d",
          borderRadius: "6px",
          marginTop: "8px",
        }}>
          <p style={{ margin: "0 0 10px 0", fontSize: "13px", color: "#92400e", fontWeight: 600 }}>
            ⚠️ This will use {creditCost} credit{creditCost !== 1 ? "s" : ""} and automatically apply the fix to your store. Proceed?
          </p>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              className="feature-card-button"
              style={{ width: "auto", padding: "6px 16px", fontSize: "13px" }}
              onClick={() => handleAutoFix()}
            >
              Confirm Fix
            </button>
            <button
              className="tutorial-button"
              style={{ padding: "6px 14px", fontSize: "13px" }}
              onClick={() => updateState({ confirming: false })}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Footer dependency warning */}
      {footerDepsUnfixed.length > 0 && !state.fixed && !state.fixing && (
        <div style={{
          marginTop: "10px", padding: "10px 14px",
          background: "#fef9c3", border: "1px solid #fcd34d",
          borderRadius: "8px",
        }}>
          <p style={{ margin: "0 0 6px 0", fontSize: "13px", fontWeight: 700, color: "#92400e" }}>
            🔒 Fix required issues first before adding footer links
          </p>
          <p style={{ margin: 0, fontSize: "12px", color: "#78350f", lineHeight: 1.6 }}>
            The following issues must be fixed first so all links actually exist on your store:
          </p>
          <ul style={{ margin: "6px 0 0 0", paddingLeft: "18px", fontSize: "12px", color: "#78350f", lineHeight: 1.8 }}>
            {footerDepsUnfixed.map((dep, i) => <li key={i}>{dep}</li>)}
          </ul>
        </div>
      )}

      {/* Fixing spinner */}
      {state.fixing && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px" }}>
          <Spinner size="small" />
          <span style={{ fontSize: "13px", color: "#555" }}>Applying fix…</span>
        </div>
      )}

      {/* Error message */}
      {state.error && (
        <p style={{ margin: "6px 0 0 0", fontSize: "13px", color: "#d72c0d" }}>
          ✕ {state.error}
        </p>
      )}

      {/* Fixed success */}
      {state.fixed && (
        <div style={{
          marginTop: "10px",
          padding: "12px 16px",
          background: "#f0fdf4",
          border: "1px solid #86efac",
          borderRadius: "8px",
        }}>
          <p style={{ margin: "0 0 6px 0", fontSize: "13px", fontWeight: 700, color: "#166534" }}>
            ✅ Fix Applied Successfully
            {state.creditsCharged ? (
              <span style={{ marginLeft: "8px", fontWeight: 400, fontSize: "12px", color: "#555" }}>
                ({state.creditsCharged} credit{state.creditsCharged !== 1 ? "s" : ""} used)
              </span>
            ) : null}
          </p>
          {state.fixSummary && (
            <p style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#14532d", lineHeight: 1.5 }}>
              {state.fixSummary}
            </p>
          )}
          {state.verifyUrl && (
            <a
              href={state.verifyUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                fontSize: "13px",
                fontWeight: 600,
                color: "#166534",
                background: "white",
                border: "1px solid #86efac",
                borderRadius: "5px",
                padding: "5px 12px",
                textDecoration: "none",
              }}
            >
              🔗 View on your store →
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function ScanResults({
  scan,
  credits,
  fixStates,
  setFixStates,
  savedDetails,
  onDetailsSaved,
}: {
  scan: any;
  credits: number;
  fixStates: Map<string, IssueFixState>;
  setFixStates: React.Dispatch<React.SetStateAction<Map<string, IssueFixState>>>;
  savedDetails: Partial<StoreDetails>;
  onDetailsSaved: (details: StoreDetails) => void;
}) {
  const result = scan.result as any;
  const summary = result?.scan_summary;
  const risk = summary?.overall_risk || "Medium";
  const rs = riskStyle(risk);

  // Flat list of all auto-fixable issues across all sections (used for footer dependency check)
  const allAutoFixableIssues: any[] = [
    ...(result?.missing_pages || []).map((p: any) => ({
      ...p, issue_description: `${p.label} — ${p.url}`,
    })),
    ...(result?.merchant_center_compliance || []),
    ...(result?.customer_trust_and_policy || []),
    ...(result?.site_structure_and_seo || []),
  ].filter((i: any) => i.auto_fixable);

  const renderSection = (title: string, issues: any[], prefix: string, isMissingPages = false, isBrokenLinks = false) => {
    const normalizedIssues = isMissingPages
      ? (issues || []).map((p: any) => ({
          issue_description: `${p.label} — ${p.url}`,
          severity: p.severity || "High",
          suggested_fix: p.suggested_fix,
          detailed_fix_steps: p.detailed_fix_steps,
          auto_fixable: p.auto_fixable,
          auto_fix_type: p.auto_fix_type,
          credit_cost: p.credit_cost,
          url: p.url,
          label: p.label,
        }))
      : isBrokenLinks
      ? (issues || []).map((l: any) => ({
          issue_description: l.url,
          severity: "High",
          suggested_fix: l.suggested_fix,
          detailed_fix_steps: l.detailed_fix_steps,
          auto_fixable: l.auto_fixable,
          auto_fix_type: l.auto_fix_type,
          credit_cost: l.credit_cost,
        }))
      : (issues || []);

    if (!normalizedIssues.length) {
      return (
        <div className="intro-card" style={{ marginBottom: 0 }}>
          <h3 style={{ margin: "0 0 16px 0", fontSize: "16px", fontWeight: 700, color: "#212121" }}>{title}</h3>
          <p style={{ color: "#12a04a", fontSize: "14px", margin: 0 }}>✓ No issues found in this category.</p>
        </div>
      );
    }

    return (
      <div className="intro-card" style={{ marginBottom: 0 }}>
        <h3 style={{ margin: "0 0 16px 0", fontSize: "16px", fontWeight: 700, color: "#212121" }}>{title}</h3>
        {normalizedIssues.map((issue: any, i: number) => {
          const issueKey = issue.auto_fixable && issue.auto_fix_type ? issue.auto_fix_type : `${prefix}-${i}`;
          return (
          <IssueCard
            key={issueKey}
            issue={issue}
            issueKey={issueKey}
            scanId={scan.id}
            fixStates={fixStates}
            setFixStates={setFixStates}
            credits={credits}
            allIssues={allAutoFixableIssues}
            savedDetails={savedDetails}
            onDetailsSaved={onDetailsSaved}
          />
          );
        })}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Summary */}
      {summary && (
        <div className="intro-card" style={{ marginBottom: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "#212121" }}>Scan Summary</h3>
            <span style={{
              padding: "3px 10px", borderRadius: "4px", fontSize: "12px", fontWeight: 700,
              background: rs.bg, color: rs.color, border: `1px solid ${rs.border}`,
            }}>
              {risk} Risk
            </span>
          </div>
          <div style={{ display: "flex", gap: "32px", flexWrap: "wrap" }}>
            {[
              { label: "Pages Scanned", value: summary.pages_scanned ?? "—", critical: false },
              { label: "Missing Required Pages", value: summary.pages_missing ?? "—", critical: summary.pages_missing > 0 },
              { label: "Broken Links", value: summary.broken_links_found ?? "—", critical: summary.broken_links_found > 0 },
              { label: "Scanned On", value: new Date(scan.updatedAt).toLocaleString(), critical: false },
            ].map((item) => (
              <div key={item.label}>
                <p style={{ margin: "0 0 4px 0", fontSize: "12px", color: "#666666", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>{item.label}</p>
                <p style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: item.critical ? "#d72c0d" : "#212121" }}>{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {result?.missing_pages?.length > 0 && renderSection("Missing Required Pages", result.missing_pages, "missing", true)}
      {result?.broken_links?.length > 0 && renderSection("Broken Links", result.broken_links, "broken", false, true)}
      {renderSection("Google Merchant Center Compliance", result?.merchant_center_compliance, "gmc")}
      {renderSection("Customer Trust & Policy Pages", result?.customer_trust_and_policy, "trust")}
      {renderSection("Site Structure & SEO", result?.site_structure_and_seo, "seo")}
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function StoreErrorReport() {
  const { productsUsed, productLimit, latestScan: initialScan, review: initialReview, savedDetails: initialSavedDetails } = useLoaderData<typeof loader>();

  const [scan, setScan] = useState<any>(initialScan);
  const [error, setError] = useState<string | null>(null);
  const [emailStatus, setEmailStatus] = useState<{ msg: string; ok: boolean } | null>(null);
  const [reviewBannerDismissed, setReviewBannerDismissed] = useState(initialReview?.dismissed || false);
  const [userRating, setUserRating] = useState<number | null>(initialReview?.rating || null);
  const [showRatingThankYou, setShowRatingThankYou] = useState(false);
  const [fixStates, setFixStates] = useState<Map<string, IssueFixState>>(new Map());
  const [savedDetails, setSavedDetails] = useState<Partial<StoreDetails>>(initialSavedDetails || {});
  const [activePlanModal, setActivePlanModal] = useState<PlanKey | null>(null);
  const detailsFetcher = useFetcher();
  const [storePassword, setStorePassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);

  const actionFetcher = useFetcher();
  const pollFetcher = useFetcher();
  const emailFetcher = useFetcher<{ success?: boolean; message?: string; error?: string }>();
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const isProcessing = scan?.status === "PENDING" || scan?.status === "PROCESSING";
  const needsPassword = scan?.status === "NEEDS_PASSWORD";
  const credits = productLimit - productsUsed;

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(() => { pollFetcher.load("/api/store-scan"); }, 4000);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => {
    if (!pollFetcher.data) return;
    const polled = (pollFetcher.data as any).scan;
    if (polled) {
      setScan(polled);
      if (polled.status === "COMPLETE" || polled.status === "FAILED") stopPolling();
    }
  }, [pollFetcher.data, stopPolling]);

  useEffect(() => {
    if (!actionFetcher.data) return;
    const data = actionFetcher.data as any;
    if (data.error) { setError(data.error); return; }
    if (data.scan) { setScan(data.scan); startPolling(); }
  }, [actionFetcher.data, startPolling]);

  useEffect(() => {
    if (isProcessing) startPolling();
    return () => stopPolling();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Hydrate fixStates from persisted applied_fixes when scan changes
  useEffect(() => {
    if (!scan?.result?.applied_fixes) return;
    const appliedFixes: Array<{ autoFixType: string; issueDescription?: string; appliedAt?: string }> = scan.result.applied_fixes;
    if (!appliedFixes.length) return;

    const FIX_SUMMARIES: Record<string, string> = {
      privacy_policy: "AI-generated Privacy Policy page created. A redirect from /policies/privacy-policy is set up automatically.",
      refund_policy: "AI-generated Refund & Return Policy page created. A redirect from /policies/refund-policy is set up automatically.",
      shipping_policy: "AI-generated Shipping Policy page created. A redirect from /policies/shipping-policy is set up automatically.",
      terms_of_service: "AI-generated Terms of Service page created. A redirect from /policies/terms-of-service is set up automatically.",
      contact_page: "Contact Us page created (or updated) with business contact details.",
      about_page: "About Us page created (or updated) with store description and trust content.",
      page_meta: "Homepage meta description updated with an SEO-optimized description.",
      footer_links: "All required GMC policy links added to your store's footer navigation menu.",
      business_contact: "Business name and contact details updated across all policy pages, About Us, Contact page, and footer — ensuring consistent business identity sitewide.",
    };

    setFixStates(prev => {
      const next = new Map(prev);
      appliedFixes.forEach(fix => {
        const key = fix.autoFixType;
        if (!next.has(key) || !next.get(key)?.fixed) {
          next.set(key, {
            confirming: false,
            fixing: false,
            fixed: true,
            error: "",
            fixSummary: FIX_SUMMARIES[fix.autoFixType] || "Fix applied to your store.",
          });
        }
      });
      return next;
    });
  }, [scan?.id, scan?.result?.applied_fixes]);

  const handleDetailsSaved = useCallback((details: StoreDetails) => {
    setSavedDetails(details);
    detailsFetcher.submit(
      { storeDetails: details } as any,
      { method: "post", action: "/api/store-details", encType: "application/json" }
    );
  }, [detailsFetcher]);

  const handleRunScan = useCallback((scanType: string) => {
    const cost = scanType === "BASIC" ? 10 : 0;
    if (credits < cost) {
      setError(`You need at least ${cost} credits. You have ${credits} remaining.`);
      return;
    }
    setError(null);
    // Only clear fix states when starting a brand-new scan
    setFixStates(new Map());
    const fd = new FormData();
    fd.append("scanType", scanType);
    actionFetcher.submit(fd, { method: "post", action: "/api/store-scan" });
  }, [credits, actionFetcher]);

  const handleSubmitPassword = useCallback(async () => {
    if (!storePassword.trim() || !scan?.id) return;
    setIsSubmittingPassword(true);
    setPasswordError(null);
    const fd = new FormData();
    fd.append("intent", "submit_password");
    fd.append("scanId", scan.id);
    fd.append("storePassword", storePassword.trim());
    try {
      const res = await fetch("/api/store-scan", { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok && data.scan) {
        setScan(data.scan);
        setStorePassword("");
        startPolling();
      } else {
        setPasswordError(data.error || "Incorrect password. Please try again.");
      }
    } catch {
      setPasswordError("Network error. Please try again.");
    } finally {
      setIsSubmittingPassword(false);
    }
  }, [storePassword, scan, startPolling]);

  // Handle email fetcher response
  useEffect(() => {
    if (!emailFetcher.data) return;
    if (emailFetcher.data.success) {
      setEmailStatus({ msg: emailFetcher.data.message || "Report sent successfully.", ok: true });
      setTimeout(() => setEmailStatus(null), 6000);
    } else if (emailFetcher.data.error) {
      setEmailStatus({ msg: emailFetcher.data.error, ok: false });
    }
  }, [emailFetcher.data]);

  const isSendingEmail = emailFetcher.state !== "idle";

  const handleSendEmail = useCallback(() => {
    if (!scan?.id) return;
    setEmailStatus(null);
    emailFetcher.submit(
      { scanId: scan.id },
      { method: "post", action: "/api/store-scan/send-email", encType: "application/json" }
    );
  }, [scan, emailFetcher]);

  // Client-side CSV download (opens in Excel)
  const handleDownloadExcel = useCallback(() => {
    if (!scan?.result) return;
    const result = scan.result as any;
    const summary = result?.scan_summary || {};

    const rows: string[][] = [];
    rows.push(["Store GMC Compliance Report"]);
    rows.push(["Store URL", summary.store_url || ""]);
    rows.push(["Overall Risk", summary.overall_risk || ""]);
    rows.push(["Pages Scanned", summary.pages_scanned ?? ""]);
    rows.push(["Missing Required Pages", summary.pages_missing ?? ""]);
    rows.push(["Broken Links", summary.broken_links_found ?? ""]);
    rows.push(["Scanned On", new Date(scan.updatedAt).toLocaleString()]);
    rows.push([]);

    const addSection = (title: string, issues: any[], extraCols?: (i: any) => string[]) => {
      rows.push([title]);
      rows.push(["#", "Severity", "Issue", "Suggested Fix", "Fix Steps", ...(extraCols ? ["Extra"] : [])]);
      (issues || []).forEach((issue: any, idx: number) => {
        rows.push([
          String(idx + 1),
          issue.severity || "",
          issue.issue_description || issue.label || issue.url || "",
          issue.suggested_fix || "",
          Array.isArray(issue.detailed_fix_steps) ? issue.detailed_fix_steps.join(" | ") : "",
          ...(extraCols ? extraCols(issue) : []),
        ]);
      });
      rows.push([]);
    };

    addSection("Missing Required Pages", result?.missing_pages || [], (i) => [i.url || ""]);
    addSection("Broken Links", result?.broken_links || [], (i) => [i.url || ""]);
    addSection("GMC Compliance", result?.merchant_center_compliance || []);
    addSection("Customer Trust & Policy", result?.customer_trust_and_policy || []);
    addSection("Site Structure & SEO", result?.site_structure_and_seo || []);

    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compliance-report-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [scan]);

  // Client-side PDF (print-ready HTML in new window)
  const handleDownloadPdf = useCallback(() => {
    if (!scan?.result) return;
    const result = scan.result as any;
    const summary = result?.scan_summary || {};
    const riskColor = summary.overall_risk === "High" ? "#d72c0d" : summary.overall_risk === "Medium" ? "#b98900" : "#12a04a";

    const sev = (s: string) => s === "High" ? "#d72c0d" : s === "Medium" ? "#b98900" : "#637381";
    const sevBg = (s: string) => s === "High" ? "#fef2f2" : s === "Medium" ? "#fffbeb" : "#f0f9ff";

    const issueRows = (issues: any[]) => (issues || []).map((issue: any) => `
      <div style="border-left:3px solid ${sev(issue.severity||"")};padding:8px 12px;margin-bottom:10px;background:#fafafa">
        <div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:4px">
          <span style="padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700;background:${sevBg(issue.severity||"")};color:${sev(issue.severity||"")};white-space:nowrap">${issue.severity||""}</span>
          <span style="font-size:13px;color:#212121;line-height:1.5">${issue.issue_description||issue.label||issue.url||""}</span>
        </div>
        ${issue.suggested_fix ? `<p style="margin:4px 0 0 12px;font-size:12px;color:#555">💡 ${issue.suggested_fix}</p>` : ""}
        ${Array.isArray(issue.detailed_fix_steps) && issue.detailed_fix_steps.length ? `
          <ol style="margin:6px 0 0 12px;padding-left:16px;font-size:11px;color:#555;line-height:1.6">
            ${issue.detailed_fix_steps.map((s: string) => `<li>${s}</li>`).join("")}
          </ol>` : ""}
      </div>`).join("");

    const section = (title: string, issues: any[]) => `
      <div style="margin-bottom:20px;page-break-inside:avoid">
        <h3 style="margin:0 0 10px 0;font-size:15px;font-weight:700;color:#1a4a5a;border-bottom:2px solid #e5e7eb;padding-bottom:6px">${title}</h3>
        ${(issues||[]).length === 0 ? `<p style="color:#12a04a;font-size:13px;margin:0">✓ No issues found.</p>` : issueRows(issues)}
      </div>`;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>GMC Compliance Report</title>
      <style>
        body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:24px;color:#212121;font-size:13px}
        @media print{body{padding:0} .no-print{display:none}}
      </style>
    </head><body>
      <div class="no-print" style="text-align:right;margin-bottom:16px">
        <button onclick="window.print()" style="padding:8px 20px;background:#1a4a5a;color:white;border:none;border-radius:6px;cursor:pointer;font-size:14px">🖨️ Print / Save as PDF</button>
      </div>
      <div style="text-align:center;background:linear-gradient(135deg,#1a4a5a,#2A5B6D);padding:24px;border-radius:8px;margin-bottom:20px;color:white">
        <div style="font-size:32px;margin-bottom:8px">🛡️</div>
        <h1 style="margin:0;font-size:20px;font-weight:700">Store GMC Compliance Report</h1>
        <p style="margin:6px 0 0;font-size:13px;opacity:0.85">${summary.store_url||""}</p>
      </div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:20px;padding:16px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb">
        <div><p style="margin:0 0 4px;font-size:10px;color:#666;font-weight:600;text-transform:uppercase">Overall Risk</p>
          <p style="margin:0;font-size:18px;font-weight:700;color:${riskColor}">${summary.overall_risk||"—"}</p></div>
        <div><p style="margin:0 0 4px;font-size:10px;color:#666;font-weight:600;text-transform:uppercase">Pages Scanned</p>
          <p style="margin:0;font-size:18px;font-weight:700">${summary.pages_scanned??""}</p></div>
        <div><p style="margin:0 0 4px;font-size:10px;color:#666;font-weight:600;text-transform:uppercase">Missing Pages</p>
          <p style="margin:0;font-size:18px;font-weight:700;color:${summary.pages_missing>0?"#d72c0d":"#212121"}">${summary.pages_missing??""}</p></div>
        <div><p style="margin:0 0 4px;font-size:10px;color:#666;font-weight:600;text-transform:uppercase">Broken Links</p>
          <p style="margin:0;font-size:18px;font-weight:700;color:${summary.broken_links_found>0?"#d72c0d":"#212121"}">${summary.broken_links_found??""}</p></div>
        <div><p style="margin:0 0 4px;font-size:10px;color:#666;font-weight:600;text-transform:uppercase">Scanned On</p>
          <p style="margin:0;font-size:13px;font-weight:600">${new Date(scan.updatedAt).toLocaleString()}</p></div>
      </div>
      ${result?.missing_pages?.length ? section("Missing Required Pages", result.missing_pages) : ""}
      ${result?.broken_links?.length ? section("Broken Links", result.broken_links) : ""}
      ${section("Google Merchant Center Compliance", result?.merchant_center_compliance)}
      ${section("Customer Trust & Policy Pages", result?.customer_trust_and_policy)}
      ${section("Site Structure & SEO", result?.site_structure_and_seo)}
      <p style="text-align:center;font-size:11px;color:#9ca3af;margin-top:24px">Generated by ShopFlix AI · ${new Date().toLocaleString()}</p>
      <script>window.onload=function(){window.print();}<\/script>
    </body></html>`;

    const win = window.open("", "_blank");
    if (win) { win.document.write(html); win.document.close(); }
  }, [scan]);

  const handleRating = useCallback(async (rating: number) => {
    setUserRating(rating);
    setShowRatingThankYou(true);
    try {
      await fetch("/api/submit-rating", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, dismissed: false }),
      });
    } catch {}
    setTimeout(() => setShowRatingThankYou(false), 2000);
  }, []);

  const handleDismiss = useCallback(async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    setReviewBannerDismissed(true);
    try {
      await fetch("/api/submit-rating", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismissed: true }),
      });
    } catch {}
  }, []);

  const isStarting = actionFetcher.state !== "idle";

  return (
    <div className="landing-page">
      <Page fullWidth>
        <div className="landing-container">

          {/* Header */}
          <div className="header-section">
            <div className="header-content">
              <div className="logo-icon">🛡️</div>
              <h1 className="app-title">Store GMC Compliance Scan</h1>
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
                    <button
                      key={star}
                      className={`star-button ${userRating && star <= userRating ? "rated" : ""}`}
                      onClick={() => handleRating(star)}
                      aria-label={`Rate ${star} stars`}
                      disabled={showRatingThankYou}
                    >
                      {userRating && star <= userRating ? "⭐" : "☆"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Intro */}
          <div className="intro-card">
            <h2 className="intro-heading">Validate Your Entire Store.</h2>
            <p className="intro-paragraph">
              A comprehensive scan of your store's pages — homepage, privacy policy, refund policy,
              shipping policy, terms of service, contact page, and navigation links — validated
              against the latest Google Merchant Center and Google Ads policies. This scan focuses
              on store-level compliance and does <strong>not</strong> check individual products.
              You have <strong>{credits} credits</strong> remaining.
            </p>
            {error && (
              <div style={{
                marginTop: "12px", padding: "10px 14px", background: "#fef2f2",
                border: "1px solid #fca5a5", borderRadius: "6px", color: "#d72c0d", fontSize: "14px",
              }}>
                {error}{" "}
                <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#d72c0d", fontWeight: 700 }}>✕</button>
              </div>
            )}
          </div>

          {/* Plan Details Modal */}
          {activePlanModal && (
            <PlanDetailsModal planKey={activePlanModal} onClose={() => setActivePlanModal(null)} />
          )}

          {/* Scan type cards */}
          <div className="feature-cards-grid">

            {/* Basic */}
            <div className="feature-card">
              <div className="feature-card-header">
                <div className="feature-card-icon">🔍</div>
                <h3 className="feature-card-title">Basic Scan</h3>
              </div>
              <p style={{ margin: "0 0 4px 0", fontSize: "12px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                Store Fundamentals & Legal Compliance
              </p>
              <p className="feature-card-description" style={{ marginTop: "8px" }}>
                Validates your store's essential pages, contact info, and navigation links against
                Google Merchant Center policies. The lightest check to catch instant-suspension risks.
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                <span style={{ fontSize: "12px", fontWeight: 700, color: "#006ECB", background: "#eff6ff", padding: "2px 8px", borderRadius: "4px", border: "1px solid #bfdbfe" }}>
                  10 Credits
                </span>
                {isProcessing && (
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "#92400e", background: "#fffbeb", padding: "2px 8px", borderRadius: "4px", border: "1px solid #fcd34d" }}>
                    Processing…
                  </span>
                )}
              </div>
              <button
                onClick={() => setActivePlanModal("basic")}
                style={{
                  background: "none", border: "none", padding: "0",
                  fontSize: "12px", color: "#006ECB", cursor: "pointer",
                  fontWeight: 600, marginBottom: "14px", textDecoration: "underline",
                  textUnderlineOffset: "2px",
                }}
              >
                View what's included →
              </button>
              <button
                className="feature-card-button"
                onClick={() => handleRunScan("BASIC")}
                disabled={isStarting || isProcessing || needsPassword || credits < 10}
                style={(isProcessing || needsPassword) ? { background: "#e5e7eb", color: "#999", cursor: "not-allowed" } : undefined}
              >
                {isProcessing ? "Scanning store…" : isStarting ? "Starting…" : needsPassword ? "Waiting for password…" : "Run Basic Scan"}
              </button>
            </div>

            {/* Advanced */}
            <div className="feature-card">
              <div className="feature-card-header">
                <div className="feature-card-icon">🔬</div>
                <h3 className="feature-card-title">Advanced Scan</h3>
              </div>
              <p style={{ margin: "0 0 4px 0", fontSize: "12px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                Product Feed Data & Accuracy
              </p>
              <p className="feature-card-description" style={{ marginTop: "8px" }}>
                Builds on the Basic Scan with deep product feed analysis — GTINs, pricing logic,
                image compliance, and feed-vs-storefront data integrity.
              </p>
              <div style={{ marginBottom: "8px" }}>
                <span style={{ fontSize: "12px", fontWeight: 700, color: "#006ECB", background: "#eff6ff", padding: "2px 8px", borderRadius: "4px", border: "1px solid #bfdbfe" }}>
                  20 Credits
                </span>
              </div>
              <button
                onClick={() => setActivePlanModal("advanced")}
                style={{
                  background: "none", border: "none", padding: "0",
                  fontSize: "12px", color: "#006ECB", cursor: "pointer",
                  fontWeight: 600, marginBottom: "14px", textDecoration: "underline",
                  textUnderlineOffset: "2px",
                }}
              >
                View what's included →
              </button>
              <button className="feature-card-button" disabled>Coming Soon</button>
            </div>

            {/* Deep */}
            <div className="feature-card">
              <div className="feature-card-header">
                <div className="feature-card-icon">🧠</div>
                <h3 className="feature-card-title">Deep Scan</h3>
              </div>
              <p style={{ margin: "0 0 4px 0", fontSize: "12px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                Misrepresentation & Checkout Audit
              </p>
              <p className="feature-card-description" style={{ marginTop: "8px" }}>
                Premium-tier audit that mirrors Google's own manual review bots — schema markup,
                checkout flow, false scarcity tactics, and business identity alignment.
              </p>
              <div style={{ marginBottom: "8px" }}>
                <span style={{ fontSize: "12px", fontWeight: 700, color: "#006ECB", background: "#eff6ff", padding: "2px 8px", borderRadius: "4px", border: "1px solid #bfdbfe" }}>
                  30 Credits
                </span>
              </div>
              <button
                onClick={() => setActivePlanModal("deep")}
                style={{
                  background: "none", border: "none", padding: "0",
                  fontSize: "12px", color: "#006ECB", cursor: "pointer",
                  fontWeight: 600, marginBottom: "14px", textDecoration: "underline",
                  textUnderlineOffset: "2px",
                }}
              >
                View what's included →
              </button>
              <button className="feature-card-button" disabled>Coming Soon</button>
            </div>
          </div>

          {/* Results */}
          {scan && (
            <>
              <div style={{ borderTop: "1px solid #e5e7eb", margin: "8px 0 16px 0" }} />

              {(scan.status === "PENDING" || scan.status === "PROCESSING") && (
                <div className="intro-card" style={{ textAlign: "center" }}>
                  <Spinner size="large" />
                  <h3 style={{ margin: "16px 0 8px 0", fontSize: "18px", fontWeight: 700, color: "#212121" }}>
                    {scan.status === "PENDING" ? "Scan queued — starting shortly…" : "Scanning your store…"}
                  </h3>
                  <p className="intro-paragraph" style={{ maxWidth: "480px", margin: "0 auto" }}>
                    We're fetching your homepage, policy pages, and navigation links, then running
                    them through our AI compliance engine. This usually takes 60–120 seconds.
                  </p>
                </div>
              )}

              {/* Password-protected store */}
              {scan.status === "NEEDS_PASSWORD" && (
                <div style={{
                  background: "#fffbeb", border: "1px solid #fcd34d",
                  borderRadius: "10px", padding: "24px",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
                    <span style={{ fontSize: "28px" }}>🔐</span>
                    <div>
                      <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#92400e" }}>
                        Store is Password Protected
                      </h3>
                      <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "#78350f" }}>
                        Your store is currently in password-protected mode. Enter your storefront password to allow a deep scan.
                      </p>
                    </div>
                  </div>
                  <p style={{ margin: "0 0 14px 0", fontSize: "12px", color: "#92400e", lineHeight: 1.6 }}>
                    💡 You can find your storefront password in <strong>Shopify Admin → Online Store → Preferences → Password protection</strong>.
                    Your password is never stored — it is only used once to fetch your store pages.
                  </p>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                    <input
                      type="password"
                      placeholder="Enter store password…"
                      value={storePassword}
                      onChange={e => { setStorePassword(e.target.value); setPasswordError(null); }}
                      onKeyDown={e => e.key === "Enter" && handleSubmitPassword()}
                      style={{
                        flex: 1, minWidth: "200px", padding: "9px 14px",
                        border: `1px solid ${passwordError ? "#fca5a5" : "#fcd34d"}`,
                        borderRadius: "6px", fontSize: "14px", background: "white",
                        outline: "none",
                      }}
                    />
                    <button
                      className="feature-card-button"
                      style={{ width: "auto", padding: "9px 20px" }}
                      onClick={handleSubmitPassword}
                      disabled={isSubmittingPassword || !storePassword.trim()}
                    >
                      {isSubmittingPassword ? "Unlocking…" : "🔓 Unlock & Scan"}
                    </button>
                  </div>
                  {passwordError && (
                    <p style={{ margin: "10px 0 0 0", fontSize: "13px", color: "#d72c0d" }}>
                      ✕ {passwordError}
                    </p>
                  )}
                </div>
              )}

              {scan.status === "FAILED" && (
                <div style={{
                  padding: "16px 20px", background: "#fef2f2", border: "1px solid #fca5a5",
                  borderRadius: "8px", color: "#d72c0d", fontSize: "14px",
                }}>
                  <strong>Scan failed:</strong> {scan.error || "Unknown error"}. Please try running the scan again.
                </div>
              )}

              {scan.status === "COMPLETE" && (
                <>
                  {/* Action bar */}
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "8px" }}>
                    <button
                      className="tutorial-button"
                      onClick={handleSendEmail}
                      disabled={isSendingEmail}
                      style={isSendingEmail ? { opacity: 0.7, cursor: "not-allowed" } : undefined}
                    >
                      <span style={{ fontSize: "14px" }}>📧</span> {isSendingEmail ? "Sending…" : "Email Report"}
                    </button>
                    <button className="tutorial-button" onClick={handleDownloadExcel}>
                      <span style={{ fontSize: "14px" }}>📊</span> Download Excel
                    </button>
                    <button className="tutorial-button" onClick={handleDownloadPdf}>
                      <span style={{ fontSize: "14px" }}>📄</span> Download PDF
                    </button>
                  </div>

                  {/* Email status */}
                  {emailStatus && (
                    <p style={{ margin: "0 0 12px 0", fontSize: "13px", color: emailStatus.ok ? "#12a04a" : "#d72c0d" }}>
                      {emailStatus.ok ? "✓ " : "✕ "}{emailStatus.msg}
                    </p>
                  )}

                  <ScanResults
                    scan={scan}
                    credits={credits}
                    fixStates={fixStates}
                    setFixStates={setFixStates}
                    savedDetails={savedDetails}
                    onDetailsSaved={handleDetailsSaved}
                  />
                </>
              )}
            </>
          )}

        </div>
      </Page>
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const is403 = isRouteErrorResponse(error) && error.status === 403;
  const message = isRouteErrorResponse(error) ? error.data : error instanceof Error ? error.message : "An unexpected error occurred.";

  return (
    <div className="landing-page">
      <Page fullWidth>
        <div className="landing-container">
          <div className="intro-card" style={{ textAlign: "center" }}>
            <h2 className="intro-heading">{is403 ? "Page Not Enabled" : "Something Went Wrong"}</h2>
            <p className="intro-paragraph">{message}</p>
            {!is403 && (
              <button className="feature-card-button" style={{ marginTop: "16px", maxWidth: "200px" }} onClick={() => window.location.reload()}>
                Retry
              </button>
            )}
          </div>
        </div>
      </Page>
    </div>
  );
}
