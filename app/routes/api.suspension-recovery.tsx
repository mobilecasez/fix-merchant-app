import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { retryOperation } from "../utils/retry.js";
import {
  incrementProductUsage, getOrCreateSubscription, getProductsUsed, getEffectiveProductLimit,
} from "../utils/billing.server";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);
const CREDIT_COST = 10;

async function runGeminiJson(prompt: string, retryId: string): Promise<any> {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
  });
  const text = await retryOperation(async () => {
    const result = await Promise.race([
      model.generateContent(prompt),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("AI timed out")), 120000)),
    ]);
    return (await (result as any).response).text();
  }, 3, 1500, retryId);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return JSON.parse(text.substring(start, end + 1));
}

/** Flatten any scan result (basic / advanced / deep chained) into a findings list. */
function extractFindings(result: any): { findings: any[]; appliedFixes: string[] } {
  if (!result) return { findings: [], appliedFixes: [] };

  const appliedFixes: string[] = (result.applied_fixes || []).map((f: any) => f.autoFixType).filter(Boolean);

  const basic = result.scan_type === "deep" || result.scan_type === "advanced"
    ? (result.basic_result || {})
    : result;
  const advanced = result.advanced_result || (result.scan_type === "advanced" ? result : null);
  const deep = result.deep_result || null;

  const findings: any[] = [];

  // Basic / store-level
  for (const section of ["missing_pages", "broken_links", "merchant_center_compliance", "customer_trust_and_policy", "site_structure_and_seo"]) {
    for (const i of (basic?.[section] || [])) {
      findings.push({
        area: "Store",
        title: i.issue_description || i.label || i.url || section,
        severity: i.severity || "Medium",
        auto_fix_type: i.auto_fix_type || null,
        fixed: i.auto_fix_type ? appliedFixes.includes(i.auto_fix_type) : false,
      });
    }
  }

  // Advanced product feed
  for (const e of (advanced?.errors_found || [])) {
    findings.push({
      area: "Product Feed",
      title: `${e.policy_violation_type || e.issue_type || "Product issue"} — ${e.product_title || e.product_id}`,
      severity: "High",
      auto_fix_type: null,
      fixed: false,
    });
  }

  // Deep misrepresentation
  for (const e of (deep?.critical_misrepresentation_errors || [])) {
    findings.push({
      area: "Trust / Misrepresentation",
      title: e.category + (e.merchant_friendly_explanation ? ` — ${e.merchant_friendly_explanation}` : ""),
      severity: e.severity || "High",
      auto_fix_type: e.auto_fix_type || null,
      fixed: e.auto_fix_type ? appliedFixes.includes(e.auto_fix_type) : false,
    });
  }

  return { findings, appliedFixes };
}

