import { json, redirect, type LoaderFunctionArgs, type ActionFunctionArgs, type MetaFunction } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { getPost, getAllPosts } from "../blog/posts.server";
import { BlogShell } from "../blog/BlogShell";
import prisma from "../db.server";

const SITE = "https://shopflixai.com";
const APP = "https://apps.shopify.com/shopflix-ai";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function loader({ params }: LoaderFunctionArgs) {
  const post = getPost(params.slug || "");
  if (!post) throw new Response("Not Found", { status: 404 });
  const related = getAllPosts()
    .filter((p) => p.slug !== post.slug)
    .slice(0, 3)
    .map(({ slug, title, description, hero }) => ({ slug, title, description, hero }));
  let comments: { id: string; name: string; website: string | null; body: string; createdAt: string }[] = [];
  try {
    const rows = await prisma.blogComment.findMany({
      where: { slug: post.slug, approved: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, website: true, body: true, createdAt: true },
    });
    comments = rows.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }));
  } catch {
    /* DB unavailable (e.g. local dev) — render with no comments */
  }
  return json({ post, related, comments });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const slug = params.slug || "";
  if (!getPost(slug)) throw new Response("Not Found", { status: 404 });
  const form = await request.formData();
  // Honeypot: hidden field real users never fill; bots fill everything.
  if ((form.get("company") || "").toString().trim()) return redirect(`/blog/${slug}?posted=1#comments`);

  const name = (form.get("name") || "").toString().trim();
  const email = (form.get("email") || "").toString().trim();
  let website = (form.get("website") || "").toString().trim();
  const body = (form.get("body") || "").toString().trim();
  const values = { name, email, website, body };
  const errors: Record<string, string> = {};

  if (name.length < 2 || name.length > 80) errors.name = "Please enter your name (2–80 characters).";
  if (!EMAIL_RE.test(email)) errors.email = "Please enter a valid email address.";
  if (body.length < 2 || body.length > 5000) errors.body = "Please write a comment (up to 5000 characters).";
  if (website) {
    if (!/^https?:\/\//i.test(website)) website = "https://" + website;
    try {
      const u = new URL(website);
      if (u.protocol !== "http:" && u.protocol !== "https:") errors.website = "Please enter a valid website URL.";
    } catch {
      errors.website = "Please enter a valid website URL.";
    }
  }
  if (Object.keys(errors).length) return json({ ok: false, errors, values }, { status: 400 });

  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
  const userAgent = request.headers.get("user-agent");
  try {
    if (ip) {
      const recent = await prisma.blogComment.count({ where: { ip, createdAt: { gt: new Date(Date.now() - 600000) } } });
      if (recent >= 5) return json({ ok: false, errors: { form: "You're commenting a bit fast — please try again in a few minutes." }, values }, { status: 429 });
    }
    await prisma.blogComment.create({ data: { slug, name, email, website: website || null, body, ip, userAgent, approved: true } });
  } catch {
    return json({ ok: false, errors: { form: "Sorry, we couldn't save your comment. Please try again." }, values }, { status: 500 });
  }
  return redirect(`/blog/${slug}?posted=1#comments`);
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: "Post not found · ShopFlix AI" }];
  const { post } = data;
  const url = `${SITE}/blog/${post.slug}`;
  // Social cards need a raster image; each hero SVG is rasterized to a sibling .png.
  const ogImage = post.hero ? `${SITE}${post.hero.replace(/\.svg$/, ".png")}` : `${SITE}/web-assets/app-scan.png`;
  return [
    { title: `${post.title} · ShopFlix AI` },
    { name: "description", content: post.description },
    { name: "keywords", content: post.keywords },
    { name: "robots", content: "index, follow" },
    { tagName: "link", rel: "canonical", href: url },
    { property: "og:type", content: "article" },
    { property: "og:title", content: post.title },
    { property: "og:description", content: post.description },
    { property: "og:url", content: url },
    { property: "og:image", content: ogImage },
    { name: "twitter:card", content: "summary_large_image" },
    {
      "script:ld+json": {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: post.title,
        description: post.description,
        datePublished: post.date,
        dateModified: post.date,
        author: { "@type": "Organization", name: post.author },
        publisher: { "@type": "Organization", name: "ShopFlix AI", logo: { "@type": "ImageObject", url: `${SITE}/icon-512.png` } },
        mainEntityOfPage: url,
      },
    },
  ];
};

function fmtDate(d: string) {
  try { return new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }); }
  catch { return d; }
}

