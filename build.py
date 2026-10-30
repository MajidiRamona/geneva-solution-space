#!/usr/bin/env python3
"""Builds the Geneva Solution Space site from the files in content/.

Run:  python3 build.py            (needs only Python 3)
Output: index.html, <slug>/index.html for every page, events/<slug>/, blog/<slug>/.

All copy lives in content/ as JSON (edited through /admin/ or by hand):
  content/site.json          name, address, email, footer links
  content/pages/<page>.json  the text of each page, section by section
  content/partners/*.json    one file per partner (name, logo, description)
  content/events/*.json      one file per event; upcoming vs past is decided by the date
  content/posts/*.json       one file per blog post; the body is Markdown
Layout lives here and in templates/ (the two hero SVGs) and styles.css.
"""
import glob
import html as H
import json
import os
import re
from datetime import date, datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
ASSET_VERSION = "20261011a"  # bump when styles.css or script.js change, so browsers fetch the new file


# ----------------------------------------------------------------------------
# Content helpers
# ----------------------------------------------------------------------------

def load(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return json.load(f)


def load_dir(rel):
    """Every JSON file in a folder, as (slug, data) pairs."""
    out = []
    for path in sorted(glob.glob(os.path.join(ROOT, rel, "*.json"))):
        out.append((os.path.splitext(os.path.basename(path))[0], load(os.path.relpath(path, ROOT))))
    return out


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


SITE_URL = "https://genevasolutionspace.ch"
PUBLIC_PAGES = []  # filled by write(); becomes sitemap.xml


def write(path, content):
    if path.endswith("index.html") and not path.startswith(("admin/", "welcome/")):
        PUBLIC_PAGES.append("/" + path[: -len("index.html")])
    full = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        f.write(content)
    print("wrote", path)


def attr(s):
    return H.escape(s or "", quote=True)


def text(s):
    return H.escape(s or "", quote=False)


def _link(m):
    label, href = m.group(1), m.group(2)
    ext = ' target="_blank" rel="noopener"' if href.startswith("http") else ""
    return f'<a href="{href}"{ext}>{label}</a>'


def inline(s):
    """Inline Markdown for short fields: **bold**, *italic*, `code`, [links](url), images, line breaks."""
    s = text(s)
    s = re.sub(r"\\([\\`*_{}\[\]()#+\-.!])", lambda m: "\x00%d\x00" % ord(m.group(1)), s)  # the editor escapes these characters; keep them literal
    s = re.sub(r"!\[([^\]]*)\]\(([^)\s]+)\)", r'<img src="\2" alt="\1" loading="lazy">', s)
    s = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", _link, s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<em>\1</em>", s)
    s = re.sub(r"(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)", r"<em>\1</em>", s)  # the editor writes italics as _text_
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\n\s*\n", "<br><br>", s)  # a blank line typed in a short field
    s = re.sub(r"\x00(\d+)\x00", lambda m: chr(int(m.group(1))), s)
    return s.replace("  \n", "<br>\n").replace("\\\n", "<br>\n")


LIST_RE = re.compile(r"^\s*([-*+]|\d+[.)])\s+")


def md(src):
    """Markdown blocks for long fields (blog posts, the prose pages). Raw HTML blocks pass through."""
    lines = (src or "").replace("\r", "").split("\n")
    out, i = [], 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        if line.startswith("```"):
            j, buf = i + 1, []
            while j < len(lines) and not lines[j].startswith("```"):
                buf.append(lines[j]); j += 1
            out.append("<pre><code>%s</code></pre>" % text("\n".join(buf)))
            i = j + 1
            continue
        m = re.match(r"(#{1,6})\s+(.*)", line)
        if m:
            n = len(m.group(1))
            out.append(f"<h{n}>{inline(m.group(2))}</h{n}>")
            i += 1
            continue
        if re.match(r"^(-{3,}|\*{3,}|_{3,})\s*$", line):
            out.append("<hr>")
            i += 1
            continue
        if re.match(r"^<[a-zA-Z!]", line):  # raw HTML (tables, embeds) until a blank line
            j, buf = i, []
            while j < len(lines) and lines[j].strip():
                buf.append(lines[j]); j += 1
            out.append("\n".join(buf))
            i = j
            continue
        if LIST_RE.match(line):
            ordered = bool(re.match(r"^\s*\d+[.)]\s+", line))
            items, j = [], i
            while j < len(lines) and lines[j].strip() and (LIST_RE.match(lines[j]) or lines[j].startswith("  ")):
                if LIST_RE.match(lines[j]):
                    items.append(LIST_RE.sub("", lines[j]))
                else:
                    items[-1] += " " + lines[j].strip()
                j += 1
            tag = "ol" if ordered else "ul"
            out.append("<%s>\n%s\n</%s>" % (tag, "\n".join("  <li>%s</li>" % inline(x) for x in items), tag))
            i = j
            continue
        if line.startswith(">"):
            j, buf = i, []
            while j < len(lines) and lines[j].startswith(">"):
                buf.append(lines[j][1:].strip()); j += 1
            out.append("<blockquote>%s</blockquote>" % md("\n".join(buf)))
            i = j
            continue
        m = re.match(r"^!\[([^\]]*)\]\(([^)\s]+)\)\s*$", line)
        if m:
            out.append(f'<figure><img src="{m.group(2)}" alt="{attr(m.group(1))}" loading="lazy"></figure>')
            i += 1
            continue
        j, buf = i, []
        while j < len(lines) and lines[j].strip() and not re.match(r"^(#{1,6}\s|```|>)", lines[j]) and not LIST_RE.match(lines[j]):
            buf.append(lines[j]); j += 1
        out.append("<p>%s</p>" % inline("\n".join(buf)))
        i = j
    return "\n".join(out)


def heading(tag, title, accent, cls=""):
    c = f' class="{cls}"' if cls else ""
    em = f" <em>{text(accent)}</em>" if accent else ""
    return f"<{tag}{c}>{text(title)}{em}</{tag}>"


def post_md(src):
    """Markdown for event and blog bodies: the page title is the page's only h1."""
    return re.sub(r"<(/?)h1\b", r"<\1h2", md(src))


def paragraphs(items, cls=""):
    c = f' class="{cls}"' if cls else ""
    return "\n".join(f"      <p{c}>{inline(p)}</p>" for p in items)


def price_list(items):
    return "\n".join(f"        <li><span>{text(p['value'])}</span><span>{text(p['label'])}</span></li>" for p in items)


def def_grid(items):
    return "\n".join(f"      <div><dt>{text(it['term'])}</dt><dd>{inline(it['text'])}</dd></div>" for it in items)


def pretty_date(iso):
    try:
        d = datetime.strptime(iso, "%Y-%m-%d")
        return f"{d.day} {d.strftime('%B %Y')}"
    except (TypeError, ValueError):
        return iso or ""


SITE = load("content/site.json")


# ----------------------------------------------------------------------------
# Shared chrome
# ----------------------------------------------------------------------------

MARK = '<img class="mark" src="/assets/logos/gss-gear.png" alt="" width="34" height="34">'