export async function action({ request }: ActionFunctionArgs) {
  const bodyClone = request.clone();
  const { admin, session } = await authenticate.admin(request);
  if (!session) return json({ error: "Unauthorized" }, { status: 401 });

  const body = await bodyClone.json().catch(() => ({}));
  const suspensionReason: string = (body.suspensionReason || "").toString().slice(0, 2000);
  const statusKind: string = body.statusKind || "suspended"; // "suspended" | "warning" | "preventive"

  // Credit check
  const sub = await getOrCreateSubscription(session.shop);
  const used = getProductsUsed(sub);
  const limit = getEffectiveProductLimit(sub);
  if (used + CREDIT_COST > limit) {
    return json({ error: `Not enough credits. This needs ${CREDIT_COST} credits. You have ${limit - used} remaining.` }, { status: 402 });
  }

  // Load latest scan — prefer the most recent COMPLETE scan (deep has the most signal).
  let scan: any = null;
  try {
    const scans = await (prisma as any).storeScan.findMany({
      where: { shop: session.shop, status: "COMPLETE" },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    scan = scans.find((s: any) => s.type === "DEEP") || scans.find((s: any) => s.type === "ADVANCED") || scans[0] || null;
  } catch { /* non-fatal */ }

  // Suspension Recovery is the FINAL step — it needs real scan data to diagnose the
  // violation and draft an accurate appeal. Require a completed scan first.
  if (!scan) {
    return json({
      error: "Please run a Basic, Advanced, or Deep scan first. Suspension Recovery uses your scan results to diagnose the issue and draft an accurate appeal letter — it's the final step after your other scans are complete.",
    }, { status: 400 });
  }

  const { findings } = extractFindings(scan?.result);

  // Shop identity for the letter
  let shopName = session.shop;
  let storeUrl = `https://${session.shop}`;
  try {
    const r = await admin.graphql(`#graphql query { shop { name primaryDomain { url } contactEmail } }`);
    const d = await r.json();
    shopName = d?.data?.shop?.name || shopName;
    storeUrl = d?.data?.shop?.primaryDomain?.url || storeUrl;
  } catch { /* non-fatal */ }

  // Cap the lists by severity/recency so a heavily-flagged store doesn't blow up
  // the prompt — the appeal only needs the most material issues.
  const sevRank: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
  const openFindings = findings.filter(f => !f.fixed)
    .sort((a, b) => (sevRank[a.severity] ?? 3) - (sevRank[b.severity] ?? 3))
    .slice(0, 15);
  const fixedFindings = findings.filter(f => f.fixed).slice(0, 10);

  const prompt = `You are a senior Google Merchant Center (GMC) policy & reinstatement specialist. A Shopify merchant's store has been ${statusKind === "warning" ? "WARNED" : statusKind === "preventive" ? "asked to prepare a preventive appeal" : "SUSPENDED"} by Google. Help them get reinstated by (1) diagnosing the most likely policy violation, (2) producing a prioritized remediation checklist, and (3) drafting a professional reinstatement request letter.

STORE:
- Name: ${shopName}
- URL: ${storeUrl}

GOOGLE'S MESSAGE / STATED REASON (may be empty — infer from findings if so):
${suspensionReason || "(not provided)"}

ISSUES FOUND BY OUR SCAN (open = still unresolved, fixed = already remediated):
OPEN ISSUES:
${openFindings.length ? openFindings.map((f, i) => `${i + 1}. [${f.severity}] (${f.area}) ${f.title}`).join("\n") : "None recorded — run a Deep Scan for richer diagnosis."}

ALREADY FIXED:
${fixedFindings.length ? fixedFindings.map((f, i) => `${i + 1}. (${f.area}) ${f.title}`).join("\n") : "None recorded."}

RULES:
1. Map the situation to ONE primary GMC suspension category: "Misrepresentation", "Insufficient Contact Information", "Untrustworthy Promotions", "Conditions of Service Not Met", "Prohibited / Restricted Content", or "Other".
2. The priority_fixes checklist must be concrete and ordered most-critical first. For each, say exactly where/how to fix it. If our scan can auto-fix it, set auto_fixable true and the auto_fix_type.
3. The appeal_letter must be professional, concise (250–400 words), policy-aware, and follow the structure Google's review team expects: (a) acknowledge the policy and take responsibility, (b) clearly list the specific corrective actions taken/being taken, (c) commit to ongoing compliance, (d) politely request a re-review. Use the real store name. Do NOT invent facts; reference the actual fixes.
4. readiness = "ready_to_appeal" only if there are no High-severity OPEN issues; otherwise "fix_first".
5. Output valid JSON only — no markdown.

Return ONLY:
{
  "suspension_category": "...",
  "category_explanation": "Why this is the likely category, in plain English.",
  "overall_assessment": "1–2 sentence summary of where they stand.",
  "readiness": "ready_to_appeal | fix_first",
  "readiness_note": "What must happen before appealing (or confirmation they're ready).",
  "priority_fixes": [
    { "title": "...", "severity": "High|Medium|Low", "why_it_matters": "...", "how_to_fix": "...", "auto_fixable": true, "auto_fix_type": "privacy_policy|refund_policy|shipping_policy|terms_of_service|contact_page|about_page|business_contact|footer_links|null" }
  ],
  "appeal_letter": "Full reinstatement request letter text...",
  "evidence_points": ["Concrete proof point to mention to Google", "..."]
}`;

  try {
    const result = await runGeminiJson(prompt, "suspension_recovery");
    for (let i = 0; i < CREDIT_COST; i++) await incrementProductUsage(session.shop);
    return json({
      success: true,
      result,
      creditsUsed: CREDIT_COST,
      scanType: scan?.type || null,
      scanDate: scan?.updatedAt || null,
      hadScan: !!scan,
    });
  } catch (err: any) {
    return json({ error: `Could not generate recovery plan: ${err.message}` }, { status: 500 });
  }
}
