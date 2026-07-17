# Blog drafts (review queue)

The scheduled **blog-drafter** routine writes new post drafts here (one per run), as
`YYYY-MM-DD-slug.md` with the same frontmatter as published posts.

Drafts are **not** live — they only render once moved into `app/blog/posts/` and the app
is redeployed. Workflow:

1. Read the draft here, edit/fact-check as needed (keep it genuinely useful — Google
   penalizes thin AI filler).
2. When it's good, move it: `git mv content-drafts/<file> app/blog/posts/<slug>.md`
   (drop the date prefix from the filename — the slug becomes the URL).
3. Redeploy: `railway up --detach`. It appears at `/blog/<slug>` and in the sitemap.
