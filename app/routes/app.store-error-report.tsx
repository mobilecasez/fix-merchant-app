import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useRouteError, isRouteErrorResponse, Link } from "@remix-run/react";
import { Page, Spinner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from "react";
import { getOrCreateSubscription, getProductsUsed, getEffectiveProductLimit } from "../utils/billing.server";
import "../styles/dashboard.css";
import RichTextEditor from "../components/RichTextEditor";
import { notifyAiSuccess } from "../utils/ai-success";
import { recordResultsVisit, recordIssueInteraction, shouldPromptReview, markReviewPrompted } from "../utils/engagement";

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
    const freeBasicScanAvailable = !(subscription as any).freeBasicScanUsed;
    return json({ productsUsed, productLimit, latestScan, review, savedDetails, freeBasicScanAvailable });
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
  partialFix?: boolean;
  manualSteps?: string[];
  themeEditorUrl?: string;
  preConfigured?: boolean;
  debugError?: string;
  menuLabel?: string;
  manualFix?: boolean;
}

// Store details collected before running auto-fix
interface StoreDetails {
  storeName: string;
  contactEmail: string;
  contactPhone: string;
  businessAddress: string;
  country: string;
  returnWindowDays: string;
  shippingEstimate: string;
  shippingCost: string;
  aboutDescription: string;
}

