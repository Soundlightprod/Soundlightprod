#!/usr/bin/env python3
"""Rapport visuel SLP : JSON -> image PNG (format téléphone).

Usage : python3 rapport_visuel.py donnees.json sortie.png   (image téléphone)
        python3 rapport_visuel.py donnees.json page.html     (page Artifact zoomable)

Clés du JSON (toutes facultatives sauf titre) :
  titre, sous_titre
  meteo_globale: "soleil" | "eclaircies" | "averses" | "orage"
  resume: [3 phrases courtes]
  sites: [{nom, meteo, valeur, label, compare, jours: [7 nombres], jours_labels: [7 txt]}]
  heures: {aujourdhui: [24 nb ou null], hier: [24 nb]}          # visiteurs par heure
  prospects: [{ville, appareil: "mobile"|"ordi", source: "mail"|"google"|"facebook"|"direct"|"autre",
               pages: n, video: "fin"|"debut"|null, quand, texte}]
  brevo: [{nom, statut, envoyes, delivres, ouvertures, clics, visites}]
  google: {clics, impressions, position, evol_impressions, index: [{site, ok, total, avant}]}
  youtube: {gain, total, top: [{titre, gain}]}
  alertes: [txt]
  actions: [txt]
"""
import json, sys, html, asyncio

C = {
    "bg": "#eef1f5", "card": "#ffffff", "ink": "#1d2433", "muted": "#6b7280", "line": "#e7e2d8",
    "sun": "#f5a524", "cloud": "#9aa7b8", "rain": "#3b82f6", "storm": "#7c3aed",
    "good": "#16a34a", "bad": "#dc2626", "accent": "#e4572e", "blue": "#2563eb", "teal": "#0d9488",
}

def esc(s):
    return html.escape(str(s if s is not None else ""))

# ---------- icônes SVG dessinées ----------
def ico_meteo(kind, size=56):
    s = size
    sun = f'<circle cx="32" cy="30" r="13" fill="{C["sun"]}"/>' + "".join(
        f'<rect x="30.5" y="5" width="3" height="9" rx="1.5" fill="{C["sun"]}" transform="rotate({a} 32 30)"/>' for a in range(0, 360, 45))
    cloud = lambda dx=0, dy=0, col=C["cloud"]: (
        f'<g transform="translate({dx} {dy})"><circle cx="26" cy="38" r="10" fill="{col}"/><circle cx="38" cy="34" r="13" fill="{col}"/>'
        f'<circle cx="48" cy="41" r="8" fill="{col}"/><rect x="18" y="38" width="38" height="11" rx="5.5" fill="{col}"/></g>')
    drops = "".join(f'<path d="M{x} 54 l-3 7" stroke="{C["rain"]}" stroke-width="3" stroke-linecap="round"/>' for x in (26, 36, 46))
    bolt = f'<path d="M37 49 l-7 9 h6 l-4 8 l10-11 h-6 l4-6z" fill="{C["sun"]}"/>'
    body = {"soleil": sun,
            "eclaircies": f'<g transform="translate(-8 -8) scale(.85)">{sun}</g>' + cloud(2, 2, "#c3ccd8"),
            "averses": cloud(0, -4) + drops,
            "orage": cloud(0, -4, "#7b8494") + bolt}.get(kind, sun)
    return f'<svg width="{s}" height="{s}" viewBox="0 0 64 64">{body}</svg>'