NAV_ITEMS = [
    ("who-we-are", "Who We Are", "/who-we-are/"),
    ("what-we-do", "What We Host", "/what-we-do/"),
    ("education", "Education", "/education/"),
    ("blog", "Blog", "/blog/"),
    ("contact", "Contact Us", "/contact/"),
]


def header(active=""):
    rows = []
    for key, label, href in NAV_ITEMS:
        current = ' aria-current="page"' if key == active else ""
        rows.append(f'    <a href="{href}"{current}>{label}</a>')
    links = "\n".join(rows)
    cta = text(SITE["nav_cta_label"])
    return f'''<header class="nav-wrap" id="top">
  <div class="nav">
  <a class="brand" href="/">
    {MARK}
    <span class="brand-text">
      <span class="brand-name">{text(SITE["name"])}</span>
    </span>
  </a>
  <nav class="nav-links" id="nav-links" aria-label="Primary">
{links}
    <a class="btn btn-solid nav-cta-mobile" href="/reservations/">{cta}</a>
  </nav>
  <a class="btn btn-solid btn-sm nav-cta" href="/reservations/">{cta}</a>
  <button class="nav-toggle" id="nav-toggle" aria-expanded="false" aria-controls="nav-links" aria-label="Open menu">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path></svg>
  </button>
  </div>
</header>'''


def footer():
    links = "".join(f'<a href="{l["url"]}">{text(l["label"])}</a>' for l in SITE["footer_links"])
    return f'''<div class="footer-wrap">
<footer class="footer container footer-simple">
  <div class="foot-brand">
    <div class="foot-mark">{MARK}<span class="brand-name">{text(SITE["name"])}</span></div>
    <address>{"<br>".join(text(l) + "," if i < len(SITE["address"]) - 1 else text(l) for i, l in enumerate(SITE["address"]))}</address>
    <a class="accent" href="mailto:{SITE["email"]}">{SITE["email"]}</a>
  </div>
  <div class="foot-col">
    {links}
  </div>
  <div class="foot-unige">
    <span class="eyebrow">An initiative of</span>
    <a href="https://www.unige.ch" target="_blank" rel="noopener"><img src="/assets/logos/unige.png" alt="University of Geneva (UNIGE)" width="200"></a>
  </div>
  <div class="foot-bottom">
    <span>{text(SITE["copyright"])}</span>
  </div>
</footer>
</div>'''


# Netlify Identity: lets an invited editor land on the site from the invite email and be sent to /admin/.
IDENTITY_SNIPPET = '''<script>
if (/(invite|recovery|confirmation|email_change)_token=/.test(location.hash) && location.pathname !== '/welcome/') {
  location.replace('/welcome/' + location.hash);
}
</script>'''


def shell(title, description, body, active="", extra_head="", extra_script="", full_title=None):
    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{attr(full_title or f"{title} | {SITE['name']}")}</title>
  <meta name="description" content="{attr(description)}">
  <link rel="icon" href="/assets/logos/gss-gear.png">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="{attr(SITE['name'])}">
  <meta property="og:title" content="{attr(full_title or title or SITE['name'])}">
  <meta property="og:description" content="{attr(description)}">
  <meta property="og:image" content="{SITE_URL}/assets/images/room-session.jpg">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Instrument+Serif:ital@0;1&display=swap">
  <link rel="stylesheet" href="/styles.css?v={ASSET_VERSION}">
{extra_head}</head>
<body>

{header(active)}

<main>
{body}
</main>

{footer()}