// Common countries with phone dialing codes. The selected country gives us both
// the country name (for the business address) and the dial code (used to prefix
// the phone number in contact info when it isn't already in international format).
const COUNTRIES: Array<{ name: string; dial: string }> = [
  { name: "United States", dial: "+1" },
  { name: "United Kingdom", dial: "+44" },
  { name: "Canada", dial: "+1" },
  { name: "Australia", dial: "+61" },
  { name: "India", dial: "+91" },
  { name: "Germany", dial: "+49" },
  { name: "France", dial: "+33" },
  { name: "Spain", dial: "+34" },
  { name: "Italy", dial: "+39" },
  { name: "Netherlands", dial: "+31" },
  { name: "Ireland", dial: "+353" },
  { name: "New Zealand", dial: "+64" },
  { name: "Singapore", dial: "+65" },
  { name: "United Arab Emirates", dial: "+971" },
  { name: "Saudi Arabia", dial: "+966" },
  { name: "South Africa", dial: "+27" },
  { name: "Brazil", dial: "+55" },
  { name: "Mexico", dial: "+52" },
  { name: "Japan", dial: "+81" },
  { name: "China", dial: "+86" },
  { name: "Hong Kong", dial: "+852" },
  { name: "Malaysia", dial: "+60" },
  { name: "Philippines", dial: "+63" },
  { name: "Indonesia", dial: "+62" },
  { name: "Pakistan", dial: "+92" },
  { name: "Bangladesh", dial: "+880" },
  { name: "Nigeria", dial: "+234" },
  { name: "Sweden", dial: "+46" },
  { name: "Norway", dial: "+47" },
  { name: "Denmark", dial: "+45" },
  { name: "Switzerland", dial: "+41" },
  { name: "Belgium", dial: "+32" },
  { name: "Portugal", dial: "+351" },
  { name: "Poland", dial: "+48" },
  { name: "Other", dial: "" },
];

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
  businessAddress: "", country: "", returnWindowDays: "30",
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
            <Fragment key={field.key}>
              <div>
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

              {/* Country dropdown — always shown right after the address field so the
                  country (and its dial code) can be used in the address & contact info. */}
              {field.key === "businessAddress" && (
                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "4px" }}>
                    Country
                    {values.country?.trim() && <span style={{ marginLeft: "6px", fontSize: "11px", color: "#12a04a", fontWeight: 400 }}>✓ saved</span>}
                  </label>
                  <select
                    value={values.country}
                    onChange={e => setValues(v => ({ ...v, country: e.target.value }))}
                    style={{
                      width: "100%", boxSizing: "border-box", padding: "9px 12px",
                      border: `1px solid ${values.country?.trim() ? "#86efac" : "#d1d5db"}`,
                      borderRadius: "6px", fontSize: "13px", outline: "none",
                      background: "white", color: values.country ? "#212121" : "#9ca3af",
                    }}
                  >
                    <option value="">Select a country…</option>
                    {COUNTRIES.map(c => (
                      <option key={c.name} value={c.name} style={{ color: "#212121" }}>
                        {c.name}{c.dial ? ` (${c.dial})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </Fragment>
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
  const autoFixFetcher = useFetcher<{
    success?: boolean; error?: string; verifyUrl?: string; creditsCharged?: number;
    partialFix?: boolean; manualSteps?: string[]; themeEditorUrl?: string;
    preConfigured?: boolean; debugError?: string; menuLabel?: string;
  }>();
  const markFixedFetcher = useFetcher<{ success?: boolean }>();
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

  const handleMarkFixed = () => {
    // Persist under the same key the card reads from (auto_fix_type when present,
    // otherwise the per-issue key) so it survives refresh of this scan.
    markFixedFetcher.submit(
      { scanId, autoFixType: issueKey } as any,
      { method: "post", action: "/api/store-scan/mark-fixed", encType: "application/json" }
    );
    // Optimistically update state to fully fixed
    updateState({ fixing: false, fixed: true, partialFix: false, manualFix: true, error: "", fixSummary: "You marked this issue as fixed manually." });
  };

  const handleUnmarkFixed = () => {
    markFixedFetcher.submit(
      { scanId, autoFixType: issueKey, unmark: true } as any,
      { method: "post", action: "/api/store-scan/mark-fixed", encType: "application/json" }
    );
    // Optimistically revert to an unfixed state so the issue shows again
    updateState({ fixed: false, manualFix: false, fixSummary: "", error: "" });
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
        partialFix: data.partialFix || false,
        manualSteps: data.manualSteps || [],
        themeEditorUrl: data.themeEditorUrl,
        preConfigured: data.preConfigured ?? false,
        debugError: data.debugError,
        menuLabel: data.menuLabel,
      });
    } else {
      updateState({ fixing: false, confirming: false, error: data.error || "Auto-fix failed. Please try again." });
    }
  }, [autoFixFetcher.state, autoFixFetcher.data]);

  const steps: string[] = Array.isArray(issue.detailed_fix_steps) ? issue.detailed_fix_steps : [];
  const creditCost = issue.credit_cost ?? 1;
  // Label of the footer menu this fix creates — used in the Theme Editor card.
  const menuLabel = state.menuLabel || (issue.auto_fix_type === "business_contact" ? "Contact Information" : "Policy Links");

  return (
    <div style={{
      borderLeft: `3px solid ${severityColor(issue.severity || "Low")}`,
      paddingLeft: "14px",
      marginBottom: "20px",
      opacity: 1,
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
        {/* Manual "Mark as fixed" — always available so a merchant who fixed the
            issue themselves (or doesn't want Auto Fix) can clear it. */}
        {!state.fixed && !state.fixing && (
          <button
            onClick={handleMarkFixed}
            disabled={markFixedFetcher.state !== "idle"}
            title="Mark this issue as fixed without using Auto Fix"
            style={{
              display: "inline-flex", alignItems: "center", gap: "5px",
              padding: "5px 12px", background: "white", color: "#166534",
              border: "1px solid #86efac", borderRadius: "6px",
              fontSize: "13px", fontWeight: 600,
              cursor: markFixedFetcher.state !== "idle" ? "wait" : "pointer", flexShrink: 0,
            }}
          >
            {markFixedFetcher.state !== "idle" ? "Saving…" : "✓ Mark as Fixed"}
          </button>
        )}
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
          background: state.partialFix ? "#fffbeb" : "#f0fdf4",
          border: `1px solid ${state.partialFix ? "#fcd34d" : "#86efac"}`,
          borderRadius: "8px",
        }}>
          <p style={{ margin: "0 0 6px 0", fontSize: "13px", fontWeight: 700, color: state.partialFix ? "#92400e" : "#166534" }}>
            {state.partialFix ? "⚠️ Partially Applied" : state.manualFix ? "✅ Marked as Fixed" : "✅ Fix Applied Successfully"}
            {state.creditsCharged ? (
              <span style={{ marginLeft: "8px", fontWeight: 400, fontSize: "12px", color: "#555" }}>
                ({state.creditsCharged} credit{state.creditsCharged !== 1 ? "s" : ""} used)
              </span>
            ) : null}
          </p>
          {state.fixSummary && !state.partialFix && (
            <p style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#14532d", lineHeight: 1.5 }}>
              {state.fixSummary}
            </p>
          )}
          {/* Undo a manual mark in case of a mis-click */}
          {state.manualFix && (
            <button
              onClick={handleUnmarkFixed}
              disabled={markFixedFetcher.state !== "idle"}
              style={{
                display: "inline-flex", alignItems: "center", gap: "5px",
                padding: "4px 12px", background: "white", color: "#92400e",
                border: "1px solid #fcd34d", borderRadius: "6px",
                fontSize: "12px", fontWeight: 600,
                cursor: markFixedFetcher.state !== "idle" ? "wait" : "pointer",
              }}
            >
              ↩ Undo — show this issue again
            </button>
          )}

          {/* Partial fix — theme injection failed, show reauth + manual option */}
          {state.partialFix && state.themeEditorUrl && (
            <div style={{ marginBottom: "10px" }}>
              <p style={{ margin: "0 0 12px 0", fontSize: "13px", color: "#78350f", lineHeight: 1.6 }}>
                ✅ <strong>"{menuLabel}"</strong> menu created with all the required links.
                {state.preConfigured
                  ? <> The footer block has been <strong>pre-configured</strong> in your theme — just open the editor and click <strong>Save</strong>.</>
                  : <> Open your Theme Editor and add the block with one click.</>
                }
              </p>

              {/* Big CTA button */}
              <a
                href={state.themeEditorUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "14px 18px",
                  background: "linear-gradient(135deg,#1a4a5a,#2A5B6D)",
                  color: "white", borderRadius: "8px",
                  textDecoration: "none", marginBottom: "12px",
                  boxShadow: "0 2px 8px rgba(26,74,90,0.3)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "22px" }}>🎨</span>
                  <div>
                    <p style={{ margin: 0, fontSize: "14px", fontWeight: 700 }}>
                      {state.preConfigured ? "Open Theme Editor — Click Save" : "Open Theme Editor"}
                    </p>
                    <p style={{ margin: 0, fontSize: "12px", opacity: 0.8 }}>
                      {state.preConfigured
                        ? "Block already added — just hit Save to go live"
                        : `Add the ${menuLabel} block to your footer`
                      }
                    </p>
                  </div>
                </div>
                <span style={{ fontSize: "18px", opacity: 0.8 }}>→</span>
              </a>

              {/* Step-by-step only shown when NOT pre-configured */}
              {!state.preConfigured && (
                <div style={{
                  background: "white", border: "1px solid #e5e7eb",
                  borderRadius: "6px", padding: "12px 14px",
                }}>
                  <p style={{ margin: "0 0 10px 0", fontSize: "12px", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                    Steps once the editor opens
                  </p>
                  {[
                    { n: 1, text: <>Click <strong>Footer</strong> in the left panel</> },
                    { n: 2, text: <>Click <strong>Add block</strong> → select <strong>Menu</strong> (or <strong>Link list</strong>)</> },
                    { n: 3, text: <>In the new block, open the <strong>Menu</strong> picker → select <strong>{menuLabel}</strong></> },
                    { n: 4, text: <>Set the <strong>Heading</strong> field to <code style={{ background: "#f3f4f6", padding: "1px 5px", borderRadius: "3px" }}>{menuLabel}</code></> },
                    { n: 5, text: <>Click <strong>Save</strong> ✓</> },
                  ].map(({ n, text }) => (
                    <div key={n} style={{ display: "flex", gap: "10px", marginBottom: "10px", alignItems: "flex-start" }}>
                      <span style={{
                        flexShrink: 0, width: "22px", height: "22px",
                        background: "#1a4a5a", color: "white",
                        borderRadius: "50%", fontSize: "11px", fontWeight: 700,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>{n}</span>
                      <p style={{ margin: 0, fontSize: "13px", color: "#374151", lineHeight: 1.6 }}>{text}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Pre-configured: just show save reminder */}
              {state.preConfigured && (
                <div style={{
                  background: "#f0fdf4", border: "1px solid #86efac",
                  borderRadius: "6px", padding: "10px 14px",
                  display: "flex", alignItems: "center", gap: "10px",
                  marginBottom: "10px",
                }}>
                  <span style={{ fontSize: "20px" }}>💡</span>
                  <p style={{ margin: 0, fontSize: "13px", color: "#166534", lineHeight: 1.5 }}>
                    The <strong>"{menuLabel}"</strong> block has been added to your footer section. Open the editor above and click the <strong>Save</strong> button — no other steps needed.
                  </p>
                </div>
              )}

              {/* Mark as Done — shown after user completes Theme Editor steps */}
              <div style={{
                marginTop: "12px", paddingTop: "12px",
                borderTop: "1px solid #fcd34d",
              }}>
                <p style={{ margin: "0 0 8px 0", fontSize: "12px", color: "#78350f" }}>
                  ✅ Once you've saved in the Theme Editor, click below to mark this as done:
                </p>
                <button
                  onClick={handleMarkFixed}
                  disabled={markFixedFetcher.state !== "idle"}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: "6px",
                    padding: "8px 18px", background: "#166534", color: "white",
                    border: "none", borderRadius: "6px", fontSize: "13px",
                    fontWeight: 600, cursor: "pointer",
                  }}
                >
                  {markFixedFetcher.state !== "idle" ? "Saving…" : "✓ I've saved in Theme Editor — Mark as Done"}
                </button>
              </div>
            </div>
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
                color: state.partialFix ? "#92400e" : "#166534",
                background: "white",
                border: `1px solid ${state.partialFix ? "#fcd34d" : "#86efac"}`,
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

// ── Helpers ────────────────────────────────────────────────────────────────────

function calcGroupCredits(count: number) { return Math.max(1, Math.ceil(count / 5)); }

function violationColor(type: string) {
  if (type?.includes("Pricing")) return { bg: "#fef2f2", color: "#d72c0d", border: "#fca5a5", icon: "💰" };
  if (type?.includes("Identifier")) return { bg: "#fffbeb", color: "#92400e", border: "#fcd34d", icon: "🏷️" };
  if (type?.includes("Image")) return { bg: "#fdf4ff", color: "#7e22ce", border: "#e9d5ff", icon: "🖼️" };
  if (type?.includes("Description") || type?.includes("Syntax")) return { bg: "#f0f9ff", color: "#0369a1", border: "#7dd3fc", icon: "📝" };
  return { bg: "#f9fafb", color: "#374151", border: "#d1d5db", icon: "⚠️" };
}

// Whether this violation type can be auto-fixed via AI
function isAutofixable(type: string) {
  return type?.includes("Identifier") || type?.includes("Pricing") || type?.includes("Description") || type?.includes("Syntax");
}

// ── Group card with inline auto-fix ──────────────────────────────────────────

// ── Confidence badge ──────────────────────────────────────────────────────────

function ConfidenceBadge({ confidence, hasGtin }: { confidence: string | null; hasGtin: boolean }) {
  if (!hasGtin) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "3px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: 700, background: "#fef2f2", color: "#d72c0d", border: "1px solid #fca5a5" }}>
        ✗ Not Found — Manual Entry Needed
      </span>
    );
  }
  if (confidence === "high") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "3px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: 700, background: "#f0fdf4", color: "#166534", border: "1px solid #86efac" }}>
        ✓ High Confidence
      </span>
    );
  }
  if (confidence === "medium") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "3px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: 700, background: "#fffbeb", color: "#92400e", border: "1px solid #fcd34d" }}>
        ⚠ Review Recommended
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "3px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: 700, background: "#fef2f2", color: "#d72c0d", border: "1px solid #fca5a5" }}>
      ✗ Manual Review Required
    </span>
  );
}

// ── Client-side markdown → HTML (used only in browser) ───────────────────────
function markdownToHtml(md: string): string {
  if (!md) return "";
  return md
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^\* (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
    .replace(/\n\n/g, "</p><p>")
    .replace(/^(?!<[hul])(.+)$/gm, "<p>$1</p>")
    .replace(/<p><\/p>/g, "")
    .trim();
}

// ── Description edit card — Quill rich-text editor ────────────────────────────

function DescriptionEditCard({
  index, productTitle, fix, saveState, onSave, description, setDescription,
}: {
  index: number; productTitle: string; fix: any;
  saveState: "idle" | "saving" | "saved" | "error";
  onSave: () => void;
  description: string;        // HTML string (for Quill)
  setDescription: (v: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // On first expand, if description is still plain-text markdown, convert it
  const handleExpand = () => {
    if (!expanded && fix?.suggested_description && !description.includes("<")) {
      setDescription(markdownToHtml(fix.suggested_description));
    }
    setExpanded(e => !e);
  };

  if (!fix?.suggested_description) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 0" }}>
        <span style={{ fontSize: "11px", color: "#9ca3af", fontWeight: 700, minWidth: "18px" }}>{index + 1}.</span>
        <p style={{ margin: 0, fontSize: "13px", fontWeight: 700, color: "#212121" }}>{productTitle}</p>
        <span style={{ fontSize: "12px", color: "#9ca3af", fontStyle: "italic" }}>No description generated</span>
      </div>
    );
  }

  // Plain text preview (strip HTML/markdown for the collapsed hint)
  const plainPreview = (description || fix.suggested_description)
    .replace(/<[^>]+>/g, " ").replace(/#+\s*/g, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim()
    .substring(0, 90);

  return (
    /* No overflow:hidden — Quill toolbar dropdowns must not be clipped */
    <div style={{ border: "1px solid #e5e7eb", borderRadius: "10px", background: "white" }}>

      {/* Header row — always visible */}
      <div style={{ padding: "11px 14px", display: "flex", alignItems: "center", gap: "10px", background: "#fafafa", borderRadius: expanded ? "10px 10px 0 0" : "10px" }}>
        <span style={{ fontSize: "11px", color: "#9ca3af", fontWeight: 700, minWidth: "18px", flexShrink: 0 }}>{index + 1}.</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: "0 0 2px 0", fontSize: "13px", fontWeight: 700, color: "#212121" }}>{productTitle}</p>
          {!expanded && (
            <p style={{ margin: 0, fontSize: "11px", color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {plainPreview}…
            </p>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          {saveState === "saved" && (
            <span style={{ fontSize: "12px", fontWeight: 700, color: "#166534" }}>✓ Saved</span>
          )}
          <button
            onClick={handleExpand}
            style={{ background: "none", border: "1px solid #d1d5db", borderRadius: "6px", padding: "5px 12px", fontSize: "11px", color: "#374151", cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}
          >
            {expanded ? "▲ Collapse" : "▼ Edit Description"}
          </button>
        </div>
      </div>

      {/* Editor — no clipping, no minHeight constraint */}
      {expanded && (
        <>
          <div style={{ borderTop: "1px solid #e5e7eb" }}>
            <RichTextEditor
              value={description || markdownToHtml(fix.suggested_description)}
              onChange={setDescription}
            />
          </div>
          <div style={{ padding: "10px 14px", background: "#f9fafb", borderTop: "1px solid #e5e7eb", borderRadius: "0 0 10px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
            <p style={{ margin: 0, fontSize: "11px", color: "#9ca3af" }}>
              Edit with the toolbar above · saved to Shopify as HTML
            </p>
            <SaveButton state={saveState} onClick={onSave} />
          </div>
        </>
      )}
    </div>
  );
}

// ── Per-product inline edit row ───────────────────────────────────────────────

function SaveButton({ state, onClick }: { state: "idle" | "saving" | "saved" | "error"; onClick: () => void }) {
  if (state === "saved") return <span style={{ fontSize: "12px", fontWeight: 700, color: "#166534", whiteSpace: "nowrap" }}>✓ Saved</span>;
  return (
    <button
      onClick={onClick}
      disabled={state === "saving"}
      style={{
        padding: "5px 14px",
        background: state === "saving" ? "#9ca3af" : "#166534",
        color: "white", border: "none", borderRadius: "6px",
        fontSize: "12px", fontWeight: 700,
        cursor: state === "saving" ? "not-allowed" : "pointer",
        whiteSpace: "nowrap", flexShrink: 0,
      }}
    >
      {state === "saving" ? "Saving…" : "💾 Save"}
    </button>
  );
}

function ProductInlineEditRow({
  index, product, fix, violationType, scanId, onValueChange, onSaved,
}: {
  index: number; product: any; fix: any | null; violationType: string; scanId: string;
  onValueChange?: (field: string, value: string) => void;
  onSaved?: (productId: string) => void;
}) {
  const productId = product.product_id || product.id;
  const productTitle = product.product_title || product.title || productId;
  const isIdentifier = violationType?.includes("Identifier");
  const isPricing   = violationType?.includes("Pricing");
  const isDesc      = violationType?.includes("Description") || violationType?.includes("Syntax");
  const isImage     = violationType?.includes("Image");

  const [gtin, setGtin]                 = useState(fix?.suggested_gtin || "");
  const [mpn, setMpn]                   = useState(fix?.suggested_mpn || product.mpn || "");
  const [compareAtPrice, setCompareAt]  = useState(String(fix?.suggested_compare_at_price || ""));
  // Start as empty — converted to HTML on first expand inside DescriptionEditCard
  const [description, setDescription]  = useState("");
  const handleSetDescription = (v: string) => { setDescription(v); onValueChange?.("description", v); };
  const [saveState, setSaveState]       = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError]       = useState("");
  const [showSteps, setShowSteps]       = useState(false);

  const handleSave = async () => {
    setSaveState("saving"); setSaveError("");
    try {
      let fixType = ""; let fields: any = {};
      if (isIdentifier)  { fixType = "identifiers"; fields = { gtin, mpn }; }
      else if (isPricing) { fixType = "pricing";     fields = { compare_at_price: compareAtPrice }; }
      // For description: use current HTML state; if empty fall back to raw AI suggestion
      else if (isDesc)    { fixType = "description"; fields = { description: description || fix?.suggested_description || "" }; }
      else { setSaveState("idle"); return; }

      const res  = await fetch("/api/advanced-scan/save-product-fix", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, fixType, fields }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setSaveState("error"); setSaveError(data.error || "Save failed."); return; }
      setSaveState("saved");
      onSaved?.(productId);
    } catch { setSaveState("error"); setSaveError("Network error."); }
  };

  const inp = (filled: boolean, mono = false): React.CSSProperties => ({
    padding: "5px 8px",
    border: `1px solid ${filled ? "#86efac" : "#d1d5db"}`,
    borderRadius: "6px", fontSize: "12px",
    fontFamily: mono ? "monospace" : "inherit",
    outline: "none",
    background: saveState === "saved" ? "#f9fafb" : "white",
    color: "#212121",
  });

  // ── Layout:
  //   [#]  [Title / badge / reasoning]          [inputs…]  [Save]
  //
  //   For description: inputs span full width below the title.

  // Description gets its own self-contained card — no outer wrapper needed
  if (isDesc) {
    return (
      <DescriptionEditCard
        index={index}
        productTitle={productTitle}
        fix={fix}
        saveState={saveState}
        onSave={handleSave}
        description={description}
        setDescription={handleSetDescription}
      />
    );
  }

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", background: "white", overflow: "hidden" }}>
      <div style={{ padding: "10px 14px" }}>

        {/* ── Identifier & Pricing: single-line row ────────────────────────── */}
        {(isIdentifier || isPricing) && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            {/* Index */}
            <span style={{ fontSize: "11px", color: "#9ca3af", fontWeight: 700, flexShrink: 0, minWidth: "18px" }}>
              {index + 1}.
            </span>

            {/* Title block */}
            <div style={{ flex: 1, minWidth: "140px" }}>
              <p style={{ margin: 0, fontSize: "13px", fontWeight: 700, color: "#212121", lineHeight: 1.4 }}>{productTitle}</p>
              {isIdentifier && fix?.confidence && (
                <div style={{ marginTop: "3px" }}>
                  <ConfidenceBadge confidence={fix.confidence} hasGtin={!!gtin} />
                </div>
              )}
              {isPricing && fix && (
                <p style={{ margin: "3px 0 0 0", fontSize: "11px", color: "#6b7280" }}>
                  Current MRP: <strong style={{ color: "#d72c0d" }}>₹{fix.current_compare_at_price ?? product.compare_at_price ?? "—"}</strong>
                </p>
              )}
              {fix?.reasoning && (
                <p style={{ margin: "3px 0 0 0", fontSize: "10px", color: "#9ca3af", fontStyle: "italic", lineHeight: 1.4 }}>{fix.reasoning}</p>
              )}
            </div>

            {/* Inputs — right side */}
            <div style={{ display: "flex", alignItems: "flex-end", gap: "6px", flexShrink: 0, flexWrap: "wrap" }}>
              {isIdentifier && (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                    <label style={{ fontSize: "10px", color: "#6b7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.4px" }}>GTIN</label>
                    <input
                      type="text" value={gtin} onChange={e => setGtin(e.target.value)}
                      placeholder="Barcode / EAN" disabled={saveState === "saved"}
                      style={{ ...inp(!!gtin, true), width: "140px" }}
                    />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                    <label style={{ fontSize: "10px", color: "#6b7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.4px" }}>MPN</label>
                    <input
                      type="text" value={mpn} onChange={e => setMpn(e.target.value)}
                      placeholder="SKU / MPN" disabled={saveState === "saved"}
                      style={{ ...inp(!!mpn, true), width: "100px" }}
                    />
                  </div>
                </>
              )}

              {isPricing && (
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <label style={{ fontSize: "10px", color: "#6b7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.4px" }}>New MRP (₹)</label>
                  <input
                    type="number" value={compareAtPrice}
                    onChange={e => { setCompareAt(e.target.value); onValueChange?.("compare_at_price", e.target.value); }}
                    placeholder="0.00" disabled={saveState === "saved"}
                    style={{ ...inp(!!compareAtPrice, true), width: "110px" }}
                  />
                </div>
              )}

              <SaveButton state={saveState} onClick={handleSave} />
            </div>
          </div>
        )}

        {/* Description is handled by early return above */}

        {/* ── Image: title + issue detail only (no editable field) ─────────── */}
        {isImage && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
            <span style={{ fontSize: "11px", color: "#9ca3af", fontWeight: 700, minWidth: "18px", paddingTop: "2px" }}>{index + 1}.</span>
            <div>
              <p style={{ margin: "0 0 3px 0", fontSize: "13px", fontWeight: 700, color: "#212121" }}>{productTitle}</p>
              {fix?.issue_detail && <p style={{ margin: 0, fontSize: "12px", color: "#7e22ce" }}>{fix.issue_detail}</p>}
            </div>
          </div>
        )}

        {/* No fix yet */}
        {!fix && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "11px", color: "#9ca3af", fontWeight: 700, minWidth: "18px" }}>{index + 1}.</span>
            <p style={{ margin: 0, fontSize: "13px", fontWeight: 700, color: "#212121" }}>{productTitle}</p>
          </div>
        )}

        {/* Manual steps toggle */}
        {fix?.manual_steps?.length > 0 && (
          <button
            onClick={() => setShowSteps(s => !s)}
            style={{ background: "none", border: "none", padding: "6px 0 0 28px", fontSize: "11px", color: "#006ECB", cursor: "pointer", fontWeight: 600, display: "block" }}
          >
            {showSteps ? "Hide steps ▲" : "View manual steps ▼"}
          </button>
        )}
      </div>

      {/* Error */}
      {saveState === "error" && (
        <div style={{ padding: "6px 14px", borderTop: "1px solid #fca5a5", background: "#fef2f2" }}>
          <p style={{ margin: 0, fontSize: "11px", color: "#d72c0d" }}>✕ {saveError}</p>
        </div>
      )}

      {/* Manual steps */}
      {showSteps && fix?.manual_steps?.length > 0 && (
        <div style={{ padding: "10px 14px", borderTop: "1px solid #e5e7eb", background: "#f0f9ff" }}>
          <ol style={{ margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "3px" }}>
            {fix.manual_steps.map((step: string, si: number) => (
              <li key={si} style={{ fontSize: "12px", color: "#0c4a6e", lineHeight: 1.6 }}>{step}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// ── Legacy bulk table (kept for any persisted old data format) ────────────────

function IdentifierBulkTable({
  fixes,
  products,
  scanId,
  persistedSaveResults,
}: {
  fixes: any[];
  products: any[];
  scanId: string;
  persistedSaveResults: Array<{ productId: string; success: boolean; error?: string }> | null;
}) {
  // Build editable rows — merge product data with AI fix suggestions
  const initRows = () => products.map((p: any) => {
    const fix = fixes.find((f: any) => f.product_id === (p.product_id || p.id)) || {};
    return {
      productId: p.product_id || p.id,
      productTitle: p.product_title || p.title || p.product_id || p.id,
      brand: fix.suggested_brand || p.brand || "",
      gtin: fix.suggested_gtin || "",
      mpn: fix.suggested_mpn || p.mpn || "",
      confidence: fix.confidence || null,
      reasoning: fix.reasoning || "",
      manual_steps: fix.manual_steps || [],
    };
  });

  const [rows, setRows] = useState(initRows);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "done" | "error">(
    persistedSaveResults ? "done" : "idle"
  );
  const [saveResults, setSaveResults] = useState<Array<{ productId: string; success: boolean; error?: string }>>(
    persistedSaveResults || []
  );
  const [saveMessage, setSaveMessage] = useState("");
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());

  const updateRow = (i: number, field: "brand" | "gtin" | "mpn", value: string) => {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  };

  const handleSaveAll = async () => {
    setSaveState("saving");
    setSaveMessage("");
    try {
      const res = await fetch("/api/advanced-scan/save-identifiers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scanId,
          rows: rows.map(r => ({
            productId: r.productId,
            brand: r.brand || null,
            gtin: r.gtin || null,
            mpn: r.mpn || null,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setSaveState("error");
        setSaveMessage(data.error || "Save failed. Please try again.");
        return;
      }
      setSaveResults(data.results || []);
      setSaveMessage(data.message || "Saved successfully.");
      setSaveState("done");
    } catch {
      setSaveState("error");
      setSaveMessage("Network error. Please try again.");
    }
  };

  const getRowSaveResult = (productId: string) =>
    saveResults.find(r => r.productId === productId);

  return (
    <div>
      {/* GS1 verification notice */}
      <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "8px", padding: "12px 16px", marginBottom: "16px" }}>
        <p style={{ margin: "0 0 4px 0", fontSize: "13px", fontWeight: 700, color: "#92400e" }}>
          ⚠ Verify GTINs before saving
        </p>
        <p style={{ margin: 0, fontSize: "12px", color: "#78350f", lineHeight: 1.6 }}>
          AI-suggested GTINs are based on product title and brand knowledge. Please cross-check against the{" "}
          <a href="https://www.gs1.org/services/verified-by-gs1" target="_blank" rel="noreferrer" style={{ color: "#92400e", fontWeight: 700 }}>GS1 Verified database</a>{" "}
          or your manufacturer before saving. Incorrect GTINs can cause product disapprovals in Google Merchant Center.
        </p>
      </div>

      {/* Bulk-edit table */}
      <div style={{ overflowX: "auto", borderRadius: "8px", border: "1px solid #e5e7eb" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
          <thead>
            <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
              {["Product", "Brand", "GTIN (Barcode)", "MPN / SKU", "AI Confidence", "Status"].map(h => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "#374151", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const saveResult = getRowSaveResult(row.productId);
              const isExpanded = expandedSteps.has(i);
              return (
                <>
                  <tr key={row.productId} style={{ borderBottom: "1px solid #e5e7eb", background: i % 2 === 0 ? "white" : "#fafafa" }}>
                    {/* Product name */}
                    <td style={{ padding: "10px 12px", minWidth: "160px", maxWidth: "220px" }}>
                      <p style={{ margin: "0 0 2px 0", fontSize: "12px", fontWeight: 700, color: "#212121", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.productTitle}>
                        {row.productTitle}
                      </p>
                      {row.manual_steps?.length > 0 && (
                        <button
                          onClick={() => setExpandedSteps(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; })}
                          style={{ background: "none", border: "none", padding: 0, fontSize: "11px", color: "#006ECB", cursor: "pointer", fontWeight: 600 }}
                        >
                          {isExpanded ? "Hide steps ▲" : "View steps ▼"}
                        </button>
                      )}
                    </td>

                    {/* Brand */}
                    <td style={{ padding: "8px 12px", minWidth: "120px" }}>
                      <input
                        type="text"
                        value={row.brand}
                        onChange={e => updateRow(i, "brand", e.target.value)}
                        placeholder="e.g. Nike"
                        disabled={saveState === "saving" || saveState === "done"}
                        style={{
                          width: "100%", padding: "5px 8px", border: "1px solid #d1d5db",
                          borderRadius: "5px", fontSize: "12px", outline: "none",
                          background: saveState === "done" ? "#f9fafb" : "white",
                          color: "#212121",
                        }}
                      />
                    </td>

                    {/* GTIN */}
                    <td style={{ padding: "8px 12px", minWidth: "150px" }}>
                      <input
                        type="text"
                        value={row.gtin}
                        onChange={e => updateRow(i, "gtin", e.target.value)}
                        placeholder="13-digit barcode"
                        disabled={saveState === "saving" || saveState === "done"}
                        style={{
                          width: "100%", padding: "5px 8px", border: `1px solid ${row.gtin ? "#86efac" : "#d1d5db"}`,
                          borderRadius: "5px", fontSize: "12px", fontFamily: "monospace", outline: "none",
                          background: saveState === "done" ? "#f9fafb" : "white",
                          color: "#212121",
                        }}
                      />
                      {row.reasoning && (
                        <p style={{ margin: "3px 0 0 0", fontSize: "10px", color: "#9ca3af", fontStyle: "italic", lineHeight: 1.4 }}>{row.reasoning}</p>
                      )}
                    </td>

                    {/* MPN */}
                    <td style={{ padding: "8px 12px", minWidth: "120px" }}>
                      <input
                        type="text"
                        value={row.mpn}
                        onChange={e => updateRow(i, "mpn", e.target.value)}
                        placeholder="SKU / MPN"
                        disabled={saveState === "saving" || saveState === "done"}
                        style={{
                          width: "100%", padding: "5px 8px", border: "1px solid #d1d5db",
                          borderRadius: "5px", fontSize: "12px", fontFamily: "monospace", outline: "none",
                          background: saveState === "done" ? "#f9fafb" : "white",
                          color: "#212121",
                        }}
                      />
                    </td>

                    {/* Confidence */}
                    <td style={{ padding: "10px 12px", minWidth: "160px" }}>
                      <ConfidenceBadge confidence={row.confidence} hasGtin={!!row.gtin} />
                    </td>

                    {/* Save status */}
                    <td style={{ padding: "10px 12px", minWidth: "120px" }}>
                      {saveResult ? (
                        saveResult.success ? (
                          <span style={{ fontSize: "12px", fontWeight: 700, color: "#166534" }}>✓ Saved</span>
                        ) : (
                          <span style={{ fontSize: "12px", fontWeight: 700, color: "#d72c0d" }} title={saveResult.error}>✗ Failed</span>
                        )
                      ) : (
                        <span style={{ fontSize: "12px", color: "#9ca3af" }}>Pending</span>
                      )}
                    </td>
                  </tr>

                  {/* Expandable manual steps row */}
                  {isExpanded && row.manual_steps?.length > 0 && (
                    <tr key={`${row.productId}-steps`} style={{ background: "#f0f9ff", borderBottom: "1px solid #e5e7eb" }}>
                      <td colSpan={6} style={{ padding: "12px 16px" }}>
                        <p style={{ margin: "0 0 6px 0", fontSize: "11px", fontWeight: 700, color: "#0369a1", textTransform: "uppercase", letterSpacing: "0.4px" }}>Manual fix steps</p>
                        <ol style={{ margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "3px" }}>
                          {row.manual_steps.map((step: string, si: number) => (
                            <li key={si} style={{ fontSize: "12px", color: "#0c4a6e", lineHeight: 1.6 }}>{step}</li>
                          ))}
                        </ol>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Save bar */}
      <div style={{ marginTop: "14px", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        {saveState !== "done" && (
          <button
            onClick={handleSaveAll}
            disabled={saveState === "saving"}
            style={{
              padding: "9px 20px", background: saveState === "saving" ? "#9ca3af" : "#166534",
              color: "white", border: "none", borderRadius: "7px", fontSize: "13px",
              fontWeight: 700, cursor: saveState === "saving" ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: "7px",
            }}
          >
            {saveState === "saving" ? (
              <><Spinner size="small" /> Saving to Shopify…</>
            ) : (
              "💾 Save All to Shopify"
            )}
          </button>
        )}
        {saveState === "done" && (
          <span style={{ fontSize: "13px", fontWeight: 700, color: "#166534" }}>
            ✓ {saveMessage}
          </span>
        )}
        {saveState === "error" && (
          <span style={{ fontSize: "13px", color: "#d72c0d" }}>✕ {saveMessage}</span>
        )}
        <p style={{ margin: 0, fontSize: "11px", color: "#9ca3af" }}>
          Brand saved to product vendor · GTIN saved to variant barcode · MPN saved as custom metafield
        </p>
      </div>
    </div>
  );
}

// ── Generic product fix row (Pricing / Description / Image) ───────────────────

function ProductFixRow({
  product,
  fix,
  violationType,
  fixState,
  cs,
}: {
  product: any;
  fix: any;
  violationType: string;
  fixState: string;
  cs: { bg: string; color: string; border: string; icon: string };
}) {
  const [showSteps, setShowSteps] = useState(false);
  const isImageViolation = violationType?.includes("Image");

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", background: "#f9fafb", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: "0 0 1px 0", fontSize: "13px", fontWeight: 700, color: "#212121", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {product.product_title || product.title}
          </p>
          <p style={{ margin: 0, fontSize: "11px", color: "#9ca3af" }}>ID: {product.product_id || product.id}</p>
        </div>
        {fix?.manual_steps?.length > 0 && (
          <button
            onClick={() => setShowSteps(s => !s)}
            style={{ background: "none", border: "none", fontSize: "11px", color: "#006ECB", cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}
          >
            {showSteps ? "Hide steps ▲" : "View steps ▼"}
          </button>
        )}
      </div>

      {fix && (
        <div style={{ padding: "10px 14px", borderTop: "1px solid #e5e7eb" }}>
          {/* Pricing fix */}
          {violationType.includes("Pricing") && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center" }}>
              <div>
                <span style={{ fontSize: "11px", color: "#6b7280", fontWeight: 600 }}>Current MRP: </span>
                <span style={{ fontSize: "13px", fontWeight: 700, color: "#d72c0d", fontFamily: "monospace" }}>₹{fix.current_compare_at_price ?? product.compare_at_price ?? "—"}</span>
              </div>
              <span style={{ color: "#9ca3af", fontSize: "16px" }}>→</span>
              <div>
                <span style={{ fontSize: "11px", color: "#6b7280", fontWeight: 600 }}>Suggested MRP: </span>
                <span style={{ fontSize: "13px", fontWeight: 700, color: "#166534", fontFamily: "monospace" }}>₹{fix.suggested_compare_at_price}</span>
              </div>
              {fix.needs_verification && (
                <span style={{ fontSize: "11px", color: "#d97706", fontWeight: 600 }}>⚠ Verify before saving</span>
              )}
              {fix.reasoning && (
                <p style={{ margin: "6px 0 0 0", fontSize: "11px", color: "#9ca3af", fontStyle: "italic", width: "100%" }}>{fix.reasoning}</p>
              )}
            </div>
          )}

          {/* Description fix */}
          {(violationType.includes("Description") || violationType.includes("Syntax")) && fix.suggested_description && (
            <div style={{ background: "#f0f9ff", borderRadius: "6px", padding: "10px 12px" }}>
              <p style={{ margin: "0 0 4px 0", fontSize: "11px", fontWeight: 700, color: "#0369a1", textTransform: "uppercase", letterSpacing: "0.4px" }}>AI-generated placeholder</p>
              <p style={{ margin: 0, fontSize: "13px", color: "#0c4a6e", lineHeight: 1.6 }}>{fix.suggested_description}</p>
            </div>
          )}

          {/* Image violation */}
          {isImageViolation && fix.issue_detail && (
            <p style={{ margin: 0, fontSize: "12px", color: "#7e22ce" }}>{fix.issue_detail}</p>
          )}

          {showSteps && fix.manual_steps?.length > 0 && (
            <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px solid #e5e7eb" }}>
              <p style={{ margin: "0 0 6px 0", fontSize: "11px", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.4px" }}>Manual fix steps</p>
              <ol style={{ margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "4px" }}>
                {fix.manual_steps.map((step: string, si: number) => (
                  <li key={si} style={{ fontSize: "12px", color: "#374151", lineHeight: 1.6 }}>{step}</li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      {!fix && fixState !== "loading" && product.merchant_friendly_description && (
        <div style={{ padding: "10px 14px", borderTop: "1px solid #e5e7eb" }}>
          <p style={{ margin: 0, fontSize: "12px", color: "#374151", lineHeight: 1.6 }}>{product.merchant_friendly_description}</p>
        </div>
      )}
    </div>
  );
}

// ── Collapsible product title list ───────────────────────────────────────────

function CollapsibleProductList({ products, defaultOpen }: { products: any[]; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border: "1px solid #f3f4f6", borderRadius: "8px", overflow: "hidden" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", padding: "8px 12px", background: "#f9fafb",
          border: "none", cursor: "pointer", display: "flex", alignItems: "center",
          justifyContent: "space-between", gap: "8px",
        }}
      >
        <span style={{ fontSize: "12px", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          Affected Products ({products.length})
        </span>
        <span style={{ fontSize: "11px", color: "#9ca3af" }}>{open ? "▲ Hide" : "▼ Show"}</span>
      </button>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: "2px", padding: "8px", maxHeight: "220px", overflowY: products.length > 7 ? "auto" : "visible" }}>
          {products.map((p: any, pi: number) => (
            <div key={p.product_id || p.id || pi} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "5px 8px", background: "white", borderRadius: "5px" }}>
              <span style={{ fontSize: "11px", color: "#9ca3af", fontWeight: 700, minWidth: "18px" }}>{pi + 1}.</span>
              <span style={{ fontSize: "12px", color: "#212121", fontWeight: 500 }}>
                {p.product_title || p.title || p.product_id || p.id}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Identifier group editor (GTIN + MPN with research + Save All) ─────────────

type IdentRow = {
  productId: string; title: string;
  gtin: string; mpn: string;
  confidence: string | null; reasoning: string; manual_steps: string[];
  saveState: "idle" | "saving" | "saved" | "error"; saveError: string;
};

const GTIN_DIRECTORIES = [
  { key: "general",     label: "General Catalog",    icon: "🌐", desc: "Broad AI product knowledge across all categories" },
  { key: "electronics", label: "Electronics & Tech",  icon: "💻", desc: "Phones, laptops, gadgets, accessories" },
  { key: "apparel",     label: "Apparel & Fashion",   icon: "👗", desc: "Clothing, footwear, bags, sportswear" },
  { key: "food",        label: "Open Food Facts",     icon: "🥗", desc: "Food & grocery — live Open Food Facts database" },
] as const;
type DirectoryKey = typeof GTIN_DIRECTORIES[number]["key"];

function IdentifierGroupEditor({
  products, fixes, scanId, onSaveComplete,
}: {
  products: any[]; fixes: any[]; scanId: string;
  onSaveComplete?: (allFixed: boolean, remaining: number) => void;
}) {
  const initRows = (): IdentRow[] =>
    products.map((p: any) => {
      const fix = fixes.find((f: any) => f.product_id === (p.product_id || p.id)) || {};
      return {
        productId: p.product_id || p.id,
        title: p.product_title || p.title || p.product_id || p.id,
        gtin: fix.suggested_gtin || "",
        mpn: fix.suggested_mpn || p.mpn || "",
        confidence: fix.confidence || null,
        reasoning: fix.reasoning || "",
        manual_steps: fix.manual_steps || [],
        saveState: "idle",
        saveError: "",
      };
    });

  const [rows, setRows] = useState<IdentRow[]>(initRows);
  const [researchState, setResearchState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [researchError, setResearchError] = useState("");
  const [researchDir, setResearchDir] = useState<DirectoryKey>("general");
  const [nearestCount, setNearestCount] = useState(0);
  const [saveAllState, setSaveAllState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [saveAllMsg, setSaveAllMsg] = useState("");

  const updateRow = (productId: string, field: "gtin" | "mpn", value: string) =>
    setRows(prev => prev.map(r => r.productId === productId ? { ...r, [field]: value } : r));

  const saveSingleRow = async (productId: string) => {
    const row = rows.find(r => r.productId === productId);
    if (!row) return;
    setRows(prev => prev.map(r => r.productId === productId ? { ...r, saveState: "saving", saveError: "" } : r));
    try {
      const res = await fetch("/api/advanced-scan/save-product-fix", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, fixType: "identifiers", fields: { gtin: row.gtin, mpn: row.mpn } }),
      });
      const data = await res.json();
      const state = (!res.ok || data.error) ? "error" : "saved";
      setRows(prev => prev.map(r => r.productId === productId ? { ...r, saveState: state, saveError: data.error || "" } : r));
    } catch {
      setRows(prev => prev.map(r => r.productId === productId ? { ...r, saveState: "error", saveError: "Network error." } : r));
    }
  };

  const handleSaveAll = async () => {
    setSaveAllState("saving"); setSaveAllMsg("");
    try {
      const res = await fetch("/api/advanced-scan/save-identifiers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scanId,
          rows: rows.map(r => ({ productId: r.productId, brand: null, gtin: r.gtin || null, mpn: r.mpn || null })),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setSaveAllState("error"); setSaveAllMsg(data.error || "Save failed."); return; }
      // Count how many still have no GTIN (need manual entry)
      const blankAtSave = rows.filter(r => !r.gtin.trim()).length;
      setSaveAllState("done");
      setSaveAllMsg(blankAtSave > 0
        ? `Saved. ${blankAtSave} product${blankAtSave > 1 ? "s" : ""} still need manual GTIN entry.`
        : data.message || "All saved.");
      setRows(prev => prev.map(r => ({ ...r, saveState: "saved" })));
      onSaveComplete?.(blankAtSave === 0, blankAtSave);
    } catch { setSaveAllState("error"); setSaveAllMsg("Network error."); }
  };

  const handleResearch = async () => {
    const blankRows = rows.filter(r => !r.gtin.trim());
    if (!blankRows.length) return;
    // Collect all currently-filled GTINs to send as exclusion list
    const filledGtins = rows.filter(r => r.gtin.trim()).map(r => r.gtin.trim());
    setResearchState("loading"); setResearchError(""); setNearestCount(0);
    try {
      const res = await fetch("/api/advanced-scan/gtin-research", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          products: blankRows.map(r => ({ id: r.productId, title: r.title, mpn: r.mpn || undefined })),
          directory: researchDir,
          existingGtins: filledGtins,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setResearchState("error"); setResearchError(data.error || "Research failed."); return; }

      const resultsMap: Record<string, any> = {};
      (data.results || []).forEach((r: any) => { resultsMap[r.id] = r; });

      // Client-side duplicate guard: also reject any GTIN that appears more than once in the result set
      const seenGtins = new Set<string>();
      let nearest = 0;
      setRows(prev => {
        const next = prev.map(r => {
          if (r.gtin.trim()) return r; // already filled — skip
          const found = resultsMap[r.productId];
          if (!found?.gtin) return r;
          if (seenGtins.has(found.gtin)) {
            // Duplicate within results — reject
            return { ...r, reasoning: "Duplicate GTIN detected — not applied. Try a different directory." };
          }
          seenGtins.add(found.gtin);
          if (found.is_nearest) nearest++;
          return {
            ...r,
            gtin: found.gtin,
            confidence: found.confidence || null,
            reasoning: found.is_nearest
              ? `⚠ Nearest match: ${found.nearest_note || found.source}`
              : (found.source || ""),
            isNearest: !!found.is_nearest,
          };
        });
        setNearestCount(nearest);
        return next;
      });
      setResearchState("done");
    } catch { setResearchState("error"); setResearchError("Network error."); }
  };

  const blankGtinCount = rows.filter(r => !r.gtin.trim()).length;
  const researchCreditCost = Math.max(1, Math.ceil(blankGtinCount / 5));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* Verify notice */}
      <div style={{ padding: "10px 14px", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "8px" }}>
        <p style={{ margin: 0, fontSize: "12px", color: "#92400e", lineHeight: 1.6 }}>
          <strong>⚠ Verify GTINs before saving</strong> — AI suggestions are based on product title knowledge.
          Cross-check against the{" "}
          <a href="https://www.gs1.org/services/verified-by-gs1" target="_blank" rel="noreferrer" style={{ color: "#92400e", fontWeight: 700 }}>GS1 database</a>{" "}
          or your manufacturer. Incorrect GTINs cause disapprovals.
        </p>
      </div>

      {/* Edit rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {rows.map((row, i) => (
          <div key={row.productId} style={{ border: "1px solid #e5e7eb", borderRadius: "8px", background: "white", overflow: "hidden" }}>
            <div style={{ padding: "9px 12px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              {/* Index + title */}
              <span style={{ fontSize: "11px", color: "#9ca3af", fontWeight: 700, minWidth: "18px", flexShrink: 0 }}>{i + 1}.</span>
              <div style={{ flex: 1, minWidth: "120px" }}>
                <p style={{ margin: "0 0 3px 0", fontSize: "13px", fontWeight: 700, color: "#212121" }}>{row.title}</p>
                <div style={{ display: "flex", gap: "5px", alignItems: "center", flexWrap: "wrap" }}>
                  {row.confidence && <ConfidenceBadge confidence={row.confidence} hasGtin={!!row.gtin} />}
                  {(row as any).isNearest && (
                    <span style={{ padding: "1px 7px", borderRadius: "4px", fontSize: "10px", fontWeight: 700, background: "#fdf4ff", color: "#7e22ce", border: "1px solid #e9d5ff" }}>
                      ~ Nearest Match
                    </span>
                  )}
                </div>
                {row.reasoning && (
                  <p style={{ margin: "3px 0 0 0", fontSize: "10px", color: (row as any).isNearest ? "#7e22ce" : "#9ca3af", fontStyle: "italic", lineHeight: 1.4 }}>
                    {row.reasoning}
                  </p>
                )}
              </div>
              {/* Inputs */}
              <div style={{ display: "flex", alignItems: "flex-end", gap: "6px", flexShrink: 0, flexWrap: "wrap" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <label style={{ fontSize: "10px", color: "#6b7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.4px" }}>GTIN</label>
                  <input
                    type="text" value={row.gtin}
                    onChange={e => updateRow(row.productId, "gtin", e.target.value)}
                    placeholder="Barcode / EAN"
                    disabled={row.saveState === "saved" || saveAllState === "done"}
                    style={{ padding: "5px 8px", border: `1px solid ${row.gtin ? "#86efac" : "#d1d5db"}`, borderRadius: "6px", fontSize: "12px", fontFamily: "monospace", outline: "none", width: "140px", background: row.saveState === "saved" ? "#f9fafb" : "white" }}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <label style={{ fontSize: "10px", color: "#6b7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.4px" }}>MPN</label>
                  <input
                    type="text" value={row.mpn}
                    onChange={e => updateRow(row.productId, "mpn", e.target.value)}
                    placeholder="SKU / MPN"
                    disabled={row.saveState === "saved" || saveAllState === "done"}
                    style={{ padding: "5px 8px", border: `1px solid ${row.mpn ? "#86efac" : "#d1d5db"}`, borderRadius: "6px", fontSize: "12px", fontFamily: "monospace", outline: "none", width: "100px", background: row.saveState === "saved" ? "#f9fafb" : "white" }}
                  />
                </div>
                {/* Per-row save */}
                <SaveButton state={row.saveState === "saved" ? "saved" : (saveAllState === "done" ? "saved" : row.saveState)} onClick={() => saveSingleRow(row.productId)} />
              </div>
            </div>
            {row.saveState === "error" && (
              <div style={{ padding: "5px 12px", borderTop: "1px solid #fca5a5", background: "#fef2f2" }}>
                <p style={{ margin: 0, fontSize: "11px", color: "#d72c0d" }}>✕ {row.saveError}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── GTIN Research section ─────────────────────────────────────────── */}
      <div style={{ border: "1px solid #e5e7eb", borderRadius: "10px", overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
            <div>
              <p style={{ margin: "0 0 2px 0", fontSize: "13px", fontWeight: 700, color: "#212121" }}>
                🔍 GTIN Research
              </p>
              <p style={{ margin: 0, fontSize: "12px", color: "#6b7280" }}>
                {blankGtinCount > 0
                  ? `Researches ${blankGtinCount} product${blankGtinCount > 1 ? "s" : ""} with blank GTINs · `
                  : "All GTINs filled · "}
                <strong>{blankGtinCount > 0 ? `${researchCreditCost} credit${researchCreditCost > 1 ? "s" : ""}` : "0 credits"}</strong>
                {blankGtinCount > 0 && <span style={{ color: "#9ca3af" }}> (1 per 5 products)</span>}
              </p>
            </div>
            {blankGtinCount === 0 && (
              <span style={{ fontSize: "12px", fontWeight: 700, color: "#166534" }}>✓ No blanks remaining</span>
            )}
          </div>
        </div>

        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
          {/* Dropdown + button — joined input-group style */}
          <div style={{ display: "flex", alignItems: "stretch", gap: "0", maxWidth: "480px" }}>
            <select
              value={researchDir}
              onChange={e => setResearchDir(e.target.value as DirectoryKey)}
              disabled={researchState === "loading" || blankGtinCount === 0 || saveAllState === "done"}
              style={{
                flex: 1,
                padding: "9px 12px",
                border: "1px solid #d1d5db",
                borderRight: "none",
                borderRadius: "8px 0 0 8px",
                fontSize: "13px",
                fontWeight: 500,
                background: blankGtinCount === 0 ? "#f9fafb" : "white",
                color: blankGtinCount === 0 ? "#9ca3af" : "#212121",
                cursor: blankGtinCount === 0 ? "not-allowed" : "pointer",
                outline: "none",
                appearance: "auto",
              }}
            >
              {GTIN_DIRECTORIES.map(dir => (
                <option key={dir.key} value={dir.key}>{dir.icon}  {dir.label}</option>
              ))}
            </select>

            <button
              onClick={handleResearch}
              disabled={researchState === "loading" || blankGtinCount === 0 || saveAllState === "done"}
              style={{
                display: "flex", alignItems: "center", gap: "6px",
                padding: "9px 18px",
                background: blankGtinCount === 0 ? "#9ca3af" : researchState === "loading" ? "#2a6b7c" : "#1a4a5a",
                color: "white",
                border: "none",
                borderRadius: "0 8px 8px 0",
                fontSize: "13px", fontWeight: 700,
                cursor: blankGtinCount === 0 || researchState === "loading" ? "not-allowed" : "pointer",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {researchState === "loading"
                ? <><Spinner size="small" />&nbsp;Searching…</>
                : "🔍 Research GTINs"}
            </button>
          </div>

          {/* Directory hint text */}
          <p style={{ margin: 0, fontSize: "11px", color: "#9ca3af" }}>
            {GTIN_DIRECTORIES.find(d => d.key === researchDir)?.desc}
            {blankGtinCount > 0 && (
              <> · <strong>{researchCreditCost} credit{researchCreditCost > 1 ? "s" : ""}</strong> for {blankGtinCount} product{blankGtinCount > 1 ? "s" : ""} (1 per 5)</>
            )}
          </p>

          {/* Feedback */}
          {researchState === "error" && (
            <p style={{ margin: 0, fontSize: "12px", color: "#d72c0d" }}>✕ {researchError}</p>
          )}
          {researchState === "done" && (
            <p style={{ margin: 0, fontSize: "12px", color: "#166534", fontWeight: 600 }}>
              ✓ Research complete.{nearestCount > 0 ? ` ${nearestCount} nearest-match GTIN${nearestCount > 1 ? "s" : ""} found (marked ~ Nearest Match) — verify before saving.` : " Review GTINs above and save."}
            </p>
          )}
        </div>
      </div>

      {/* ── Save All button ───────────────────────────────────────────────── */}
      <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
          {saveAllState === "done" ? (
            <span style={{ fontSize: "13px", fontWeight: 700, color: saveAllMsg.includes("still need") ? "#92400e" : "#166534" }}>
              {saveAllMsg.includes("still need") ? "⚠" : "✓"} {saveAllMsg}
            </span>
          ) : (
            <button
              onClick={handleSaveAll}
              disabled={saveAllState === "saving"}
              style={{
                display: "flex", alignItems: "center", gap: "8px",
                padding: "10px 24px",
                background: saveAllState === "saving" ? "#9ca3af" : "#166534",
                color: "white", border: "none", borderRadius: "8px",
                fontSize: "14px", fontWeight: 700,
                cursor: saveAllState === "saving" ? "not-allowed" : "pointer",
                minWidth: "200px", justifyContent: "center",
              }}
            >
              {saveAllState === "saving" ? <><Spinner size="small" />&nbsp;Saving…</> : "💾 Save All to Shopify"}
            </button>
          )}
          {saveAllState === "error" && (
            <span style={{ fontSize: "12px", color: "#d72c0d" }}>✕ {saveAllMsg}</span>
          )}
          {saveAllState === "idle" && (
            <p style={{ margin: 0, fontSize: "11px", color: "#9ca3af" }}>
              GTIN → variant barcode · MPN → custom metafield
            </p>
          )}
        </div>
        {saveAllState === "done" && (
          <div style={{ padding: "10px 14px", background: "#f0f9ff", border: "1px solid #7dd3fc", borderRadius: "8px" }}>
            <p style={{ margin: 0, fontSize: "12px", color: "#0369a1", lineHeight: 1.6 }}>
              💡 <strong>Run a new scan</strong> to verify all fixes are detected correctly. The next Advanced Scan will check whether saved GTINs are now compliant with Google Merchant Center.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Non-identifier fix group (Pricing / Description / Image) with Save All ────

function NonIdentifierFixGroup({
  products, fixes, violationType, scanId, onSaveComplete,
}: {
  products: any[]; fixes: any[]; violationType: string; scanId: string;
  onSaveComplete?: (allFixed: boolean, remaining: number) => void;
}) {
  const isDesc    = violationType?.includes("Description") || violationType?.includes("Syntax");
  const isPricing = violationType?.includes("Pricing");
  const [saveAllState, setSaveAllState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [saveAllMsg, setSaveAllMsg]     = useState("");

  // Track individually saved products — when all done, bubble up onSaveComplete
  const savedIdsRef = useRef<Set<string>>(new Set());
  const handleProductSaved = (productId: string) => {
    savedIdsRef.current.add(productId);
    if (savedIdsRef.current.size >= products.length) {
      onSaveComplete?.(true, 0);
    }
  };

  // Refs to collect current values from child rows
  const rowValuesRef = useRef<Record<string, { description?: string; compare_at_price?: string }>>({});
  const setRowValue = (productId: string, field: string, value: string) => {
    if (!rowValuesRef.current[productId]) rowValuesRef.current[productId] = {};
    (rowValuesRef.current[productId] as any)[field] = value;
  };

  const handleSaveAll = async () => {
    setSaveAllState("saving"); setSaveAllMsg("");
    try {
      const calls = products.map(async (p: any) => {
        const pid = p.product_id || p.id;
        const fix = fixes.find((f: any) => f.product_id === pid);
        if (!fix) return { pid, ok: true };

        const stored = rowValuesRef.current[pid] || {};
        let fixType = ""; let fields: any = {};
        if (isDesc)    { fixType = "description"; fields = { description: stored.description || fix.suggested_description || "" }; }
        if (isPricing) { fixType = "pricing";     fields = { compare_at_price: stored.compare_at_price || String(fix.suggested_compare_at_price || "") }; }
        if (!fixType) return { pid, ok: true };

        const res  = await fetch("/api/advanced-scan/save-product-fix", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: pid, fixType, fields }),
        });
        const data = await res.json();
        return { pid, ok: res.ok && !data.error, error: data.error };
      });

      const results = await Promise.all(calls);
      const failed = results.filter(r => !r.ok);
      if (failed.length) {
        setSaveAllState("error");
        setSaveAllMsg(`${failed.length} product${failed.length > 1 ? "s" : ""} failed to save. Check individual rows.`);
        onSaveComplete?.(false, failed.length);
      } else {
        setSaveAllState("done");
        setSaveAllMsg(`All ${products.length} products saved successfully.`);
        onSaveComplete?.(true, 0);
      }
    } catch { setSaveAllState("error"); setSaveAllMsg("Network error. Please try again."); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {products.map((product: any, pi: number) => {
        const fix = fixes.find((f: any) => f.product_id === (product.product_id || product.id)) || null;
        return (
          <ProductInlineEditRow
            key={product.product_id || product.id || pi}
            index={pi}
            product={product}
            fix={fix}
            violationType={violationType}
            scanId={scanId}
            onValueChange={(field, value) => setRowValue(product.product_id || product.id, field, value)}
            onSaved={handleProductSaved}
          />
        );
      })}

      {/* Save All */}
      <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
          {saveAllState === "done" ? (
            <span style={{ fontSize: "13px", fontWeight: 700, color: "#166534" }}>✓ {saveAllMsg}</span>
          ) : (
            <button
              onClick={handleSaveAll}
              disabled={saveAllState === "saving"}
              style={{
                display: "flex", alignItems: "center", gap: "8px",
                padding: "10px 24px",
                background: saveAllState === "saving" ? "#9ca3af" : "#166534",
                color: "white", border: "none", borderRadius: "8px",
                fontSize: "14px", fontWeight: 700,
                cursor: saveAllState === "saving" ? "not-allowed" : "pointer",
                minWidth: "200px", justifyContent: "center",
              }}
            >
              {saveAllState === "saving" ? <><Spinner size="small" />&nbsp;Saving…</> : "💾 Save All to Shopify"}
            </button>
          )}
          {saveAllState === "error" && (
            <span style={{ fontSize: "12px", color: "#d72c0d" }}>✕ {saveAllMsg}</span>
          )}
        </div>
        {saveAllState === "done" && (
          <div style={{ padding: "10px 14px", background: "#f0f9ff", border: "1px solid #7dd3fc", borderRadius: "8px" }}>
            <p style={{ margin: 0, fontSize: "12px", color: "#0369a1", lineHeight: 1.6 }}>
              💡 <strong>Run a new scan</strong> to verify all fixes are detected correctly. The next Advanced Scan will check whether the saved values are now compliant with Google Merchant Center.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Violation group card ──────────────────────────────────────────────────────

function ViolationGroupCard({
  violationType,
  products,
  scanId,
  persistedFixes,
  persistedSaveResults,
  persistedManualFixed,
}: {
  violationType: string;
  products: any[];
  scanId: string;
  persistedFixes: any[] | null;
  persistedSaveResults: Array<{ productId: string; success: boolean; error?: string }> | null;
  persistedManualFixed?: boolean;
}) {
  const cs = violationColor(violationType);
  const credits = calcGroupCredits(products.length);
  const canAutofix = isAutofixable(violationType);
  const isIdentifier = violationType?.includes("Identifier");

  const [expanded, setExpanded] = useState(false);
  const [fixState, setFixState] = useState<"idle" | "confirming" | "loading" | "done" | "error">(
    persistedFixes ? "done" : "idle"
  );
  const [fixes, setFixes] = useState<any[]>(persistedFixes || []);
  const [errorMsg, setErrorMsg] = useState("");
  const [manuallyFixed, setManuallyFixed] = useState(persistedManualFixed || false);
  const [markingFixed, setMarkingFixed] = useState(false);
  // Tracks save completion reported by child save-group components
  const [saveStatus, setSaveStatus] = useState<{ allFixed: boolean; remaining: number } | null>(
    persistedSaveResults ? {
      allFixed: persistedSaveResults.every(r => r.success),
      remaining: persistedSaveResults.filter(r => !r.success).length,
    } : null
  );

  const handleMarkGroupFixed = async (unmark = false) => {
    setMarkingFixed(true);
    try {
      await fetch("/api/advanced-scan/mark-group-fixed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanId, violationType, unmark }),
      });
      setManuallyFixed(!unmark);
    } catch { /* non-fatal — state is still updated optimistically */ }
    setMarkingFixed(false);
  };

  const handleAutoFix = async () => {
    setFixState("loading");
    setErrorMsg("");
    try {
      const res = await fetch("/api/advanced-scan/group-fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanId, violationType, products }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setFixState("error"); setErrorMsg(data.error || "Auto-fix failed."); return; }
      setFixes(data.fixes || []);
      setFixState("done");
    } catch {
      setFixState("error");
      setErrorMsg("Network error. Please try again.");
    }
  };

  const isSaved = persistedSaveResults?.some(r => r.success);

  return (
    <div style={{ border: `1px solid ${cs.border}`, borderRadius: "12px", overflow: "hidden", background: "white" }}>
      {/* Header */}
      <div
        style={{ padding: "16px 18px", background: cs.bg, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}
        onClick={() => setExpanded(e => !e)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: "22px", flexShrink: 0 }}>{cs.icon}</span>
          <div>
            <p style={{ margin: "0 0 2px 0", fontSize: "15px", fontWeight: 700, color: "#212121" }}>{violationType}</p>
            <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: "13px", fontWeight: 600, color: cs.color }}>
                {products.length} product{products.length !== 1 ? "s" : ""} affected
              </span>
              {/* Save status badges — priority order: saved > suggestions ready */}
              {manuallyFixed && (
                <span style={{ padding: "2px 9px", borderRadius: "4px", fontSize: "11px", fontWeight: 700, background: "#f0fdf4", color: "#166534", border: "1px solid #86efac" }}>
                  ✓ Marked as Fixed
                </span>
              )}
              {!manuallyFixed && saveStatus?.allFixed && (
                <span style={{ padding: "2px 9px", borderRadius: "4px", fontSize: "11px", fontWeight: 700, background: "#f0fdf4", color: "#166534", border: "1px solid #86efac" }}>
                  ✓ All Issues Fixed
                </span>
              )}
              {!manuallyFixed && saveStatus && !saveStatus.allFixed && saveStatus.remaining > 0 && (
                <span style={{ padding: "2px 9px", borderRadius: "4px", fontSize: "11px", fontWeight: 700, background: "#fffbeb", color: "#92400e", border: "1px solid #fcd34d" }}>
                  ⚠ {saveStatus.remaining} Manual Fix{saveStatus.remaining > 1 ? "es" : ""} Still Required
                </span>
              )}
              {!manuallyFixed && !saveStatus && fixState === "done" && !isSaved && (
                <span style={{ padding: "2px 9px", borderRadius: "4px", fontSize: "11px", fontWeight: 700, background: "#f0fdf4", color: "#166534", border: "1px solid #86efac" }}>✓ Suggestions Ready</span>
              )}
              {!manuallyFixed && !saveStatus && isSaved && (
                <span style={{ padding: "2px 9px", borderRadius: "4px", fontSize: "11px", fontWeight: 700, background: "#f0fdf4", color: "#166534", border: "1px solid #86efac" }}>✓ Saved to Shopify</span>
              )}
            </div>
          </div>
        </div>
        {/* Mark as Fixed button always visible in header when not already fixed */}
        {!manuallyFixed && !saveStatus?.allFixed && (
          <button
            onClick={(e) => { e.stopPropagation(); handleMarkGroupFixed(false); }}
            disabled={markingFixed}
            title="Mark all products in this group as fixed manually"
            style={{
              display: "inline-flex", alignItems: "center", gap: "5px",
              padding: "5px 12px", background: "white", color: "#166534",
              border: "1px solid #86efac", borderRadius: "6px",
              fontSize: "12px", fontWeight: 600, flexShrink: 0,
              cursor: markingFixed ? "wait" : "pointer",
            }}
          >
            {markingFixed ? "Saving…" : "✓ Mark as Fixed"}
          </button>
        )}
        <span style={{ fontSize: "13px", color: "#6b7280", flexShrink: 0 }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${cs.border}`, padding: "18px", display: "flex", flexDirection: "column", gap: "16px" }}>

          {/* Error banner */}
          {fixState === "error" && (
            <div style={{ padding: "12px 16px", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "8px" }}>
              <p style={{ margin: 0, fontSize: "13px", color: "#d72c0d" }}>✕ {errorMsg}</p>
            </div>
          )}

          {/* Manually marked fixed banner */}
          {manuallyFixed && (
            <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "8px", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "20px" }}>✅</span>
                <div>
                  <p style={{ margin: "0 0 2px 0", fontSize: "13px", fontWeight: 700, color: "#166534" }}>Marked as fixed manually</p>
                  <p style={{ margin: 0, fontSize: "12px", color: "#166534", opacity: 0.85 }}>
                    Run a new Advanced Scan to confirm these changes are now compliant.
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleMarkGroupFixed(true)}
                disabled={markingFixed}
                style={{
                  display: "inline-flex", alignItems: "center", gap: "5px",
                  padding: "5px 12px", background: "white", color: "#92400e",
                  border: "1px solid #fcd34d", borderRadius: "6px",
                  fontSize: "12px", fontWeight: 600, cursor: markingFixed ? "wait" : "pointer", flexShrink: 0,
                }}
              >
                ↩ Undo
              </button>
            </div>
          )}

          {/* What this violation means — hidden when all fixed or manually marked */}
          {!manuallyFixed && (saveStatus?.allFixed ? (
            <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "8px", padding: "12px 16px", display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "20px" }}>✅</span>
              <div>
                <p style={{ margin: "0 0 2px 0", fontSize: "13px", fontWeight: 700, color: "#166534" }}>All issues fixed and saved to Shopify</p>
                <p style={{ margin: 0, fontSize: "12px", color: "#166534", opacity: 0.85 }}>
                  Run a new Advanced Scan to verify these changes are now compliant with Google Merchant Center.
                </p>
              </div>
            </div>
          ) : (
            <div style={{ background: cs.bg, border: `1px solid ${cs.border}`, borderRadius: "8px", padding: "12px 16px" }}>
              <p style={{ margin: 0, fontSize: "13px", color: "#374151", lineHeight: 1.7 }}>
                {isIdentifier
                  ? "These products are missing their GTIN (barcode) or MPN — required by Google Merchant Center. Without identifiers, Google cannot match your products to its catalog and will disapprove them."
                  : violationType.includes("Pricing")
                  ? "The Compare-at price (MRP) on these products is equal to or lower than the sale price. Google treats this as deceptive pricing and will disapprove the products."
                  : violationType.includes("Description")
                  ? "These products have no description or are missing mandatory attributes. Google requires a description to show products in Shopping ads."
                  : violationType.includes("Image")
                  ? "These product images are too small (under 100×100px) or contain promotional overlays. Google rejects images that don't meet its quality standards."
                  : "These products have compliance issues that need to be resolved before they can be approved in Google Merchant Center."}
              </p>
            </div>
          ))}

          {/* Affected product list + Auto Fix only shown when NOT manually marked fixed */}
          {!manuallyFixed && <CollapsibleProductList
            products={products}
            defaultOpen={fixState !== "done"}
          />}

          {/* Auto Fix / Re-run button — always visible for fixable types */}
          {!manuallyFixed && canAutofix && (
            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              {fixState === "loading" ? (
                <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 16px", background: "#f9fafb", borderRadius: "8px", border: "1px solid #e5e7eb", flex: 1 }}>
                  <Spinner size="small" />
                  <p style={{ margin: 0, fontSize: "13px", color: "#6b7280" }}>
                    Analyzing {products.length} product{products.length !== 1 ? "s" : ""}…
                  </p>
                </div>
              ) : (
                <button
                  onClick={handleAutoFix}
                  style={{
                    display: "flex", alignItems: "center", gap: "8px",
                    padding: "9px 20px",
                    background: fixState === "done" ? "#f9fafb" : "#1a4a5a",
                    color: fixState === "done" ? "#374151" : "white",
                    border: fixState === "done" ? "1px solid #d1d5db" : "none",
                    borderRadius: "8px", fontSize: "13px", fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {fixState === "done" ? "🔄 Re-run Auto Fix" : `🔧 Auto Fix All`}
                </button>
              )}
              <span style={{ fontSize: "12px", color: "#9ca3af" }}>
                {fixState === "done"
                  ? `Re-runs AI for all ${products.length} products · ${credits} credit${credits > 1 ? "s" : ""}`
                  : `${credits} credit${credits > 1 ? "s" : ""} · AI generates fixes for all ${products.length} products`}
              </span>
            </div>
          )}

          {/* After auto-fix: identifier group editor OR per-product rows */}
          {!manuallyFixed && fixState === "done" && isIdentifier && (
            <IdentifierGroupEditor
              products={products}
              fixes={fixes}
              scanId={scanId}
              onSaveComplete={(allFixed, remaining) => setSaveStatus({ allFixed, remaining })}
            />
          )}
          {!manuallyFixed && fixState === "done" && !isIdentifier && (
            <NonIdentifierFixGroup
              products={products}
              fixes={fixes}
              violationType={violationType}
              scanId={scanId}
              onSaveComplete={(allFixed, remaining) => setSaveStatus({ allFixed, remaining })}
            />
          )}

          {/* ── Mark as Done — always shown when fix suggestions are ready, not already marked ── */}
          {!manuallyFixed && fixState === "done" && !saveStatus?.allFixed && (
            <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: "14px", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              <button
                onClick={() => setSaveStatus({ allFixed: true, remaining: 0 })}
                style={{
                  display: "flex", alignItems: "center", gap: "7px",
                  padding: "9px 20px",
                  background: "#166534", color: "white",
                  border: "none", borderRadius: "8px",
                  fontSize: "13px", fontWeight: 700, cursor: "pointer",
                }}
              >
                ✓ Mark All as Fixed
              </button>
              <p style={{ margin: 0, fontSize: "12px", color: "#9ca3af" }}>
                Click after saving all products to update the status
              </p>
            </div>
          )}

          {/* Link to Product Editor */}
          <div style={{ padding: "14px 16px", background: "#f0f9ff", border: "1px solid #7dd3fc", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
            <div>
              <p style={{ margin: "0 0 2px 0", fontSize: "13px", fontWeight: 700, color: "#0369a1" }}>💡 Need per-product deep fixes?</p>
              <p style={{ margin: 0, fontSize: "12px", color: "#0369a1", lineHeight: 1.5 }}>
                Use the <strong>Product Detailed Error Report</strong> for full AI rewrites, GTIN finder, SEO optimization, and more.
              </p>
            </div>
            <Link to="/app/report" style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "7px 14px", background: "#0369a1", color: "white", borderRadius: "6px", fontSize: "12px", fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap", flexShrink: 0 }}>
              Open Product Error Report →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Collapsed Basic Results accordion (shown inside Advanced/Deep) ────────────

// ── Shared collapsible section shell ─────────────────────────────────────────

function ScanSection({
  icon, title, badgeText, badgeBg, badgeColor, badgeBorder,
  defaultOpen, children,
}: {
  icon: string; title: string;
  badgeText: string; badgeBg: string; badgeColor: string; badgeBorder: string;
  defaultOpen: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: "12px", overflow: "hidden" }}>
      <div
        style={{ padding: "14px 18px", background: "#f9fafb", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}
        onClick={() => setOpen(o => !o)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "18px" }}>{icon}</span>
          <p style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "#212121" }}>{title}</p>
          <span style={{ padding: "2px 9px", borderRadius: "4px", fontSize: "11px", fontWeight: 700, background: badgeBg, color: badgeColor, border: `1px solid ${badgeBorder}` }}>
            {badgeText}
          </span>
        </div>
        <span style={{ fontSize: "12px", color: "#6b7280", whiteSpace: "nowrap" }}>{open ? "▲ Collapse" : "▼ Expand"}</span>
      </div>
      {open && (
        <div style={{ padding: "18px", borderTop: "1px solid #e5e7eb" }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Basic results inside Advanced/Deep ───────────────────────────────────────

function CollapsedBasicResults({
  basicResult, credits, fixStates, setFixStates, savedDetails, onDetailsSaved, scanId,
}: {
  basicResult: any; credits: number;
  fixStates: Map<string, IssueFixState>;
  setFixStates: React.Dispatch<React.SetStateAction<Map<string, IssueFixState>>>;
  savedDetails: Partial<StoreDetails>; onDetailsSaved: (d: StoreDetails) => void;
  scanId: string;
}) {
  if (!basicResult || basicResult._error) return null;

  const summary = basicResult.scan_summary;
  const risk = summary?.overall_risk || "Medium";
  const rs = riskStyle(risk);
  const totalIssues = [
    ...(basicResult.missing_pages || []),
    ...(basicResult.broken_links || []),
    ...(basicResult.merchant_center_compliance || []),
    ...(basicResult.customer_trust_and_policy || []),
    ...(basicResult.site_structure_and_seo || []),
  ].length;

  const badgeText = totalIssues === 0 ? "✓ All Clear" : `${totalIssues} issue${totalIssues !== 1 ? "s" : ""} · ${risk} Risk`;

  return (
    <ScanSection
      icon="🏪" title="Store-Level Compliance"
      badgeText={badgeText}
      badgeBg={totalIssues === 0 ? "#f0fdf4" : rs.bg}
      badgeColor={totalIssues === 0 ? "#166534" : rs.color}
      badgeBorder={totalIssues === 0 ? "#86efac" : rs.border}
      defaultOpen={true}
    >
      <ScanResults
        scan={{ id: scanId, type: "BASIC", updatedAt: new Date().toISOString(), result: basicResult }}
        credits={credits}
        fixStates={fixStates}
        setFixStates={setFixStates}
        savedDetails={savedDetails}
        onDetailsSaved={onDetailsSaved}
      />
    </ScanSection>
  );
}

// ── Advanced error panel (inner content) ─────────────────────────────────────

function AdvancedErrorPanel({ advancedResult, scanId, groupFixes }: {
  advancedResult: any; scanId: string; groupFixes: any;
}) {
  const errors: any[] = advancedResult?.errors_found || [];
  const warnings: string[] = advancedResult?.store_warnings || [];

  const persistedGroupFixes: Record<string, any[]> = groupFixes
    ? Object.fromEntries(Object.entries(groupFixes).map(([k, v]: [string, any]) => [k, v.fixes || []]))
    : {};
  const persistedSaveResults: Record<string, any> = groupFixes
    ? Object.fromEntries(Object.entries(groupFixes).map(([k, v]: [string, any]) => [k, v.saveResults || null]))
    : {};
  const persistedManualFixed: Record<string, boolean> = groupFixes
    ? Object.fromEntries(Object.entries(groupFixes).map(([k, v]: [string, any]) => [k, !!v.manuallyFixed]))
    : {};

  const groups = errors.reduce((acc: Record<string, any[]>, err: any) => {
    const key = err.policy_violation_type || err.issue_type || "Other";
    if (!acc[key]) acc[key] = [];
    acc[key].push(err);
    return acc;
  }, {});

  const uniqueProductsAffected = new Set(errors.map((e: any) => e.product_id)).size;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* Stats row */}
      <div style={{ display: "flex", gap: "28px", flexWrap: "wrap" }}>
        {[
          { label: "Violation Types", value: Object.keys(groups).length, critical: Object.keys(groups).length > 0 },
          { label: "Total Issues", value: errors.length, critical: errors.length > 0 },
          { label: "Products Affected", value: uniqueProductsAffected, critical: uniqueProductsAffected > 0 },
        ].map(item => (
          <div key={item.label}>
            <p style={{ margin: "0 0 2px 0", fontSize: "11px", color: "#6b7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>{item.label}</p>
            <p style={{ margin: 0, fontSize: "22px", fontWeight: 700, color: item.critical ? "#d72c0d" : "#212121" }}>{item.value}</p>
          </div>
        ))}
      </div>

      {warnings.length > 0 && (
        <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "8px", padding: "12px 16px" }}>
          <h4 style={{ margin: "0 0 6px 0", fontSize: "13px", fontWeight: 700, color: "#92400e" }}>⚠ Store Warnings</h4>
          {warnings.map((w, i) => <p key={i} style={{ margin: i < warnings.length - 1 ? "0 0 4px 0" : 0, fontSize: "12px", color: "#78350f" }}>{w}</p>)}
        </div>
      )}

      {errors.length === 0 ? (
        <div style={{ padding: "14px 16px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "8px" }}>
          <p style={{ color: "#166534", fontSize: "14px", margin: 0, fontWeight: 600 }}>✓ No product feed issues found. Your feed looks clean!</p>
        </div>
      ) : (
        Object.entries(groups).map(([vType, groupProducts]) => (
          <ViolationGroupCard
            key={vType}
            violationType={vType}
            products={groupProducts}
            scanId={scanId}
            persistedFixes={persistedGroupFixes[vType] || null}
            persistedSaveResults={persistedSaveResults[vType] || null}
            persistedManualFixed={persistedManualFixed[vType] || false}
          />
        ))
      )}
    </div>
  );
}

function AdvancedScanResults({ scan, credits, fixStates, setFixStates, savedDetails, onDetailsSaved }: {
  scan: any; credits: number;
  fixStates: Map<string, IssueFixState>;
  setFixStates: React.Dispatch<React.SetStateAction<Map<string, IssueFixState>>>;
  savedDetails: Partial<StoreDetails>; onDetailsSaved: (d: StoreDetails) => void;
}) {
  const result = scan.result as any;
  if (!result) return null;

  // ── New chained format ─────────────────────────────────────────────────────
  if (result.scan_type === "advanced" && result.advanced_result) {
    const adv = result.advanced_result;
    const advErrors: any[] = adv?.errors_found || [];
    const advBadgeText = adv?.status === "pass" ? "✓ Pass" : `${new Set(advErrors.map((e: any) => e.product_id)).size} Products Affected`;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* Basic — collapsed */}
        {result.basic_result && (
          <CollapsedBasicResults
            basicResult={result.basic_result}
            credits={credits}
            fixStates={fixStates}
            setFixStates={setFixStates}
            savedDetails={savedDetails}
            onDetailsSaved={onDetailsSaved}
            scanId={scan.id}
          />
        )}
        {/* Advanced — expanded */}
        <ScanSection
          icon="🔬" title="Advanced Scan — Product Feed Analysis"
          badgeText={advBadgeText}
          badgeBg={adv?.status === "pass" ? "#f0fdf4" : "#fef2f2"}
          badgeColor={adv?.status === "pass" ? "#166534" : "#d72c0d"}
          badgeBorder={adv?.status === "pass" ? "#86efac" : "#fca5a5"}
          defaultOpen={true}
        >
          <AdvancedErrorPanel advancedResult={adv} scanId={scan.id} groupFixes={result.group_fixes} />
        </ScanSection>
      </div>
    );
  }

  // ── Legacy format ──────────────────────────────────────────────────────────
  const errors: any[] = result.errors_found || [];
  const warnings: string[] = result.store_warnings || [];
  const groupFixes = result.group_fixes;

  const persistedGroupFixes: Record<string, any[]> = groupFixes
    ? Object.fromEntries(Object.entries(groupFixes).map(([k, v]: [string, any]) => [k, v.fixes || []]))
    : {};
  const persistedSaveResults: Record<string, any> = groupFixes
    ? Object.fromEntries(Object.entries(groupFixes).map(([k, v]: [string, any]) => [k, v.saveResults || null]))
    : {};
  const persistedManualFixed: Record<string, boolean> = groupFixes
    ? Object.fromEntries(Object.entries(groupFixes).map(([k, v]: [string, any]) => [k, !!v.manuallyFixed]))
    : {};

  const groups = errors.reduce((acc: Record<string, any[]>, err: any) => {
    const key = err.policy_violation_type || err.issue_type || "Other";
    if (!acc[key]) acc[key] = [];
    acc[key].push(err);
    return acc;
  }, {});

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {warnings.length > 0 && (
        <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "10px", padding: "16px 20px" }}>
          <h4 style={{ margin: "0 0 10px 0", fontSize: "14px", fontWeight: 700, color: "#92400e" }}>⚠ Store Warnings</h4>
          {warnings.map((w, i) => <p key={i} style={{ margin: i < warnings.length - 1 ? "0 0 6px 0" : 0, fontSize: "13px", color: "#78350f" }}>{w}</p>)}
        </div>
      )}
      {errors.length === 0 ? (
        <div className="intro-card" style={{ marginBottom: 0 }}>
          <p style={{ color: "#12a04a", fontSize: "14px", margin: 0 }}>✓ No product feed issues found.</p>
        </div>
      ) : (
        Object.entries(groups).map(([vType, groupProducts]) => (
          <ViolationGroupCard
            key={vType}
            violationType={vType}
            products={groupProducts}
            scanId={scan.id}
            persistedFixes={persistedGroupFixes[vType] || null}
            persistedSaveResults={persistedSaveResults[vType] || null}
            persistedManualFixed={persistedManualFixed[vType] || false}
          />
        ))
      )}
    </div>
  );
}

