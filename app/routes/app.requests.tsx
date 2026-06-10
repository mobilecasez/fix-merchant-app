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

  let isAccountOwner = false;
  let reviewRating = 0;
  let reviewDismissed = false;
  let requests: any[] = [];
  let loadError = false;

  // Data queries are wrapped defensively: a transient Prisma/DB issue (e.g. the
  // very first request during a deploy cutover before `prisma generate` finishes)
  // shows a friendly "refresh" state instead of crashing the page.
  try {
    const sessionData = await prisma.session.findFirst({ where: { shop: session.shop } });
    isAccountOwner = sessionData?.accountOwner || false;

    const review = await prisma.shopReview.findUnique({ where: { shop: session.shop } }).catch(() => null);
    reviewRating = review?.rating || 0;
    reviewDismissed = review?.dismissed || false;

    const reqs = await prisma.featureRequest.findMany({
      orderBy: [{ votes: { _count: "desc" } }, { createdAt: "desc" }],
      include: { _count: { select: { votes: true } } },
    });
    const myVotes = await prisma.featureRequestVote.findMany({
      where: { shop: session.shop },
      select: { requestId: true },
    });
    const votedSet = new Set(myVotes.map((v) => v.requestId));
    requests = reqs.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      status: r.status,
      voteCount: r._count.votes,
      votedByMe: votedSet.has(r.id),
      mine: r.createdByShop === session.shop,
      createdAt: r.createdAt,
    }));
  } catch (error) {
    console.error("[requests] loader data query failed:", error);
    loadError = true;
  }

  return json({ shop: session.shop, isAccountOwner, reviewRating, reviewDismissed, requests, loadError });
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

const TEAL = "#1a4a5a";

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
      title={voted ? "Remove your vote" : "Vote for this"}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        width: "52px", minHeight: "56px", padding: "8px 6px", borderRadius: "12px", cursor: "pointer",
        border: `1.5px solid ${voted ? TEAL : "#e2e5e9"}`,
        background: voted ? TEAL : "#fff", color: voted ? "#fff" : "#4b5563",
        boxShadow: voted ? "0 2px 8px rgba(26,74,90,0.25)" : "none",
        transition: "all .12s", fontFamily: "inherit", flexShrink: 0,
      }}
    >
      <span style={{ fontSize: "13px", lineHeight: 1, opacity: 0.9 }}>▲</span>
      <span style={{ fontSize: "17px", fontWeight: 800, lineHeight: 1.35 }}>{count}</span>
    </button>
  );
}