{IDENTITY_SNIPPET}
<script src="/script.js?v={ASSET_VERSION}"></script>
{extra_script}</body>
</html>
'''


def page_hero(h, cta=""):
    lede_html = f'\n    <p class="lede">{inline(h["lede"])}</p>' if h.get("lede") else ""
    cta_html = f'\n    <div class="actions">{cta}</div>' if cta else ""
    eyebrow_html = f'\n    <p class="eyebrow">{text(h["eyebrow"])}</p>' if h.get("eyebrow") else ""
    return f'''  <section class="page-hero container">{eyebrow_html}
    {heading("h1", h["title"], h.get("accent"))}{lede_html}{cta_html}
  </section>'''


# ----------------------------------------------------------------------------
# Collections
# ----------------------------------------------------------------------------

def partners():
    rows = [dict(p, slug=slug) for slug, p in load_dir("content/partners")]
    rows.sort(key=lambda p: (p.get("order") or 999, p["name"].lower()))
    return rows


def events():
    """(upcoming, past) — decided by the event date against the build date."""
    today = date.today().isoformat()
    rows = [dict(e, slug=slug) for slug, e in load_dir("content/events")]
    upcoming = sorted([e for e in rows if e.get("date", "") >= today], key=lambda e: e["date"])
    past = sorted([e for e in rows if e.get("date", "") < today], key=lambda e: e["date"], reverse=True)
    return upcoming, past


def posts():
    rows = [dict(p, slug=slug) for slug, p in load_dir("content/posts") if not p.get("draft")]
    rows.sort(key=lambda p: (p.get("date") or "0000", -(p.get("sort") or 0)), reverse=True)
    return rows


def partners_section(d):
    cards = []
    for p in partners():
        link = f'\n          <a href="{p["url"]}" target="_blank" rel="noopener">Visit {text(p["domain"])} ↗</a>' if p.get("domain") and p.get("url") else ""
        cards.append(f'''      <article class="partner-card">
        <div class="partner-logo"><img src="{p["logo"]}" alt="{attr(p["name"])} logo"></div>
        <div class="partner-body">
          <h3>{text(p["name"])}</h3>
          <p>{inline(p["description"])}</p>{link}
        </div>
      </article>''')
    return f'''  <section class="section container" id="partners">
    <div class="section-head">
      <div>
        <p class="eyebrow">{text(d["eyebrow"])}</p>
        {heading("h2", d["title"], d["accent"])}
      </div>
    </div>
    <div class="pillars-head">
      <p class="lede">{inline(d["lede"])}</p>
      <p class="lede">{inline(d["lede2"])}</p>
    </div>
    <div class="partner-grid">
{chr(10).join(cards)}
    </div>
  </section>'''


# ----------------------------------------------------------------------------
# Homepage
# ----------------------------------------------------------------------------

def page_home():
    d = load("content/pages/home.json")
    h, r, eco, ev, fm, loc = d["hero"], d["roadto"], d["ecosystem"], d["events"], d["formats"], d["location"]
    plist = partners()
    n = len(plist)
    ticker = "".join(f"<li>{inline(t)}</li>" for t in d["ticker"])
    stats = "\n".join(
        '    <div class="stat"><span class="stat-n">%s%s%s</span><span class="stat-l">%s</span></div>' % (
            '<small class="gt">&gt;</small>' if s.get("prefix") == ">" else "", text(s["value"]),
            f"<small>{text(s['unit'])}</small>" if s.get("unit") else "", inline(s["label"]))
        for s in d["stats"])
    outer = "\n".join(
        '            <div class="onode" style="--a: %sdeg"><span>%s</span></div>' % (
            ("%.1f" % (i * 360 / len(d["outer_ring"]))).rstrip("0").rstrip("."), text(o).replace("Palais des Nations", "Palais<br>des Nations"))
        for i, o in enumerate(d["outer_ring"]))
    nodes = []
    for i, p in enumerate(plist):
        href = f'href="{p["url"]}" target="_blank" rel="noopener"' if p.get("url") else 'href="/partners/"'
        nodes.append(f'            <div class="node" style="--a: {i * 360 // n if (360 % n == 0) else round(i * 360 / n, 1)}deg"><div class="upright"><a class="logo" data-partner="{p["slug"]}" {href} title="{attr(p["name"])}"><img src="{p["logo"]}" alt="{attr(p["name"])}"></a></div></div>')
    plist_html = "\n".join(
        f'          <li id="p-{p["slug"]}" data-partner="{p["slug"]}"><button type="button" class="partner-btn" data-open="{p["slug"]}"><span>{text(p["name"])}</span><span class="pl-more" aria-hidden="true">→</span></button></li>'
        for p in sorted(plist, key=lambda p: p["name"].lower()))
    pdata = {p["slug"]: {"name": p["name"], "logo": p["logo"], "url": p.get("url", ""), "domain": p.get("domain", ""), "desc": p["description"]} for p in plist}
    upcoming, _ = events()
    ecards = []
    for e in upcoming[:2]:
        dt = datetime.strptime(e["date"], "%Y-%m-%d")
        ecards.append(f'''      <a class="event" {event_link(e)}>
        <div class="event-date"><span class="day">{dt.day}</span><span class="eyebrow">{dt.strftime("%b")}</span></div>
        <div class="event-body">
          <span class="tag">{text(e.get("kind", ""))}</span>
          <h3>{text(e["title"])}</h3>
          <p>{inline(e.get("blurb", ""))}</p>{f'{chr(10)}          <span class="more">{text(e.get("link_label") or "Programme & registration")} ↗</span>' if e.get("link") else ""}
        </div>
      </a>''')
    cards = "\n".join(
        f'      <article class="card"><img class="card-bg" src="{c["image"]}" alt=""><span class="eyebrow">{i + 1:02d}</span><h3>{text(c["title"])}</h3><p>{inline(c["text"])}</p></article>'
        for i, c in enumerate(fm["cards"]))
    body = f'''
  <!-- HERO -->
  <section class="hero">
    <div class="hero-copy reveal-seq">
      {heading("h1", h["title"], h["accent"])}
      <p class="lede">{inline(h["lede"])}</p>
      <div class="actions">
        <a class="btn btn-coral" href="{h["cta_url"]}">{text(h["cta_label"])}</a>
      </div>
    </div>
    <div class="hero-art">
{read("templates/gears.svg").rstrip()}
      <div class="hero-roadto">
        <a class="roadto" href="{r["url"]}" target="_blank" rel="noopener" aria-label="{attr(r["aria"])}"><img src="{r["image"]}" alt="{attr(r["alt"])}"></a>
        <p class="roadto-note">{inline(r["note"])}</p>
      </div>
    </div>
  </section>

  <!-- NEIGHBOURS TICKER -->
  <div class="ticker" aria-label="Location highlights">
    <div class="ticker-track">
      <ul class="ticker-list">
        {ticker}
      </ul>
    </div>
  </div>

  <!-- STATS -->
  <section class="reveal stats container" aria-label="Key figures">
{stats}
  </section>

  <!-- ECOSYSTEM WHEEL -->
  <section class="ecosystem" id="ecosystem">
    <div class="container ecosystem-grid reveal">
      <div class="wheel-wrap">
        <div class="wheel" role="img" aria-label="The {n} partner organizations of the Geneva Solution Space, surrounded by the institutions of International Geneva">
          <div class="outer-ring" aria-hidden="true">
{outer}
          </div>
{read("templates/spokes.svg").rstrip()}
          <div class="inner-circle" aria-hidden="true"></div>
          <div class="ring">
{chr(10).join(nodes)}
          </div>
          <div class="hub">
            <img class="mark hub-mark" src="/assets/logos/gss-gear.png" alt="" width="44" height="44">
            <span>Geneva<br>Solution<br>Space</span>
          </div>
        </div>
        <div class="partner-panel" id="partner-panel" hidden role="dialog" aria-modal="false" aria-labelledby="pd-name">
          <button class="pd-close" type="button" data-close aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path></svg>
          </button>
          <div class="pd-logo"><img id="pd-logo" alt=""></div>
          <h3 id="pd-name"></h3>
          <p id="pd-desc"></p>
          <a id="pd-link" href="#" target="_blank" rel="noopener"></a>
        </div>
      </div>
      <div class="ecosystem-copy">
        <p class="eyebrow">{text(eco["eyebrow"])}</p>
        {heading("h2", eco["title"], eco["accent"])}
        <p class="lede">{inline(eco["lede"])}</p>
        <p class="lede">{inline(eco["lede2"])}</p>
        <ul class="partner-list">
{plist_html}
        </ul>
        <div class="actions">
          <a class="btn btn-ghost-light" href="{eco["cta_url"]}">{text(eco["cta_label"])}</a>
        </div>
      </div>
    </div>
  </section>

  <!-- EVENTS -->
  <section class="reveal events container" id="events">
    <div class="section-head">
      <div>
        <p class="eyebrow">{text(ev["eyebrow"])}</p>
        {heading("h2", ev["title"], ev["accent"])}
        <p class="lede">{inline(ev["lede"])}</p>
      </div>
      <a class="btn btn-ghost" href="/what-we-do/#events">{text(ev["all_label"])}</a>
    </div>
    <div class="event-grid">
{chr(10).join(ecards)}
    </div>
  </section>

  <!-- FORMATS -->
  <section class="reveal formats container">
    <div class="pillars-head">
      <p class="eyebrow">{text(fm["eyebrow"])}</p>
      {heading("h2", fm["title"], fm["accent"])}
      <p class="lede">{inline(fm["lede"])}</p>
      <p class="lede">{inline(fm["lede2"])}</p>
    </div>
    <div class="format-grid">
{cards}
    </div>
    <div class="format-foot"><a class="btn btn-coral" href="{fm["cta_url"]}">{text(fm["cta_label"])}</a></div>
  </section>

  <!-- LOCATION -->
  <section class="reveal location container" id="location">
    <div class="location-copy">
      <p class="eyebrow">{text(loc["eyebrow"])}</p>
      {heading("h2", loc["title"], loc["accent"])}
      <p>{inline(loc["text"])}</p>
      <a class="btn btn-ghost" href="{loc["cta_url"]}">{text(loc["cta_label"])}</a>
    </div>
    <div class="location-map">
      <figure class="aerial">
        <img src="{loc["map"]}" alt="{attr(loc["map_alt"])}">
        <figcaption>{inline(loc["caption"])}</figcaption>
      </figure>
    </div>
  </section>
