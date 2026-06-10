/**
 * Client-only helper: signal that an AI operation finished successfully so the
 * global <RatingPrompt> (mounted once in app.tsx) can — politely and heavily
 * throttled — ask the merchant for a rating + feedback at a happy moment.
 *
 * Call this from any AI success handler, e.g. notifyAiSuccess("scan").
 * The prompt itself decides whether to actually show (already rated / snoozed /
 * once-per-session), so calling this often is safe.
 */
export const AI_SUCCESS_EVENT = "shopflix:ai-success";

export function notifyAiSuccess(source = "ai"): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(AI_SUCCESS_EVENT, { detail: { source } }));
  } catch {
    /* no-op */
  }
}
