import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useRevalidator, useRouteError, isRouteErrorResponse } from "@remix-run/react";
import { Page } from "@shopify/polaris";
import { useEffect, useRef, useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { findSimilarRequests, makeTags } from "../utils/feature-requests.server";
import "../styles/dashboard.css";

const STATUS_META: Record<string, { label: string; bg: string; color: string; border: string }> = {
  open: { label: "Open", bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
  planned: { label: "Planned", bg: "#faf5ff", color: "#7e22ce", border: "#e9d5ff" },
  in_progress: { label: "In progress", bg: "#fffbeb", color: "#92400e", border: "#fcd34d" },
  done: { label: "Shipped", bg: "#f0fdf4", color: "#166534", border: "#86efac" },
  declined: { label: "Not planned", bg: "#f3f4f6", color: "#6b7280", border: "#e5e7eb" },
};
const OWNER_STATUS_CYCLE = ["open", "planned", "in_progress", "done", "declined"];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  try {
    const sessionData = await prisma.session.findFirst({ where: { shop: session.shop } });
    const isAccountOwner = sessionData?.accountOwner || false;

    const review = await prisma.shopReview.findUnique({ where: { shop: session.shop } }).catch(() => null);

    const requests = await prisma.featureRequest.findMany({
      orderBy: [{ votes: { _count: "desc" } }, { createdAt: "desc" }],
      include: { _count: { select: { votes: true } } },
    });
    const myVotes = await prisma.featureRequestVote.findMany({
      where: { shop: session.shop },
      select: { requestId: true },
    });
    const votedSet = new Set(myVotes.map((v) => v.requestId));

    return json({
      shop: session.shop,
      isAccountOwner,
      reviewRating: review?.rating || 0,
      reviewDismissed: review?.dismissed || false,
      requests: requests.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        status: r.status,
        voteCount: r._count.votes,
        votedByMe: votedSet.has(r.id),
        mine: r.createdByShop === session.shop,
        createdAt: r.createdAt,
      })),
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw new Response(`Loader error: ${msg}`, { status: 500 });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = (form.get("intent") || "").toString();

  const isOwner = async () => {
    const s = await prisma.session.findFirst({ where: { shop } });
    return s?.accountOwner || false;
  };

  try {
    if (intent === "check") {
      const title = (form.get("title") || "").toString().trim();
      const description = (form.get("description") || "").toString().trim();
      if (title.length < 4) return json({ ok: false, error: "Please enter a clear title (at least 4 characters)." });

      const existing = await prisma.featureRequest.findMany({
        where: { status: { not: "declined" } },
        select: { id: true, title: true, description: true, tags: true },
      });
      const similar = findSimilarRequests(title, description, existing);
      if (similar.length === 0) return json({ ok: true, intent: "check", similar: [] });

      const ids = similar.map((s) => s.request.id);
      const detailed = await prisma.featureRequest.findMany({
        where: { id: { in: ids } },
        include: { _count: { select: { votes: true } } },
      });
      const myVotes = await prisma.featureRequestVote.findMany({
        where: { shop, requestId: { in: ids } },
        select: { requestId: true },
      });
      const votedSet = new Set(myVotes.map((v) => v.requestId));
      const byId = new Map(detailed.map((d) => [d.id, d]));
      const out = similar
        .map((s) => {
          const d = byId.get(s.request.id);
          if (!d) return null;
          return {
            id: d.id,
            title: d.title,
            description: d.description,
            status: d.status,
            voteCount: d._count.votes,
            votedByMe: votedSet.has(d.id),
          };
        })
        .filter(Boolean);
      return json({ ok: true, intent: "check", similar: out });
    }

    if (intent === "create") {
      const title = (form.get("title") || "").toString().trim();
      const description = (form.get("description") || "").toString().trim();
      if (title.length < 4) return json({ ok: false, error: "Please enter a clear title (at least 4 characters)." });
      const tags = makeTags(title, description);
      const created = await prisma.featureRequest.create({
        data: {
          title: title.slice(0, 140),
          description: description.slice(0, 2000),
          tags,
          createdByShop: shop,
          status: "open",
          votes: { create: { shop } }, // creator's request starts with their own vote
        },
      });
      return json({ ok: true, intent: "create", createdId: created.id });
    }

    if (intent === "vote") {
      const requestId = (form.get("requestId") || "").toString();
      // Ignore duplicate-vote unique violations (already voted).
      await prisma.featureRequestVote.create({ data: { requestId, shop } }).catch(() => {});
      return json({ ok: true });
    }

    if (intent === "unvote") {
      const requestId = (form.get("requestId") || "").toString();
      await prisma.featureRequestVote.deleteMany({ where: { requestId, shop } });
      return json({ ok: true });
    }

    if (intent === "status") {
      if (!(await isOwner())) return json({ ok: false, error: "Unauthorized" }, { status: 403 });
      const requestId = (form.get("requestId") || "").toString();
      const status = (form.get("status") || "open").toString();
      await prisma.featureRequest.update({ where: { id: requestId }, data: { status } });
      return json({ ok: true });
    }

    if (intent === "delete") {
      if (!(await isOwner())) return json({ ok: false, error: "Unauthorized" }, { status: 403 });
      const requestId = (form.get("requestId") || "").toString();
      await prisma.featureRequest.delete({ where: { id: requestId } }).catch(() => {});
      return json({ ok: true });
    }

    return json({ ok: false, error: "Unknown action." }, { status: 400 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: msg }, { status: 500 });
  }
};

type ReqItem = {
  id: string;
  title: string;
  description: string;
  status: string;
  voteCount: number;
  votedByMe: boolean;
  mine?: boolean;
};

function VoteButton({ id, voteCount, votedByMe }: { id: string; voteCount: number; votedByMe: boolean }) {
  const fetcher = useFetcher();
  const [voted, setVoted] = useState(votedByMe);
  const [count, setCount] = useState(voteCount);
  useEffect(() => { setVoted(votedByMe); setCount(voteCount); }, [votedByMe, voteCount]);

  const toggle = () => {
    const next = !voted;
    setVoted(next);
    setCount((c) => c + (next ? 1 : -1));
    fetcher.submit({ intent: next ? "vote" : "unvote", requestId: id }, { method: "post" });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={voted}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        minWidth: "58px", padding: "8px 6px", borderRadius: "10px", cursor: "pointer",
        border: `1.5px solid ${voted ? "#1a4a5a" : "#d1d5db"}`,
        background: voted ? "#1a4a5a" : "#fff", color: voted ? "#fff" : "#374151",
        transition: "all .12s", fontFamily: "inherit",
      }}
      title={voted ? "Remove your vote" : "Vote for this"}
    >
      <span style={{ fontSize: "15px", lineHeight: 1 }}>▲</span>
      <span style={{ fontSize: "16px", fontWeight: 800, lineHeight: 1.4 }}>{count}</span>
    </button>
  );
}