'''
    block = '<!-- PARTNER DATA -->\n<script type="application/json" id="partner-data">' + json.dumps(pdata, ensure_ascii=False) + '</script>\n<!-- /PARTNER DATA -->\n'
    return shell("", d["meta_description"], body, active="", extra_script=block, full_title=d["meta_title"])


# ----------------------------------------------------------------------------
# Inner pages
# ----------------------------------------------------------------------------

def split_section(sec, cls="", sid="", buttons=None, tag="h2"):
    """Photo + copy block used on What We Host and Partners."""
    btns = buttons or [{"label": sec["cta_label"], "url": sec["cta_url"], "cls": "btn-solid"}]
    bhtml = "\n".join(f'      <a class="btn {b.get("cls", "btn-ghost")}" href="{b["url"]}">{text(b["label"])}</a>' for b in btns)
    idattr = f' id="{sid}"' if sid else ""
    return f'''  <section class="section container split{(' ' + cls) if cls else ''}"{idattr}>
    <figure class="photo"><img src="{sec["image"]}" alt="{attr(sec["alt"])}"></figure>
    <div class="split-copy">
      {heading(tag, sec["title"], sec["accent"])}
{paragraphs(sec["paragraphs"])}
      <ul class="price-list">
{price_list(sec["prices"])}
      </ul>
{bhtml}
    </div>
  </section>'''


def photo_row(photos):
    imgs = "\n".join(f'      <div class="tone"><img src="{p["image"]}" alt="{attr(p["alt"])}" loading="lazy"></div>' for p in photos)
    return f'''  <section class="container photo-row-wrap">
    <div class="photo-row">
{imgs}
    </div>
  </section>'''


def page_who_we_are():
    d = load("content/pages/who-we-are.json")
    s, hl = d["story"], d["highlights"]
    body = page_hero(d["hero"]) + f'''
  <section class="section container split">
    <figure class="photo">
      <img src="{s["image"]}" alt="{attr(s["alt"])}">
    </figure>
    <div class="split-copy">
      <p class="lede">{inline(s["lede"])}</p>
    </div>
  </section>

  <section class="section container">
    <div class="pillars-head">
      {heading("h2", hl["title"], hl["accent"])}
    </div>
    <dl class="def-grid">
{def_grid(hl["items"])}
    </dl>
    <p class="section-foot">{inline(hl["foot"])}</p>
    <p class="lede">{inline(hl["lede"])}</p>
  </section>
'''
    return shell("Who We Are", d["meta_description"], body, active="who-we-are")


def page_what_we_do():
    d = load("content/pages/what-we-do.json")
    ev, b, t = d["events"], d["band"], d["testimonials"]
    upcoming, past = events()
    up_html = "\n".join(f'''      <a class="event" {event_link(e)}>
        <div class="event-date"><span class="day">{datetime.strptime(e["date"], "%Y-%m-%d").day}</span><span class="eyebrow">{datetime.strptime(e["date"], "%Y-%m-%d").strftime("%B %Y")}</span></div>
        <div class="event-body">
          <h3>{text(e["title"])}</h3>
          <p>{inline(e.get("blurb", ""))}</p>
          <span class="more">{f'{text(e.get("link_label") or "Programme & registration")} ↗' if e.get("link") else "Details →"}</span>
        </div>
      </a>''' for e in upcoming)
    past_html = "\n".join(f'      <li><span>{text(e["title"])}</span><span>{pretty_date(e["date"])}</span></li>' for e in past)
    body = split_section(d["event_space"], sid="event-space", tag="h1") + "\n\n" + split_section(d["coworking"], cls="reverse", sid="coworking", buttons=d["coworking"]["buttons"]) + f'''

  <section class="band container">
    <div class="band-inner">
      {heading("h2", b["title"], b["accent"])}
      <p>{inline(b["text"])}</p>
      <a class="btn btn-paper" href="{b["cta_url"]}">{text(b["cta_label"])}</a>
    </div>
  </section>

  <section class="section container" id="events">
    <div class="section-head">
      <div>
        <p class="eyebrow">{text(ev["eyebrow"])}</p>
        {heading("h2", ev["title"], ev["accent"])}
      </div>
    </div>
    <p class="lede">{inline(ev["lede"])}</p>
    <h3 class="sub">Upcoming</h3>
    <div class="event-grid">
{up_html}
    </div>
    <h3 class="sub">Past events</h3>
    <ul class="past-list">
{past_html}
    </ul>
    <div class="cta cta-compact">
      <div class="cta-main">
        {heading("h2", ev["cta_title"], ev["cta_accent"])}
        <p>{inline(ev["cta_text"])}</p>
        <a class="btn btn-paper" href="{ev["cta_url"]}">{text(ev["cta_label"])}</a>
      </div>
    </div>
  </section>

  <section class="section container" id="testimonials">
    <div class="section-head">
      <div>
        <p class="eyebrow">{text(t["eyebrow"])}</p>
        {heading("h2", t["title"], t["accent"])}
      </div>
    </div>
    <div class="split form-split">
      <div class="split-copy">
        <p class="lede">{inline(t["lede"])}</p>
        <p>{inline(t["text"])}</p>
      </div>
      <form class="form" name="testimonial" method="POST" data-netlify="true" netlify-honeypot="website" action="/contact/?sent=testimonial">
        <input type="hidden" name="form-name" value="testimonial">
        <p class="hp"><label>Website <input name="website" tabindex="-1" autocomplete="off"></label></p>
        <div class="field-row">
          <label>Name<input type="text" name="name" required autocomplete="name"></label>
          <label>Role (e.g. "Student, University of Geneva")<input type="text" name="role"></label>
        </div>
        <div class="field-row">
          <label>Organization<input type="text" name="organization" autocomplete="organization"></label>
          <label>I'm sharing this as a…
            <select name="as">
              <option>Student</option><option>Partner organization</option><option>Event participant</option><option>Other</option>
            </select>
          </label>
        </div>
        <label>Your experience<textarea name="experience" rows="6" required></textarea></label>
        <button class="btn btn-solid" type="submit">Submit</button>
      </form>
    </div>
  </section>
'''
    return shell("What We Host", d["meta_description"], body, active="what-we-do")


def page_education():
    d = load("content/pages/education.json")
    m, ar, al = d["master"], d["around"], d["alumni"]
    cards = "\n".join(f'''      <article class="card static">
        <h3>{text(c["title"])}</h3>
        <p>{inline(c["text"])}</p>
      </article>''' for c in m["cards"])
    ext = ' target="_blank" rel="noopener"' if m["cta_url"].startswith("http") else ""
    body = page_hero(d["hero"]) + f'''
  <section class="section container">
    <div class="pillars-head">
      <p class="eyebrow">{text(m["eyebrow"])}</p>
      {heading("h2", m["title"], m["accent"])}
      <p class="lede">{inline(m["lede"])}</p>
    </div>
    <div class="two-cards">
{cards}
    </div>
    <div class="actions">
      <a class="btn btn-solid" href="{m["cta_url"]}"{ext}>{text(m["cta_label"])}</a>
    </div>
  </section>

{photo_row(d["photos"])}

  <section class="section container">
    <div class="pillars-head">
      {heading("h2", ar["title"], ar["accent"])}
    </div>
    <dl class="def-grid">
{def_grid(ar["items"])}
    </dl>
  </section>

{photo_row(d["photos2"])}

  <section class="band container">
    <div class="band-inner">
      {heading("h2", al["title"], al["accent"])}
{paragraphs(al["paragraphs"]).replace("<a href", '<a class="link-under" href')}
    </div>
  </section>
