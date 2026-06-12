/**
 * Helpers for the public website scan (shopflixai.com).
 * Normalizes a user-entered store URL and maps the real Basic-scan result
 * (runMonitoringScan -> runBasicScan) into the shape the marketing-site UI
 * expects: issues of { sev, title, why, fix, cat } plus a 0-100 score.
 */

import dns from "node:dns/promises";
import net from "node:net";

// Reject loopback / private / link-local / reserved IPs (SSRF guard).
function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const p = ip.split(".").map(Number);
    const [a, b] = p;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;       // link-local / cloud metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true;                       // multicast / reserved
    return false;
  }
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::" || v === "0:0:0:0:0:0:0:1") return true;
  if (v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd")) return true; // link-local / ULA
  const mapped = v.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/); // IPv4-mapped
  if (mapped) return isPrivateIp(mapped[1]);
  return false;
}

const BLOCKED_HOST_SUFFIX = /\.(internal|local|lan|localhost|home|corp|intranet)$/i;

/**
 * Resolve a hostname and confirm every address is public-routable. Defends the
 * server-side scan fetch against SSRF (internal hostnames, or attacker-registered
 * domains whose A/AAAA records point at private/metadata IPs). Returns false to reject.
 * NOTE: does not pin the IP, so it is not full DNS-rebinding protection — but it blocks
 * the common SSRF vectors before any fetch is made.
 */
export async function assertPublicHost(domain: string): Promise<boolean> {
  if (!domain) return false;
  if (domain === "localhost" || BLOCKED_HOST_SUFFIX.test(domain)) return false;
  // Reject a bare IP literal supplied as the host (normalizeStoreUrl already blocks
  // most, but be defensive in case it's called directly).
  if (net.isIP(domain)) return !isPrivateIp(domain);
  try {
    const addrs = await dns.lookup(domain, { all: true });
    if (!addrs.length) return false;
    return addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

export interface WebIssue {
  sev: "High" | "Medium" | "Low";
  title: string;
  why: string;
  fix: string;
  cat: string;
}

export interface WebScanMapped {
  storeUrl: string;
  storeDomain: string;
  score: number;
  riskLevel: "High" | "Medium" | "Low";
  pagesScanned: number;
  checksRun: number;
  totalIssues: number;
  highCount: number;
  issues: WebIssue[]; // full list incl. fix text (gated)
}

const SECTION_CAT: Record<string, string> = {
  merchant_center_compliance: "Merchant Center compliance",
  customer_trust_and_policy: "Contact & trust signals",
  site_structure_and_seo: "Navigation & SEO",
  missing_pages: "Policy pages & legal",
  broken_links: "Navigation & links",
};

const SEV_RANK: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

function normSev(s: any): "High" | "Medium" | "Low" {
  const v = String(s || "").toLowerCase();
  if (v.startsWith("high")) return "High";
  if (v.startsWith("low")) return "Low";
  return "Medium";
}

/** Normalize a raw user-entered URL/domain into { url, domain }. Returns null if invalid. */
export function normalizeStoreUrl(raw: string): { url: string; domain: string } | null {
  if (!raw || typeof raw !== "string") return null;
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  s = s.split(/[/?#]/)[0].trim(); // host only
  if (!s || s.length > 253) return null;
  // basic hostname validation: label.label, allows subdomains, requires a dot + TLD
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s)) return null;
  if (!/\.[a-z]{2,}$/.test(s)) return null;
  return { url: `https://${s}`, domain: s };
}

/** Map a Basic-scan result object into the website UI shape with a computed score. */
export function mapBasicResult(result: any, storeUrl: string, storeDomain: string): WebScanMapped {
  const issues: WebIssue[] = [];
  const sections = ["merchant_center_compliance", "customer_trust_and_policy", "site_structure_and_seo", "missing_pages", "broken_links"];

  for (const section of sections) {
    for (const i of (result?.[section] || [])) {
      const title =
        i.issue_description || i.label ||
        (i.url ? `Broken link: ${i.url}` : "") ||
        "Compliance issue";
      const fixSteps = Array.isArray(i.detailed_fix_steps) ? i.detailed_fix_steps.join(" ") : "";
      issues.push({
        sev: normSev(i.severity),
        title: String(title).slice(0, 200),
        why: String(i.why || i.reason || i.issue_description || "Flagged against Google Merchant Center requirements.").slice(0, 400),
        fix: String(i.suggested_fix || fixSteps || "See the full report for step-by-step fix instructions.").slice(0, 600),
        cat: SECTION_CAT[section] || "Compliance",
      });
    }
  }

  // Dedupe by title and sort by severity.
  const seen = new Set<string>();
  const deduped = issues.filter((i) => {
    const k = i.title.toLowerCase().slice(0, 80);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  deduped.sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev]);

  const totalIssues = deduped.length;
  const highCount = deduped.filter((i) => i.sev === "High").length;
  const mediumCount = deduped.filter((i) => i.sev === "Medium").length;

  // Score: start at 100, subtract weighted by severity, floor at 8.
  const score = Math.max(8, Math.min(100, 100 - highCount * 14 - mediumCount * 6 - (totalIssues - highCount - mediumCount) * 2));
  const riskLevel: "High" | "Medium" | "Low" = score < 60 ? "High" : score < 80 ? "Medium" : "Low";

  const pagesScanned = Number(result?.scan_summary?.pages_scanned) || 7;
  const checksRun = Number(result?.scan_summary?.checks_run) || 38;

  return { storeUrl, storeDomain, score, riskLevel, pagesScanned, checksRun, totalIssues, highCount, issues: deduped };
}

/** Free preview: the first N issues WITHOUT fix text (fixes are the paid value). */
export function toPreview(mapped: WebScanMapped, n = 2) {
  return mapped.issues.slice(0, n).map(({ sev, title, why, cat }) => ({ sev, title, why, cat }));
}
