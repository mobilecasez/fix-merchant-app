import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useRouteError, isRouteErrorResponse } from "@remix-run/react";
import { Page, Spinner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useState } from "react";
import { getOrCreateSubscription, getProductsUsed, getEffectiveProductLimit } from "../utils/billing.server";
import "../styles/dashboard.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  try {
    const settings = await prisma.appSettings.findUnique({ where: { shop: session.shop } });
    if (settings && settings.merchandisingEnabled === false) {
      throw new Response("This page is not enabled", { status: 403 });
    }
    const subscription = await getOrCreateSubscription(session.shop);
    const productsUsed = getProductsUsed(subscription);
    const productLimit = getEffectiveProductLimit(subscription);
    const review = await prisma.shopReview.findUnique({ where: { shop: session.shop } }).catch(() => null);
    return json({ productsUsed, productLimit, review });
  } catch (error) {
    if (error instanceof Response) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw new Response(`Loader error: ${msg}`, { status: 500 });
  }
};

// ── Shared helpers ──────────────────────────────────────────────────────────
const post = async (intent: string, extra: Record<string, any> = {}) => {
  const res = await fetch("/api/merchandising", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent, ...extra }),
  });
  const data = await res.json();
  return { ok: res.ok && !data.error, data };
};

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 1 — Smart Collections
// ════════════════════════════════════════════════════════════════════════════
function CollectionsPanel({ credits }: { credits: number }) {
  const [state, setState] = useState<"idle" | "loading" | "ready" | "creating" | "done" | "error">("idle");
  const [groups, setGroups] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState("");
  const [total, setTotal] = useState(0);

  const keyOf = (g: string, c: any) => `${g}::${c.rule_field}::${c.rule_value}::${c.title}`;

  const suggest = async () => {
    setState("loading"); setMsg("");
    const { ok, data } = await post("suggest_collections");
    if (!ok) { setState("error"); setMsg(data.error || "Failed to analyse products."); return; }
    setGroups(data.suggestions || []);
    setTotal(data.totalProducts || 0);
    // Pre-select everything
    const all = new Set<string>();
    (data.suggestions || []).forEach((g: any) => g.collections.forEach((c: any) => all.add(keyOf(g.group, c))));
    setSelected(all);
    setState("ready");
  };

  const toggle = (k: string) => setSelected(prev => {
    const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n;
  });

  const create = async () => {
    const chosen: any[] = [];
    groups.forEach(g => g.collections.forEach((c: any) => { if (selected.has(keyOf(g.group, c))) chosen.push(c); }));
    if (!chosen.length) { setMsg("Select at least one collection."); return; }
    setState("creating"); setMsg("");
    const { ok, data } = await post("create_collections", { collections: chosen });
    if (!ok) { setState("error"); setMsg(data.error || "Failed to create collections."); return; }
    setMsg(data.message || "Collections created."); setState("done");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ background: "#f0f9ff", border: "1px solid #7dd3fc", borderRadius: "10px", padding: "16px 20px" }}>
        <p style={{ margin: 0, fontSize: "14px", color: "#0c4a6e", lineHeight: 1.6 }}>
          We read every product's <strong>tags, type and brand</strong>, then design a clean set of <strong>auto-updating smart collections</strong> (e.g. by category, gender, brand, phone model). New products that match a rule are added to the collection automatically — no manual sorting ever again.
        </p>
      </div>

      {state === "idle" && (
        <button className="feature-card-button" style={{ maxWidth: "320px" }} onClick={suggest} disabled={credits < 3}>
          🧠 Analyse Catalog & Suggest Collections (3 credits)
        </button>
      )}

      {state === "loading" && (
        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "16px", background: "#f9fafb", borderRadius: "8px" }}>
          <Spinner size="small" /> <span style={{ fontSize: "13px", color: "#6b7280" }}>Analysing your catalog…</span>
        </div>
      )}

      {(state === "ready" || state === "creating" || state === "done") && (
        <>
          <p style={{ margin: 0, fontSize: "13px", color: "#374151" }}>
            Found <strong>{groups.reduce((n, g) => n + g.collections.length, 0)}</strong> suggested collections across {groups.length} groups from {total} products. Uncheck any you don't want, then create.
          </p>
          {groups.map((g, gi) => (
            <div key={gi} style={{ border: "1px solid #e5e7eb", borderRadius: "10px", overflow: "hidden" }}>
              <div style={{ background: "#f9fafb", padding: "10px 14px", fontSize: "13px", fontWeight: 700, color: "#212121", borderBottom: "1px solid #e5e7eb" }}>
                {g.group}
              </div>
              <div style={{ padding: "8px" }}>
                {g.collections.map((c: any, ci: number) => {
                  const k = keyOf(g.group, c);
                  const on = selected.has(k);
                  return (
                    <label key={ci} style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "8px 10px", borderRadius: "6px", cursor: state === "done" ? "default" : "pointer", background: on ? "#f0fdf4" : "white" }}>
                      <input type="checkbox" checked={on} disabled={state === "done"} onChange={() => toggle(k)} style={{ marginTop: "3px" }} />
                      <span style={{ flex: 1 }}>
                        <span style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "13px", fontWeight: 700, color: "#212121" }}>{c.title}</span>
                          <span style={{ fontSize: "10px", fontWeight: 700, color: "#6b7280", background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: "4px", padding: "1px 6px" }}>
                            {c.rule_field}: {c.rule_value}
                          </span>
                          {c.est_products ? <span style={{ fontSize: "11px", color: "#9ca3af" }}>~{c.est_products} products</span> : null}
                        </span>
                        {c.description && <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: "#6b7280" }}>{c.description}</p>}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}

          <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap", borderTop: "1px solid #e5e7eb", paddingTop: "14px" }}>
            {state !== "done" ? (
              <button className="feature-card-button" style={{ maxWidth: "260px" }} onClick={create} disabled={state === "creating"}>
                {state === "creating" ? "Creating collections…" : `📁 Create ${selected.size} Collections`}
              </button>
            ) : (
              <span style={{ fontSize: "13px", fontWeight: 700, color: "#166534" }}>✓ {msg}</span>
            )}
            {msg && state !== "done" && <span style={{ fontSize: "12px", color: "#d72c0d" }}>{msg}</span>}
          </div>
        </>
      )}

      {state === "error" && <p style={{ margin: 0, fontSize: "13px", color: "#d72c0d" }}>✕ {msg}</p>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 2 — Sitemap
// ════════════════════════════════════════════════════════════════════════════
function SitemapPanel() {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<any>(null);
  const [msg, setMsg] = useState("");

  const generate = async () => {
    setState("loading"); setMsg("");
    const { ok, data } = await post("generate_sitemap");
    if (!ok) { setState("error"); setMsg(data.error || "Failed to generate sitemap."); return; }
    setResult(data); setState("done");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ background: "#f0f9ff", border: "1px solid #7dd3fc", borderRadius: "10px", padding: "16px 20px" }}>
        <p style={{ margin: "0 0 8px 0", fontSize: "14px", color: "#0c4a6e", lineHeight: 1.6 }}>
          Builds a clean, customer-facing <strong>HTML sitemap page</strong> that lists every collection, page and policy in one organised directory. This improves <strong>internal linking & SEO</strong> and gives shoppers a fast way to find anything.
        </p>
        <p style={{ margin: 0, fontSize: "12px", color: "#0369a1" }}>
          💡 Shopify already serves a machine-readable <code>/sitemap.xml</code> for Google automatically — this adds the human-friendly version Google also rewards.
        </p>
      </div>

      {state === "idle" && (
        <button className="feature-card-button" style={{ maxWidth: "300px" }} onClick={generate}>
          🗺️ Generate / Update HTML Sitemap
        </button>
      )}
      {state === "loading" && (
        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "16px", background: "#f9fafb", borderRadius: "8px" }}>
          <Spinner size="small" /> <span style={{ fontSize: "13px", color: "#6b7280" }}>Building your sitemap page…</span>
        </div>
      )}
      {state === "done" && result && (
        <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "10px", padding: "16px 20px" }}>
          <p style={{ margin: "0 0 10px 0", fontSize: "14px", fontWeight: 700, color: "#166534" }}>✓ {result.message}</p>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <a href={result.sitemapUrl} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "8px 14px", background: "#166534", color: "white", borderRadius: "6px", fontSize: "13px", fontWeight: 700, textDecoration: "none" }}>
              View HTML Sitemap →
            </a>
            <a href={result.xmlSitemapUrl} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "8px 14px", background: "white", color: "#0369a1", border: "1px solid #7dd3fc", borderRadius: "6px", fontSize: "13px", fontWeight: 700, textDecoration: "none" }}>
              View XML Sitemap →
            </a>
          </div>
          <p style={{ margin: "10px 0 0 0", fontSize: "12px", color: "#166534" }}>
            Tip: link your HTML sitemap from the footer so both shoppers and search engines can find it.
          </p>
        </div>
      )}
      {state === "error" && <p style={{ margin: 0, fontSize: "13px", color: "#d72c0d" }}>✕ {msg}</p>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 3 — Cross-Sell / Related Products
// ════════════════════════════════════════════════════════════════════════════
function CrossSellPanel({ credits }: { credits: number }) {
  const [state, setState] = useState<"idle" | "loading" | "ready" | "applying" | "done" | "error">("idle");
  const [links, setLinks] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [msg, setMsg] = useState("");
  const [applied, setApplied] = useState<any>(null);

  const suggest = async () => {
    setState("loading"); setMsg("");
    const { ok, data } = await post("suggest_crosssell");
    if (!ok) { setState("error"); setMsg(data.error || "Failed to analyse products."); return; }
    setLinks(data.links || []); setTotal(data.totalProducts || 0); setState("ready");
  };

  const apply = async () => {
    setState("applying"); setMsg("");
    const { ok, data } = await post("apply_crosssell", { links });
    if (!ok) { setState("error"); setMsg(data.error || "Failed to apply."); return; }
    setApplied(data); setMsg(data.message || "Applied."); setState("done");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ background: "#f0f9ff", border: "1px solid #7dd3fc", borderRadius: "10px", padding: "16px 20px" }}>
        <p style={{ margin: 0, fontSize: "14px", color: "#0c4a6e", lineHeight: 1.6 }}>
          AI studies your catalog and links each product to the <strong>accessories & matching items people buy together</strong> — a phone case → tempered glass + charger, jeans → belt + shoes. Then add our <strong>Related Products</strong> block to your product page with one click — it shows the matches automatically and lifts average order value.
        </p>
      </div>

      {state === "idle" && (
        <button className="feature-card-button" style={{ maxWidth: "320px" }} onClick={suggest} disabled={credits < 1}>
          🧠 Find Cross-Sell Opportunities (1 credit / 5 products)
        </button>
      )}
      {state === "loading" && (
        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "16px", background: "#f9fafb", borderRadius: "8px" }}>
          <Spinner size="small" /> <span style={{ fontSize: "13px", color: "#6b7280" }}>Analysing every product and finding the best pairings…</span>
        </div>
      )}
      {(state === "ready" || state === "applying" || state === "done") && (
        <>
          {links.length === 0 ? (
            <p style={{ fontSize: "13px", color: "#6b7280" }}>No strong cross-sell pairings found for this catalog. This happens when products have no complementary items in your store — add accessories/related items and run again.</p>
          ) : (
            <>
              <p style={{ margin: 0, fontSize: "13px", color: "#374151" }}>
                Recommendations generated for <strong>{links.length}</strong> of <strong>{total}</strong> products{links.length < total ? <span style={{ color: "#9ca3af" }}> (the rest had no relevant matches in your catalog)</span> : null}. Review, then apply to all.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {links.map((l, i) => (
                  <div key={i} style={{ border: "1px solid #e5e7eb", borderRadius: "10px", padding: "12px 14px" }}>
                    <p style={{ margin: "0 0 4px 0", fontSize: "13px", fontWeight: 700, color: "#212121" }}>{l.product_title}</p>
                    {l.reason && <p style={{ margin: "0 0 8px 0", fontSize: "12px", color: "#6b7280", fontStyle: "italic" }}>{l.reason}</p>}
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      {l.complements.map((c: any, ci: number) => (
                        <span key={ci} style={{ fontSize: "12px", color: "#0369a1", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: "6px", padding: "3px 9px" }}>
                          + {c.title}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap", borderTop: "1px solid #e5e7eb", paddingTop: "14px" }}>
                {state !== "done" ? (
                  <button className="feature-card-button" style={{ maxWidth: "280px" }} onClick={apply} disabled={state === "applying"}>
                    {state === "applying" ? "Saving to products…" : "💾 Apply Cross-Sell Links to All"}
                  </button>
                ) : (
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#166534" }}>✓ {msg}</span>
                )}
              </div>

              {/* One-click display setup after applying (Theme App Extension block) */}
              {state === "done" && applied && (
                <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "10px", padding: "16px 20px" }}>
                  <p style={{ margin: "0 0 4px 0", fontSize: "14px", fontWeight: 700, color: "#166534" }}>
                    ✓ Cross-sell links saved to {applied.savedCount} products
                  </p>
                  <p style={{ margin: "0 0 12px 0", fontSize: "13px", color: "#166534" }}>
                    Now add our <strong>Related Products</strong> block to your product page — one click, no code. It reads these links and updates automatically (and is removed cleanly if you ever uninstall):
                  </p>
                  <ol style={{ margin: "0 0 14px 0", paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "6px" }}>
                    {(applied.setupSteps || []).map((s: string, i: number) => (
                      <li key={i} style={{ fontSize: "13px", color: "#14532d", lineHeight: 1.6 }}>{s}</li>
                    ))}
                  </ol>
                  {applied.addBlockUrl && (
                    <a href={applied.addBlockUrl} target="_blank" rel="noreferrer"
                      style={{ display: "inline-flex", alignItems: "center", gap: "7px", padding: "10px 20px", background: "#166534", color: "white", borderRadius: "8px", fontSize: "14px", fontWeight: 700, textDecoration: "none" }}>
                      🎨 Add to product page (1 click) →
                    </a>
                  )}
                  <p style={{ margin: "12px 0 0 0", fontSize: "11px", color: "#6b7280" }}>
                    Note: requires an Online Store 2.0 theme. If the button says the app isn't available yet, run <code>shopify app deploy</code> (dev: it's already live via <code>shopify app dev</code>).
                  </p>
                </div>
              )}
            </>
          )}
        </>
      )}
      {state === "error" && <p style={{ margin: 0, fontSize: "13px", color: "#d72c0d" }}>✕ {msg}</p>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PAGE
// ════════════════════════════════════════════════════════════════════════════
const FEATURES = [
  { key: "collections", icon: "📁", title: "Smart Collections", subtitle: "Auto-organise your catalog", desc: "Turn product tags, types and brands into clean, auto-updating collections so customers can browse with ease.", cta: "Build Collections" },
  { key: "sitemap", icon: "🗺️", title: "Sitemap Builder", subtitle: "SEO & easy navigation", desc: "Generate an organised HTML sitemap of every collection, page and policy — better SEO and a faster shopping experience.", cta: "Generate Sitemap" },
  { key: "crosssell", icon: "🛒", title: "Cross-Sell Engine", subtitle: "Lift average order value", desc: "AI links products to the accessories and matching items people buy together — shown on product & cart pages.", cta: "Find Cross-Sells" },
] as const;

export default function Merchandising() {
  const { productsUsed, productLimit, review: initialReview } = useLoaderData<typeof loader>();
  const credits = productLimit - productsUsed;
  const [active, setActive] = useState<string | null>(null);

  const [reviewBannerDismissed, setReviewBannerDismissed] = useState((initialReview as any)?.dismissed || false);
  const [userRating, setUserRating] = useState<number | null>((initialReview as any)?.rating || null);
  const [showRatingThankYou, setShowRatingThankYou] = useState(false);

  const handleRating = async (rating: number) => {
    setUserRating(rating);
    setShowRatingThankYou(true);
    try {
      await fetch("/api/submit-rating", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, dismissed: false }),
      });
    } catch { /* ignore */ }
    setTimeout(() => setShowRatingThankYou(false), 2000);
  };

  const handleDismiss = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    setReviewBannerDismissed(true);
    try {
      await fetch("/api/submit-rating", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismissed: true }),
      });
    } catch { /* ignore */ }
  };

  const activeMeta = FEATURES.find(f => f.key === active);

  return (
    <div className="landing-page">
      <Page fullWidth>
        <div className="landing-container">

          {/* Header */}
          <div className="header-section">
            <div className="header-content">
              <div className="logo-icon">🧩</div>
              <h1 className="app-title">Catalog & Merchandising</h1>
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
            <h2 className="intro-heading">Organise, Connect & Sell More.</h2>
            <p className="intro-paragraph">
              Three powerful tools to turn a messy catalog into a polished, high-converting storefront — automatically build
              collections from your tags, generate an SEO-friendly sitemap, and create smart cross-sell links that raise your
              average order value. You have <strong>{credits} credits</strong> remaining.
            </p>
          </div>

          {/* Explainer cards row */}
          <div className="feature-cards-grid" style={{ marginBottom: "12px" }}>
            <div className="feature-card" style={{ padding: "18px" }}>
              <div style={{ fontSize: "22px", marginBottom: "6px" }}>⚡</div>
              <p style={{ margin: "0 0 4px 0", fontWeight: 700, fontSize: "14px", color: "#212121" }}>Done in one click</p>
              <p style={{ margin: 0, fontSize: "13px", color: "#6b7280", lineHeight: 1.5 }}>Each tool analyses your store and applies changes directly to Shopify — no manual setup.</p>
            </div>
            <div className="feature-card" style={{ padding: "18px" }}>
              <div style={{ fontSize: "22px", marginBottom: "6px" }}>🔄</div>
              <p style={{ margin: "0 0 4px 0", fontWeight: 700, fontSize: "14px", color: "#212121" }}>Always up to date</p>
              <p style={{ margin: 0, fontSize: "13px", color: "#6b7280", lineHeight: 1.5 }}>Smart collections auto-include new matching products, so your store stays organised as it grows.</p>
            </div>
            <div className="feature-card" style={{ padding: "18px" }}>
              <div style={{ fontSize: "22px", marginBottom: "6px" }}>📈</div>
              <p style={{ margin: "0 0 4px 0", fontWeight: 700, fontSize: "14px", color: "#212121" }}>Built to convert</p>
              <p style={{ margin: 0, fontSize: "13px", color: "#6b7280", lineHeight: 1.5 }}>Better navigation, SEO and cross-sells work together to help shoppers find — and add — more.</p>
            </div>
          </div>

          {/* Feature cards */}
          <div className="feature-cards-grid">
            {FEATURES.map(f => (
              <div className="feature-card" key={f.key}>
                <div className="feature-card-header">
                  <div className="feature-card-icon">{f.icon}</div>
                  <h3 className="feature-card-title">{f.title}</h3>
                </div>
                <p style={{ margin: "0 0 4px 0", fontSize: "12px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                  {f.subtitle}
                </p>
                <p className="feature-card-description" style={{ marginTop: "8px" }}>{f.desc}</p>
                <button
                  className="feature-card-button"
                  onClick={() => setActive(f.key)}
                  style={active === f.key ? { background: "#0055a8" } : undefined}
                >
                  {active === f.key ? "▼ Open Below" : f.cta}
                </button>
              </div>
            ))}
          </div>

          {/* Active feature panel */}
          {activeMeta && (
            <div className="intro-card" style={{ marginTop: "4px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
                <span style={{ fontSize: "22px" }}>{activeMeta.icon}</span>
                <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: "#212121" }}>{activeMeta.title}</h3>
              </div>
              {active === "collections" && <CollectionsPanel credits={credits} />}
              {active === "sitemap" && <SitemapPanel />}
              {active === "crosssell" && <CrossSellPanel credits={credits} />}
            </div>
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
          </div>
        </div>
      </Page>
    </div>
  );
}