'''
    return shell("Education", d["meta_description"], body, active="education")


def page_partners():
    d = load("content/pages/partners.json")
    be, ro, b = d["benefits"], d["rooms"], d["band"]
    btns = "\n".join(f'        <a class="btn {"btn-paper" if i == 0 else "btn-ghost-light"}" href="{x["url"]}">{text(x["label"])}</a>' for i, x in enumerate(b["buttons"]))
    body = page_hero(d["hero"]) + "\n" + split_section(d["desk"], buttons=[{"label": d["desk"]["cta_label"], "url": d["desk"]["cta_url"]}]) + f'''

  <section class="section container">
    <div class="pillars-head">
      {heading("h2", be["title"], be["accent"])}
    </div>
    <dl class="def-grid">
{def_grid(be["items"])}
    </dl>
  </section>

  <section class="section container" id="meeting-rooms">
    <div class="pillars-head">
      {heading("h2", ro["title"], ro["accent"])}
    </div>
    <dl class="def-grid">
{def_grid(ro["items"])}
    </dl>
  </section>

  <section class="band container">
    <div class="band-inner">
      {heading("h2", b["title"], b["accent"])}
      <p>{inline(b["text"])}</p>
      <div class="actions">
{btns}
      </div>
    </div>
  </section>

''' + partners_section(d["list"])
    return shell("Partners", d["meta_description"], body)


def page_contact():
    d = load("content/pages/contact.json")
    f, v = d["form"], d["visiting"]
    body = page_hero(d["hero"]) + f'''
  <section class="section container split form-split">
    <form class="form" name="contact" method="POST" data-netlify="true" netlify-honeypot="website" action="/contact/?sent=contact">
      <input type="hidden" name="form-name" value="contact">
      <p class="hp"><label>Website <input name="website" tabindex="-1" autocomplete="off"></label></p>
      <p class="eyebrow">{text(f["eyebrow"])}</p>
      <label>Name<input type="text" name="name" required autocomplete="name"></label>
      <label>Email<input type="email" name="email" required autocomplete="email"></label>
      <label>Message<textarea name="message" rows="7" required></textarea></label>
      <button class="btn btn-solid" type="submit">{text(f["button_label"])}</button>
      <p class="form-intro">{text(f["email_note"])} <a href="mailto:{SITE["email"]}">{SITE["email"]}</a></p>
      <p class="form-note" id="form-note" hidden>Thank you. Your message is on its way.</p>
    </form>
    <div class="split-copy" id="find-us">
      {heading("h2", v["title"], v["accent"])}
      <address class="plain">{"<br>".join(text(l) for l in v["address"].split(chr(10)))}</address>
      <p>{inline(v["text"])}</p>
    </div>
  </section>
'''
    script = '''<script>
(function () {
  var sent = new URLSearchParams(location.search).get('sent');
  var note = document.getElementById('form-note');
  if (sent && note) { note.hidden = false; note.textContent = sent === 'testimonial' ? 'Thank you. Your experience has been received and will be reviewed before publication.' : 'Thank you. Your message is on its way.'; note.scrollIntoView({ block: 'center' }); }
})();
</script>
'''
    return shell("Contact Us", d["meta_description"], body, active="contact", extra_script=script)


def page_reservations():
    d = load("content/pages/reservations.json")
    sp, f, faq, rules = d["spaces"], d["form"], d["faq"], d["booking"]
    toggles = "\n".join(f'        <button class="space-btn{" is-active" if i == 0 else ""}" role="tab" aria-selected="{"true" if i == 0 else "false"}" data-space="{s["key"]}">{text(s["label"])}</button>' for i, s in enumerate(sp))
    chips = lambda s: f'<span>Up to {s["capacity"]} people</span><span>CHF {s["rate_hour"]:,}/hour</span><span>CHF {s["rate_day"]:,}/day</span>'.replace(",", "’")
    descs = "\n".join(f'      <div class="space-desc" data-for="{s["key"]}"{"" if i == 0 else " hidden"}><p>{inline(s["description"])}</p><p class="space-facts">{chips(s)}</p></div>' for i, s in enumerate(sp))
    photo_attrs = " ".join(f'data-{s["key"]}="{s["image"]}" data-{s["key"]}-alt="{attr(s["alt"])}"' for s in sp)
    capacity = sp[0]["capacity"]
    body = page_hero(d["hero"]) + f'''
  <section class="container space-intro">
    <div class="space-copy">
      <div class="space-toggle" role="tablist" aria-label="Space">
{toggles}
      </div>
{descs}
      <a class="faq-hint" href="#faq">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"></circle><path d="M9.6 9.6a2.4 2.4 0 1 1 3.6 2.1c-.8.5-1.2 1-1.2 1.9M12 17h.01" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg>
        {text(d["faq_hint"])}
      </a>
    </div>
    <div class="space-photo tone">
      <img id="space-photo" src="{sp[0]["image"]}" {photo_attrs} alt="{attr(sp[0]["alt"])}">
    </div>
  </section>

  <section class="section container bk" id="bk" aria-labelledby="bk-title">
    <div class="bk-top">
      <div>
        <p class="eyebrow">{text(f["eyebrow"])}</p>
        <h2 id="bk-title" class="bk-title">{text(f["intro"])}</h2>
      </div>
      <ol class="bk-steps" aria-label="Booking steps">
        <li class="is-current" aria-current="step"><button type="button" disabled><b>1</b>Time</button></li>
        <li><button type="button" disabled><b>2</b>Your details</button></li>
        <li><button type="button" disabled><b>3</b>Review</button></li>
      </ol>
    </div>
    <noscript><p class="form-note is-error">The booking calendar needs JavaScript. You can also email <a href="mailto:{SITE["email"]}">{SITE["email"]}</a>.</p></noscript>

    <div class="bk-layout">
      <div class="bk-main">
        <div class="bk-notice" id="bk-notice" role="alert" hidden></div>

        <div class="bk-panel bk-pick" data-step="1">
          <div class="calendar bk-cal">
            <div class="cal-head">
              <h3 id="bk-month" aria-live="polite"></h3>
              <div class="cal-nav">
                <button type="button" id="bk-prev" aria-label="Previous month">←</button>
                <button type="button" id="bk-next" aria-label="Next month">→</button>
              </div>
            </div>
            <div class="cal-grid" id="bk-grid"></div>
            <p class="bk-cal-error" id="bk-cal-error" hidden>We couldn't load availability. Check your connection and try again.</p>
            <ul class="cal-legend">
              <li><span class="sw sw-free"></span>Available</li>
              <li><span class="sw sw-partial"></span>Some hours free</li>
              <li><span class="sw sw-full"></span>Unavailable</li>
            </ul>
          </div>
          <div class="bk-day" id="bk-day"></div>
        </div>

        <form class="bk-panel form bk-form" data-step="2" id="bk-form" novalidate hidden>
          <h3>Your details</h3>
          <p class="hp"><label>Website <input name="website" tabindex="-1" autocomplete="off"></label></p>
          <div class="field-row">
            <label>Your name<input type="text" name="name" required maxlength="120" autocomplete="name"></label>
            <label>Email<input type="email" name="email" required maxlength="200" autocomplete="email"></label>
          </div>
          <div class="field-row">
            <label>Phone <span class="hint">Optional</span><input type="tel" name="phone" maxlength="40" autocomplete="tel"></label>
            <label>Organization <span class="hint">Optional</span><input type="text" name="organization" maxlength="160" autocomplete="organization"></label>
          </div>
          <div class="field-row">
            <label>Event name<input type="text" name="event" required maxlength="160"></label>
            <label>Number of participants<input type="number" name="participants" min="1" max="{capacity}" inputmode="numeric" required></label>
          </div>
          <label>What are you planning? <span class="hint">Objectives, relation to the SDGs, set-up, Fab Lab or catering needs</span><textarea name="plan" rows="5" minlength="10" maxlength="4000" required></textarea></label>
          <label class="check"><input type="checkbox" name="first_time"> This is our first booking at the {text(SITE["name"])} <span class="hint">({rules["first_time_discount_percent"]}% off, for one day at most)</span></label>
          <button class="btn btn-solid" type="submit">Review request</button>
        </form>

        <form class="bk-panel bk-review-panel" data-step="3" id="bk-confirm" novalidate hidden>
          <h3>Check your request</h3>
          <dl class="bk-dl" id="bk-review"></dl>
          <label class="check"><input type="checkbox" id="bk-rules"> I have read and accept the <a href="/code-of-conduct/">house rules and Code of Conduct</a> for using the space.</label>
          <p class="bk-err" id="bk-rules-err" hidden>Please accept the house rules to continue.</p>
          <p class="form-note is-error" id="bk-send-error" role="alert" hidden></p>
          <div class="actions">
            <button class="btn btn-solid bk-send" type="submit" id="bk-send"><span>{text(f["button_label"])}</span></button>
            <p class="bk-fineprint">Nothing to pay now. We confirm the booking and send an invoice afterwards.</p>
          </div>
        </form>

        <div class="bk-panel bk-done" data-step="4" hidden>
          <div class="bk-done-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
          <p class="eyebrow">Request sent · <span id="bk-ref"></span></p>
          <h3>Thank you. Your request is on its way to our team.</h3>
          <p id="bk-done-when" class="bk-done-when"></p>
          <p>{text(rules.get("confirmation_note", ""))} A confirmation has been sent to <strong id="bk-done-email"></strong>, with a link to withdraw the request if your plans change.</p>
          <div class="actions">
            <a class="btn btn-solid" id="bk-ics" href="#">Add to my calendar</a>
            <button type="button" class="btn btn-ghost" id="bk-again">Make another booking</button>
          </div>
        </div>
      </div>

      <aside class="bk-summary" id="bk-summary" aria-label="Your booking">
        <p class="eyebrow">Your booking</p>
        <p class="bk-sum-space" id="bk-sum-space"></p>
        <p class="bk-sum-when" id="bk-sum-when"></p>
        <ul class="bk-sum-lines" id="bk-sum-lines"></ul>
        <p class="bk-sum-total"><span>Estimated total</span><strong id="bk-sum-total" aria-live="polite">—</strong></p>
        <p class="bk-fineprint">Pending until our team confirms it. Final price confirmed by email, invoiced after the event is approved.</p>
        <div class="bk-sum-actions">
          <button type="button" class="btn btn-ghost" id="bk-back" hidden>Back</button>
          <button type="button" class="btn btn-solid" id="bk-next-step" disabled>Continue</button>
        </div>
      </aside>
    </div>
  </section>

  <section class="section container faq" id="faq">
    <div class="pillars-head">
      {heading("h2", faq["title"], faq["accent"])}
    </div>
    <dl class="def-grid">
{def_grid(faq["items"])}
    </dl>
  </section>
