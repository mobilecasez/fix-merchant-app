#!/usr/bin/env node
/**
 * ShopFlix AI — store-prospecting scanner.
 *
 * Input: a list of Shopify store domains (CLI args, or tools/prospects.txt, one per line).
 * For each store it reads ONLY public data (homepage HTML, /products.json, policy pages),
 * computes a deterministic Google Merchant Center suspension-RISK score, estimates store
 * age + size (for the "small/medium, < 1 year" filter), and extracts the PUBLIC contact
 * email. Output: a ranked CSV (tools/prospect-report.csv) + a console summary.
 *
 * No AI, no DB — just HTTP. For COMPLIANT, personalized, manual outreach (highest-risk
 * + best-fit stores first). Be polite: modest concurrency, identifies itself.
 *
 * Usage:
 *   node tools/prospect.cjs store1.com store2.com
 *   node tools/prospect.cjs            (reads tools/prospects.txt)
 *   node tools/prospect.cjs --max-age 365 --max-products 300   (filter flags)
 */
const fs = require("fs");
const path = require("path");

const UA = "ShopFlixAI-Prospector/1.0 (+https://shopflixai.com; compliance research)";
const args = process.argv.slice(2);
const flags = {};
const domains = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--max-age") flags.maxAge = Number(args[++i]);
  else if (args[i] === "--max-products") flags.maxProducts = Number(args[++i]);
  else domains.push(args[i]);
}
let list = domains;
if (!list.length) {
  const f = path.join(__dirname, "prospects.txt");
  if (fs.existsSync(f)) list = fs.readFileSync(f, "utf8").split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));
}
if (!list.length) { console.error("No domains. Pass them as args or create tools/prospects.txt"); process.exit(1); }

function norm(d) { return "https://" + d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0]; }
async function get(url, timeout = 12000) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(timeout) });
    return { ok: res.ok, status: res.status, ct: res.headers.get("content-type") || "", text: res.ok ? await res.text() : "" };
  } catch { return { ok: false, status: 0, ct: "", text: "" }; }
}

