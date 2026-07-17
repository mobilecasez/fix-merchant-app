/**
 * Blog post store. Markdown files in ./posts/*.md are bundled into the server build
 * via Vite's import.meta.glob (no runtime fs), parsed for frontmatter, and rendered to
 * HTML. Server-rendered so posts actually index in Google.
 *
 * Frontmatter format (between --- fences):
 *   title: ...
 *   description: ...
 *   date: 2026-06-23
 *   author: ShopFlix AI Team
 *   keywords: a, b, c
 */

const RAW = import.meta.glob("./posts/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export interface Post {
  slug: string;
  title: string;
  description: string;
  date: string; // YYYY-MM-DD
  author: string;
  keywords: string;
  hero: string; // path to the hero banner image (e.g. /blog-assets/hero-x.svg), "" if none
  html: string;
  readingMins: number;
  toc: { id: string; text: string }[]; // H2 headings, for the on-page table of contents
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
/** Turn heading text into a stable URL-fragment id (strips markdown + punctuation). */
function slugify(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links → text
    .replace(/[*`_]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60)
    .replace(/-+$/, "");
}
function inline(s: string): string {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
}

/** Minimal, dependency-free Markdown → HTML (headings, lists, blockquotes, hr, paragraphs). */
function mdToHtml(md: string): string {
  const lines = md.split("\n");
  let html = "", para: string[] = [], ul: string[] = [], ol: string[] = [], quote: string[] = [];
  const flushP = () => { if (para.length) { html += "<p>" + inline(para.join(" ")) + "</p>\n"; para = []; } };
  const flushUl = () => { if (ul.length) { html += "<ul>" + ul.map((li) => "<li>" + inline(li) + "</li>").join("") + "</ul>\n"; ul = []; } };
  const flushOl = () => { if (ol.length) { html += "<ol>" + ol.map((li) => "<li>" + inline(li) + "</li>").join("") + "</ol>\n"; ol = []; } };
  const flushQ = () => { if (quote.length) { html += "<blockquote>" + inline(quote.join(" ")) + "</blockquote>\n"; quote = []; } };
  const flushAll = () => { flushP(); flushUl(); flushOl(); flushQ(); };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { flushAll(); continue; }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/))) { flushAll(); const cap = m[1]; const src = m[2]; html += `<figure class="post-fig"><img src="${src}" alt="${esc(cap)}" loading="lazy" />` + (cap ? `<figcaption>${inline(cap)}</figcaption>` : "") + `</figure>\n`; continue; }
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flushAll(); const l = m[1].length; const idAttr = l === 2 || l === 3 ? ` id="${slugify(m[2])}"` : ""; html += `<h${l}${idAttr}>` + inline(m[2]) + `</h${l}>\n`; continue; }
    if (/^(---+|\*\*\*+)$/.test(line.trim())) { flushAll(); html += "<hr>\n"; continue; }
    if ((m = line.match(/^>\s?(.*)$/))) { flushP(); flushUl(); flushOl(); quote.push(m[1]); continue; }
    if ((m = line.match(/^\d+\.\s+(.*)$/))) { flushP(); flushUl(); flushQ(); ol.push(m[1]); continue; }
    if ((m = line.match(/^[-*]\s+(.*)$/))) { flushP(); flushOl(); flushQ(); ul.push(m[1]); continue; }
    flushUl(); flushOl(); flushQ(); para.push(line.trim());
  }
  flushAll();
  return html;
}

function parse(src: string): { meta: Record<string, string>; body: string } {
  const m = src.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: src };
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: m[2] };
}

const POSTS: Post[] = Object.entries(RAW)
  .map(([path, src]) => {
    const slug = (path.split("/").pop() || "").replace(/\.md$/, "");
    const { meta, body } = parse(src);
    const words = body.split(/\s+/).filter(Boolean).length;
    const html = mdToHtml(body.replace(/^\s*#[^\n]*\n+/, "")); // drop the leading H1 — the route renders the title
    const toc = [...html.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)].map((mm) => ({
      id: mm[1],
      text: mm[2].replace(/<[^>]+>/g, "").trim(),
    }));
    return {
      slug,
      title: meta.title || slug,
      description: meta.description || "",
      date: meta.date || "2026-01-01",
      author: meta.author || "ShopFlix AI Team",
      keywords: meta.keywords || "",
      hero: meta.hero || "",
      html,
      readingMins: Math.max(1, Math.round(words / 200)),
      toc,
    };
  })
  .sort((a, b) => (a.date < b.date ? 1 : -1));

export function getAllPosts(): Post[] {
  return POSTS;
}
export function getPost(slug: string): Post | null {
  return POSTS.find((p) => p.slug === slug) || null;
}
