import { useCallback, useEffect, useRef, useState } from "react";
import { AI_SUCCESS_EVENT } from "../utils/ai-success";

const LS_KEY = "shopflix_rating_prompt_v1";
const SNOOZE_DAYS = 14; // after "Maybe later", don't ask again for this long
const OPEN_DELAY_MS = 1200; // let the success sink in before asking

type Stored = { rated?: boolean; snoozedUntil?: number };

function readStored(): Stored {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(window.localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; }
}
function writeStored(patch: Stored) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(LS_KEY, JSON.stringify({ ...readStored(), ...patch })); } catch { /* no-op */ }
}

/**
 * Global, self-throttling rating + feedback prompt. Mounted once in app.tsx.
 * Opens after an AI-success event (notifyAiSuccess), but only if the shop hasn't
 * already rated and isn't snoozed — at most once per session.
 */
export function RatingPrompt({
  initialRating = 0,
  initialDismissed = false,
  reviewUrl = "",
}: {
  initialRating?: number;
  initialDismissed?: boolean;
  reviewUrl?: string;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const handledThisSession = useRef(false);

  // Already-rated shops never see it again.
  const alreadyRated = initialRating > 0 || readStored().rated === true;

  const canShow = useCallback(() => {
    if (alreadyRated) return false;
    if (handledThisSession.current) return false;
    const s = readStored();
    if (s.rated) return false;
    if (s.snoozedUntil && Date.now() < s.snoozedUntil) return false;
    return true;
  }, [alreadyRated]);

  useEffect(() => {
    const onSuccess = () => {
      if (!canShow()) return;
      handledThisSession.current = true;
      window.setTimeout(() => setOpen(true), OPEN_DELAY_MS);
    };
    window.addEventListener(AI_SUCCESS_EVENT, onSuccess as EventListener);
    return () => window.removeEventListener(AI_SUCCESS_EVENT, onSuccess as EventListener);
  }, [canShow]);

  const post = useCallback(async (body: Record<string, unknown>) => {
    try {
      await fetch("/api/submit-rating", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch { /* non-fatal */ }
  }, []);

  const submit = useCallback(async () => {
    if (rating < 1) return;
    setSubmitting(true);
    await post({ rating, feedback });
    writeStored({ rated: true });
    setSubmitting(false);
    setDone(true);
  }, [rating, feedback, post]);

  const later = useCallback(() => {
    writeStored({ snoozedUntil: Date.now() + SNOOZE_DAYS * 86400000 });
    void post({ dismissed: true });
    setOpen(false);
  }, [post]);

  const close = useCallback(() => setOpen(false), []);

  if (!open) return null;

  const teal = "#1a4a5a";
  const showStoreCta = done && reviewUrl && rating >= 4;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Rate ShopFlix AI"
      style={{
        position: "fixed", inset: 0, zIndex: 2147483000,
        background: "rgba(15,23,42,0.45)", display: "flex",
        alignItems: "center", justifyContent: "center", padding: "16px",
      }}
      onClick={done ? close : later}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: "420px", background: "#fff",
          borderRadius: "14px", boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          padding: "24px", fontFamily: "-apple-system,Segoe UI,sans-serif",
        }}
      >
        {!done ? (
          <>
            <div style={{ fontSize: "26px", textAlign: "center", marginBottom: "6px" }}>🎉</div>
            <h2 style={{ margin: "0 0 6px", fontSize: "18px", fontWeight: 700, color: "#212121", textAlign: "center" }}>
              How's ShopFlix AI working for you?
            </h2>
            <p style={{ margin: "0 0 16px", fontSize: "13px", color: "#6b7280", textAlign: "center", lineHeight: 1.5 }}>
              Your feedback shapes what we build next. It takes 10 seconds.
            </p>

            <div style={{ display: "flex", justifyContent: "center", gap: "6px", marginBottom: "14px" }}>
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onMouseEnter={() => setHover(star)}
                  onMouseLeave={() => setHover(0)}
                  onClick={() => setRating(star)}
                  aria-label={`${star} star${star > 1 ? "s" : ""}`}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    fontSize: "32px", lineHeight: 1, padding: 0,
                    color: (hover || rating) >= star ? "#f5b014" : "#d1d5db",
                    transition: "transform .1s",
                  }}
                >
                  {(hover || rating) >= star ? "★" : "☆"}
                </button>
              ))}
            </div>

            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="What's working well, or what should we improve? (optional)"
              rows={3}
              style={{
                width: "100%", boxSizing: "border-box", resize: "vertical",
                border: "1px solid #e5e7eb", borderRadius: "8px", padding: "10px 12px",
                fontSize: "13px", fontFamily: "inherit", marginBottom: "16px",
              }}
            />

            <button
              type="button"
              onClick={submit}
              disabled={rating < 1 || submitting}
              style={{
                width: "100%", padding: "12px", border: "none", borderRadius: "8px",
                background: rating < 1 ? "#9ca3af" : teal, color: "#fff",
                fontWeight: 700, fontSize: "14px", cursor: rating < 1 ? "not-allowed" : "pointer",
              }}
            >
              {submitting ? "Sending…" : "Submit feedback"}
            </button>
            <button
              type="button"
              onClick={later}
              style={{
                width: "100%", marginTop: "8px", padding: "8px", border: "none",
                background: "none", color: "#6b7280", fontSize: "13px", cursor: "pointer",
              }}
            >
              Maybe later
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: "26px", textAlign: "center", marginBottom: "6px" }}>🙏</div>
            <h2 style={{ margin: "0 0 6px", fontSize: "18px", fontWeight: 700, color: "#212121", textAlign: "center" }}>
              Thank you!
            </h2>
            <p style={{ margin: "0 0 16px", fontSize: "13px", color: "#6b7280", textAlign: "center", lineHeight: 1.5 }}>
              {showStoreCta
                ? "Glad it's helping! A quick public review helps other merchants find us."
                : "We read every note — thank you for helping us improve."}
            </p>
            {showStoreCta && (
              <button
                type="button"
                onClick={() => { window.open(reviewUrl, "_blank", "noopener,noreferrer"); close(); }}
                style={{
                  width: "100%", padding: "12px", border: "none", borderRadius: "8px",
                  background: teal, color: "#fff", fontWeight: 700, fontSize: "14px", cursor: "pointer",
                }}
              >
                Leave a review on the Shopify App Store →
              </button>
            )}
            <button
              type="button"
              onClick={close}
              style={{
                width: "100%", marginTop: showStoreCta ? "8px" : 0, padding: "8px", border: "none",
                background: "none", color: "#6b7280", fontSize: "13px", cursor: "pointer",
              }}
            >
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
}