function RequestCard({ item, isOwner }: { item: ReqItem; isOwner: boolean }) {
  const ownerFetcher = useFetcher();
  const meta = STATUS_META[item.status] || STATUS_META.open;

  const cycleStatus = () => {
    const idx = OWNER_STATUS_CYCLE.indexOf(item.status);
    const next = OWNER_STATUS_CYCLE[(idx + 1) % OWNER_STATUS_CYCLE.length];
    ownerFetcher.submit({ intent: "status", requestId: item.id, status: next }, { method: "post" });
  };
  const remove = () => {
    if (typeof window !== "undefined" && !window.confirm("Delete this request?")) return;
    ownerFetcher.submit({ intent: "delete", requestId: item.id }, { method: "post" });
  };

  return (
    <div className="feature-card" style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
      <VoteButton id={item.id} voteCount={item.voteCount} votedByMe={item.votedByMe} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "4px" }}>
          <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#212121" }}>{item.title}</h3>
          <span style={{ fontSize: "11px", fontWeight: 700, color: meta.color, background: meta.bg, border: `1px solid ${meta.border}`, borderRadius: "999px", padding: "2px 9px" }}>
            {meta.label}
          </span>
          {item.mine && (
            <span style={{ fontSize: "11px", fontWeight: 600, color: "#6b7280" }}>· your request</span>
          )}
        </div>
        <p style={{ margin: 0, fontSize: "13px", color: "#4b5563", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
          {item.description}
        </p>
        {isOwner && (
          <div style={{ display: "flex", gap: "12px", marginTop: "10px" }}>
            <button type="button" onClick={cycleStatus} style={ownerBtn}>↻ Set: {(STATUS_META[OWNER_STATUS_CYCLE[(OWNER_STATUS_CYCLE.indexOf(item.status) + 1) % OWNER_STATUS_CYCLE.length]] || STATUS_META.open).label}</button>
            <button type="button" onClick={remove} style={{ ...ownerBtn, color: "#b91c1c" }}>🗑 Delete</button>
          </div>
        )}
      </div>
    </div>
  );
}
const ownerBtn: React.CSSProperties = {
  background: "none", border: "none", padding: 0, fontSize: "12px", fontWeight: 600,
  color: "#6b7280", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: "2px",
};

