import { getAllPosts } from "../blog/posts.server";

const SITE = "https://shopflixai.com";

// Dynamic sitemap — home, /blog, and every blog post. Replaces the old static file so
// new posts are included automatically.
export async function loader() {
  const posts = getAllPosts();
  const entries = [
    { loc: `${SITE}/`, freq: "weekly", pri: "1.0" },
    { loc: `${SITE}/features`, freq: "weekly", pri: "0.9" },
    { loc: `${SITE}/pricing`, freq: "monthly", pri: "0.8" },
    { loc: `${SITE}/blog`, freq: "weekly", pri: "0.8" },
    ...posts.map((p) => ({ loc: `${SITE}/blog/${p.slug}`, freq: "monthly", pri: "0.7", lastmod: p.date })),
  ];
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    entries
      .map((e: any) => `  <url><loc>${e.loc}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ""}<changefreq>${e.freq}</changefreq><priority>${e.pri}</priority></url>`)
      .join("\n") +
    `\n</urlset>\n`;
  return new Response(body, {
    headers: { "Content-Type": "application/xml", "Cache-Control": "public, max-age=3600" },
  });
}
