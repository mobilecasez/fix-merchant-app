/**
 * Browser-safe (isomorphic) parser for a Shopify Analytics sessions CSV.
 *
 * Runs in the merchant's browser so a huge export (e.g. "Sessions by landing page" with a
 * daily TIMESERIES can be 250k+ rows / 14MB) is parsed and aggregated to a compact
 * per-(product, month) payload BEFORE it's sent to the server — instead of POSTing the raw file.
 *
 * Column detection is loose: the PRODUCT can be a title, handle, landing-page URL/path
 * (/products/<handle>), or a numeric/gid id; the COUNT is sessions/views/visits; an optional
 * DAY/MONTH/DATE column is bucketed to the first of its month. No server-only imports here.
 */

export interface ParsedRow { identifier: string; kind: "id" | "handle" | "url" | "title"; month: string | null; sessions: number }

const ID_HEADERS = [/^product[_\s-]*id$/i, /^id$/i];
const HANDLE_HEADERS = [/^product[_\s-]*handle$/i, /^handle$/i];
const URL_HEADERS = [/landing[_\s-]*page/i, /page[_\s-]*path/i, /^url$/i, /^path$/i, /product[_\s-]*url/i];
const TITLE_HEADERS = [/product[_\s-]*title/i, /product[_\s-]*name/i, /^product$/i, /^title$/i];
const MONTH_HEADERS = [/^month$/i, /^months$/i, /^date$/i, /^day$/i, /^week$/i, /^period$/i, /^time$/i, /month/i, /timeseries/i];
// Exact/specific patterns first so a "Sessions" column beats a "Sessions %" / "Sessions share" one.
const SESSION_HEADERS = [
  /view[_\s-]*sessions/i, /product[_\s-]*views?/i, /online[_\s-]*store[_\s-]*sessions/i,
  /^total[_\s-]*sessions$/i, /^sessions?$/i, /session[_\s-]*count/i, /^views?$/i, /^visits?$/i,
  /sessions/i, /visits/i, /views/i,
];

function matchHeader(headers: string[], patterns: RegExp[]): number {
  for (const p of patterns) {
    const i = headers.findIndex((h) => p.test(h));
    if (i >= 0) return i;
  }
  return -1;
}

/** Split one CSV line into fields, honouring double-quoted values (Shopify quotes commas). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(cur); cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const MONTH_NAMES: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }

/** Parse many date/month formats to a first-of-month ISO string "YYYY-MM-01", or null. */
export function parseMonthISO(v: string): string | null {
  const s = String(v || "").trim();
  if (!s) return null;
  // 2022-02, 2022-02-01, 2022/02, 2022/02/15, 2022-02-01T00:00:00Z
  let m = s.match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?/);
  if (m) { const mo = +m[2]; if (mo >= 1 && mo <= 12) return `${m[1]}-${pad2(mo)}-01`; }
  // "February 2022" / "Feb 2022"
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{4})$/);
  if (m) { const mo = MONTH_NAMES[m[1].slice(0, 3).toLowerCase()]; if (mo != null) return `${m[2]}-${pad2(mo + 1)}-01`; }
  // "Feb 1, 2022" / "February 1 2022"
  m = s.match(/^([A-Za-z]{3,9})\.?\s+\d{1,2},?\s+(\d{4})$/);
  if (m) { const mo = MONTH_NAMES[m[1].slice(0, 3).toLowerCase()]; if (mo != null) return `${m[2]}-${pad2(mo + 1)}-01`; }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) { const d = new Date(t); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-01`; }
  return null;
}

function toInt(v: string): number {
  const n = parseInt(String(v).replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

/** Parse CSV text into typed rows. Returns [] rows if no usable columns are found. */
export function parseSessionsCsv(text: string): { rows: ParsedRow[]; header: { id: string | null; sessions: string | null; month: string | null } } {
  const lines = String(text || "").split(/\r\n|\r|\n/);
  const empty = { rows: [], header: { id: null, sessions: null, month: null } };
  if (lines.length < 2) return empty;

  // Find the real header row — the first non-empty line (within the first 5) that has a sessions column.
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    if (!lines[i].trim()) continue;
    if (matchHeader(splitCsvLine(lines[i]), SESSION_HEADERS) >= 0) { headerIdx = i; break; }
  }
  if (headerIdx < 0) return empty;
  const headers = splitCsvLine(lines[headerIdx]);

  const idCol = matchHeader(headers, ID_HEADERS);
  const handleCol = matchHeader(headers, HANDLE_HEADERS);
  const urlCol = matchHeader(headers, URL_HEADERS);
  const titleCol = matchHeader(headers, TITLE_HEADERS);
  const monthCol = matchHeader(headers, MONTH_HEADERS);
  const sessCol = matchHeader(headers, SESSION_HEADERS);
  if (sessCol < 0) return empty;

  let idKind: ParsedRow["kind"];
  let idColUsed: number;
  if (idCol >= 0) { idKind = "id"; idColUsed = idCol; }
  else if (handleCol >= 0) { idKind = "handle"; idColUsed = handleCol; }
  else if (urlCol >= 0) { idKind = "url"; idColUsed = urlCol; }
  else if (titleCol >= 0) { idKind = "title"; idColUsed = titleCol; }
  else return { rows: [], header: { id: null, sessions: headers[sessCol] || null, month: null } };

  const rows: ParsedRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = splitCsvLine(lines[i]);
    const rawId = f[idColUsed];
    const sessions = toInt(f[sessCol]);
    if (!rawId || sessions <= 0) continue; // skips the empty-path backfill rows Shopify emits
    const month = monthCol >= 0 ? parseMonthISO(f[monthCol]) : null;
    rows.push({ identifier: rawId, kind: idKind, month, sessions });
  }
  return { rows, header: { id: headers[idColUsed] || null, sessions: headers[sessCol] || null, month: monthCol >= 0 ? headers[monthCol] || null : null } };
}

/** Aggregate parsed rows to { identifier: { monthISO: sessions } }. Null months use `fallbackMonthISO`. */
export function aggregateToBuckets(rows: ParsedRow[], fallbackMonthISO: string): Record<string, Record<string, number>> {
  const buckets: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const m = r.month || fallbackMonthISO;
    const b = (buckets[r.identifier] ||= {});
    b[m] = (b[m] || 0) + r.sessions;
  }
  return buckets;
}