export default function FeatureRequests() {
  const { requests, isAccountOwner, reviewRating, reviewDismissed } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const checkFetcher = useFetcher<any>();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [similar, setSimilar] = useState<ReqItem[] | null>(null);
  const [formError, setFormError] = useState("");
  const [view, setView] = useState<"top" | "roadmap">("top");
  const lastHandled = useRef<any>(null);

  // Rating banner state (matches the Protect & Grow card style)
  const [bannerDismissed, setBannerDismissed] = useState(reviewDismissed || reviewRating > 0);
  const [userRating, setUserRating] = useState<number | null>(reviewRating || null);
  const [ratingThanks, setRatingThanks] = useState(false);

  const rate = async (rating: number) => {
    setUserRating(rating); setRatingThanks(true);
    try { await fetch("/api/submit-rating", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating }) }); } catch { /* ignore */ }
    setTimeout(() => setRatingThanks(false), 2000);
  };
  const dismissBanner = async (e: React.MouseEvent) => {
    e.preventDefault(); setBannerDismissed(true);
    try { await fetch("/api/submit-rating", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dismissed: true }) }); } catch { /* ignore */ }
  };

  const submitting = checkFetcher.state !== "idle";

  const runCheck = () => {
    setFormError("");
    if (title.trim().length < 4) { setFormError("Please enter a clear title (at least 4 characters)."); return; }
    setSimilar(null);
    checkFetcher.submit({ intent: "check", title, description }, { method: "post" });
  };
  const postAnyway = () => {
    checkFetcher.submit({ intent: "create", title, description }, { method: "post" });
  };

  // React to fetcher responses (check → show similar or auto-create; create → reset)
  useEffect(() => {
    const data = checkFetcher.data;
    if (!data || data === lastHandled.current) return;
    lastHandled.current = data;
    if (!data.ok) { setFormError(data.error || "Something went wrong."); return; }
    if (data.intent === "check") {
      if (data.similar && data.similar.length > 0) {
        setSimilar(data.similar as ReqItem[]);
      } else {
        // No duplicates — create it straight away.
        checkFetcher.submit({ intent: "create", title, description }, { method: "post" });
      }
    } else if (data.intent === "create") {
      setTitle(""); setDescription(""); setSimilar(null); setFormError("");
      revalidator.revalidate();
    }
  }, [checkFetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="landing-page">
      <Page fullWidth>
        <div className="landing-container">

          {/* Header */}
          <div className="header-section">
            <div className="header-content">
              <div className="logo-icon">🗳️</div>
              <h1 className="app-title">Feature Requests</h1>
            </div>
          </div>

          {/* Rating card on top */}
          {!bannerDismissed && (
            <div className="review-banner">
              <div className="review-content">
                <div className="review-left">
                  {!ratingThanks ? (
                    <>
                      <p className="review-text">Enjoying ShopFlix AI? Rate us!</p>
                      <p className="review-subtext">
                        <a href="#" onClick={dismissBanner} className="review-link">Tap the stars to rate. Dismiss.</a>
                      </p>
                    </>
                  ) : (
                    <p className="review-text">✓ Thank you for your feedback!</p>
                  )}
                </div>
                <div className="review-stars">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button key={star} className={`star-button ${userRating && star <= userRating ? "rated" : ""}`}
                      onClick={() => rate(star)} aria-label={`Rate ${star} stars`} disabled={ratingThanks}>
                      {userRating && star <= userRating ? "⭐" : "☆"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Submit a request */}
          <div className="intro-card">
            <h2 className="intro-heading">Request a feature</h2>
            <p className="intro-paragraph" style={{ marginBottom: "14px" }}>
              Tell us what would help your store. We build the most-requested ideas first — so
              <strong> vote on existing requests</strong> to push them up the list.
            </p>

            <input
              type="text" value={title} maxLength={140}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short title — e.g. 'Bulk-fix images across all products'"
              style={inputStyle}
            />
            <textarea
              value={description} maxLength={2000} rows={3}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the feature and why it would help (optional but helpful)"
              style={{ ...inputStyle, resize: "vertical" }}
            />
            {formError && <p style={{ color: "#b91c1c", fontSize: "13px", margin: "0 0 10px" }}>{formError}</p>}

            {/* Similar-requests gate */}
            {similar && similar.length > 0 ? (
              <div style={{ border: "1px solid #fcd34d", background: "#fffbeb", borderRadius: "10px", padding: "14px", marginBottom: "12px" }}>
                <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: "14px", color: "#92400e" }}>
                  💡 Similar requests already exist
                </p>
                <p style={{ margin: "0 0 12px", fontSize: "13px", color: "#92400e", lineHeight: 1.5 }}>
                  Voting on an existing request gets it prioritized faster than starting a new one. Found a match? Vote for it 👇
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {similar.map((s) => (
                    <div key={s.id} style={{ display: "flex", gap: "12px", alignItems: "flex-start", background: "#fff", border: "1px solid #fde68a", borderRadius: "8px", padding: "10px" }}>
                      <VoteButton id={s.id} voteCount={s.voteCount} votedByMe={s.votedByMe} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: "0 0 2px", fontWeight: 700, fontSize: "14px", color: "#212121" }}>{s.title}</p>
                        <p style={{ margin: 0, fontSize: "12px", color: "#6b7280", lineHeight: 1.5 }}>{s.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: "10px", marginTop: "14px", flexWrap: "wrap" }}>
                  <button type="button" onClick={postAnyway} disabled={submitting} style={secondaryBtn}>
                    None match — post my request
                  </button>
                  <button type="button" onClick={() => { setSimilar(null); }} style={ghostBtn}>
                    Edit my request
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={runCheck} disabled={submitting} className="feature-card-button" style={{ width: "auto", paddingLeft: "22px", paddingRight: "22px" }}>
                {submitting ? "Checking…" : "Submit request"}
              </button>
            )}
          </div>

          {/* View toggle */}
          <div style={{ display: "flex", gap: "8px", margin: "4px 2px 14px" }}>
            <button type="button" onClick={() => setView("top")} style={tabStyle(view === "top")}>🔥 Most Requested</button>
            <button type="button" onClick={() => setView("roadmap")} style={tabStyle(view === "roadmap")}>🗺️ Roadmap</button>
          </div>

          {requests.length === 0 ? (
            <div className="intro-card" style={{ textAlign: "center" }}>
              <p className="intro-paragraph" style={{ margin: 0 }}>No requests yet — be the first to suggest a feature above! 🚀</p>
            </div>
          ) : view === "top" ? (
            (() => {
              const active = (requests as ReqItem[]).filter((r) => r.status !== "done" && r.status !== "declined");
              if (active.length === 0) {
                return (
                  <div className="intro-card" style={{ textAlign: "center" }}>
                    <p className="intro-paragraph" style={{ margin: 0 }}>Nothing open right now — check the Roadmap to see what's shipped. ✅</p>
                  </div>
                );
              }
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {active.map((r) => <RequestCard key={r.id} item={r} isOwner={isAccountOwner} />)}
                </div>
              );
            })()
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
              {([
                { status: "in_progress", icon: "🚧", label: "In progress" },
                { status: "planned", icon: "📋", label: "Planned" },
                { status: "done", icon: "✅", label: "Shipped" },
              ] as const).map((group) => {
                const items = (requests as ReqItem[]).filter((r) => r.status === group.status);
                if (items.length === 0) return null;
                return (
                  <div key={group.status}>
                    <h2 style={{ margin: "0 0 10px 2px", fontSize: "15px", fontWeight: 700, color: "#212121" }}>
                      {group.icon} {group.label} <span style={{ color: "#9ca3af", fontWeight: 600 }}>({items.length})</span>
                    </h2>
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      {items.map((r) => <RequestCard key={r.id} item={r} isOwner={isAccountOwner} />)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

        </div>
      </Page>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", border: "1px solid #e5e7eb", borderRadius: "8px",
  padding: "10px 12px", fontSize: "14px", fontFamily: "inherit", marginBottom: "10px",
};
const secondaryBtn: React.CSSProperties = {
  background: "#1a4a5a", color: "#fff", border: "none", borderRadius: "8px",
  padding: "10px 16px", fontSize: "13px", fontWeight: 700, cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  background: "none", color: "#6b7280", border: "1px solid #e5e7eb", borderRadius: "8px",
  padding: "10px 16px", fontSize: "13px", fontWeight: 600, cursor: "pointer",
};
const tabStyle = (active: boolean): React.CSSProperties => ({
  border: `1.5px solid ${active ? "#1a4a5a" : "#e5e7eb"}`,
  background: active ? "#1a4a5a" : "#fff",
  color: active ? "#fff" : "#374151",
  borderRadius: "999px", padding: "8px 16px", fontSize: "13px", fontWeight: 700,
  cursor: "pointer", fontFamily: "inherit",
});

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