'''
    keys = ("key", "label", "capacity", "open", "close", "open_days", "min_hours", "rate_hour", "rate_day")
    cfg = {
        "spaces": [{k: s[k] for k in keys} for s in sp],
        "booking": {k: rules[k] for k in ("min_notice_hours", "max_advance_days", "first_time_discount_percent")},
        "email": SITE["email"],
        "location": ", ".join(SITE["address"]),
    }
    cfg_json = json.dumps(cfg, ensure_ascii=False).replace("</", "<\\/")
    script = f'''<script>window.GSS_BOOKING = {cfg_json};</script>
<script src="/assets/js/booking.js?v={ASSET_VERSION}"></script>
'''
    return shell("Reservations", d["meta_description"], body, active="reservations", extra_script=script)


def page_admin_bookings():
    """Staff dashboard for booking requests. Login is Netlify Identity, like the site editor."""
    sp = load("content/pages/reservations.json")["spaces"]
    opts = "".join(f'<option value="{s["key"]}">{text(s["label"])}</option>' for s in sp)
    spaces_json = json.dumps([{"key": s["key"], "label": s["label"]} for s in sp], ensure_ascii=False).replace("</", "<\\/")
    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Bookings | {text(SITE["name"])}</title>
  <link rel="icon" href="/assets/logos/gss-gear.png">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Instrument+Serif:ital@0;1&display=swap">
  <link rel="stylesheet" href="/styles.css?v={ASSET_VERSION}">
  <script src="https://identity.netlify.com/v1/netlify-identity-widget.js"></script>
</head>
<body class="adm-body">
<header class="adm-bar">
  <a class="adm-brand" href="/"><img src="/assets/logos/gss-gear.png" alt="" width="28" height="28">{text(SITE["name"])}<span>Bookings</span></a>
  <nav class="adm-bar-links"><a href="/admin/">Site editor</a><a href="/reservations/" target="_blank" rel="noopener">Booking page ↗</a></nav>
</header>

<section class="adm-login" id="adm-login" hidden>
  <p class="eyebrow">Staff only</p>
  <h1>Manage <em>bookings</em></h1>
  <p>Log in with the same account you use for the site editor.</p>
  <p class="adm-error" id="adm-login-msg"></p>
  <button class="btn btn-solid" id="adm-login-btn">Log in</button>
</section>

<main class="adm" id="adm" hidden>
  <div class="adm-head">
    <div class="adm-tabs" role="tablist">
      <button class="adm-tab is-active" role="tab" data-view="requests" aria-selected="true">Requests <span class="adm-badge" id="adm-pending-count" hidden></span></button>
      <button class="adm-tab" role="tab" data-view="calendar" aria-selected="false">Calendar</button>
      <button class="adm-tab" role="tab" data-view="list" aria-selected="false">All bookings</button>
    </div>
    <div class="adm-head-right">
      <button class="btn btn-ghost btn-sm" id="adm-refresh">Refresh</button>
      <button class="btn btn-solid btn-sm" id="adm-block-open">Block time</button>
      <span class="adm-user"><span id="adm-user"></span> · <button class="bk-link" id="adm-logout">Log out</button></span>
    </div>
  </div>

  <section class="adm-view" data-view="requests">
    <div class="adm-view-head"><h1>Waiting for a <em>decision</em></h1><p class="adm-muted">Oldest first. Pending requests hold their time on the booking page until you decide.</p></div>
    <div class="adm-cards" id="adm-requests"></div>
  </section>

  <section class="adm-view" data-view="calendar" hidden>
    <div class="adm-view-head adm-week-head">
      <div class="adm-week-nav">
        <button class="adm-round" id="adm-week-prev" aria-label="Previous week">←</button>
        <button class="adm-round" id="adm-week-next" aria-label="Next week">→</button>
        <button class="btn btn-ghost btn-sm" id="adm-week-today">This week</button>
        <h2 id="adm-week-title"></h2>
      </div>
      <div class="adm-week-tools">
        <select id="adm-week-space" aria-label="Space"><option value="all">All spaces</option>{opts}</select>
        <ul class="adm-legend"><li><i class="is-approved"></i>Approved</li><li><i class="is-pending"></i>Pending</li><li><i class="is-blocked"></i>Blocked</li></ul>
      </div>
    </div>
    <p class="adm-muted adm-tip">Click a booking to open it, or click an empty hour to block that time.</p>
    <div class="adm-week" id="adm-week"></div>
  </section>

  <section class="adm-view" data-view="list" hidden>
    <form class="adm-filter" id="adm-filter">
      <label>Search<input type="search" name="q" placeholder="Name, email, reference, event…"></label>
      <label>From<input type="date" name="from"></label>
      <label>To<input type="date" name="to"></label>
      <label>Status<select name="status"><option value="">Any</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="declined">Declined</option><option value="cancelled">Cancelled</option><option value="blocked">Blocked</option></select></label>
      <label>Space<select name="space"><option value="">All</option>{opts}</select></label>
      <button class="btn btn-ghost btn-sm" type="submit">Search</button>
    </form>
    <div class="adm-list-bar"><span class="adm-muted" id="adm-list-count"></span><button class="btn btn-ghost btn-sm" id="adm-csv" type="button">Export CSV</button></div>
    <div id="adm-list"></div>
  </section>
</main>

<dialog class="adm-dialog" id="adm-dialog">
  <button class="adm-close" id="adm-dialog-close" aria-label="Close">×</button>
  <div id="adm-dialog-body"></div>
</dialog>

<dialog class="adm-dialog adm-dialog-sm" id="adm-block">
  <form id="adm-block-form" class="adm-block-form">
    <h2>Block time</h2>
    <p class="adm-muted">Blocked time shows as unavailable on the booking page, e.g. for maintenance or internal events.</p>
    <label>Space<select name="space">{opts}<option value="all">All spaces</option></select></label>
    <div class="adm-two"><label>From<input type="date" name="start_date" required></label><label>Time<input type="time" name="start_time" step="3600" required></label></div>
    <div class="adm-two"><label>Until<input type="date" name="end_date" required></label><label>Time<input type="time" name="end_time" step="3600" required></label></div>
    <label>Label<input type="text" name="note" maxlength="200" placeholder="e.g. Maintenance, Partner workshop"></label>
    <p class="adm-error" id="adm-block-err" hidden></p>
    <div class="adm-actions"><button class="btn btn-solid btn-sm" type="submit">Block</button><button class="btn btn-ghost btn-sm" type="button" id="adm-block-cancel">Cancel</button></div>
  </form>
</dialog>

<div class="adm-toast" id="adm-toast" role="status"></div>
<script>window.GSS_SPACES = {spaces_json};</script>
<script src="/assets/js/bookings-admin.js?v={ASSET_VERSION}"></script>
</body>
</html>
'''


