/**
 * Client-only engagement gate for the review prompt. We only ask for a review once the
 * merchant has BOTH interacted with their scan issues AND come back across multiple visits
 * — never on the very first scan. Counters persist in localStorage; a "visit" is counted at
 * most once per browser session (so a return = a new session), and once we've prompted we
 * never re-arm from engagement again.
 */
const LS_KEY = "shopflix_engagement_v1";
const SS_VISIT_FLAG = "shopflix_engagement_visited";
const VISIT_THRESHOLD = 2; // must have come back at least once
const INTERACTION_THRESHOLD = 1; // must have interacted with at least one issue

type Eng = { visits: number; interactions: number; prompted?: boolean };

function read(): Eng {
  if (typeof window === "undefined") return { visits: 0, interactions: 0 };
  try { return { visits: 0, interactions: 0, ...JSON.parse(window.localStorage.getItem(LS_KEY) || "{}") }; }
  catch { return { visits: 0, interactions: 0 }; }
}
function write(patch: Partial<Eng>) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(LS_KEY, JSON.stringify({ ...read(), ...patch })); } catch { /* no-op */ }
}

/** Count a visit to a completed-scan view — at most once per browser session. */
export function recordResultsVisit(): void {
  if (typeof window === "undefined") return;
  try {
    if (window.sessionStorage.getItem(SS_VISIT_FLAG)) return;
    window.sessionStorage.setItem(SS_VISIT_FLAG, "1");
  } catch { /* sessionStorage blocked — still count the visit below */ }
  write({ visits: read().visits + 1 });
}

/** Count a meaningful interaction with the issues (expanding a section, viewing a fix, marking fixed). */
export function recordIssueInteraction(): void {
  write({ interactions: read().interactions + 1 });
}

/** True once the merchant has interacted AND returned across enough visits, and we haven't asked yet. */
export function shouldPromptReview(): boolean {
  const e = read();
  return !e.prompted && e.visits >= VISIT_THRESHOLD && e.interactions >= INTERACTION_THRESHOLD;
}

export function markReviewPrompted(): void {
  write({ prompted: true });
}
