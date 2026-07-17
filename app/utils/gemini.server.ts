import { GoogleGenerativeAI } from "@google/generative-ai";

export const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY || "");

/**
 * Prioritised Gemini model ids to try, first that responds wins. Google retires dated model ids
 * (e.g. `gemini-2.5-flash` started returning 404 "no longer available"), so we lead with the
 * stable `*-latest` aliases and keep known-good fallbacks behind them. An env override
 * (`GEMINI_TEXT_MODEL`) always takes precedence. Dedupes, drops empties.
 */
export function geminiModels(preferred?: string): string[] {
  const list = [
    preferred,
    process.env.GEMINI_TEXT_MODEL,
    // Ordered by what's currently provisioned/responding for this API key (user preference:
    // 3.1 flash lite). Change the `GEMINI_TEXT_MODEL` env var to steer this without a deploy.
    "gemini-3.1-flash-lite",
    "gemini-flash-lite-latest",
    "gemini-3-flash-preview",
    "gemini-flash-latest",
  ].filter(Boolean) as string[];
  return [...new Set(list)];
}

// Errors that mean "try the next model" rather than "give up" — a retired model (404), a busy
// one (503/500/overloaded), or a plain network failure (fetch failed / reset / timeout, which a
// long generation can hit). Anything else (bad request, auth, safety block) is a real failure.
const TRANSIENT = /\b(404|429|500|503)\b|no longer available|not found|high demand|overloaded|unavailable|try again|fetch failed|network error|ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket hang up|terminated/i;
// Billing exhaustion / project denial hit EVERY model identically — fail fast with an actionable
// message instead of burning through the fallback list. NOTE: a plain "exceeded your current
// quota" 429 is a RATE/TIER limit for one model (e.g. pro not enabled on this tier) — that one is
// deliberately NOT here, so it falls through to the next model.
const BILLING = /prepayment credits|billing account|enable billing/i;
const DENIED = /denied access|has been suspended|API key not valid|PERMISSION_DENIED/i;
export const GEMINI_BILLING_MESSAGE =
  "Google AI (Gemini) credits are exhausted for this app's API key — open Google AI Studio (ai.studio/projects), select the project, and top up billing. All AI features resume immediately after.";
export const GEMINI_DENIED_MESSAGE =
  "Google has DENIED this project's Gemini API access ('project has been denied access'). Open Google AI Studio (aistudio.google.com) — check the project's billing/status notifications, or create a fresh API key in a new project with billing enabled and update the app's GOOGLE_GEMINI_API_KEY.";

/**
 * Run `generateContent` across the model fallback list. On a transient/availability error it moves
 * to the next model; a busy `*-latest` alias is also retried once after a short wait. Returns the
 * response text + which model actually answered. Throws the last error only if every model fails.
 */
export async function geminiGenerateDetailed(
  opts: { config?: any; preferredModel?: string; models?: string[]; retryBusyMs?: number; busyRetries?: number; lowThinking?: boolean },
  prompt: any,
): Promise<{ text: string; model: string }> {
  const models = opts.models?.length ? opts.models : geminiModels(opts.preferredModel);
  const busyRetries = Math.max(0, opts.busyRetries ?? 1); // extra same-model retries on 429/503
  let lastErr: any;
  for (const id of models) {
    // lowThinking: mechanical generation (e.g. per-product action lists) must not burn the output
    // budget on internal reasoning — Gemini 3's dynamic thinking has consumed the entire
    // maxOutputTokens and returned a truncated answer (finishReason=MAX_TOKENS with ~8k visible
    // chars). Applied only to explicit gemini-3* ids — `*-latest` aliases may resolve to models
    // that reject the field, which would turn a graceful fallback into a hard 400.
    const cfg = opts.config ? JSON.parse(JSON.stringify(opts.config)) : {};
    if (opts.lowThinking && /^gemini-3/.test(id)) {
      cfg.generationConfig = { ...(cfg.generationConfig || {}), thinkingConfig: { thinkingLevel: "LOW" } };
    }
    for (let attempt = 0; attempt <= busyRetries; attempt++) {
      try {
        const model = genAI.getGenerativeModel({ model: id, ...cfg } as any);
        const res = await model.generateContent(prompt);
        const finishReason = (res.response as any)?.candidates?.[0]?.finishReason;
        if (finishReason && finishReason !== "STOP") console.warn(`[gemini] ${id} finishReason=${finishReason} — output may be truncated`);
        return { text: res.response.text(), model: id };
      } catch (e: any) {
        lastErr = e;
        const msg = String(e?.message || e);
        console.error(`[gemini] ${id} failed: ${msg.slice(0, 300)}`); // raw error always logged
        if (BILLING.test(msg)) throw new Error(GEMINI_BILLING_MESSAGE); // affects all models — stop now
        if (DENIED.test(msg)) throw new Error(GEMINI_DENIED_MESSAGE);  // project-level denial — stop now
        if (!TRANSIENT.test(msg)) throw e; // real error — don't waste the other models
        // A 503/429 (busy) on this model: back off (linearly longer each attempt) and retry, then fall through.
        if (attempt < busyRetries && /\b(429|503)\b|high demand|overloaded/i.test(msg) && opts.retryBusyMs !== 0) {
          await new Promise((r) => setTimeout(r, (opts.retryBusyMs ?? 1200) * (attempt + 1)));
          continue;
        }
        break; // move to the next model
      }
    }
  }
  throw lastErr || new Error("All Gemini models failed");
}

export async function geminiGenerateText(
  opts: { config?: any; preferredModel?: string; models?: string[]; retryBusyMs?: number },
  prompt: any,
): Promise<string> {
  return (await geminiGenerateDetailed(opts, prompt)).text;
}

/**
 * Salvage a JSON value from a model response that may include prose, markdown fences, or stray
 * trailing characters (pro models occasionally emit an extra `}` after valid JSON). Handles BOTH
 * top-level objects and top-level ARRAYS (models asked for {"actions":[…]} sometimes reply with
 * the bare array). Tries the greedy first…last slice, then a string-aware balance scan that stops
 * at the exact closing bracket of the first value.
 */
export function extractJson(text: string): any {
  if (!text) return null;
  const ao = text.indexOf("{");
  const aa = text.indexOf("[");
  // Start at whichever opens first; arrays win ties (an object found later is inside the array).
  const isArray = aa >= 0 && (ao < 0 || aa < ao);
  const a = isArray ? aa : ao;
  if (a < 0) return null;
  const open = isArray ? "[" : "{";
  const close = isArray ? "]" : "}";
  const b = text.lastIndexOf(close);
  if (b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch { /* fall through to balance scan */ } }
  let depth = 0, inStr = false, esc = false;
  for (let i = a; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) { try { return JSON.parse(text.slice(a, i + 1)); } catch { return null; } }
    }
  }
  return null;
}