function RequestCard({ item, isOwner }: { item: ReqItem; isOwner: boolean }) {
  const ownerFetcher = useFetcher();
  const meta = STATUS_META[item.status] || STATUS_META.open;
  const nextStatus = OWNER_STATUS_CYCLE[(OWNER_STATUS_CYCLE.indexOf(item.status) + 1) % OWNER_STATUS_CYCLE.length];

  const cycleStatus = () =>
    ownerFetcher.submit({ intent: "status", requestId: item.id, status: nextStatus }, { method: "post" });
  const remove = () => {
    if (typeof window !== "undefined" && !window.confirm("Delete this request?")) return;
    ownerFetcher.submit({ intent: "delete", requestId: item.id }, { method: "post" });
  };

  return (
    <div style={requestCardStyle}>
      <VoteButton id={item.id} voteCount={item.voteCount} votedByMe={item.votedByMe} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "5px" }}>
          <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#1a1a1a" }}>{item.title}</h3>
          <span style={badge(meta)}>{meta.label}</span>
          {item.mine && <span style={{ fontSize: "11px", fontWeight: 600, color: "#9ca3af" }}>· your request</span>}
        </div>
        <p style={{ margin: 0, fontSize: "13px", color: "#5b6470", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
          {item.description}
        </p>
        {isOwner && (
          <div style={{ display: "flex", gap: "14px", marginTop: "12px", paddingTop: "10px", borderTop: "1px solid #f1f2f4" }}>
            <button type="button" onClick={cycleStatus} style={ownerBtn}>↻ Move to “{(STATUS_META[nextStatus] || STATUS_META.open).label}”</button>
            <button type="button" onClick={remove} style={{ ...ownerBtn, color: "#b91c1c" }}>🗑 Delete</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function FeatureRequests() {
  const { requests, isAccountOwner, reviewRating, reviewDismissed, loadError } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const checkFetcher = useFetcher<any>();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [similar, setSimilar] = useState<ReqItem[] | null>(null);
  const [formError, setFormError] = useState("");
  const [view, setView] = useState<"top" | "roadmap">("top");
  const lastHandled = useRef<any>(null);

  // Rating card — visible unless explicitly dismissed (raters still see a thank-you).
  const [bannerDismissed, setBannerDismissed] = useState(reviewDismissed);
  const [userRating, setUserRating] = useState<number | null>(reviewRating || null);

  const rate = async (rating: number) => {
    setUserRating(rating);
    try { await fetch("/api/submit-rating", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating }) }); } catch { /* ignore */ }
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
  const postAnyway = () => checkFetcher.submit({ intent: "create", title, description }, { method: "post" });

  useEffect(() => {
    const data = checkFetcher.data;
    if (!data || data === lastHandled.current) return;
    lastHandled.current = data;
    if (!data.ok) { setFormError(data.error || "Something went wrong."); return; }
    if (data.intent === "check") {
      if (data.similar && data.similar.length > 0) setSimilar(data.similar as ReqItem[]);
      else checkFetcher.submit({ intent: "create", title, description }, { method: "post" });
    } else if (data.intent === "create") {
      setTitle(""); setDescription(""); setSimilar(null); setFormError("");
      revalidator.revalidate();
    }
  }, [checkFetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const reqList = requests as ReqItem[];
  const shippedCount = reqList.filter((r) => r.status === "done").length;
  const plannedCount = reqList.filter((r) => r.status === "planned" || r.status === "in_progress").length;

  return (
    <div className="landing-page">
      <Page fullWidth>
        <div className="landing-container" style={{ maxWidth: "880px", margin: "0 auto" }}>

          {/* Hero */}
          <div style={heroCard}>
            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              <div style={heroIcon}>🗳️</div>
              <div>
                <h1 style={{ margin: 0, fontSize: "22px", fontWeight: 800, color: "#fff" }}>Feature Requests</h1>
                <p style={{ margin: "4px 0 0", fontSize: "13.5px", color: "rgba(255,255,255,0.85)", lineHeight: 1.5 }}>
                  Tell us what to build next — vote on ideas, and we ship the most-wanted first.
                </p>
              </div>
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "18px", flexWrap: "wrap" }}>
              <HeroStat n={requests.length} label="Requests" />
              <HeroStat n={plannedCount} label="In progress / planned" />
              <HeroStat n={shippedCount} label="Shipped" />
            </div>
          </div>

          {/* Rating card */}
          {!bannerDismissed && (
            <div style={ratingCard}>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: "14px", color: "#1a1a1a" }}>
                  {userRating ? "Thanks for rating ShopFlix AI! 💛" : "Enjoying ShopFlix AI?"}
                </p>
                <p style={{ margin: "2px 0 0", fontSize: "12.5px", color: "#9ca3af" }}>
                  {userRating ? "Tap a star to update your rating." : "Tap a star to rate — it really helps us."}{" "}
                  <a href="#" onClick={dismissBanner} style={{ color: "#9ca3af", textDecoration: "underline" }}>Dismiss</a>
                </p>
              </div>
              <div style={{ display: "flex", gap: "3px", flexShrink: 0 }}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <button key={star} type="button" onClick={() => rate(star)} aria-label={`Rate ${star} stars`}
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: "26px", lineHeight: 1, padding: "0 1px", color: (userRating || 0) >= star ? "#f5b014" : "#d6dae0" }}>
                    {(userRating || 0) >= star ? "★" : "☆"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Submit a request */}
          <div style={card}>
            <h2 style={cardHeading}>💡 Request a feature</h2>
            <p style={{ margin: "0 0 14px", fontSize: "13.5px", color: "#6b7280", lineHeight: 1.5 }}>
              Tell us what would help your store. We build the most-requested ideas first — so
              <strong style={{ color: "#374151" }}> vote on existing requests</strong> to push them up.
            </p>

            <input
              type="text" value={title} maxLength={140}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short title — e.g. “Bulk-fix images across all products”"
              style={inputStyle}
            />
            <textarea
              value={description} maxLength={2000} rows={3}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the feature and why it would help (optional but helpful)"
              style={{ ...inputStyle, resize: "vertical" }}
            />
            {formError && <p style={{ color: "#b91c1c", fontSize: "13px", margin: "0 0 10px" }}>{formError}</p>}

            {similar && similar.length > 0 ? (
              <div style={{ border: "1px solid #fde68a", background: "#fffdf5", borderRadius: "12px", padding: "16px", marginTop: "4px" }}>
                <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: "14px", color: "#92400e" }}>💡 Similar requests already exist</p>
                <p style={{ margin: "0 0 12px", fontSize: "12.5px", color: "#a16207", lineHeight: 1.5 }}>
                  Voting on an existing request gets it prioritized faster than starting a new one. Found a match? Vote for it 👇
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {similar.map((s) => (
                    <div key={s.id} style={{ display: "flex", gap: "12px", alignItems: "flex-start", background: "#fff", border: "1px solid #fde68a", borderRadius: "10px", padding: "12px" }}>
                      <VoteButton id={s.id} voteCount={s.voteCount} votedByMe={s.votedByMe} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: "0 0 2px", fontWeight: 700, fontSize: "14px", color: "#1a1a1a" }}>{s.title}</p>
                        <p style={{ margin: 0, fontSize: "12px", color: "#6b7280", lineHeight: 1.5 }}>{s.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: "10px", marginTop: "16px", flexWrap: "wrap" }}>
                  <button type="button" onClick={postAnyway} disabled={submitting} style={primaryBtn}>None match — post my request</button>
                  <button type="button" onClick={() => setSimilar(null)} style={ghostBtn}>Edit my request</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={runCheck} disabled={submitting} style={{ ...primaryBtn, opacity: submitting ? 0.7 : 1 }}>
                {submitting ? "Checking…" : "Submit request"}
              </button>
            )}
          </div>

          {/* View toggle */}
          <div style={segmented}>
            <button type="button" onClick={() => setView("top")} style={segBtn(view === "top")}>🔥 Most Requested</button>
            <button type="button" onClick={() => setView("roadmap")} style={segBtn(view === "roadmap")}>🗺️ Roadmap</button>
          </div>

          {loadError ? (
            <div style={{ ...card, textAlign: "center", color: "#6b7280", fontSize: "14px" }}>
              We couldn't load the requests just now — please refresh the page in a moment. 🔄
            </div>
          ) : requests.length === 0 ? (
            <div style={{ ...card, textAlign: "center", color: "#6b7280", fontSize: "14px" }}>
              No requests yet — be the first to suggest a feature above! 🚀
            </div>
          ) : view === "top" ? (
            (() => {
              const active = reqList.filter((r) => r.status !== "done" && r.status !== "declined");
              if (active.length === 0) {
                return (
                  <div style={{ ...card, textAlign: "center", color: "#6b7280", fontSize: "14px" }}>
                    Nothing open right now — check the Roadmap to see what's shipped. ✅
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
            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              {([
                { status: "in_progress", icon: "🚧", label: "In progress" },
                { status: "planned", icon: "📋", label: "Planned" },
                { status: "done", icon: "✅", label: "Shipped" },
              ] as const).map((group) => {
                const items = reqList.filter((r) => r.status === group.status);
                if (items.length === 0) return null;
                return (
                  <div key={group.status}>
                    <h2 style={{ margin: "0 0 12px 2px", fontSize: "14px", fontWeight: 800, color: "#374151", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      {group.icon} {group.label} <span style={{ color: "#b6bcc4" }}>· {items.length}</span>
                    </h2>
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      {items.map((r) => <RequestCard key={r.id} item={r} isOwner={isAccountOwner} />)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ height: "32px" }} />
        </div>
      </Page>
    </div>
  );
}

function HeroStat({ n, label }: { n: number; label: string }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.14)", borderRadius: "12px", padding: "10px 16px", minWidth: "92px" }}>
      <div style={{ fontSize: "20px", fontWeight: 800, color: "#fff", lineHeight: 1.1 }}>{n}</div>
      <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.8)", marginTop: "2px" }}>{label}</div>
    </div>
  );
}

const heroCard: React.CSSProperties = {
  background: "linear-gradient(135deg, #1a4a5a, #2A5B6D)",
  borderRadius: "18px", padding: "24px 26px", marginBottom: "16px",
  boxShadow: "0 10px 30px rgba(26,74,90,0.20)",
};
const heroIcon: React.CSSProperties = {
  width: "54px", height: "54px", borderRadius: "15px", background: "rgba(255,255,255,0.16)",
  display: "flex", alignItems: "center", justifyContent: "center", fontSize: "28px", flexShrink: 0,
};
const card: React.CSSProperties = {
  background: "#fff", border: "1px solid #eceef1", borderRadius: "16px", padding: "20px",
  marginBottom: "16px", boxShadow: "0 1px 3px rgba(16,24,40,0.05)",
};
const ratingCard: React.CSSProperties = {
  ...card, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px", flexWrap: "wrap",
  padding: "14px 18px",
};
const requestCardStyle: React.CSSProperties = {
  display: "flex", gap: "14px", alignItems: "flex-start",
  background: "#fff", border: "1px solid #eceef1", borderRadius: "14px", padding: "16px 18px",
  boxShadow: "0 1px 3px rgba(16,24,40,0.05)",
};
const cardHeading: React.CSSProperties = { margin: "0 0 6px", fontSize: "17px", fontWeight: 800, color: "#1a1a1a" };
const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", border: "1px solid #e2e5e9", borderRadius: "10px",
  padding: "11px 13px", fontSize: "14px", fontFamily: "inherit", marginBottom: "10px", outlineColor: TEAL,
};
const primaryBtn: React.CSSProperties = {
  background: TEAL, color: "#fff", border: "none", borderRadius: "10px",
  padding: "11px 22px", fontSize: "14px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
};
const ghostBtn: React.CSSProperties = {
  background: "none", color: "#6b7280", border: "1px solid #e2e5e9", borderRadius: "10px",
  padding: "11px 18px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};
const ownerBtn: React.CSSProperties = {
  background: "none", border: "none", padding: 0, fontSize: "12px", fontWeight: 600,
  color: "#6b7280", cursor: "pointer",
};
const segmented: React.CSSProperties = {
  display: "inline-flex", gap: "4px", background: "#eef0f3", borderRadius: "12px",
  padding: "4px", marginBottom: "16px",
};
const segBtn = (active: boolean): React.CSSProperties => ({
  border: "none", background: active ? "#fff" : "transparent",
  color: active ? TEAL : "#6b7280", borderRadius: "9px", padding: "8px 16px",
  fontSize: "13px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
  boxShadow: active ? "0 1px 3px rgba(16,24,40,0.12)" : "none",
});
const badge = (meta: { bg: string; color: string; border: string }): React.CSSProperties => ({
  fontSize: "11px", fontWeight: 700, color: meta.color, background: meta.bg,
  border: `1px solid ${meta.border}`, borderRadius: "999px", padding: "2px 10px",
});

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error) ? error.data : error instanceof Error ? error.message : "An unexpected error occurred.";
  return (
    <div className="landing-page">
      <Page fullWidth>
        <div className="landing-container">
          <div style={{ ...card, textAlign: "center", maxWidth: "560px", margin: "40px auto" }}>
            <h2 style={cardHeading}>Something Went Wrong</h2>
            <p style={{ margin: 0, color: "#6b7280", fontSize: "14px" }}>{message}</p>
          </div>
        </div>
      </Page>
    </div>
  );
}