function DeepScanResults({ scan, credits, fixStates, setFixStates, savedDetails, onDetailsSaved }: {
  scan: any; credits: number;
  fixStates: Map<string, IssueFixState>;
  setFixStates: React.Dispatch<React.SetStateAction<Map<string, IssueFixState>>>;
  savedDetails: Partial<StoreDetails>; onDetailsSaved: (d: StoreDetails) => void;
}) {
  const result = scan.result as any;
  if (!result) return null;

  // ── New chained format: Basic + Advanced + Deep ─────────────────────────────
  if (result.scan_type === "deep" && (result.deep_result || result.advanced_result || result.basic_result)) {
    const adv = result.advanced_result;
    const advErrors: any[] = adv?.errors_found || [];
    const advBadgeText = !adv ? "—" : adv.status === "pass" ? "✓ Pass" : `${new Set(advErrors.map((e: any) => e.product_id)).size} Products Affected`;
    const deep = result.deep_result || {};
    const deepErrs: any[] = deep.critical_misrepresentation_errors || [];
    const deepRisk = deep.suspension_risk || "Low";
    const drs = riskStyle(deepRisk);
    const deepBadge = deepErrs.length > 0 ? `${deepErrs.length} finding${deepErrs.length !== 1 ? "s" : ""} · ${deepRisk} Risk` : `✓ ${deepRisk} Risk`;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* Store-level — prominent (opens by default) */}
        {result.basic_result && (
          <CollapsedBasicResults
            basicResult={result.basic_result}
            credits={credits}
            fixStates={fixStates}
            setFixStates={setFixStates}
            savedDetails={savedDetails}
            onDetailsSaved={onDetailsSaved}
            scanId={scan.id}
          />
        )}
        {/* Product feed */}
        {adv && (
          <ScanSection
            icon="🔬" title="Advanced Scan — Product Feed Analysis"
            badgeText={advBadgeText}
            badgeBg={adv.status === "pass" ? "#f0fdf4" : "#fef2f2"}
            badgeColor={adv.status === "pass" ? "#166534" : "#d72c0d"}
            badgeBorder={adv.status === "pass" ? "#86efac" : "#fca5a5"}
            defaultOpen={advErrors.length > 0}
          >
            <AdvancedErrorPanel advancedResult={adv} scanId={scan.id} groupFixes={result.group_fixes} />
          </ScanSection>
        )}
        {/* Suspension & misrepresentation */}
        <ScanSection
          icon="🛡️" title="Suspension & Misrepresentation Audit"
          badgeText={deepBadge}
          badgeBg={deepErrs.length > 0 ? drs.bg : "#f0fdf4"}
          badgeColor={deepErrs.length > 0 ? drs.color : "#166534"}
          badgeBorder={deepErrs.length > 0 ? drs.border : "#86efac"}
          defaultOpen={true}
        >
          <DeepPanel
            embedded
            result={deep}
            updatedAt={scan.updatedAt}
            scanId={scan.id}
            credits={credits}
            fixStates={fixStates}
            setFixStates={setFixStates}
            savedDetails={savedDetails}
            onDetailsSaved={onDetailsSaved}
          />
        </ScanSection>
      </div>
    );
  }

  // ── Legacy format: deep fields at the top level ─────────────────────────────
  const legacyErrs: any[] = result.critical_misrepresentation_errors || [];
  const legacyRisk = result.suspension_risk || "Low";
  const lrs = riskStyle(legacyRisk);
  const legacyBadge = legacyErrs.length > 0 ? `${legacyErrs.length} finding${legacyErrs.length !== 1 ? "s" : ""} · ${legacyRisk} Risk` : `✓ ${legacyRisk} Risk`;
  return (
    <ScanSection
      icon="🛡️" title="Suspension & Misrepresentation Audit"
      badgeText={legacyBadge}
      badgeBg={legacyErrs.length > 0 ? lrs.bg : "#f0fdf4"}
      badgeColor={legacyErrs.length > 0 ? lrs.color : "#166534"}
      badgeBorder={legacyErrs.length > 0 ? lrs.border : "#86efac"}
      defaultOpen={true}
    >
      <DeepPanel
        embedded
        result={result}
        updatedAt={scan.updatedAt}
        scanId={scan.id}
        credits={credits}
        fixStates={fixStates}
        setFixStates={setFixStates}
        savedDetails={savedDetails}
        onDetailsSaved={onDetailsSaved}
      />
    </ScanSection>
  );
}

