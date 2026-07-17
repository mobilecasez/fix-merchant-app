#!/usr/bin/env python3
"""
Blog image generator — stamps hero + inline-diagram SVGs in the EXACT visual system
used by the existing ShopFlix AI blog posts (dark navy gradient, cyan/green/amber
accents, Inter type). Keeps every new post's imagery consistent with the originals.

Usage:
  python3 blog_image_gen.py spec.json         # spec describes one post's images
  cat spec.json | python3 blog_image_gen.py -  # or from stdin

It writes SVGs into public/blog-assets/ and prints, on stdout, JSON with the exact
frontmatter `hero:` line and the `![caption](path)` markdown lines to insert.

Spec shape:
{
  "slug": "domain-age-whois-privacy-merchant-center-trust",
  "hero": { "eyebrow":"DOMAIN TRUST", "titleTop":"Domain Age &",
            "titleBot":"WHOIS Privacy", "highlight":"WHOIS",
            "subtitle":"Why a hidden registration date reads as risk to Google.",
            "icon":"search" },                       # icon: shield|search|clock|doc|pin|link|warn
  "figures": [
    { "type":"cards", "name":"trust-checklist", "eyebrow":"BEFORE YOU ADVERTISE",
      "title":"The trust-signal checklist", "caption":"Caption shown under the figure.",
      "cards":[ {"n":"01","title":"Consistent contact info","lines":["Address, phone,","on-domain email"]}, ... up to 6 ],
      "notes":[ {"accent":"amber","title":"Fix the whole picture","lines":["...","..."]} ] },   # 0-2 notes
    { "type":"steps", "name":"timeline", "eyebrow":"...", "title":"...", "caption":"...",
      "steps":[ {"label":"Day 0","lines":["Feed uploaded","review starts"]}, ... 2-5 ] },
    { "type":"compare", "name":"wrong-vs-right", "eyebrow":"...", "title":"...", "caption":"...",
      "left":{"head":"Flagged","kind":"bad","items":["...","..."]},
      "right":{"head":"Clean","kind":"good","items":["...","..."]} }
  ]
}
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.abspath(os.path.join(HERE, "..", "..", "public", "blog-assets"))
FONT = "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"

# palette (identical to existing posts)
C = dict(bg0="#07101f", bg1="#0d1a30", card="#0e1c34", card2="#0a1526", line="#25395a",
         cyan="#41c6ee", green="#38d39a", amber="#e89b3c", red="#e2604f",
         title="#e9f0fa", muted="#9fb2c9", faint="#6b819c")


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


def T(x, y, s, size, weight=400, fill=C["title"], spacing=None, extra=""):
    ls = f' letter-spacing="{spacing}"' if spacing is not None else ""
    return (f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" '
            f'font-weight="{weight}" fill="{fill}"{ls}{extra}>{s}</text>')


# ---- icons (drawn in a ~120x250 box; caller translates into place) ----
def icon(name):
    ln, cy, gr, am = C["line"], C["cyan"], C["green"], C["amber"]
    if name == "shield":
        return (f'<path d="M 60 0 L 120 26 L 120 130 Q 120 215 60 250 Q 0 215 0 130 L 0 26 Z" fill="url(#shield)" stroke="{cy}" stroke-width="1.5"/>'
                f'<path d="M 60 18 L 104 37 L 104 130 Q 104 200 60 230 Q 16 200 16 130 L 16 37 Z" fill="none" stroke="{ln}" stroke-width="1.5"/>'
                f'<path d="M 33 128 L 53 150 L 90 95" fill="none" stroke="{gr}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>')
    if name == "search":
        return (f'<circle cx="60" cy="95" r="66" fill="url(#shield)" stroke="{cy}" stroke-width="1.5"/>'
                f'<circle cx="60" cy="95" r="40" fill="none" stroke="{ln}" stroke-width="1.5"/>'
                f'<line x1="104" y1="139" x2="150" y2="196" stroke="{cy}" stroke-width="10" stroke-linecap="round"/>')
    if name == "clock":
        return (f'<circle cx="70" cy="110" r="78" fill="url(#shield)" stroke="{cy}" stroke-width="1.5"/>'
                f'<circle cx="70" cy="110" r="52" fill="none" stroke="{ln}" stroke-width="1.5"/>'
                f'<line x1="70" y1="110" x2="70" y2="70" stroke="{gr}" stroke-width="8" stroke-linecap="round"/>'
                f'<line x1="70" y1="110" x2="102" y2="122" stroke="{gr}" stroke-width="8" stroke-linecap="round"/>')
    if name == "doc":
        return (f'<path d="M 8 6 L 96 6 L 132 42 L 132 244 L 8 244 Z" fill="url(#shield)" stroke="{cy}" stroke-width="1.5"/>'
                f'<path d="M 96 6 L 96 42 L 132 42" fill="none" stroke="{ln}" stroke-width="1.5"/>'
                + "".join(f'<line x1="30" y1="{y}" x2="110" y2="{y}" stroke="{ln}" stroke-width="6" stroke-linecap="round"/>' for y in (86, 116, 146, 176))
                + f'<path d="M 34 150 L 52 170 L 92 120" fill="none" stroke="{gr}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>')
    if name == "pin":
        return (f'<path d="M 65 4 Q 130 4 130 78 Q 130 150 65 236 Q 0 150 0 78 Q 0 4 65 4 Z" fill="url(#shield)" stroke="{cy}" stroke-width="1.5"/>'
                f'<circle cx="65" cy="80" r="30" fill="none" stroke="{gr}" stroke-width="8"/>')
    if name == "link":
        return (f'<g fill="none" stroke="{cy}" stroke-width="12" stroke-linecap="round">'
                f'<path d="M 40 150 A 44 44 0 0 1 40 62 L 78 62"/>'
                f'<path d="M 100 62 A 44 44 0 0 1 100 150 L 62 150"/>'
                f'<line x1="55" y1="106" x2="105" y2="106" stroke="{gr}"/></g>')
    if name == "warn":
        return (f'<path d="M 70 6 L 138 210 L 2 210 Z" fill="url(#shield)" stroke="{am}" stroke-width="1.5"/>'
                f'<line x1="70" y1="70" x2="70" y2="150" stroke="{am}" stroke-width="10" stroke-linecap="round"/>'
                f'<circle cx="70" cy="182" r="7" fill="{am}"/>')
    return icon("shield")


def hero(spec):
    h = spec["hero"]
    eyebrow = esc(h.get("eyebrow", "").upper())
    t1, t2 = h.get("titleTop", ""), h.get("titleBot", "")
    hl = h.get("highlight", "")
    longest = max(len(t1), len(t2), 1)
    fs = 86 if longest <= 12 else (72 if longest <= 16 else 60)
    y1 = 330
    y2 = int(y1 + fs * 1.12)
    ysub = y2 + 60

    def line(t):
        t = esc(t)
        if hl and esc(hl) in t:
            t = t.replace(esc(hl), f'<tspan fill="{C["cyan"]}">{esc(hl)}</tspan>')
        return t

    title = esc(h.get("titleTop", "") + " " + h.get("titleBot", "")).strip()
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630"><title>{title}</title>
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{C['bg0']}"/><stop offset="1" stop-color="{C['bg1']}"/></linearGradient>
<radialGradient id="glowC" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="{C['cyan']}" stop-opacity="0.30"/><stop offset="1" stop-color="{C['cyan']}" stop-opacity="0"/></radialGradient>
<radialGradient id="glowG" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="{C['green']}" stop-opacity="0.22"/><stop offset="1" stop-color="{C['green']}" stop-opacity="0"/></radialGradient>
<linearGradient id="shield" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#11243f"/><stop offset="1" stop-color="#0a1526"/></linearGradient>
</defs>
<rect width="1200" height="630" fill="url(#bg)"/>
<circle cx="965" cy="300" r="320" fill="url(#glowC)"/>
<circle cx="180" cy="560" r="240" fill="url(#glowG)"/>
<g stroke="{C['line']}" stroke-width="1" opacity="0.5">
<circle cx="965" cy="300" r="250" fill="none"/><circle cx="965" cy="300" r="190" fill="none"/><circle cx="965" cy="300" r="130" fill="none"/>
</g>
<g fill="{C['line']}" opacity="0.55">
<circle cx="70" cy="80" r="2.5"/><circle cx="130" cy="80" r="2.5"/><circle cx="190" cy="80" r="2.5"/><circle cx="250" cy="80" r="2.5"/>
<circle cx="70" cy="140" r="2.5"/><circle cx="130" cy="140" r="2.5"/><circle cx="190" cy="140" r="2.5"/><circle cx="250" cy="140" r="2.5"/>
<circle cx="70" cy="200" r="2.5"/><circle cx="130" cy="200" r="2.5"/><circle cx="190" cy="200" r="2.5"/>
</g>
{T(90, 244, eyebrow, 22, 600, C['cyan'], 4)}
{T(88, y1, line(t1), fs, 800, C['title'])}
{T(88, y2, line(t2), fs, 800, C['title'])}
{T(92, ysub, esc(h.get("subtitle","")), 24, 400, C['muted'])}
<g transform="translate(915,190)">{icon(h.get("icon","shield"))}</g>
</svg>'''
    return svg


def _fig_head(w, hgt, gid, eyebrow, title):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {hgt}"><title>{esc(title)}</title>
<defs>
<linearGradient id="bg{gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{C['bg0']}"/><stop offset="1" stop-color="{C['bg1']}"/></linearGradient>
<radialGradient id="gl{gid}" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="{C['green']}" stop-opacity="0.16"/><stop offset="1" stop-color="{C['green']}" stop-opacity="0"/></radialGradient>
</defs>
<rect width="{w}" height="{hgt}" rx="18" fill="url(#bg{gid})"/>
<circle cx="{w-150}" cy="90" r="260" fill="url(#gl{gid})"/>
{T(56, 66, esc(eyebrow.upper()), 21, 600, C['cyan'], 3)}
{T(56, 108, esc(title), 34, 800, C['title'])}'''


def cards(fig):
    items = fig.get("cards", [])[:6]
    notes = fig.get("notes", [])[:2]
    w = 1200
    hgt = 640 if (len(items) > 3 or notes) else 340
    gid = fig.get("name", "f").replace("-", "")[:8]
    out = [_fig_head(w, hgt, gid, fig.get("eyebrow", ""), fig.get("title", ""))]
    out.append(f'<g font-family="{FONT}">')
    xs = [56, 424, 792]
    for i, c in enumerate(items):
        x = xs[i % 3]
        y = 160 + (i // 3) * 156
        lines = c.get("lines", [])[:2]
        out.append(f'<g transform="translate({x},{y})">'
                   f'<rect width="352" height="138" rx="14" fill="{C["card"]}" stroke="{C["line"]}" stroke-width="1"/>'
                   f'<circle cx="38" cy="42" r="16" fill="{C["card2"]}" stroke="{C["green"]}" stroke-width="1.5"/>'
                   f'<path d="M 31 42 L 36 48 L 46 35" fill="none" stroke="{C["green"]}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'
                   + T(72, 38, esc(c.get("n", f"{i+1:02d}")), 15, 700, C["faint"], 2)
                   + T(72, 66, esc(c.get("title", "")), 20, 700, C["title"])
                   + "".join(T(24, 100 + j * 22, esc(t), 16, 400, C["muted"]) for j, t in enumerate(lines))
                   + '</g>')
    # note cards along the bottom row
    ny = 160 + ((len(items) + 2) // 3) * 156
    for i, n in enumerate(notes):
        x = xs[i % 3]
        acc = C.get(n.get("accent", "amber"), C["amber"])
        lines = n.get("lines", [])[:2]
        out.append(f'<g transform="translate({x},{ny})">'
                   f'<rect width="352" height="120" rx="14" fill="{C["card2"]}" stroke="{C["line"]}" stroke-width="1"/>'
                   + T(24, 44, esc(n.get("title", "")), 17, 700, acc)
                   + "".join(T(24, 76 + j * 22, esc(t), 15.5, 400, C["muted"]) for j, t in enumerate(lines))
                   + '</g>')
    out.append('</g></svg>')
    return "".join(out)


def steps(fig):
    st = fig.get("steps", [])[:5]
    n = max(len(st), 1)
    w = 1200
    hgt = 430
    gid = fig.get("name", "s").replace("-", "")[:8]
    out = [_fig_head(w, hgt, gid, fig.get("eyebrow", ""), fig.get("title", ""))]
    left, right, cy = 120, 1080, 250
    span = (right - left) / (n - 1) if n > 1 else 0
    xs = [left + i * span for i in range(n)] if n > 1 else [w / 2]
    out.append(f'<line x1="{left}" y1="{cy}" x2="{right if n>1 else left}" y2="{cy}" stroke="{C["line"]}" stroke-width="2"/>')
    out.append(f'<g font-family="{FONT}">')
    for i, s in enumerate(st):
        x = xs[i]
        acc = C["cyan"] if i == n - 1 else C["green"]
        lines = s.get("lines", [])[:2]
        out.append(f'<circle cx="{x}" cy="{cy}" r="16" fill="{C["card2"]}" stroke="{acc}" stroke-width="2"/>'
                   f'<circle cx="{x}" cy="{cy}" r="5" fill="{acc}"/>'
                   + T(x, cy - 40, esc(s.get("label", "")), 19, 800, C["title"], extra=' text-anchor="middle"')
                   + "".join(T(x, cy + 46 + j * 22, esc(t), 15.5, 400, C["muted"], extra=' text-anchor="middle"') for j, t in enumerate(lines)))
    out.append('</g></svg>')
    return "".join(out)


def compare(fig):
    w, hgt = 1200, 560
    gid = fig.get("name", "c").replace("-", "")[:8]
    out = [_fig_head(w, hgt, gid, fig.get("eyebrow", ""), fig.get("title", ""))]
    out.append(f'<g font-family="{FONT}">')
    for side, x, default_acc in (("left", 56, C["red"]), ("right", 624, C["green"])):
        pane = fig.get(side, {})
        good = pane.get("kind") == "good"
        acc = C["green"] if good else (C["red"] if pane.get("kind") == "bad" else default_acc)
        items = pane.get("items", [])[:6]
        out.append(f'<g transform="translate({x},158)">'
                   f'<rect width="520" height="360" rx="16" fill="{C["card"]}" stroke="{acc}" stroke-width="1.5"/>'
                   + T(30, 52, esc(pane.get("head", "")), 22, 800, acc))
        for j, it in enumerate(items):
            yy = 98 + j * 42
            if good:
                mark = (f'<circle cx="42" cy="{yy-5}" r="12" fill="{C["card2"]}" stroke="{C["green"]}" stroke-width="1.5"/>'
                        f'<path d="M 36 {yy-5} L 41 {yy} L 49 {yy-11}" fill="none" stroke="{C["green"]}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>')
            else:
                mark = (f'<circle cx="42" cy="{yy-5}" r="12" fill="{C["card2"]}" stroke="{C["red"]}" stroke-width="1.5"/>'
                        f'<path d="M 37 {yy-10} L 47 {yy} M 47 {yy-10} L 37 {yy}" stroke="{C["red"]}" stroke-width="2.5" stroke-linecap="round"/>')
            out.append(mark + T(66, yy, esc(it), 16.5, 400, C["muted"]))
        out.append('</g>')
    out.append('</g></svg>')
    return "".join(out)


FIGS = {"cards": cards, "steps": steps, "compare": compare}


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else "-"
    raw = sys.stdin.read() if arg == "-" else open(arg).read()
    spec = json.loads(raw)
    slug = spec["slug"]
    os.makedirs(ASSETS, exist_ok=True)
    written, md_lines = [], []

    if spec.get("hero"):
        hpath = os.path.join(ASSETS, f"hero-{slug}.svg")
        with open(hpath, "w") as f:
            f.write(hero(spec))
        written.append(hpath)

    figrefs = []
    for fig in spec.get("figures", []):
        gen = FIGS.get(fig["type"])
        if not gen:
            continue
        name = fig["name"]
        fpath = os.path.join(ASSETS, f"{slug}--{name}.svg")
        with open(fpath, "w") as f:
            f.write(gen(fig))
        written.append(fpath)
        cap = fig.get("caption", fig.get("title", ""))
        figrefs.append({"caption": cap, "path": f"/blog-assets/{slug}--{name}.svg",
                        "markdown": f"![{cap}](/blog-assets/{slug}--{name}.svg)"})

    print(json.dumps({
        "slug": slug,
        "hero_frontmatter": f"hero: /blog-assets/hero-{slug}.svg" if spec.get("hero") else None,
        "figures": figrefs,
        "written": written,
    }, indent=2))


if __name__ == "__main__":
    main()
