/**
 * Lightweight, deterministic similarity matching for the feature-request board.
 * No AI tokens — pure keyword/tag overlap, which catches the common case where
 * merchants describe the same feature with overlapping words. Fast and free, so
 * it runs on every "check" before a request is created.
 */

const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "your", "with", "this", "that",
  "have", "has", "had", "was", "were", "will", "would", "should", "could", "can",
  "able", "from", "into", "out", "off", "over", "under", "then", "than", "them",
  "they", "their", "there", "here", "when", "what", "which", "who", "whom", "how",
  "why", "all", "any", "some", "more", "most", "such", "only", "also", "just",
  "like", "want", "need", "please", "add", "added", "adding", "make", "made",
  "feature", "request", "option", "able", "app", "shopify", "store", "stores",
  "would", "really", "very", "much", "many", "get", "got", "set", "use", "using",
  "new", "old", "via", "per", "etc", "one", "two", "way", "ways", "let", "lets",
]);

/** Tokenize text into meaningful lowercase keywords (≥3 chars, no stopwords). */
export function extractTokens(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** Build a compact, weighted tag string (title counts double) for storage + matching. */
export function makeTags(title: string, description: string): string {
  const counts = new Map<string, number>();
  const bump = (tokens: string[], weight: number) => {
    for (const t of tokens) counts.set(t, (counts.get(t) || 0) + weight);
  };
  bump(extractTokens(title), 2);
  bump(extractTokens(description), 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([t]) => t)
    .join(" ");
}

function normalizeTitle(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export interface ExistingRequest {
  id: string;
  title: string;
  description: string;
  tags?: string | null;
}

export interface SimilarMatch<T extends ExistingRequest = ExistingRequest> {
  request: T;
  score: number;
}

/**
 * Find existing requests similar to a new one. Uses the overlap coefficient
 * (shared / smaller set) so a short new request that's fully contained in a
 * longer existing one still scores high. Also flags near-duplicate titles.
 */
export function findSimilarRequests<T extends ExistingRequest>(
  title: string,
  description: string,
  existing: T[],
  { minShared = 2, minScore = 0.4, limit = 5 } = {}
): SimilarMatch<T>[] {
  const aTokens = new Set([...extractTokens(title), ...extractTokens(description)]);
  const aTitle = normalizeTitle(title);
  if (aTokens.size === 0 && aTitle.length === 0) return [];

  const matches: SimilarMatch<T>[] = [];
  for (const r of existing) {
    const bTokens = new Set([
      ...extractTokens(r.title),
      ...extractTokens(r.tags || ""),
      ...extractTokens(r.description),
    ]);
    if (bTokens.size === 0) continue;

    let shared = 0;
    for (const t of aTokens) if (bTokens.has(t)) shared++;
    const score = aTokens.size ? shared / Math.min(aTokens.size, bTokens.size) : 0;

    // Near-duplicate title (one contains the other) is always a strong match.
    const bTitle = normalizeTitle(r.title);
    const titleDup =
      aTitle.length > 0 && bTitle.length > 0 &&
      (aTitle === bTitle || (aTitle.length >= 6 && (bTitle.includes(aTitle) || aTitle.includes(bTitle))));

    if (titleDup || (shared >= minShared && score >= minScore)) {
      matches.push({ request: r, score: titleDup ? Math.max(score, 0.95) : score });
    }
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, limit);
}