def ico(name, size=22, col=None):
    col = col or C["ink"]
    p = {
        "mobile": f'<rect x="7" y="2" width="10" height="20" rx="2" fill="none" stroke="{col}" stroke-width="2"/><circle cx="12" cy="18.5" r="1.2" fill="{col}"/>',
        "ordi": f'<rect x="3" y="4" width="18" height="12" rx="1.5" fill="none" stroke="{col}" stroke-width="2"/><path d="M8 20h8M12 16v4" stroke="{col}" stroke-width="2"/>',
        "mail": f'<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="{col}" stroke-width="2"/><path d="M3.5 6l8.5 7 8.5-7" fill="none" stroke="{col}" stroke-width="2"/>',
        "google": f'<circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="{col}" stroke-width="2.2"/><path d="M15.5 15.5l5 5" stroke="{col}" stroke-width="2.4" stroke-linecap="round"/>',
        "facebook": f'<circle cx="12" cy="12" r="9.5" fill="{col}"/><path d="M13.2 19v-6h2l.3-2.4h-2.3V9.2c0-.7.2-1.1 1.2-1.1h1.2V6a15 15 0 0 0-1.8-.1c-1.8 0-3 1.1-3 3.1v1.6H8.8V13h2V19z" fill="#fff"/>',
        "direct": f'<path d="M5 12h12M13 7l5 5-5 5" fill="none" stroke="{col}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
        "autre": f'<circle cx="12" cy="12" r="8" fill="none" stroke="{col}" stroke-width="2"/><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16" fill="none" stroke="{col}" stroke-width="1.5"/>',
        "play": f'<circle cx="12" cy="12" r="10" fill="{col}"/><path d="M10 8l6 4-6 4z" fill="#fff"/>',
        "page": f'<path d="M6 3h9l4 4v14H6z" fill="none" stroke="{col}" stroke-width="2" stroke-linejoin="round"/><path d="M9 11h7M9 15h7" stroke="{col}" stroke-width="1.6"/>',
        "alerte": f'<path d="M12 3l10 18H2z" fill="{col}"/><path d="M12 9v6" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="18" r="1.3" fill="#fff"/>',
        "action": f'<circle cx="12" cy="12" r="10" fill="{col}"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
        "yt": f'<rect x="2" y="5" width="20" height="14" rx="4" fill="{col}"/><path d="M10 9l5 3-5 3z" fill="#fff"/>',
        "star": f'<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" fill="{col}"/>',
    }.get(name, "")
    return f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" style="vertical-align:middle">{p}</svg>'

# ---------- petits graphiques ----------
def spark_bars(vals, labels=None, w=180, h=46, col=None):
    vals = [v or 0 for v in vals]
    m = max(vals + [1]); n = len(vals); bw = w / max(n, 1)
    out = []
    for i, v in enumerate(vals):
        bh = max(2, (h - 14) * v / m)
        last = i == n - 1
        out.append(f'<rect x="{i*bw+2:.1f}" y="{h-12-bh:.1f}" width="{bw-4:.1f}" height="{bh:.1f}" rx="2" fill="{col if last else "#cfd6e0"}"/>')
        if labels:
            out.append(f'<text x="{i*bw+bw/2:.1f}" y="{h-1}" font-size="9" text-anchor="middle" fill="{C["muted"]}">{esc(labels[i])}</text>')
    return f'<svg viewBox="0 0 {w} {h}" width="100%" style="max-width:{w}px">{"".join(out)}</svg>'