def page_welcome():
    body = '''  <section class="page-hero container welcome">
    <p class="eyebrow">Site editor</p>
    <h1 id="w-title">Create your <em>password.</em></h1>
    <p class="lede" id="w-lede">You've been invited to edit the Geneva Solution Space website. Choose a password below — this is a new password that you are creating now, for the site editor only. You'll use it together with your email address to log in from now on.</p>
  </section>
  <section class="container welcome-form-wrap">
    <form class="form welcome-form" id="w-form" novalidate>
      <label>Your new password<input type="password" id="w-pass" autocomplete="new-password" minlength="8" required placeholder="At least 8 characters"></label>
      <label>Type it again<input type="password" id="w-pass2" autocomplete="new-password" minlength="8" required></label>
      <label class="check"><input type="checkbox" id="w-show"> Show password</label>
      <button class="btn btn-solid" type="submit" id="w-btn">Create password and open the editor</button>
      <p class="form-note" id="w-note" hidden></p>
    </form>
    <div class="welcome-aside">
      <p class="eyebrow">Good to know</p>
      <ul>
        <li>There is no password to look up — you are making one up right now.</li>
        <li>Write it down somewhere safe, or let your browser save it.</li>
        <li>Forgot it later? Use "Forgot password?" on the editor's login screen.</li>
      </ul>
    </div>
  </section>
'''
    script = '''<script src="https://unpkg.com/gotrue-js@1.0.1/browser/gotrue.js"></script>
<script>
(function () {
  var params = new URLSearchParams(location.hash.replace(/^#/, ''));
  var invite = params.get('invite_token'), recovery = params.get('recovery_token'), confirmation = params.get('confirmation_token');
  var form = document.getElementById('w-form'), note = document.getElementById('w-note'), btn = document.getElementById('w-btn');
  var pass = document.getElementById('w-pass'), pass2 = document.getElementById('w-pass2');
  var Ctor = (window.GoTrue && window.GoTrue.default) || window.GoTrue;
  var auth = new Ctor({ APIUrl: location.origin + '/.netlify/identity', setCookie: true });
  function say(msg, bad) { note.hidden = false; note.textContent = msg; note.classList.toggle('is-error', !!bad); }
  function done() { say('All set — opening the editor…'); setTimeout(function () { location.href = '/admin/'; }, 900); }
  document.getElementById('w-show').addEventListener('change', function (e) { pass.type = pass2.type = e.target.checked ? 'text' : 'password'; });
  if (recovery) {
    document.getElementById('w-title').innerHTML = 'Choose a new <em>password.</em>';
    document.getElementById('w-lede').textContent = 'You asked to reset your password for the site editor. Choose a new one below.';
    btn.textContent = 'Save new password and open the editor';
  } else if (confirmation) {
    auth.confirm(confirmation, true).then(done).catch(function (e) { say('This link has already been used or has expired. Ask for a new invitation.', true); });
    return;
  } else if (!invite) {
    form.hidden = true;
    document.getElementById('w-title').innerHTML = 'This page needs an <em>invitation link.</em>';
    document.getElementById('w-lede').innerHTML = 'Open the link from your invitation email, or <a href="/admin/">go to the editor login</a> if you already have a password.';
    return;
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (pass.value.length < 8) return say('Please choose a password of at least 8 characters.', true);
    if (pass.value !== pass2.value) return say('The two passwords do not match — please type them again.', true);
    btn.disabled = true; say('Saving…');
    var p = invite ? auth.acceptInvite(invite, pass.value, true)
                   : auth.recover(recovery, true).then(function (user) { return user.update({ password: pass.value }); });
    p.then(done).catch(function (err) {
      btn.disabled = false;
      say('That did not work: ' + ((err && err.json && err.json.msg) || (err && err.message) || 'unknown error') + '. If the link is old, ask for a new invitation.', true);
    });
  });
})();
</script>
''' 
    return shell("Create your password", "Set up your password for the Geneva Solution Space site editor.", body, extra_head='<meta name="robots" content="noindex">\n', extra_script=script)


