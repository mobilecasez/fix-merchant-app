/**
 * AI Profit Advisor — rich PDF export (jsPDF, loaded on demand in the browser).
 *
 * Card-based layout mirroring the in-app report: header band → headline/summary → "all products
 * screened" trust strip with bucket chips → key-stat tiles → profit waterfall → per-section tinted
 * cards with accent-bar action items → quick wins → numbered footer. Standard Helvetica only, so
 * non-Latin glyphs (₹ → "Rs.") are transliterated; bullets/checks are drawn as vectors.
 *
 * Kept UI-free so it can be built and visually verified in node (buildAdvisorPdfDoc).
 */

type RGB = [number, number, number];
const rgb = (hex: string): RGB => {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

const INK = rgb("#101A24");
const SUB = rgb("#5B6470");
const SUB2 = rgb("#8A94A2");
const TEAL = rgb("#0E7569");
const GREEN = rgb("#12B76A");
const GREEN_DEEP = rgb("#067647");
const PURPLE = rgb("#5B21B6");
const PURPLE_SOFT = rgb("#7C3AED");
const LAVENDER = rgb("#DDD6FE");
const CARD_BG = rgb("#FAFBFD");
const CARD_LINE = rgb("#E8ECF1");
const MINT_BG = rgb("#F2FBF8");
const MINT_LINE = rgb("#C7E4DF");

const PRIO_PDF: Record<string, { pill: RGB; label: string }> = {
  high: { pill: rgb("#B42318"), label: "HIGH PRIORITY" },
  medium: { pill: rgb("#93700A"), label: "MEDIUM" },
  low: { pill: rgb("#64748B"), label: "LOW" },
};

// Section card tints keyed to the LEVER, not urgency — a "Scale Winners" card must read positive
// (green), not alarming. Matched on the stable code-authored section titles.
const SECTION_TONES: Array<{ match: RegExp; band: RGB; accent: RGB }> = [
  { match: /^(pause|rto drag|true drains|margin impossible)/i, band: rgb("#FDF1F0"), accent: rgb("#B42318") },
  { match: /^scale winners/i, band: rgb("#EDF8F2"), accent: rgb("#067647") },
  { match: /^hidden gems/i, band: rgb("#F6F0FE"), accent: rgb("#6941C6") },
  { match: /^raise price/i, band: rgb("#E9F5F2"), accent: rgb("#0E7569") },
  { match: /^loss leaders/i, band: rgb("#EFF4FF"), accent: rgb("#3538CD") },
  { match: /^price/i, band: rgb("#FEF8EA"), accent: rgb("#93700A") },
];
const toneFor = (title: string): { band: RGB; accent: RGB } =>
  SECTION_TONES.find((t) => t.match.test(String(title || ""))) || { band: rgb("#F3F5F8"), accent: rgb("#64748B") };

const BUCKET_PDF: Record<string, { label: string; bg: RGB; fg: RGB }> = {
  MARGIN_IMPOSSIBLE: { label: "Margin impossible", bg: rgb("#7F1D1D"), fg: rgb("#FEE2E2") },
  BLEEDER: { label: "Ad bleeders", bg: rgb("#FDE8E8"), fg: rgb("#B42318") },
  RTO_LEAK: { label: "RTO leaks", bg: rgb("#FEF0E6"), fg: rgb("#B54708") },
  TRUE_DRAIN: { label: "True drains", bg: rgb("#FDE8E8"), fg: rgb("#B42318") },
  LOSS_LEADER: { label: "Loss leaders", bg: rgb("#EFF4FF"), fg: rgb("#3538CD") },
  WINNER: { label: "Winners", bg: rgb("#E6F4EF"), fg: rgb("#067647") },
  HIDDEN_GEM: { label: "Hidden gems", bg: rgb("#F4EBFF"), fg: rgb("#6941C6") },
  RAISE_PRICE: { label: "Raise price", bg: rgb("#E6F4F1"), fg: rgb("#0E7569") },
  PRICE_TEST: { label: "Price tests", bg: rgb("#FEF7E6"), fg: rgb("#93700A") },
  WATCH: { label: "Watchlist", bg: rgb("#F2F4F7"), fg: rgb("#475467") },
  ZOMBIE: { label: "Zombies", bg: rgb("#F2F4F7"), fg: rgb("#98A2B3") },
  OK: { label: "Healthy", bg: rgb("#F2F4F7"), fg: rgb("#475467") },
};

const clean = (s: any) =>
  String(s ?? "")
    .replace(/₹/g, "Rs. ")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-").replace(/→/g, "->").replace(/↑/g, "+").replace(/·/g, "-")
    .replace(/×/g, "x").replace(/[^\x00-\x7F]/g, "");

function fmtDayPdf(iso: string): string {
  try { return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return String(iso || "").slice(0, 10); }
}

/** Build the document. `data` = the saved advisor payload (report + meta fields). */
export function buildAdvisorPdfDoc(jsPDF: any, data: any, currency: string): any {
  const report = data.report || {};
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  const CW = W - 2 * M;
  const FOOTER_H = 34;
  let y = M;

  const font = (size: number, bold = false, color: RGB = INK) => {
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(...color);
  };
  const wrap = (s: string, size: number, bold: boolean, width: number): string[] => {
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size);
    return doc.splitTextToSize(clean(s), width);
  };
  const ensure = (h: number) => { if (y + h > H - M - FOOTER_H) { doc.addPage(); y = M; } };
  const textWidth = (s: string, size: number, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size);
    return doc.getTextWidth(clean(s));
  };

  // ── Header band ────────────────────────────────────────────────────────────
  doc.setFillColor(...PURPLE); doc.roundedRect(M, y, CW, 78, 12, 12, "F");
  doc.setFillColor(...PURPLE_SOFT); doc.circle(M + CW - 46, y + 39, 22, "F"); // soft glow, safely inside the band
  font(19, true, [255, 255, 255] as RGB); doc.text("AI Profit Advisor", M + 20, y + 32);
  font(9.5, false, LAVENDER);
  doc.text(clean(`Reporting window ${data.rangeLabel || ""}   -   Generated ${fmtDayPdf(data.generatedAt)}`), M + 20, y + 50);
  font(8.5, true, LAVENDER); doc.text("ShopFlix AI", M + CW - 20 - textWidth("ShopFlix AI", 8.5, true), y + 64);
  doc.setFillColor(...rgb("#12B76A")); doc.roundedRect(M + 20, y + 58, 46, 3, 1.5, 1.5, "F"); // teal accent tick
  y += 78 + 16;

  // ── Headline + summary ─────────────────────────────────────────────────────
  if (report.headline) {
    const lines = wrap(report.headline, 13.5, true, CW);
    ensure(lines.length * 17 + 6);
    font(13.5, true, TEAL);
    for (const ln of lines) { doc.text(ln, M, y + 12); y += 17; }
    y += 4;
  }
  if (report.summary) {
    const lines = wrap(report.summary, 10, false, CW);
    ensure(lines.length * 13.5 + 8);
    font(10, false, SUB);
    for (const ln of lines) { doc.text(ln, M, y + 10); y += 13.5; }
    y += 10;
  }

  // ── "All products screened" trust strip with bucket chips ─────────────────
  const sc = data.screened;
  if (sc?.total) {
    const chips = Object.keys(BUCKET_PDF).filter((b) => (sc.counts?.[b] || 0) > 0)
      .map((b) => ({ text: `${sc.counts[b]} ${BUCKET_PDF[b].label}`, ...BUCKET_PDF[b] }));
    // chip flow layout (8pt text, 14pt chip height)
    const rowsOfChips: Array<Array<{ text: string; bg: RGB; fg: RGB; w: number }>> = [[]];
    let cx = 0;
    for (const c of chips) {
      const w = textWidth(c.text, 8, true) + 14;
      if (cx + w > CW - 24 && rowsOfChips[rowsOfChips.length - 1].length) { rowsOfChips.push([]); cx = 0; }
      rowsOfChips[rowsOfChips.length - 1].push({ ...c, w });
      cx += w + 6;
    }
    const stripH = 34 + rowsOfChips.length * 20;
    ensure(stripH + 12);
    doc.setFillColor(...MINT_BG); doc.setDrawColor(...MINT_LINE);
    doc.roundedRect(M, y, CW, stripH, 10, 10, "FD");
    // vector check mark
    doc.setDrawColor(...GREEN); doc.setLineWidth(1.8);
    doc.line(M + 16, y + 17, M + 20, y + 21); doc.line(M + 20, y + 21, M + 27, y + 12);
    doc.setLineWidth(0.6);
    font(10.5, true, TEAL);
    doc.text(clean(`All ${Number(sc.total).toLocaleString()} products screened`), M + 34, y + 20);
    font(8.5, false, SUB);
    doc.text(clean(`${sc.listed} analysed individually  -  ad spend: ${sc.adSpendSource === "google-ads" ? "actual (Google Ads)" : sc.adSpendSource === "estimated" ? "estimated (sessions x CPC)" : "not connected"}`), M + 34 + textWidth(`All ${Number(sc.total).toLocaleString()} products screened`, 10.5, true) + 10, y + 20);
    let chipY = y + 32;
    for (const row of rowsOfChips) {
      let chipX = M + 14;
      for (const c of row) {
        doc.setFillColor(...c.bg); doc.roundedRect(chipX, chipY, c.w, 14, 7, 7, "F");
        font(8, true, c.fg); doc.text(clean(c.text), chipX + 7, chipY + 9.5);
        chipX += c.w + 6;
      }
      chipY += 20;
    }
    y += stripH + 14;
  }

  // ── Key stat tiles ─────────────────────────────────────────────────────────
  if (report.keyStats?.length) {
    const perRow = report.keyStats.length >= 3 ? 3 : Math.max(1, report.keyStats.length);
    const gap = 10;
    const tileW = (CW - gap * (perRow - 1)) / perRow;
    for (let i = 0; i < report.keyStats.length; i += perRow) {
      const row = report.keyStats.slice(i, i + perRow);
      const rowLines = row.map((k: any) => wrap(k.value, 10.5, true, tileW - 24));
      const tileH = 26 + Math.max(...rowLines.map((l: string[]) => l.length)) * 13;
      ensure(tileH + 10);
      row.forEach((k: any, j: number) => {
        const x = M + j * (tileW + gap);
        doc.setFillColor(...CARD_BG); doc.setDrawColor(...CARD_LINE);
        doc.roundedRect(x, y, tileW, tileH, 8, 8, "FD");
        font(7, true, SUB2); doc.text(clean(String(k.label || "").toUpperCase()), x + 12, y + 15);
        font(10.5, true, INK);
        rowLines[j].forEach((ln: string, li: number) => doc.text(ln, x + 12, y + 30 + li * 13));
      });
      y += tileH + 10;
    }
    y += 4;
  }

  // ── Profit waterfall ───────────────────────────────────────────────────────
  const wf = data.waterfall;
  if (wf && wf.revenue > 0) {
    ensure(64);
    const fmtM = (n: number) => `Rs. ${Math.round(Math.abs(n)).toLocaleString()}`;
    font(8, true, SUB2); doc.text("WHERE THE MONEY WENT", M, y + 8);
    const segs = [
      { label: "ads", value: wf.adSpend || 0, color: rgb("#F97066") },
      { label: "shipping", value: wf.shipCost || 0, color: rgb("#F7B267") },
      { label: "RTO", value: wf.rtoCost || 0, color: rgb("#B54708") },
    ].filter((s) => s.value > 0);
    const profitPos = (wf.profit || 0) >= 0;
    const barY = y + 14, barH = 13;
    let bx = M;
    doc.setDrawColor(...CARD_LINE);
    for (const s of segs) {
      const w = Math.max(6, (s.value / wf.revenue) * CW);
      doc.setFillColor(...s.color); doc.rect(bx, barY, Math.min(w, M + CW - bx - 6), barH, "F");
      bx += Math.min(w, M + CW - bx - 6);
    }
    doc.setFillColor(...(profitPos ? GREEN : rgb("#B42318"))); doc.rect(bx, barY, Math.max(6, M + CW - bx), barH, "F");
    doc.roundedRect(M, barY, CW, barH, 4, 4, "S");
    // legend
    let lx = M; const ly = barY + barH + 14;
    font(8.5, true, INK); doc.text(clean(`Revenue ${fmtM(wf.revenue)}`), lx, ly);
    lx += textWidth(`Revenue ${fmtM(wf.revenue)}`, 8.5, true) + 12;
    for (const s of segs) {
      doc.setFillColor(...s.color); doc.rect(lx, ly - 6.5, 7, 7, "F");
      font(8.5, false, SUB); doc.text(clean(`-${fmtM(s.value)} ${s.label}`), lx + 10, ly);
      lx += 10 + textWidth(`-${fmtM(s.value)} ${s.label}`, 8.5) + 12;
    }
    doc.setFillColor(...(profitPos ? GREEN : rgb("#B42318"))); doc.rect(lx, ly - 6.5, 7, 7, "F");
    font(8.5, true, profitPos ? GREEN_DEEP : rgb("#B42318"));
    doc.text(clean(`= ${profitPos ? "profit" : "loss"} ${fmtM(wf.profit)}`), lx + 10, ly);
    y = ly + 18;
  }

  // ── Sections ───────────────────────────────────────────────────────────────
  // Visual hierarchy: header bands OUTDENT to the left of the page grid while action cards INDENT
  // to the right — a section header is instantly distinguishable from its items.
  const BAND_OUT = 10;  // header band extends this far left of the grid
  const CARD_IND = 14;  // action cards start this far right of the grid
  for (const sec of report.sections || []) {
    const prio = PRIO_PDF[sec.priority] || PRIO_PDF.medium;
    const tone = toneFor(sec.title);
    const bandX = M - BAND_OUT;
    const bandW = CW + BAND_OUT;
    const pillW = textWidth(prio.label, 7, true) + 14;
    const countText = `${(sec.actions || []).length} product${(sec.actions || []).length === 1 ? "" : "s"}`;
    const countW = textWidth(countText, 7, true) + 14;
    const titleLines = wrap(sec.title, 12, true, bandW - pillW - countW - 60);
    const insightLines = sec.insight ? wrap(sec.insight, 9, false, bandW - 28) : [];
    const bandH = 16 + titleLines.length * 15 + (insightLines.length ? 4 + insightLines.length * 12 : 0) + 10;
    ensure(bandH + 14);
    y += 4;
    doc.setFillColor(...tone.band); doc.roundedRect(bandX, y, bandW, bandH, 10, 10, "F");
    doc.setFillColor(...tone.accent); doc.roundedRect(bandX, y, 4, bandH, 2, 2, "F");
    font(12, true, INK);
    titleLines.forEach((ln: string, i: number) => doc.text(ln, bandX + 14, y + 20 + i * 15));
    // pills on the first title line, right-aligned
    let px = M + CW - 10 - pillW;
    doc.setFillColor(...prio.pill); doc.roundedRect(px, y + 9, pillW, 14, 7, 7, "F");
    font(7, true, [255, 255, 255] as RGB); doc.text(prio.label, px + 7, y + 18.5);
    px -= countW + 6;
    doc.setFillColor(255, 255, 255); doc.setDrawColor(...CARD_LINE); doc.roundedRect(px, y + 9, countW, 14, 7, 7, "FD");
    font(7, true, SUB); doc.text(countText, px + 7, y + 18.5);
    if (insightLines.length) {
      font(9, false, SUB);
      insightLines.forEach((ln: string, i: number) => doc.text(ln, bandX + 14, y + 20 + titleLines.length * 15 + 2 + i * 12));
    }
    y += bandH + 8;

    // Action cards (indented under their header)
    const cx = M + CARD_IND;
    const cw = CW - CARD_IND;
    for (const a of sec.actions || []) {
      const prodLines = a.product ? wrap(a.product, 9.5, true, cw - 26) : [];
      const recLines = a.recommendation ? wrap(a.recommendation, 9, true, cw - 26) : [];
      const reasonLines = a.reason ? wrap(a.reason, 8.5, false, cw - 26) : [];
      const impactLines = a.impact ? wrap(`Impact: ${a.impact}`, 8.5, true, cw - 26) : [];
      const cardH = 10 + prodLines.length * 12.5 + recLines.length * 12 + reasonLines.length * 11 + impactLines.length * 11 + 8;
      ensure(cardH + 6);
      doc.setFillColor(...CARD_BG); doc.setDrawColor(...CARD_LINE);
      doc.roundedRect(cx, y, cw, cardH, 7, 7, "FD");
      doc.setFillColor(...tone.accent); doc.roundedRect(cx, y + 6, 3, cardH - 12, 1.5, 1.5, "F");
      let ty = y + 16;
      font(9.5, true, TEAL);
      for (const ln of prodLines) { doc.text(ln, cx + 16, ty); ty += 12.5; }
      font(9, true, INK);
      for (const ln of recLines) { doc.text(ln, cx + 16, ty); ty += 12; }
      font(8.5, false, SUB);
      for (const ln of reasonLines) { doc.text(ln, cx + 16, ty); ty += 11; }
      font(8.5, true, GREEN_DEEP);
      for (const ln of impactLines) { doc.text(ln, cx + 16, ty); ty += 11; }
      y += cardH + 6;
    }
    y += 8;
  }

  // ── Quick wins ─────────────────────────────────────────────────────────────
  if (report.quickWins?.length) {
    const winLines: string[][] = report.quickWins.map((q: string) => wrap(q, 9.5, false, CW - 44));
    const cardH = 30 + winLines.reduce((s, l) => s + l.length * 12.5 + 5, 0) + 6;
    ensure(Math.min(cardH, H - 2 * M - FOOTER_H));
    doc.setFillColor(...MINT_BG); doc.setDrawColor(...MINT_LINE);
    doc.roundedRect(M, y, CW, cardH, 10, 10, "FD");
    font(11, true, TEAL); doc.text("Quick wins - do these today", M + 14, y + 19);
    let wy = y + 36;
    for (const lines of winLines) {
      doc.setDrawColor(...GREEN); doc.setLineWidth(1.4);
      doc.line(M + 16, wy - 4.5, M + 19, wy - 1.5); doc.line(M + 19, wy - 1.5, M + 24, wy - 8);
      doc.setLineWidth(0.6);
      font(9.5, false, rgb("#2C6E63"));
      lines.forEach((ln, i) => doc.text(ln, M + 30, wy + i * 12.5));
      wy += lines.length * 12.5 + 5;
    }
    y += cardH + 10;
  }

  // ── Footer on every page ───────────────────────────────────────────────────
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...CARD_LINE); doc.setLineWidth(0.6);
    doc.line(M, H - M - 14, M + CW, H - M - 14);
    font(7.5, false, SUB2);
    doc.text("AI-generated from your store data - review before acting.  Prices only change when you Apply.", M, H - M - 2);
    const pn = `Page ${p} of ${pages}`;
    doc.text(pn, M + CW - textWidth(pn, 7.5), H - M - 2);
  }

  return doc;
}

/** Browser entry: dynamic-import jsPDF, build, download. */
export async function exportAdvisorPdf(data: any, currency: string): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = buildAdvisorPdfDoc(jsPDF, data, currency);
  doc.save(`profit-advisor_${String(data.rangeLabel || "report").replace(/ /g, "")}.pdf`);
}