export default function BlogPost() {
  const { post, related, comments } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as { ok?: boolean; errors?: Record<string, string>; values?: { name: string; email: string; website: string; body: string } } | undefined;
  const nav = useNavigation();
  const [sp] = useSearchParams();
  const posted = sp.get("posted") === "1";
  const submitting = nav.state !== "idle" && nav.formMethod === "POST";
  const hasToc = post.toc.length >= 3;
  const errors = actionData?.errors || {};
  const v = actionData?.values || { name: "", email: "", website: "", body: "" };

  return (
    <BlogShell>
      <article>
        {post.hero && <img className="post-hero" src={post.hero} alt={post.title} width={1200} height={630} />}
        <header className="post-head">
          <h1>{post.title}</h1>
          <p className="post-meta">{fmtDate(post.date)} · {post.readingMins} min read · {post.author}</p>
        </header>

        <div className={hasToc ? "post-grid" : "post-grid no-toc"}>
          {hasToc && (
            <aside className="post-aside">
              <nav className="toc" aria-label="On this page">
                <p className="toc-h">On this page</p>
                <ul>
                  {post.toc.map((t) => (
                    <li key={t.id}><a href={`#${t.id}`}>{t.text}</a></li>
                  ))}
                </ul>
              </nav>
            </aside>
          )}

          <div className="post-content">
            <div className="prose" dangerouslySetInnerHTML={{ __html: post.html }} />

            <div className="cta">
              <h3>Stop guessing why Google flagged your store</h3>
              <p>Run a free scan to see the exact issues Google checks for — then install the ShopFlix AI app to fix them automatically and stay approved.</p>
              <div className="cta-btns">
                <a className="bbtn-amber" href={`${SITE}/`}>Scan your store free</a>
                <a className="bbtn" href={APP} target="_blank" rel="noopener">Get the Shopify app</a>
              </div>
            </div>

            <section className="comments" id="comments">
              <h2 className="comments-h">{comments.length} {comments.length === 1 ? "Comment" : "Comments"}</h2>

              {posted && <p className="comment-note ok">Thanks! Your comment has been posted.</p>}
              {comments.length === 0 && !posted && <p className="comment-empty">No comments yet — share your experience or ask a question below.</p>}

              {comments.length > 0 && (
                <ul className="comment-list">
                  {comments.map((c) => (
                    <li className="comment" key={c.id}>
                      <div className="comment-av" aria-hidden="true">{(c.name.trim()[0] || "?").toUpperCase()}</div>
                      <div className="comment-main">
                        <div className="comment-head">
                          {c.website
                            ? <a className="comment-name" href={c.website} target="_blank" rel="nofollow ugc noopener">{c.name}</a>
                            : <span className="comment-name">{c.name}</span>}
                          <span className="comment-date">{fmtDate(c.createdAt.slice(0, 10))}</span>
                        </div>
                        <p className="comment-body">{c.body}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <h3 className="comment-form-h">Leave a comment</h3>
              {errors.form && <p className="comment-note err">{errors.form}</p>}
              <Form method="post" className="comment-form" replace>
                <div className="cf-row">
                  <div className="cf-field">
                    <label htmlFor="cf-name">Name *</label>
                    <input id="cf-name" name="name" type="text" defaultValue={v.name} maxLength={80} required />
                    {errors.name && <span className="cf-err">{errors.name}</span>}
                  </div>
                  <div className="cf-field">
                    <label htmlFor="cf-email">Email * <span className="cf-hint">(not published)</span></label>
                    <input id="cf-email" name="email" type="email" defaultValue={v.email} maxLength={120} required />
                    {errors.email && <span className="cf-err">{errors.email}</span>}
                  </div>
                </div>
                <div className="cf-field">
                  <label htmlFor="cf-website">Website <span className="cf-hint">(optional)</span></label>
                  <input id="cf-website" name="website" type="text" defaultValue={v.website} maxLength={200} placeholder="https://yourstore.com" />
                  {errors.website && <span className="cf-err">{errors.website}</span>}
                </div>
                <div className="cf-field">
                  <label htmlFor="cf-body">Comment *</label>
                  <textarea id="cf-body" name="body" rows={5} defaultValue={v.body} maxLength={5000} required />
                  {errors.body && <span className="cf-err">{errors.body}</span>}
                </div>
                <div className="cf-hp" aria-hidden="true">
                  <label>Company<input name="company" tabIndex={-1} autoComplete="off" /></label>
                </div>
                <div className="cf-actions">
                  <button type="submit" className="bbtn-amber" disabled={submitting}>{submitting ? "Posting…" : "Post comment"}</button>
                  <span className="cf-privacy">Your email stays private. By posting you agree to our <a href="/privacy-policy.html">Privacy Policy</a>.</span>
                </div>
              </Form>
            </section>
          </div>
        </div>

        {related.length > 0 && (
          <section className="related">
            <h2>Keep reading</h2>
            <div className="pgrid">
              {related.map((r) => (
                <a className={`pcard${r.hero ? " pcard-media" : ""}`} href={`/blog/${r.slug}`} key={r.slug}>
                  {r.hero && <img className="pcard-thumb" src={r.hero} alt="" loading="lazy" width={1200} height={630} />}
                  <div className="pcard-body">
                    <h2>{r.title}</h2>
                    <p>{r.description}</p>
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}
      </article>
    </BlogShell>
  );
}