def page_find_us():
    d = load("content/pages/find-us.json")
    a, w, g = d["aerial"], d["where"], d["getting"]
    items = "\n".join(f'        <dt>{text(it["term"])}</dt><dd>{inline(it["text"])}</dd>' for it in g["items"])
    body = page_hero(d["hero"]) + f'''
  <section class="container">
    <figure class="aerial">
      <img src="{a["image"]}" alt="{attr(a["alt"])}">
      <figcaption>{inline(a["caption"])}</figcaption>
    </figure>
  </section>

  <section class="section container split" id="map">
    <div class="split-copy">
      {heading("h2", w["title"], w["accent"])}
      <address class="plain">{"<br>".join(text(l) for l in w["address"].split(chr(10)))}</address>
      <p>{inline(w["text"])}</p>
    </div>
    <div class="split-copy">
      {heading("h2", g["title"], g["accent"])}
      <dl class="def-list">
{items}
      </dl>
      <p>{inline(g["foot"])}</p>
    </div>
  </section>
'''
    return shell("Find Us", d["meta_description"], body)


def prose_page(rel, title):
    d = load(rel)
    body = page_hero(d["hero"]) + f'''
  <section class="section container prose-wrap">
    <article class="prose">
{md(d["body"])}
    </article>
  </section>
'''
    return shell(title, d["meta_description"], body)


def event_link(e):
    """href + attributes for an event card: the event's external page if it has one, else its page here."""
    if e.get("link"):
        return f'href="{attr(e["link"])}" target="_blank" rel="noopener"'
    return f'href="/events/{e["slug"]}/"'


def page_event(e):
    body = f'''  <section class="page-hero container event-hero">
    <a class="back" href="/what-we-do/#events">← All events</a>
    <div class="tags"><span class="tag tag-{e.get("colour", "teal")}">{text(e.get("kind", "Event"))}</span><span class="tag tag-quiet">Upcoming</span></div>
    <h1>{text(e["title"])}</h1>
    <p class="event-meta">{pretty_date(e["date"])} · Geneva Solution Space, Campus Biotech, Geneva</p>
    <p class="lede">{inline(e.get("blurb", ""))}</p>{f'{chr(10)}    <div class="actions"><a class="btn btn-solid" href="{attr(e["link"])}" target="_blank" rel="noopener">{text(e.get("link_label") or "Programme & registration")} ↗</a></div>' if e.get("link") else ""}
  </section>
{("  <section class='section container prose-wrap'><article class='prose'>" + chr(10) + post_md(e["body"]) + chr(10) + "  </article></section>") if e.get("body") else ""}
  <section class="band container">
    <div class="band-inner">
      <h2>Want to run <em>something like this?</em></h2>
      <p>The space hosts meetings, workshops, innovation labs, and hackathons — <a class="link-under" href="/reservations/">check availability</a> or <a class="link-under" href="/contact/">let us know what you have in mind</a>.</p>
    </div>
  </section>
'''
    return shell(e["title"], e.get("blurb", "")[:150], body)


# ----------------------------------------------------------------------------
# Blog
# ----------------------------------------------------------------------------

def build_blog():
    ordered = posts()
    cards = []
    for e in ordered:
        thumb = f'<div class="post-thumb"><img src="{e["thumb"]}" alt="" loading="lazy"></div>' if e.get("thumb") else '<div class="post-thumb post-thumb-empty" aria-hidden="true"></div>'
        cards.append(f'''      <a class="post-card" href="/blog/{e["slug"]}/">
        {thumb}
        <div class="post-body">
          <span class="eyebrow">{pretty_date(e.get("date", ""))}</span>
          <h2>{text(e["title"])}</h2>
          <p>{text(e.get("excerpt", ""))}</p>
        </div>
      </a>''')
    body = page_hero({"eyebrow": "Blog", "title": "News & writing", "accent": "from the space."}) + f'''
  <section class="section container">
    <div class="post-list">
{chr(10).join(cards)}
    </div>
  </section>
'''
    write("blog/index.html", shell("Blog", "News and writing from the Geneva Solution Space.", body, active="blog"))

    for e in ordered:
        hero_img = f'\n    <figure class="post-hero"><img src="{e["thumb"]}" alt=""></figure>' if e.get("thumb") else ""
        pbody = f'''  <article class="post container">
    <a class="back" href="/blog/">← All posts</a>
    <p class="eyebrow">{pretty_date(e.get("date", ""))}</p>
    <h1>{text(e["title"])}</h1>{hero_img}
    <div class="prose">
{post_md(e["body"])}
    </div>
  </article>
'''
        write(f"blog/{e['slug']}/index.html", shell(e["title"], (e.get("excerpt") or "")[:150], pbody, active="blog"))


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------

def clean_generated():
    """Remove pages of deleted or draft posts/events so nothing stale is served."""
    for folder, rel in (("blog", "content/posts"), ("events", "content/events")):
        keep = {slug for slug, d in load_dir(rel) if not d.get("draft")}
        for path in glob.glob(os.path.join(ROOT, folder, "*", "index.html")):
            slug = os.path.basename(os.path.dirname(path))
            if slug not in keep:
                os.remove(path); os.rmdir(os.path.dirname(path)); print("removed", folder + "/" + slug)


if __name__ == "__main__":
    write("index.html", page_home())
    write("who-we-are/index.html", page_who_we_are())
    write("what-we-do/index.html", page_what_we_do())
    write("education/index.html", page_education())
    write("contact/index.html", page_contact())
    write("reservations/index.html", page_reservations())
    write("find-us/index.html", page_find_us())
    write("partners/index.html", page_partners())
    write("welcome/index.html", page_welcome())
    write("admin/bookings/index.html", page_admin_bookings())
    write("code-of-conduct/index.html", prose_page("content/pages/code-of-conduct.json", "Code of Conduct"))
    write("privacy-policy/index.html", prose_page("content/pages/privacy-policy.json", "Privacy Policy"))
    upcoming, _ = events()
    for e in upcoming:
        write(f"events/{e['slug']}/index.html", page_event(e))
    build_blog()
    clean_generated()
    write("404.html", shell("Page not found", "This page doesn't exist.", page_hero({"eyebrow": "404", "title": "This page", "accent": "doesn't exist.", "lede": "It may have moved, or the link may be out of date."}, '<a class="btn btn-solid" href="/">Go to the homepage</a><a class="btn btn-ghost" href="/reservations/">Book the space</a>')))
    write("robots.txt", f"User-agent: *\nDisallow: /admin/\nDisallow: /welcome/\nDisallow: /api/\n\nSitemap: {SITE_URL}/sitemap.xml\n")
    urls = "".join(f"  <url><loc>{SITE_URL}{p}</loc></url>\n" for p in sorted(set(PUBLIC_PAGES)))
    write("sitemap.xml", f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{urls}</urlset>\n')
