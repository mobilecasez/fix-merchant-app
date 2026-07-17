import { json, type MetaFunction } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getAllPosts } from "../blog/posts.server";
import { BlogShell } from "../blog/BlogShell";

const SITE = "https://shopflixai.com";

export async function loader() {
  return json(
    getAllPosts().map(({ slug, title, description, date, author, readingMins, hero }) => ({ slug, title, description, date, author, readingMins, hero })),
  );
}

export const meta: MetaFunction = () => [
  { title: "Google Merchant Center & Shopify blog · ShopFlix AI" },
  { name: "description", content: "Practical guides on fixing Google Merchant Center suspensions, misrepresentation, and product disapprovals for Shopify stores — so you get approved and stay approved." },
  { name: "robots", content: "index, follow" },
  { tagName: "link", rel: "canonical", href: `${SITE}/blog` },
  { property: "og:type", content: "website" },
  { property: "og:title", content: "Google Merchant Center & Shopify blog · ShopFlix AI" },
  { property: "og:description", content: "Fixing Google Merchant Center suspensions, misrepresentation, and product disapprovals for Shopify stores." },
  { property: "og:url", content: `${SITE}/blog` },
  { property: "og:image", content: `${SITE}/web-assets/app-scan.png` },
  { name: "twitter:card", content: "summary_large_image" },
];

function fmtDate(d: string) {
  try { return new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }); }
  catch { return d; }
}

export default function BlogIndex() {
  const posts = useLoaderData<typeof loader>();
  return (
    <BlogShell>
      <main className="blist">
        <h1>The ShopFlix AI blog</h1>
        <p className="sub">Plain-English guides on Google Merchant Center suspensions, misrepresentation, and product disapprovals — written for Shopify merchants.</p>
        <div className="pgrid">
          {posts.map((p) => (
            <a key={p.slug} className={`pcard${p.hero ? " pcard-media" : ""}`} href={`/blog/${p.slug}`}>
              {p.hero && <img className="pcard-thumb" src={p.hero} alt="" loading="lazy" width={1200} height={630} />}
              <div className="pcard-body">
                <h2>{p.title}</h2>
                <p>{p.description}</p>
                <div className="meta">{fmtDate(p.date)} · {p.readingMins} min read · {p.author}</div>
              </div>
            </a>
          ))}
        </div>
      </main>
    </BlogShell>
  );
}