def chart_heures(auj, hier, w=660, h=170):
    auj = auj or [None] * 24; hier = hier or [0] * 24
    m = max([v or 0 for v in auj] + [v or 0 for v in hier] + [1])
    pl, pb, pt = 22, 20, 10; cw = (w - pl - 6) / 24; ch = h - pb - pt
    out = []
    for k in range(0, int(m) + 1, max(1, int(m) // 3 or 1)):
        y = pt + ch - ch * k / m
        out.append(f'<line x1="{pl}" x2="{w-4}" y1="{y:.1f}" y2="{y:.1f}" stroke="{C["line"]}"/><text x="{pl-6}" y="{y+3:.1f}" font-size="10" text-anchor="end" fill="{C["muted"]}">{k}</text>')
    for i in range(24):
        v = auj[i]
        if v:
            bh = ch * v / m
            out.append(f'<rect x="{pl+i*cw+2:.1f}" y="{pt+ch-bh:.1f}" width="{cw-4:.1f}" height="{bh:.1f}" rx="3" fill="{C["accent"]}"/>')
        if i % 3 == 0:
            out.append(f'<text x="{pl+i*cw+cw/2:.1f}" y="{h-5}" font-size="10" text-anchor="middle" fill="{C["muted"]}">{i}h</text>')
    pts = " ".join(f'{pl+i*cw+cw/2:.1f},{pt+ch-ch*(hier[i] or 0)/m:.1f}' for i in range(24))
    out.append(f'<polyline points="{pts}" fill="none" stroke="{C["blue"]}" stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round"/>')
    return f'<svg viewBox="0 0 {w} {h}" width="100%">{"".join(out)}</svg>'

def funnel(c):
    steps = [("Envoyés", c.get("envoyes")), ("Délivrés", c.get("delivres")), ("Ouverts", c.get("ouvertures")),
             ("Clics", c.get("clics")), ("Visites", c.get("visites"))]
    top = max([s[1] or 0 for s in steps] + [1])
    cols = ["#cbd5e1", "#94a3b8", C["teal"], C["accent"], C["good"]]
    rows = []
    for (lab, v), col in zip(steps, cols):
        if v is None:
            continue
        pct = max(1.5, 100 * v / top)
        rows.append(f'<div class="fr"><span class="fl">{lab}</span><span class="fb"><i style="width:{pct:.1f}%;background:{col}"></i></span><b>{v}</b></div>')
    return "".join(rows)

def progress(ok, total, avant=None):
    pct = 100 * ok / total if total else 0
    gain = ""
    if avant is not None and ok != avant:
        d = ok - avant
        gain = f'<em style="color:{C["good"] if d > 0 else C["bad"]}">{"+" if d > 0 else ""}{d}</em>'
    return f'<span class="pb"><i style="width:{pct:.0f}%"></i></span><b>{ok}/{total}</b>{gain}'

def delta_badge(txt):
    if not txt:
        return ""
    t = str(txt)
    col = C["good"] if t.strip().startswith("+") else (C["bad"] if t.strip().startswith(("−", "-")) else C["muted"])
    return f'<span class="badge" style="background:{col}1a;color:{col}">{esc(t)}</span>'

# ---------- page ----------
def build(d, page=False):
    parts = []
    parts.append(f'''<header><div>{ico_meteo(d.get("meteo_globale", "eclaircies"), 74)}</div>
      <div><h1>{esc(d.get("titre"))}</h1><p>{esc(d.get("sous_titre", ""))}</p></div></header>''')

    if d.get("resume"):
        parts.append('<section class="card resume">' + "".join(
            f'<div class="rl"><span class="num">{i+1}</span><span>{esc(t)}</span></div>' for i, t in enumerate(d["resume"])) + '</section>')

    if d.get("sites"):
        cards = []
        for s in d["sites"]:
            cards.append(f'''<div class="site">{ico_meteo(s.get("meteo", "eclaircies"), 44)}
              <div class="sn">{esc(s["nom"])}</div>
              <div class="big">{esc(s.get("valeur", "–"))}</div>
              <div class="lbl">{esc(s.get("label", "visiteurs"))}</div>
              <div class="cmp">{esc(s.get("compare", ""))} {delta_badge(s.get("delta"))}</div>
              {spark_bars(s.get("jours", []), s.get("jours_labels"), 150, 44, C["accent"]) if s.get("jours") else ""}</div>''')
        parts.append('<section class="sites">' + "".join(cards) + '</section>')

    if d.get("heures"):
        parts.append(f'''<section class="card"><h2>Visiteurs heure par heure</h2>
          <div class="legend"><span><i style="background:{C["accent"]}"></i>aujourd'hui</span><span><i class="dash"></i>hier</span></div>
          {chart_heures(d["heures"].get("aujourdhui"), d["heures"].get("hier"))}</section>''')

    if d.get("prospects"):
        rows = []
        for p in d["prospects"]:
            vid = ""
            if p.get("video"):
                vid = f'<span class="chip" style="background:#fde8e1">{ico("play", 16, C["accent"])} {"vidéo jusqu’au bout" if p["video"] == "fin" else "vidéo lancée"}</span>'
            dots = "".join(f'<i class="dot{" on" if k < (p.get("pages") or 0) else ""}"></i>' for k in range(min(max(p.get("pages") or 0, 5), 10)))
            rows.append(f'''<div class="pr"><div class="pi">{ico(p.get("appareil", "mobile"), 26, C["ink"])}{ico(p.get("source", "direct"), 22, C["blue"])}</div>
              <div class="pt"><b>{esc(p.get("ville"))}</b> <span class="muted">{esc(p.get("quand", ""))}</span><br>
              <span class="dots">{dots}</span> <span class="muted">{p.get("pages", 0)} page{"s" if (p.get("pages") or 0) > 1 else ""}</span> {vid}
              <div class="ptx">{esc(p.get("texte", ""))}</div></div></div>''')
        parts.append(f'<section class="card"><h2>{ico("star", 20, C["sun"])} Prospects à suivre</h2>' + "".join(rows) + '</section>')

    if d.get("brevo"):
        cs = "".join(f'''<div class="camp"><div class="ch"><b>{esc(c["nom"])}</b>{f'<span class="badge" style="background:#fef3c7;color:#92400e">{esc(c["statut"])}</span>' if c.get("statut") else ""}</div>{funnel(c)}</div>''' for c in d["brevo"])
        parts.append(f'<section class="card"><h2>{ico("mail", 20, C["teal"])} Mails Brevo</h2><div class="camps">{cs}</div><p class="note">Ouverts et clics = vrais humains (robots et Apple retirés).</p></section>')

    g = d.get("google")
    if g:
        idx = "".join(f'<div class="ir"><span class="fl">{esc(i["site"])}</span>{progress(i["ok"], i["total"], i.get("avant"))}</div>' for i in g.get("index", []))
        parts.append(f'''<section class="card"><h2>{ico("google", 20, C["blue"])} Google (28 jours)</h2>
          <div class="kpis"><div><b>{esc(g.get("clics", "–"))}</b><span>clics</span></div>
          <div><b>{esc(g.get("impressions", "–"))}</b><span>apparitions {delta_badge(g.get("evol_impressions"))}</span></div>
          <div><b>{esc(g.get("position", "–"))}</b><span>place moyenne</span></div></div>
          <h3>Pages connues de Google</h3>{idx}</section>''')

    y = d.get("youtube")
    if y:
        m = max([t["gain"] for t in y.get("top", [])] + [1])
        bars = "".join(f'<div class="fr"><span class="fl yl">{esc(t["titre"])}</span><span class="fb"><i style="width:{100*t["gain"]/m:.0f}%;background:#ef4444"></i></span><b>+{t["gain"]}</b></div>' for t in y.get("top", []))
        parts.append(f'''<section class="card"><h2>{ico("yt", 22, "#ef4444")} YouTube</h2>
          <div class="kpis"><div><b>+{esc(y.get("gain", 0))}</b><span>vues gagnées</span></div><div><b>{esc(y.get("total", "–"))}</b><span>vues au total</span></div></div>{bars}</section>''')

    if d.get("alertes") or d.get("actions"):
        al = "".join(f'<div class="ar">{ico("alerte", 20, C["sun"])}<span>{esc(t)}</span></div>' for t in d.get("alertes", []))
        ac = "".join(f'<div class="ar">{ico("action", 20, C["good"])}<span>{esc(t)}</span></div>' for t in d.get("actions", []))
        parts.append(f'<section class="card">{"<h2>À surveiller</h2>" + al if al else ""}{"<h2>À faire</h2>" + ac if ac else ""}</section>')

    parts.append('<footer>Tous les graphiques : onglet 9 « Météo & visites » de l’admin SLP</footer>')
    css = f"""
    *{{box-sizing:border-box}} :root{{color-scheme:light}} body{{margin:0;background:{C['bg']};font-family:'DejaVu Sans',system-ui,sans-serif;color:{C['ink']}}} .wrap{{width:720px;padding:22px}}
    header{{display:flex;gap:16px;align-items:center;margin-bottom:14px}} h1{{font-size:27px;margin:0}} header p{{margin:4px 0 0;color:{C['muted']};font-size:15px}}
    .card{{background:{C['card']};border-radius:18px;padding:16px 18px;margin-bottom:14px;box-shadow:0 1px 3px #0001}}
    h2{{font-size:18px;margin:0 0 10px;display:flex;gap:8px;align-items:center}} h3{{font-size:14px;color:{C['muted']};margin:14px 0 6px;font-weight:normal}}
    .resume .rl{{display:flex;gap:10px;align-items:flex-start;font-size:15px;line-height:1.35;margin:6px 0}}
    .num{{flex:none;width:24px;height:24px;border-radius:50%;background:{C['accent']};color:#fff;font-weight:bold;font-size:13px;display:flex;align-items:center;justify-content:center}}
    .sites{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:14px}}
    .site{{background:{C['card']};border-radius:18px;padding:12px;text-align:center;box-shadow:0 1px 3px #0001}}
    .sn{{font-weight:bold;font-size:14px}} .big{{font-size:38px;font-weight:bold;line-height:1.1}} .lbl{{font-size:12px;color:{C['muted']}}}
    .cmp{{font-size:12px;color:{C['muted']};margin:4px 0 6px}} .badge{{display:inline-block;border-radius:10px;padding:1px 7px;font-size:12px;font-weight:bold}}
    .legend{{display:flex;gap:16px;font-size:12px;color:{C['muted']};margin-bottom:4px}} .legend i{{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:5px;vertical-align:-1px}}
    .legend .dash{{height:0;border-top:2px dashed {C['blue']};border-radius:0;vertical-align:3px}}
    .pr{{display:flex;gap:12px;padding:10px 0;border-top:1px solid {C['line']}}} .pr:first-of-type{{border-top:0}}
    .pi{{display:flex;flex-direction:column;gap:4px;align-items:center;width:30px}} .pt{{font-size:15px;flex:1;min-width:0}} .ptx{{font-size:13px;color:#374151;margin-top:3px}}
    .muted{{color:{C['muted']};font-size:12px}} .dots i{{display:inline-block;width:9px;height:9px;border-radius:50%;background:#e5e7eb;margin-right:3px}} .dots i.on{{background:{C['accent']}}}
    .chip{{display:inline-flex;gap:4px;align-items:center;border-radius:10px;padding:1px 8px;font-size:12px;color:{C['accent']};font-weight:bold}}
    .camps{{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}} .camp{{background:#f8fafc;border-radius:12px;padding:10px}} .ch{{font-size:13px;margin-bottom:6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center}}
    .fr,.ir{{display:flex;align-items:center;gap:8px;font-size:12px;margin:4px 0}} .fl{{width:62px;color:{C['muted']}}} .yl{{flex:0 0 40%;min-width:0;color:{C['ink']};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
    .fb,.pb{{flex:1;height:12px;background:#eef1f5;border-radius:6px;overflow:hidden}} .fb i,.pb i{{display:block;height:100%;border-radius:6px}} .pb i{{background:{C['good']}}}
    .fr b,.ir b{{min-width:30px;text-align:right}} .ir em{{font-style:normal;font-weight:bold;font-size:12px;min-width:26px}}
    .kpis{{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:8px}} .kpis div{{min-width:120px}} .kpis div{{flex:1;background:#f8fafc;border-radius:12px;padding:10px;text-align:center}} .kpis b{{display:block;font-size:26px}} .kpis span{{font-size:12px;color:{C['muted']}}}
    .ar{{display:flex;gap:10px;align-items:flex-start;font-size:14px;line-height:1.35;margin:7px 0}} .ar svg{{flex:none}}
    .note{{font-size:11px;color:{C['muted']};margin:8px 0 0}} footer{{text-align:center;font-size:12px;color:{C['muted']};padding:4px 0 2px}}
    """
    if page:
        css += """
    .wrap{width:auto;max-width:780px;margin:0 auto;padding-block:22px;padding-left:max(16px, env(safe-area-inset-left, 0px));padding-right:max(16px, env(safe-area-inset-right, 0px))}
    .zoom{font-size:12px;color:#6b7280;text-align:center;margin:0 0 12px}
    @media (max-width:520px){ h1{font-size:22px} .big{font-size:30px} }
    """
        hint = '<p class="zoom">Astuce sur ordinateur : Ctrl + molette (ou Ctrl +) pour zoomer, tout reste net.</p>'
        return (f'<title>Météo SLP</title><meta name="claude:viewport-fit-sides" content="cover">'
                f'<style>{css}</style><div class="wrap">{hint}{"".join(parts)}</div>')
    return f'<!doctype html><html><head><meta charset="utf-8"><style>{css}</style></head><body><div class="wrap">{"".join(parts)}</div></body></html>'

async def render(d, out):
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 720, "height": 800}, device_scale_factor=2)
        await pg.set_content(build(d), wait_until="load")
        await pg.screenshot(path=out, full_page=True)
        await b.close()

if __name__ == "__main__":
    data = json.load(open(sys.argv[1], encoding="utf-8"))
    out = sys.argv[2] if len(sys.argv) > 2 else "rapport.png"
    if out.endswith(".html"):
        # page.html = page à publier comme Artifact (zoomable sur ordinateur)
        open(out, "w", encoding="utf-8").write(build(data, page=True))
    else:
        asyncio.run(render(data, out))
    print(out)
