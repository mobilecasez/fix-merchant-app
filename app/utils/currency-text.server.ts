/**
 * Currency-text sanitizer for AI-generated content. Gemini sometimes writes "$"/"USD"/"dollars"
 * even when told (and shown) the store's currency, so every AI report/plan is passed through this
 * — both when generated AND when read back from the DB (which retro-fixes older saved payloads
 * without burning credits on a regenerate).
 */
export function currencySymbolFor(code: string): string {
  try {
    const parts = new Intl.NumberFormat("en", { style: "currency", currency: code }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value || code;
  } catch { return code; }
}

/** Rewrite dollar-isms in one string to the store currency. No-op for USD stores. */
export function fixMoneyText(s: string, code: string): string {
  if (!s || !code || code === "USD") return s;
  const sym = currencySymbolFor(code);
  const word = code === "INR" ? "rupees" : code;
  return s
    .replace(/US\$\s?/g, sym)       // "US$1,499" → "₹1,499"
    .replace(/\$\s?(?=\d)/g, sym)   // "$1,499" / "$ 18k" → "₹…" (only money-looking $)
    .replace(/\bUSD\b/g, code)       // "1499 USD" → "1499 INR"
    .replace(/\bdollars?\b/gi, word);
}

/**
 * Deep-walk any JSON payload and fix every string value (URLs skipped). Keys are untouched.
 * Idempotent — safe to apply repeatedly.
 */
export function fixCurrencyDeep<T>(value: T, code: string): T {
  if (!code || code === "USD") return value;
  const walk = (v: any): any => {
    if (typeof v === "string") return /^https?:\/\//i.test(v) ? v : fixMoneyText(v, code);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const o: any = {};
      for (const k of Object.keys(v)) o[k] = walk(v[k]);
      return o;
    }
    return v;
  };
  return walk(value);
}