const EMAIL_JUNK = /(no-?reply|noreply|example\.|sentry|wixpress|\.png|\.jpg|@sentry|@shopify|@2x)/i;
function extractEmail(html, domain) {
  const found = new Set();
  for (const m of html.matchAll(/mailto:([^"'?\s>]+@[^"'?\s>]+)/gi)) found.add(m[1].toLowerCase());
  for (const m of html.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) found.add(m[0].toLowerCase());
  const clean = [...found].filter((e) => !EMAIL_JUNK.test(e));
  const host = domain.replace(/^https?:\/\//, "");
  return clean.find((e) => e.endsWith("@" + host)) || clean.find((e) => e.includes(host.split(".")[0])) || clean[0] || "";
}

const SCARCITY = [/only\s+\d+\s+left/i, /\d+\s+(people|customers)\s+(are\s+)?(viewing|watching)/i, /(hurry|limited time|ends? (in|soon)|while stocks last)/i, /countdown|sale ends/i, /selling fast|almost gone/i];

async function scan(domain) {
  const base = norm(domain);
  const host = base.replace(/^https?:\/\//, "");
  const home = await get(base + "/");
  if (!home.text) return { domain: host, reachable: false, riskScore: 0, riskLevel: "?", issues: ["unreachable / not public"], email: "", products: 0, ageDays: null };
  const text = home.text.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ");

  // products.json (public)
  let products = [];
  const pj = await get(base + "/products.json?limit=250", 15000);
  if (pj.ok && pj.ct.includes("json")) { try { products = (JSON.parse(pj.text).products) || []; } catch {} }

  // policy pages
  const pol = {};
  for (const [k, p] of [["refund", "/policies/refund-policy"], ["privacy", "/policies/privacy-policy"], ["shipping", "/policies/shipping-policy"], ["terms", "/policies/terms-of-service"]]) {
    const r = await get(base + p, 8000);
    pol[k] = r.ok && r.status !== 404 && r.text.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length > 60;
  }

  // contact email (homepage + contact page)
  let email = extractEmail(home.text, base);
  if (!email) { const c = await get(base + "/pages/contact", 9000); if (c.text) email = extractEmail(c.text, base); }

  // store age proxy = earliest product created_at; size = product count
  let ageDays = null;
  if (products.length) {
    const dates = products.map((p) => Date.parse(p.created_at || p.published_at || "")).filter((n) => !isNaN(n));
    if (dates.length) ageDays = Math.round((Date.now() - Math.min(...dates)) / 86400000);
  }

  // deterministic risk signals (mirrors the GMC research)
  const issues = [];
  let score = 0;
  if (!pol.refund) { score += 30; issues.push("No/thin refund policy (HIGH)"); }
  if (!email) { score += 20; issues.push("No public contact email (HIGH)"); }
  const deceptive = products.filter((p) => { const v = (p.variants || [])[0] || {}; const cap = parseFloat(v.compare_at_price); const pr = parseFloat(v.price); return cap > 0 && cap <= pr; }).length;
  if (deceptive) { score += 25; issues.push(`${deceptive} product(s) with fake compare-at pricing (HIGH)`); }
  if (SCARCITY.some((re) => re.test(text))) { score += 15; issues.push("Fake urgency/scarcity on storefront (MED)"); }
  const smallImg = products.filter((p) => { const im = (p.images || [])[0] || {}; return im.width && im.height && (im.width < 500 || im.height < 500); }).length;
  if (smallImg) { score += 8; issues.push(`${smallImg} product image(s) under 500px (MED)`); }
  const thinDesc = products.filter((p) => !(p.body_html || "").replace(/<[^>]+>/g, "").trim()).length;
  if (products.length && thinDesc / products.length > 0.3) { score += 8; issues.push("Many products missing descriptions (MED)"); }
  if (!/visa|mastercard|paypal|secure checkout|256[- ]?bit/i.test(home.text)) { score += 5; issues.push("No visible payment/trust badges (LOW)"); }

  const riskLevel = score >= 40 ? "High" : score >= 20 ? "Medium" : "Low";
  return { domain: host, reachable: true, riskScore: score, riskLevel, issues, email, products: products.length, ageDays };
}

(async () => {
  console.error(`Scanning ${list.length} store(s)…  (filters: ${JSON.stringify(flags)})`);
  const results = [];
  const POOL = 4;
  for (let i = 0; i < list.length; i += POOL) {
    const batch = await Promise.all(list.slice(i, i + POOL).map((d) => scan(d).catch((e) => ({ domain: d, reachable: false, riskScore: 0, riskLevel: "?", issues: ["error: " + e.message], email: "", products: 0, ageDays: null }))));
    results.push(...batch);
  }
  // filters (best-fit): small/medium + young, if flags given
  let rows = results;
  if (flags.maxProducts) rows = rows.filter((r) => !r.products || r.products <= flags.maxProducts);
  if (flags.maxAge) rows = rows.filter((r) => r.ageDays == null || r.ageDays <= flags.maxAge);
  rows.sort((a, b) => b.riskScore - a.riskScore);

  // CSV
  const csv = ["domain,riskScore,riskLevel,products,ageDays,contactEmail,topIssues"]
    .concat(rows.map((r) => [r.domain, r.riskScore, r.riskLevel, r.products, r.ageDays ?? "", r.email, '"' + r.issues.join("; ").replace(/"/g, "'") + '"'].join(",")))
    .join("\n");
  const out = path.join(__dirname, "prospect-report.csv");
  fs.writeFileSync(out, csv);

  // console summary
  console.log("\n=== Prospect report (highest risk = best lead) ===\n");
  for (const r of rows) {
    const age = r.ageDays != null ? `${r.ageDays}d old` : "age ?";
    console.log(`• ${r.domain}  [${r.riskLevel} ${r.riskScore}]  ${r.products} products · ${age} · ${r.email || "no email found"}`);
    r.issues.forEach((i) => console.log(`    - ${i}`));
  }
  console.log(`\nCSV written to ${out}  (${rows.length} stores)`);
})();