// ── Deep finding card — rich header + reusable IssueCard action flow ──────────
function DeepIssueCard({
  err, index, scanId, credits, fixStates, setFixStates, savedDetails, onDetailsSaved,
}: {
  err: any; index: number; scanId: string; credits: number;
  fixStates: Map<string, IssueFixState>;
  setFixStates: React.Dispatch<React.SetStateAction<Map<string, IssueFixState>>>;
  savedDetails: Partial<StoreDetails>; onDetailsSaved: (d: StoreDetails) => void;
}) {
  const issueKey = err.issue_key || `deep_${index}`;
  const sev = (err.severity || "Medium");
  const cs = (() => {
    const s = sev.toLowerCase();
    if (s === "high") return { bg: "#fef2f2", color: "#d72c0d", border: "#fca5a5" };
    if (s === "medium") return { bg: "#fffbeb", color: "#92400e", border: "#fcd34d" };
    return { bg: "#f0f9ff", color: "#0369a1", border: "#7dd3fc" };
  })();

  // Transform the deep finding into the shape IssueCard expects so the existing,
  // battle-tested Auto-Fix + Mark-as-Fixed + StoreDetails-modal flow is reused.
  const transformedIssue = {
    issue_description: err.merchant_friendly_explanation || err.category || "",
    severity: sev,
    suggested_fix: "",
    detailed_fix_steps: err.remediation_steps || [],
    auto_fixable: !!err.auto_fixable,
    auto_fix_type: err.auto_fix_type || null,
    credit_cost: err.credit_cost || 0,
    label: err.category,
  };

  return (
    <div style={{ border: `1px solid ${cs.border}`, borderRadius: "10px", overflow: "hidden" }}>
      {/* Rich header — category, policy, fix-method badge */}
      <div style={{
        background: cs.bg, borderBottom: `1px solid ${cs.border}`,
        padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "13px", fontWeight: 700, color: cs.color }}>{err.category}</span>
          {err.auto_fixable ? (
            <span style={{ padding: "1px 7px", borderRadius: "4px", fontSize: "10px", fontWeight: 700, background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe" }}>⚡ Auto-fixable</span>
          ) : (
            <span style={{ padding: "1px 7px", borderRadius: "4px", fontSize: "10px", fontWeight: 700, background: "#f3f4f6", color: "#6b7280", border: "1px solid #d1d5db" }}>✋ Manual fix required</span>
          )}
        </div>
        {err.google_policy_violated && (
          <span style={{ fontSize: "11px", color: "#6b7280", fontStyle: "italic" }}>Policy: {err.google_policy_violated}</span>
        )}
      </div>

      <div style={{ padding: "14px 16px 0", background: "white" }}>
        {/* Evidence */}
        {err.evidence && (
          <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "6px", padding: "10px 14px", marginBottom: "14px" }}>
            <p style={{ margin: "0 0 2px 0", fontSize: "10px", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.4px" }}>Evidence</p>
            <p style={{ margin: 0, fontSize: "12px", color: "#374151" }}>{err.evidence}</p>
          </div>
        )}

        {/* Reused action card (Auto Fix / Mark as Fixed / steps / modal) */}
        <IssueCard
          issue={transformedIssue}
          issueKey={issueKey}
          scanId={scanId}
          fixStates={fixStates}
          setFixStates={setFixStates}
          credits={credits}
          allIssues={[]}
          savedDetails={savedDetails}
          onDetailsSaved={onDetailsSaved}
        />
      </div>
    </div>
  );
}

function DeepPanel({ result, updatedAt, scanId, credits, fixStates, setFixStates, savedDetails, onDetailsSaved, embedded }: {
  result: any; updatedAt: string; scanId: string; credits: number;
  fixStates: Map<string, IssueFixState>;
  setFixStates: React.Dispatch<React.SetStateAction<Map<string, IssueFixState>>>;
  savedDetails: Partial<StoreDetails>; onDetailsSaved: (d: StoreDetails) => void;
  embedded?: boolean; // rendered inside a ScanSection card — hide the duplicate heading/badge
}) {
  const errors: any[] = result.critical_misrepresentation_errors || [];
  const warnings: string[] = result.store_warnings || [];
  const passedChecks: string[] = result.passed_checks || [];
  const risk = result.suspension_risk || "Low";
  const rs = riskStyle(risk);

  // Count by severity among UNFIXED findings (a fixed finding no longer counts).
  const isFixed = (err: any, i: number) => !!fixStates.get(err.issue_key || `deep_${i}`)?.fixed;
  const unfixed = errors.filter((e, i) => !isFixed(e, i));
  const highCount = unfixed.filter(e => (e.severity || "").toLowerCase() === "high").length;
  const medCount = unfixed.filter(e => (e.severity || "").toLowerCase() === "medium").length;
  const fixedCount = errors.length - unfixed.length;
  const autoFixableCount = errors.filter(e => e.auto_fixable).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Summary */}
      <div className="intro-card" style={{ marginBottom: 0 }}>
        {!embedded && (
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px", flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "#212121" }}>Suspension Risk Audit</h3>
            <span style={{
              padding: "3px 10px", borderRadius: "4px", fontSize: "12px", fontWeight: 700,
              background: rs.bg, color: rs.color, border: `1px solid ${rs.border}`,
            }}>
              {risk} Suspension Risk
            </span>
          </div>
        )}
        {result.summary && (
          <p style={{ margin: "0 0 16px 0", fontSize: "13px", color: "#374151", lineHeight: 1.6 }}>{result.summary}</p>
        )}
        <div style={{ display: "flex", gap: "32px", flexWrap: "wrap" }}>
          {[
            { label: "High-Risk Issues", value: highCount, critical: highCount > 0 },
            { label: "Medium-Risk Issues", value: medCount, critical: false },
            { label: "Fixed", value: fixedCount, critical: false },
            { label: "Checks Passed", value: passedChecks.length, critical: false },
          ].map((item) => (
            <div key={item.label}>
              <p style={{ margin: "0 0 4px 0", fontSize: "12px", color: "#666666", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>{item.label}</p>
              <p style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: item.critical ? "#d72c0d" : "#212121" }}>{item.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "10px", padding: "16px 20px" }}>
          <h4 style={{ margin: "0 0 10px 0", fontSize: "14px", fontWeight: 700, color: "#92400e" }}>⚠ Store Warnings</h4>
          {warnings.map((w, i) => (
            <p key={i} style={{ margin: i < warnings.length - 1 ? "0 0 6px 0" : 0, fontSize: "13px", color: "#78350f" }}>{w}</p>
          ))}
        </div>
      )}

      {/* Findings */}
      <div className="intro-card" style={{ marginBottom: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", marginBottom: "16px" }}>
          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#212121" }}>
            Suspension & Misrepresentation Findings {errors.length > 0 && <span style={{ color: "#d72c0d" }}>({errors.length})</span>}
          </h3>
          {autoFixableCount > 0 && (
            <span style={{ fontSize: "12px", color: "#1d4ed8", fontWeight: 600 }}>
              ⚡ {autoFixableCount} can be auto-fixed by the system
            </span>
          )}
        </div>
        {errors.length === 0 ? (
          <p style={{ color: "#12a04a", fontSize: "14px", margin: 0 }}>✓ No suspension risks detected. Your store passes all deep compliance checks.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {errors.map((err: any, i: number) => (
              <DeepIssueCard
                key={err.issue_key || i}
                err={err}
                index={i}
                scanId={scanId}
                credits={credits}
                fixStates={fixStates}
                setFixStates={setFixStates}
                savedDetails={savedDetails}
                onDetailsSaved={onDetailsSaved}
              />
            ))}
          </div>
        )}
      </div>

      {/* Passed checks */}
      {passedChecks.length > 0 && (
        <div className="intro-card" style={{ marginBottom: 0 }}>
          <h3 style={{ margin: "0 0 12px 0", fontSize: "15px", fontWeight: 700, color: "#166534" }}>✓ Checks Passed ({passedChecks.length})</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {passedChecks.map((c, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "4px 10px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "6px", fontSize: "12px", color: "#166534", fontWeight: 500 }}>
                ✓ {c}
              </span>
            ))}
          </div>
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

// ── Normalize any scan result (basic / advanced / deep) into a flat report ─────
// Basic scans store sections at the top level; Advanced/Deep nest them under
// basic_result / advanced_result / deep_result. This unifies them for export.
function extractReportSections(result: any): {
  basic: any;
  advancedErrors: any[];
  deepErrors: any[];
  deepSummary: any;
  scanLabel: string;
} {
  if (!result) return { basic: {}, advancedErrors: [], deepErrors: [], deepSummary: null, scanLabel: "Basic" };

  if (result.scan_type === "deep") {
    return {
      basic: result.basic_result || {},
      advancedErrors: result.advanced_result?.errors_found || [],
      deepErrors: result.deep_result?.critical_misrepresentation_errors || [],
      deepSummary: result.deep_result || null,
      scanLabel: "Deep",
    };
  }
  if (result.scan_type === "advanced") {
    return {
      basic: result.basic_result || {},
      advancedErrors: result.advanced_result?.errors_found || [],
      deepErrors: [],
      deepSummary: null,
      scanLabel: "Advanced",
    };
  }
  // Legacy / basic format — sections live at the top level
  return { basic: result, advancedErrors: [], deepErrors: [], deepSummary: null, scanLabel: "Basic" };
}

// ── main page ─────────────────────────────────────────────────────────────────

// ── Auto-fix credit costs (mirrors the server's FIX_CREDIT_COSTS; for display) ─
const AUTO_FIX_CREDITS: Record<string, number> = {
  privacy_policy: 3, refund_policy: 3, shipping_policy: 3, terms_of_service: 3,
  contact_page: 2, about_page: 2, page_meta: 1, footer_links: 3, business_contact: 2,
};

// Strip HTML tags → plain text, used when copying / downloading the appeal letter
// (Google's reinstatement form is a plain-text field).
function htmlToPlainText(html: string): string {
  if (!html) return "";
  if (typeof document === "undefined") return html.replace(/<[^>]+>/g, "");
  const el = document.createElement("div");
  el.innerHTML = html.replace(/<\/(p|h[1-6]|li|ul|ol|div)>/gi, "$&\n");
  return (el.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

// ── Suspension Recovery — the full-width 4th "scan" ──────────────────────────
// Diagnoses the likely GMC suspension category, builds an auto-fixable
// remediation checklist (reusing the exact IssueCard auto-fix flow as the scans
// above), and drafts an editable, richly-formatted reinstatement letter.
function SuspensionRecoveryScan({
  credits, scanId, fixStates, setFixStates, savedDetails, onDetailsSaved,
}: {
  credits: number;
  scanId?: string;
  fixStates: Map<string, IssueFixState>;
  setFixStates: React.Dispatch<React.SetStateAction<Map<string, IssueFixState>>>;
  savedDetails: Partial<StoreDetails>;
  onDetailsSaved: (details: StoreDetails) => void;
}) {
  const CREDIT_COST = 10;
  const [statusKind, setStatusKind] = useState<"suspended" | "warning" | "preventive">("suspended");
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);
  const [err, setErr] = useState("");
  const [letterHtml, setLetterHtml] = useState("");
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setState("loading"); setErr("");
    try {
      const res = await fetch("/api/suspension-recovery", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suspensionReason: reason, statusKind }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setState("error"); setErr(data.error || "Failed to generate."); return; }
      setResult(data.result);
      setMeta(data);
      setLetterHtml(markdownToHtml(data.result?.appeal_letter || ""));
      setState("done");
      notifyAiSuccess("suspension-recovery");
    } catch { setState("error"); setErr("Network error. Please try again."); }
  };

  const copyLetter = () => {
    navigator.clipboard?.writeText(htmlToPlainText(letterHtml));
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };
  const downloadLetter = () => {
    const blob = new Blob([htmlToPlainText(letterHtml)], { type: "text/plain;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "gmc-reinstatement-request.txt";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const statusOptions = [
    { key: "suspended", label: "I've been suspended", icon: "🚫" },
    { key: "warning", label: "I got a warning", icon: "⚠️" },
    { key: "preventive", label: "Just preparing ahead", icon: "🛡️" },
  ] as const;

  // Map the AI's priority_fixes onto the IssueCard shape so each one reuses the
  // identical "Auto Fix with AI" / "Mark as Fixed" flow as the scan results.
  const mappedFixes = (result?.priority_fixes || []).map((f: any) => {
    const type = f.auto_fix_type && f.auto_fix_type !== "null" ? f.auto_fix_type : null;
    return {
      severity: f.severity || "Medium",
      issue_description: f.title,
      suggested_fix: [f.why_it_matters, f.how_to_fix].filter(Boolean).join(" — "),
      detailed_fix_steps: [],
      auto_fixable: !!(f.auto_fixable && type),
      auto_fix_type: type,
      credit_cost: type ? (AUTO_FIX_CREDITS[type] ?? 3) : 1,
    };
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Situation selector */}
      <div>
        <p style={{ margin: "0 0 8px 0", fontSize: "12px", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.4px" }}>What's your situation?</p>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {statusOptions.map(o => (
            <button key={o.key} onClick={() => setStatusKind(o.key)}
              style={{
                display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
                borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer",
                background: statusKind === o.key ? "#1a4a5a" : "white",
                color: statusKind === o.key ? "white" : "#374151",
                border: `1px solid ${statusKind === o.key ? "#1a4a5a" : "#d1d5db"}`,
              }}>
              {o.icon} {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Paste Google's message */}
      <div>
        <p style={{ margin: "0 0 6px 0", fontSize: "12px", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.4px" }}>
          Paste Google's message <span style={{ fontWeight: 400, textTransform: "none", color: "#9ca3af" }}>(optional — improves accuracy)</span>
        </p>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={3}
          placeholder="e.g. 'Your Merchant Center account has been suspended for Misrepresentation…' — paste the exact reason Google gave."
          style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: "8px", fontSize: "13px", lineHeight: 1.6, resize: "vertical", outline: "none", fontFamily: "inherit" }}
        />
      </div>

      {state !== "done" && (
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <button
            onClick={generate}
            disabled={state === "loading" || credits < CREDIT_COST}
            className="feature-card-button"
            style={{ maxWidth: "360px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", opacity: state === "loading" ? 0.7 : 1 }}
          >
            {state === "loading" ? <><Spinner size="small" /> Building your recovery plan…</> : `🛟 Generate Recovery Plan & Appeal (${CREDIT_COST} credits)`}
          </button>
          {credits < CREDIT_COST && <span style={{ fontSize: "12px", color: "#d72c0d" }}>You need {CREDIT_COST} credits.</span>}
        </div>
      )}
      {state === "error" && <p style={{ margin: 0, fontSize: "13px", color: "#d72c0d" }}>✕ {err}</p>}

      {state === "done" && result && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Category + readiness badges */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center" }}>
            <span style={{ padding: "4px 12px", borderRadius: "6px", fontSize: "13px", fontWeight: 700, background: "#fef2f2", color: "#d72c0d", border: "1px solid #fca5a5" }}>
              {result.suspension_category}
            </span>
            <span style={{
              padding: "4px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: 700,
              background: result.readiness === "ready_to_appeal" ? "#f0fdf4" : "#fffbeb",
              color: result.readiness === "ready_to_appeal" ? "#166534" : "#92400e",
              border: `1px solid ${result.readiness === "ready_to_appeal" ? "#86efac" : "#fcd34d"}`,
            }}>
              {result.readiness === "ready_to_appeal" ? "✓ Ready to appeal" : "⚠ Fix high-priority items first"}
            </span>
            {meta?.scanType && <span style={{ fontSize: "11px", color: "#9ca3af" }}>Based on your latest {meta.scanType} scan</span>}
          </div>

          {result.category_explanation && (
            <p style={{ margin: 0, fontSize: "13px", color: "#374151", lineHeight: 1.7 }}>{result.category_explanation}</p>
          )}
          {result.overall_assessment && (
            <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "12px 16px" }}>
              <p style={{ margin: 0, fontSize: "13px", color: "#374151", lineHeight: 1.6 }}>{result.overall_assessment}</p>
              {result.readiness_note && <p style={{ margin: "6px 0 0 0", fontSize: "12px", color: "#6b7280" }}>{result.readiness_note}</p>}
            </div>
          )}

          {/* Fix-before-you-appeal checklist — reuses the IssueCard auto-fix flow */}
          {mappedFixes.length > 0 && (
            <div>
              <p style={{ margin: "0 0 10px 0", fontSize: "14px", fontWeight: 700, color: "#212121" }}>Fix-before-you-appeal checklist</p>
              {mappedFixes.map((iss: any, i: number) => (
                <IssueCard
                  key={iss.auto_fix_type || `susp_${i}`}
                  issue={iss}
                  issueKey={iss.auto_fix_type || `susp_${i}`}
                  scanId={scanId || ""}
                  fixStates={fixStates}
                  setFixStates={setFixStates}
                  credits={credits}
                  allIssues={mappedFixes}
                  savedDetails={savedDetails}
                  onDetailsSaved={onDetailsSaved}
                />
              ))}
            </div>
          )}

          {/* Reinstatement letter — editable rich-text box (formatting renders, no raw **) */}
          {letterHtml && (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", marginBottom: "8px" }}>
                <p style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "#212121" }}>📧 Your Reinstatement Request Letter</p>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={copyLetter}
                    style={{ padding: "6px 14px", background: "#166534", color: "white", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>
                    {copied ? "✓ Copied" : "Copy text"}
                  </button>
                  <button onClick={downloadLetter}
                    style={{ padding: "6px 14px", background: "white", color: "#374151", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>
                    Download .txt
                  </button>
                </div>
              </div>
              <RichTextEditor value={letterHtml} onChange={setLetterHtml} />
              <p style={{ margin: "8px 0 0 0", fontSize: "11px", color: "#9ca3af" }}>
                Edit the letter above with the toolbar before sending. <strong>Copy text</strong> gives you a clean plain-text version for Google's reinstatement form.
              </p>
            </div>
          )}

          {result.evidence_points?.length > 0 && (
            <div style={{ background: "#f0f9ff", border: "1px solid #7dd3fc", borderRadius: "8px", padding: "12px 16px" }}>
              <p style={{ margin: "0 0 8px 0", fontSize: "12px", fontWeight: 700, color: "#0369a1", textTransform: "uppercase", letterSpacing: "0.4px" }}>Evidence to mention to Google</p>
              <ul style={{ margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "4px" }}>
                {result.evidence_points.map((e: string, i: number) => (
                  <li key={i} style={{ fontSize: "12px", color: "#0c4a6e", lineHeight: 1.6 }}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <button onClick={() => { setState("idle"); setResult(null); setLetterHtml(""); }}
              style={{ padding: "7px 16px", background: "white", color: "#374151", border: "1px solid #d1d5db", borderRadius: "7px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
              🔄 Regenerate ({CREDIT_COST} credits)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function StoreErrorReport() {
  const { productsUsed, productLimit, latestScan: initialScan, review: initialReview, savedDetails: initialSavedDetails, freeBasicScanAvailable } = useLoaderData<typeof loader>();

  const [scan, setScan] = useState<any>(initialScan);
  const [suspensionOpen, setSuspensionOpen] = useState(false);
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
  // Which scan type is currently running (derived from the active scan record)
  const activeScanType = isProcessing ? (scan?.type || "BASIC") : null;

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(() => { pollFetcher.load("/api/store-scan"); }, 4000);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  // Review gate (issue: ask for a review only after the merchant has interacted with issues AND
  // come back across visits — never on the first scan). notifyAiSuccess opens the global RatingPrompt.
  const maybePromptReview = useCallback(() => {
    if (shouldPromptReview()) { markReviewPrompted(); notifyAiSuccess("engagement"); }
  }, []);
  const onResultsInteract = useCallback(() => { recordIssueInteraction(); maybePromptReview(); }, [maybePromptReview]);
  // Count a visit whenever a completed scan is on screen (once per session), then re-check the gate.
  const visitRecordedRef = useRef(false);
  useEffect(() => {
    if (visitRecordedRef.current || scan?.status !== "COMPLETE") return;
    visitRecordedRef.current = true;
    recordResultsVisit();
    maybePromptReview();
  }, [scan?.status, maybePromptReview]);

  useEffect(() => {
    if (!pollFetcher.data) return;
    const polled = (pollFetcher.data as any).scan;
    if (polled) {
      setScan(polled);
      if (polled.status === "COMPLETE" || polled.status === "FAILED") {
        stopPolling();
        // No longer prompts for a review on scan-complete — the engagement gate above decides.
      }
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
      appliedFixes.forEach((fix: any) => {
        const key = fix.autoFixType;
        const isManual = !!fix.manual && !fix.themeEditorUrl;
        if (!next.has(key) || !next.get(key)?.fixed) {
          next.set(key, {
            confirming: false,
            fixing: false,
            fixed: true,
            error: "",
            manualFix: isManual,
            fixSummary: isManual
              ? "You marked this issue as fixed manually."
              : (FIX_SUMMARIES[fix.autoFixType] || "Fix applied to your store."),
            // Restore partial fix state so the Theme Editor card re-appears on reload
            partialFix: fix.partial ?? false,
            themeEditorUrl: fix.themeEditorUrl,
            preConfigured: fix.preConfigured ?? false,
            menuLabel: fix.menuLabel,
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
    // First Basic scan is free (one per shop) — don't gate it on credits.
    const isFreeBasic = scanType === "BASIC" && freeBasicScanAvailable;
    const cost = isFreeBasic ? 0 : scanType === "BASIC" ? 10 : scanType === "ADVANCED" ? 20 : scanType === "DEEP" ? 30 : 10;
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
    const { basic, advancedErrors, deepErrors, deepSummary, scanLabel } = extractReportSections(result);
    const summary = basic?.scan_summary || {};

    const rows: string[][] = [];
    rows.push([`Store GMC Compliance Report — ${scanLabel} Scan`]);
    rows.push(["Store URL", summary.store_url || ""]);
    rows.push(["Overall Risk", summary.overall_risk || ""]);
    rows.push(["Pages Scanned", summary.pages_scanned ?? ""]);
    rows.push(["Missing Required Pages", summary.pages_missing ?? ""]);
    rows.push(["Broken Links", summary.broken_links_found ?? ""]);
    if (deepSummary) rows.push(["Suspension Risk", deepSummary.suspension_risk || ""]);
    rows.push(["Scanned On", new Date(scan.updatedAt).toLocaleString()]);
    rows.push([]);

    const addSection = (title: string, issues: any[], extraCols?: (i: any) => string[]) => {
      if (!issues || !issues.length) return;
      rows.push([title]);
      rows.push(["#", "Severity", "Issue", "Suggested Fix", "Fix Steps", ...(extraCols ? ["Extra"] : [])]);
      issues.forEach((issue: any, idx: number) => {
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

    // ── Basic / store-level sections ──────────────────────────────────────────
    addSection("Missing Required Pages", basic?.missing_pages || [], (i) => [i.url || ""]);
    addSection("Broken Links", basic?.broken_links || [], (i) => [i.url || ""]);
    addSection("GMC Compliance", basic?.merchant_center_compliance || []);
    addSection("Customer Trust & Policy", basic?.customer_trust_and_policy || []);
    addSection("Site Structure & SEO", basic?.site_structure_and_seo || []);

    // ── Advanced product-feed errors ────────────────────────────────────────
    if (advancedErrors.length) {
      rows.push(["Advanced — Product Feed Issues"]);
      rows.push(["#", "Product", "Violation", "Explanation", "Fix Steps"]);
      advancedErrors.forEach((e: any, idx: number) => {
        rows.push([
          String(idx + 1),
          e.product_title || e.product_id || "",
          e.policy_violation_type || e.issue_type || "",
          e.merchant_friendly_description || e.description || "",
          Array.isArray(e.manual_fix_steps) ? e.manual_fix_steps.join(" | ") : "",
        ]);
      });
      rows.push([]);
    }

    // ── Deep misrepresentation findings ─────────────────────────────────────
    if (deepErrors.length) {
      rows.push(["Deep — Suspension & Misrepresentation Findings"]);
      rows.push(["#", "Severity", "Category", "Explanation", "Evidence", "Policy", "Remediation Steps"]);
      deepErrors.forEach((e: any, idx: number) => {
        rows.push([
          String(idx + 1),
          e.severity || "",
          e.category || "",
          e.merchant_friendly_explanation || "",
          e.evidence || "",
          e.google_policy_violated || "",
          Array.isArray(e.remediation_steps) ? e.remediation_steps.join(" | ") : "",
        ]);
      });
      rows.push([]);
    }

    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compliance-report-${scanLabel.toLowerCase()}-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [scan]);

  // Client-side PDF (print-ready HTML in new window)
  const handleDownloadPdf = useCallback(() => {
    if (!scan?.result) return;
    const result = scan.result as any;
    const { basic, advancedErrors, deepErrors, deepSummary, scanLabel } = extractReportSections(result);
    const summary = basic?.scan_summary || {};
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

    const section = (title: string, issues: any[], hideIfEmpty = false) => {
      if (hideIfEmpty && (!issues || !issues.length)) return "";
      return `
      <div style="margin-bottom:20px;page-break-inside:avoid">
        <h3 style="margin:0 0 10px 0;font-size:15px;font-weight:700;color:#1a4a5a;border-bottom:2px solid #e5e7eb;padding-bottom:6px">${title}</h3>
        ${(issues||[]).length === 0 ? `<p style="color:#12a04a;font-size:13px;margin:0">✓ No issues found.</p>` : issueRows(issues)}
      </div>`;
    };

    // Advanced product-feed errors block
    const advancedBlock = advancedErrors.length ? `
      <div style="margin-bottom:20px;page-break-inside:avoid">
        <h3 style="margin:0 0 10px 0;font-size:15px;font-weight:700;color:#7e22ce;border-bottom:2px solid #e5e7eb;padding-bottom:6px">Advanced — Product Feed Issues (${advancedErrors.length})</h3>
        ${advancedErrors.map((e: any) => `
          <div style="border-left:3px solid #7e22ce;padding:8px 12px;margin-bottom:10px;background:#fafafa">
            <div style="font-size:13px;font-weight:700;color:#212121">${e.product_title || e.product_id || ""}</div>
            <div style="font-size:11px;color:#7e22ce;font-weight:600;margin:2px 0">${e.policy_violation_type || e.issue_type || ""}</div>
            <p style="margin:4px 0 0;font-size:12px;color:#555">${e.merchant_friendly_description || e.description || ""}</p>
          </div>`).join("")}
      </div>` : "";

    // Deep misrepresentation findings block
    const deepBlock = deepErrors.length ? `
      <div style="margin-bottom:20px;page-break-inside:avoid">
        <h3 style="margin:0 0 10px 0;font-size:15px;font-weight:700;color:#d72c0d;border-bottom:2px solid #e5e7eb;padding-bottom:6px">Deep — Suspension & Misrepresentation Findings (${deepErrors.length})</h3>
        ${deepErrors.map((e: any) => `
          <div style="border-left:3px solid ${sev(e.severity||"")};padding:8px 12px;margin-bottom:10px;background:#fafafa">
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
              <span style="padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700;background:${sevBg(e.severity||"")};color:${sev(e.severity||"")}">${e.severity||""}</span>
              <span style="font-size:13px;font-weight:700;color:#212121">${e.category||""}</span>
            </div>
            <p style="margin:4px 0 0;font-size:12px;color:#555">${e.merchant_friendly_explanation||""}</p>
            ${e.evidence ? `<p style="margin:4px 0 0;font-size:11px;color:#777"><strong>Evidence:</strong> ${e.evidence}</p>` : ""}
            ${Array.isArray(e.remediation_steps) && e.remediation_steps.length ? `<ol style="margin:6px 0 0 12px;padding-left:16px;font-size:11px;color:#555;line-height:1.6">${e.remediation_steps.map((s: string) => `<li>${s}</li>`).join("")}</ol>` : ""}
          </div>`).join("")}
      </div>` : "";

    const deepRiskColor = deepSummary?.suspension_risk === "High" ? "#d72c0d" : deepSummary?.suspension_risk === "Medium" ? "#b98900" : "#12a04a";

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>GMC Compliance Report — ${scanLabel}</title>
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
        <p style="margin:6px 0 0;font-size:13px;opacity:0.85">${summary.store_url||""} · ${scanLabel} Scan</p>
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
        ${deepSummary ? `<div><p style="margin:0 0 4px;font-size:10px;color:#666;font-weight:600;text-transform:uppercase">Suspension Risk</p>
          <p style="margin:0;font-size:18px;font-weight:700;color:${deepRiskColor}">${deepSummary.suspension_risk||"—"}</p></div>` : ""}
        <div><p style="margin:0 0 4px;font-size:10px;color:#666;font-weight:600;text-transform:uppercase">Scanned On</p>
          <p style="margin:0;font-size:13px;font-weight:600">${new Date(scan.updatedAt).toLocaleString()}</p></div>
      </div>
      ${section("Missing Required Pages", basic?.missing_pages, true)}
      ${section("Broken Links", basic?.broken_links, true)}
      ${section("Google Merchant Center Compliance", basic?.merchant_center_compliance)}
      ${section("Customer Trust & Policy Pages", basic?.customer_trust_and_policy)}
      ${section("Site Structure & SEO", basic?.site_structure_and_seo)}
      ${advancedBlock}
      ${deepBlock}
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
              <h1 className="app-title">GMC Compliance Fix</h1>
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
                {freeBasicScanAvailable ? (
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "#166534", background: "#f0fdf4", padding: "2px 8px", borderRadius: "4px", border: "1px solid #86efac" }}>
                    ✨ First scan FREE
                  </span>
                ) : (
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "#006ECB", background: "#eff6ff", padding: "2px 8px", borderRadius: "4px", border: "1px solid #bfdbfe" }}>
                    10 Credits
                  </span>
                )}
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
                style={(isProcessing || needsPassword) ? { background: activeScanType === "BASIC" ? undefined : "#e5e7eb", color: activeScanType === "BASIC" ? undefined : "#999", cursor: "not-allowed" } : undefined}
              >
                {activeScanType === "BASIC" ? "Scanning store…" : isStarting ? "Starting…" : (isProcessing || needsPassword) ? "Run Basic Scan" : "Run Basic Scan"}
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
              <button
                className="feature-card-button"
                onClick={() => handleRunScan("ADVANCED")}
                disabled={isStarting || isProcessing || needsPassword || credits < 20}
                style={(isProcessing || needsPassword) ? { background: activeScanType === "ADVANCED" ? undefined : "#e5e7eb", color: activeScanType === "ADVANCED" ? undefined : "#999", cursor: "not-allowed" } : undefined}
              >
                {activeScanType === "ADVANCED" ? "Scanning products…" : isStarting ? "Starting…" : "Run Advanced Scan"}
              </button>
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
              <button
                className="feature-card-button"
                onClick={() => handleRunScan("DEEP")}
                disabled={isStarting || isProcessing || needsPassword || credits < 30}
                style={(isProcessing || needsPassword) ? { background: activeScanType === "DEEP" ? undefined : "#e5e7eb", color: activeScanType === "DEEP" ? undefined : "#999", cursor: "not-allowed" } : undefined}
              >
                {activeScanType === "DEEP" ? "Running deep audit…" : isStarting ? "Starting…" : "Run Deep Scan"}
              </button>
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
                    {scan.type === "ADVANCED"
                      ? "We're pulling your product catalog and running feed data through our AI compliance engine. This usually takes 60–180 seconds."
                      : scan.type === "DEEP"
                      ? "We're analyzing your schema markup, business identity, and store signals for misrepresentation. This usually takes 90–180 seconds."
                      : "We're fetching your homepage, policy pages, and navigation links, then running them through our AI compliance engine. This usually takes 60–120 seconds."}
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

                  {/* Interacting with the issues (expanding sections, viewing fixes, marking fixed)
                      feeds the engagement gate that decides when to ask for a review. */}
                  <div onClickCapture={onResultsInteract}>
                  {scan.type === "ADVANCED" ? (
                    <AdvancedScanResults
                      scan={scan}
                      credits={credits}
                      fixStates={fixStates}
                      setFixStates={setFixStates}
                      savedDetails={savedDetails}
                      onDetailsSaved={handleDetailsSaved}
                    />
                  ) : scan.type === "DEEP" ? (
                    <DeepScanResults
                      scan={scan}
                      credits={credits}
                      fixStates={fixStates}
                      setFixStates={setFixStates}
                      savedDetails={savedDetails}
                      onDetailsSaved={handleDetailsSaved}
                    />
                  ) : (
                    <ScanResults
                      scan={scan}
                      credits={credits}
                      fixStates={fixStates}
                      setFixStates={setFixStates}
                      savedDetails={savedDetails}
                      onDetailsSaved={handleDetailsSaved}
                    />
                  )}
                  </div>
                </>
              )}
            </>
          )}

          {/* Suspension Recovery & Reinstatement — the final step, collapsed, after the scan results */}
          <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "14px", marginTop: "24px" }}>
            <button
              onClick={() => setSuspensionOpen(v => !v)}
              aria-expanded={suspensionOpen}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: "12px",
                padding: "18px 24px", background: "none", border: "none", cursor: "pointer", textAlign: "left",
              }}
            >
              <span style={{ fontSize: "26px", flexShrink: 0 }}>🚨</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: "18px", fontWeight: 700, color: "#212121" }}>Suspension Recovery & Reinstatement</span>
                <span style={{ display: "block", marginTop: "2px", fontSize: "12px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                  The final step — diagnosis, fix plan & appeal letter
                </span>
              </span>
              <span style={{ fontSize: "12px", fontWeight: 700, color: "#006ECB", background: "#eff6ff", padding: "4px 10px", borderRadius: "4px", border: "1px solid #bfdbfe", whiteSpace: "nowrap", flexShrink: 0 }}>
                10 Credits
              </span>
              <span style={{ fontSize: "14px", color: "#6b7280", flexShrink: 0 }}>{suspensionOpen ? "▲" : "▼"}</span>
            </button>

            {suspensionOpen && (
              <div style={{ padding: "0 24px 24px 24px" }}>
                <p style={{ margin: 0, fontSize: "13px", color: "#374151", lineHeight: 1.7 }}>
                  If Google Merchant Center has <strong>suspended</strong> or <strong>warned</strong> your store, this analyzes your latest
                  scan results to pinpoint the most likely policy violation (Misrepresentation, Insufficient Contact Information,
                  Untrustworthy Promotions, and more), builds a prioritized <strong>fix-before-you-appeal checklist</strong> — with the same
                  one-click Auto Fix as the scans above — and drafts a professional, ready-to-send <strong>reinstatement request letter</strong>
                  you can edit and copy straight into Google's appeal form.
                </p>

                {/* Run-this-last warning */}
                <div style={{ marginTop: "16px", padding: "12px 16px", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "8px" }}>
                  <p style={{ margin: 0, fontSize: "13px", fontWeight: 700, color: "#92400e" }}>
                    ⚠️ Run this last
                  </p>
                  <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#78350f", lineHeight: 1.6 }}>
                    Run the <strong>Basic</strong>, <strong>Advanced</strong> and <strong>Deep</strong> scans above and fix every issue they
                    surface <strong>first</strong>. Google only reinstates stores that have actually resolved the underlying problems —
                    appealing before they're fixed almost always gets rejected. This assistant uses your most recent (ideally Deep) scan to
                    write the strongest possible case.
                  </p>
                </div>

                <div style={{ marginTop: "20px" }}>
                  <SuspensionRecoveryScan
                    credits={credits}
                    scanId={scan?.id}
                    fixStates={fixStates}
                    setFixStates={setFixStates}
                    savedDetails={savedDetails}
                    onDetailsSaved={handleDetailsSaved}
                  />
                </div>
              </div>
            )}
          </div>

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
