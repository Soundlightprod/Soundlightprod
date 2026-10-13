#!/usr/bin/env python3
"""Génère les pages produit statiques de la boutique SLP (référencement Google).

Source : l'API publique de la boutique (même catalogue que l'admin).
Sorties :
  produits/<slug>.html          une page par produit, avec données structurées Product/Offer
  produits/flux-google.xml      flux produits pour Google Merchant Center (fiches gratuites)
  boutique.html                 bloc « Toutes nos références » + données structurées du magasin
  sitemap.xml                   une entrée par produit (avec image)

Usage : python3 _boutique/build.py [fichier.json | URL]   (défaut : l'API en ligne)
"""
import unicodedata
import datetime, html, json, pathlib, re, sys, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = 'https://soundlightprod.store'   # domaine de la boutique
ORG = 'https://soundlightprod.fr'       # site de l'entreprise
API = 'https://slp-api.raspy-silence-d4c7.workers.dev/api/products'
CATS = {'son': 'Son', 'lumiere': 'Lumière', 'effets': 'Effets', 'consommables': 'Consommables'}
CAT_FULL = {'son': 'Sonorisation', 'lumiere': 'Éclairage scénique', 'effets': 'Machines à effets', 'consommables': 'Consommables'}
GOOGLE_CAT = {'son': 'Électronique > Audio > Composants audio', 'lumiere': 'Arts et loisirs > Arts du spectacle > Éclairage de scène',
              'effets': 'Arts et loisirs > Fêtes et célébrations > Articles de fête',
              'consommables': 'Arts et loisirs > Fêtes et célébrations > Articles de fête'}
EMPTY = {'', 'descriptif en préparation'}
# Photos supplémentaires (la base n'a qu'une image par produit) : slug -> [fichiers du site]
EXTRA_IMAGES = {
    'machine-etincelles-800w': ['/machine-etincelles-800w-hauteurs.png'],
    'machine-etincelles-800w-x2': ['/machine-etincelles-800w-hauteurs.png'],
    'machine-etincelles-800w-x4': ['/machine-etincelles-800w-hauteurs.png'],
}
# Photos du fournisseur téléchargées par _boutique/fetch_images.py (workflow « Photos produits »)
_gal = ROOT / 'galerie-produits' / 'index.json'
if _gal.exists():
    for _slug, _files in json.loads(_gal.read_text(encoding='utf-8')).items():
        EXTRA_IMAGES.setdefault(_slug, []).extend(f for f in _files if f not in EXTRA_IMAGES.get(_slug, []))


def load(src):
    if src.startswith('http'):
        req = urllib.request.Request(src, headers={'User-Agent': 'slp-boutique-build'})
        data = json.load(urllib.request.urlopen(req, timeout=30))
    else:
        data = json.loads(pathlib.Path(src).read_text(encoding='utf-8'))
    if isinstance(data, dict):
        data = data.get('products') or data.get('results') or []
    return [p for p in data if p.get('slug') and p.get('active', 1)]


def esc(s):
    return html.escape(str(s or ''), quote=True)


def specs(p):
    d = (p.get('description') or '').strip()
    if d.lower() in EMPTY:
        return []
    parts = [s.strip() for s in d.split('|')] if '|' in d else [d]
    return [s for s in parts if s]


def summary(p):
    sp = specs(p)
    cat = CAT_FULL.get(p['category'], 'Matériel')
    base = f"{p['name']} : {cat.lower()} professionnel"
    if sp and len(sp) > 1:
        return f"{base} — {', '.join(sp[:3])}. Garantie 2 ans, livraison partout en France."
    if sp:
        return f"{sp[0]} Garantie 2 ans, livraison partout en France."
    return f"{base}, garanti 2 ans, livré partout en France par SLP."


def price(p):
    return f"{p['price_cents'] / 100:.2f}"


def fr_price(p):
    return f"{p['price_cents'] / 100:.2f}".replace('.', ',') + ' €'


def in_stock(p):
    return int(p.get('stock_qty') or 0) > 0


def absolutize(fragment):
    """Les pages produit sont dans /produits/ : liens et images du site en chemins absolus."""
    fragment = re.sub(r'(href|src)="(?!https?:|mailto:|tel:|/|#|data:)([^"]+)"', r'\1="/\2"', fragment)
    return fragment


def template():
    s = (ROOT / 'boutique.html').read_text(encoding='utf-8')
    head = s[:s.index('</head>')]
    header = s[s.index('<header'):s.index('</header>') + len('</header>')]
    footer = s[s.index('<footer'):s.index('</footer>') + len('</footer>')]
    style = re.search(r'<style>.*?</style>', head, re.S).group(0)
    links = '\n'.join(l for l in re.findall(r'<link [^>]*>|<meta name="theme-color"[^>]*>', head)
                      if 'hreflang' not in l and 'canonical' not in l)
    shopbar = re.search(r'<!-- shopbar:start -->.*?<!-- shopbar:end -->', s, re.S).group(0)
    return style, absolutize(links), absolutize(header), absolutize(footer), absolutize(shopbar)


PAGE_CSS = """<style>
  .pp{max-width:1220px; margin:0 auto; padding:40px 24px 80px;}
  .pp-crumb{font-family:'DM Mono',monospace; font-size:.78rem; letter-spacing:.06em; color:var(--muted); margin-bottom:26px;}
  .pp-crumb a{color:var(--muted); text-decoration:none;} .pp-crumb a:hover{color:var(--paper);}
  .pp-grid{display:grid; grid-template-columns:1.05fr 1fr; gap:48px; align-items:start;}
  @media (max-width:860px){ .pp-grid{grid-template-columns:1fr; gap:28px;} }
  .pp-img{background:#fff; border-radius:18px; aspect-ratio:1; display:flex; align-items:center; justify-content:center; overflow:hidden; border:1px solid var(--line);}
  .pp-img img{width:100%; height:100%; object-fit:contain; padding:6%;}
  .pp-thumbs{display:flex; gap:10px; margin-top:12px;}
  .pp-thumbs button{width:76px; height:76px; padding:4px; background:#fff; border:2px solid var(--line); border-radius:10px; cursor:pointer; opacity:.7;}
  .pp-thumbs button.on, .pp-thumbs button:hover{border-color:var(--paper); opacity:1;}
  .pp-thumbs img{width:100%; height:100%; object-fit:contain; display:block;}
  .pp h1{font-size:clamp(1.9rem,4vw,3rem); margin:10px 0 18px; text-transform:none; line-height:1.02;}
  .pp-price{font-family:'League Spartan',sans-serif; font-weight:900; font-size:2.3rem; margin:6px 0 4px;}
  .pp-ttc{color:var(--muted); font-size:.85rem;}
  .pp-stock{display:inline-flex; align-items:center; gap:8px; font-size:.9rem; margin:16px 0 24px;}
  .pp-stock::before{content:''; width:9px; height:9px; border-radius:50%; background:#3ddc84; box-shadow:0 0 8px #3ddc84;}
  .pp-stock.out::before{background:#ff5a5a; box-shadow:0 0 8px #ff5a5a;}
  .pp-actions{display:flex; gap:12px; flex-wrap:wrap; margin-bottom:28px;}
  .pp-trust{display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:30px;}
  .pp-trust div{background:var(--ink-2); border:1px solid var(--line); border-radius:12px; padding:12px; font-size:.82rem; color:var(--muted);}
  .pp-trust b{display:block; color:var(--paper); font-size:.9rem; margin-bottom:2px;}
  @media (max-width:520px){ .pp-trust{grid-template-columns:1fr;} }
  .pp h2{font-size:1.25rem; text-transform:none; margin:0 0 14px;}
  .pp-specs{list-style:none; padding:0; margin:0; border-top:1px solid var(--line);}
  .pp-specs li{padding:10px 0; border-bottom:1px solid var(--line); font-size:.93rem; color:var(--paper);}
  .pp-intro{color:var(--muted); margin-bottom:22px;}
  .pp-more{margin-top:70px;}
  .pp-more-grid{display:grid; grid-template-columns:repeat(4,1fr); gap:16px;}
  @media (max-width:860px){ .pp-more-grid{grid-template-columns:repeat(2,1fr);} }
  .pp-more a{display:block; text-decoration:none; color:var(--paper); background:var(--ink-2); border:1px solid var(--line); border-radius:14px; overflow:hidden; transition:transform .25s, border-color .25s;}
  .pp-more a:hover{transform:translateY(-4px); border-color:rgba(255,255,255,.3);}
  .pp-more .im{background:#fff; aspect-ratio:1;} .pp-more .im img{width:100%; height:100%; object-fit:contain; padding:8%;}
  .pp-more .tx{padding:12px 14px;} .pp-more .tx b{display:block; font-size:.9rem; line-height:1.25;} .pp-more .tx span{color:var(--muted); font-size:.85rem;}
  .pp-need{margin:26px 0 8px; padding:18px; border:1px solid var(--line); border-radius:14px; background:var(--ink-2);}
  .pp-need h2{margin:0 0 6px !important;} .pp-need p{color:var(--muted); font-size:.88rem; margin:0 0 12px;}
  .pp-need-i{display:flex; align-items:center; gap:12px; padding:10px 0; border-top:1px solid var(--line);}
  .pp-need-i .nm{display:flex; align-items:center; gap:12px; flex:1; text-decoration:none; color:var(--paper); min-width:0;}
  .pp-need-i .im{width:54px; height:54px; background:#fff; border-radius:10px; flex:none;} .pp-need-i .im img{width:100%; height:100%; object-fit:contain; padding:4px;}
  .pp-need-i b{font-size:.92rem; line-height:1.25;} .pp-need-i .pr{font-weight:700; white-space:nowrap;}
  .pp-need-i .btn{padding:9px 16px; font-size:.85rem;}
  .pp-need-links{display:flex; flex-wrap:wrap; gap:8px;} .pp-need-links a{padding:8px 14px; border:1px solid var(--line); border-radius:100px; text-decoration:none; color:var(--paper); font-size:.88rem;}
</style>"""


def jsonld(p):
    offer = {
        '@type': 'Offer', 'url': f"{SITE}/produits/{p['slug']}", 'priceCurrency': 'EUR', 'price': price(p),
        'availability': 'https://schema.org/InStock' if in_stock(p) else 'https://schema.org/OutOfStock',
        'itemCondition': 'https://schema.org/NewCondition',
        'seller': {'@type': 'Organization', 'name': 'SLP Sound Light Prod', 'url': ORG + '/'},
        'shippingDetails': {'@type': 'OfferShippingDetails',
                            'shippingDestination': {'@type': 'DefinedRegion', 'addressCountry': 'FR'}},
        'hasMerchantReturnPolicy': {'@type': 'MerchantReturnPolicy', 'applicableCountry': 'FR',
                                    'returnPolicyCategory': 'https://schema.org/MerchantReturnFiniteReturnWindow',
                                    'merchantReturnDays': 14, 'returnMethod': 'https://schema.org/ReturnByMail',
                                    'returnFees': 'https://schema.org/ReturnFeesCustomerResponsibility'},
    }
    prod = {'@context': 'https://schema.org', '@type': 'Product', 'name': p['name'], 'sku': f"SLP-{p['id']}",
            'description': summary(p), 'category': CAT_FULL.get(p['category'], ''),
            'brand': {'@type': 'Brand', 'name': 'SLP Sound Light Prod'}, 'offers': offer}
    if p.get('image'):
        prod['image'] = [SITE + p['image']]
    crumbs = {'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [
        {'@type': 'ListItem', 'position': 1, 'name': 'Accueil', 'item': SITE + '/'},
        {'@type': 'ListItem', 'position': 2, 'name': 'Boutique', 'item': SITE + '/'},
        {'@type': 'ListItem', 'position': 3, 'name': p['name'], 'item': f"{SITE}/produits/{p['slug']}"}]}
    return ('<script type="application/ld+json">' + json.dumps(prod, ensure_ascii=False) + '</script>\n'
            '<script type="application/ld+json">' + json.dumps(crumbs, ensure_ascii=False) + '</script>')


# --- Produits associés : une machine à effets nécessite un consommable (poudre, liquide…) ---
FX_KEYS = ('etincelles', 'fumee', 'brouillard', 'mousse', 'bulles')


def _norm(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s or '') if not unicodedata.combining(c)).lower()


def is_acc(p):
    return bool(re.match(r'(poudre|liquide|fluide|recharge)\b', _norm(p['name'])))


def fx_key(p):
    n = _norm(p['name'])
    return next((k for k in FX_KEYS if k in n), None)


def related(p, products):
    """('acc', [consommables]) pour une machine, ('machines', [machines]) pour un consommable, sinon None."""
    k = fx_key(p)
    if not k:
        return None
    acc = is_acc(p)
    others = [q for q in products if q['slug'] != p['slug'] and fx_key(q) == k and is_acc(q) != acc
              and not (acc and _norm(q['name']).startswith('lot de'))]
    return ('machines' if acc else 'acc', others) if others else None


def need_block(p, products):
    r = related(p, products)
    if not r:
        return ''
    kind, items = r
    if kind == 'acc':
        rows = ''.join(
            f'<div class="pp-need-i"><a class="nm" href="/produits/{esc(q["slug"])}">'
            f'<span class="im"><img src="{esc(q.get("image") or "")}" alt="" loading="lazy"></span><b>{esc(q["name"])}</b></a>'
            f'<span class="pr">{fr_price(q)}</span>'
            f'<a class="btn btn-primary" href="/boutique.html?ajouter={esc(q["slug"])}">Ajouter</a></div>' for q in items)
        return ('<section class="pp-need"><h2>À prévoir avec cette machine</h2>'
                '<p>Consommable nécessaire à son fonctionnement, vendu séparément.</p>' + rows + '</section>')
    links = ''.join(f'<a href="/produits/{esc(q["slug"])}">{esc(q["name"])}</a>' for q in items)
    return f'<section class="pp-need"><h2>Compatible avec</h2><div class="pp-need-links">{links}</div></section>'


TRACK_JS = """<script>
(function(){
  try{ if(localStorage.getItem('slp_admin_token')||localStorage.getItem('slp_notrack')) return; }catch(e){}
  var sid=null; try{ sid=sessionStorage.getItem('slp_visit_sid'); if(!sid){ sid=Date.now().toString(36)+Math.random().toString(36).slice(2); sessionStorage.setItem('slp_visit_sid',sid); } }catch(e){}
  fetch((/\\.store$/.test(location.hostname)?'':'https://slp-api.raspy-silence-d4c7.workers.dev')+'/api/track-visit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({artist_slug:'boutique/__SLUG__',session_id:sid,ref:document.referrer})}).catch(function(){});
})();
</script>"""

def page(p, products, tpl):
    style, links, header, footer, shopbar = tpl
    url = f"{SITE}/produits/{p['slug']}"
    cat = CATS.get(p['category'], p['category'])
    title = f"{p['name']} — {CAT_FULL.get(p['category'], 'Matériel')} | Boutique SLP"
    desc = summary(p)[:300]
    sp = specs(p)
    spec_html = ''.join(f'<li>{esc(s)}</li>' for s in sp) if len(sp) > 1 else ''
    intro = f'<p class="pp-intro">{esc(sp[0])}</p>' if len(sp) == 1 else ''
    stock = ('<span class="pp-stock">En stock — expédition en France</span>' if in_stock(p)
             else '<span class="pp-stock out">Bientôt de retour en stock</span>')
    buy = (f'<a class="btn btn-primary" href="/boutique.html?ajouter={esc(p["slug"])}">Ajouter au panier</a>' if in_stock(p)
           else f'<a class="btn btn-primary" href="/contact.html">Être prévenu du retour</a>')
    same = [q for q in products if q['category'] == p['category'] and q['slug'] != p['slug']]
    others = (same + [q for q in products if q['category'] != p['category']])[:4]
    more = ''.join(
        f'<a href="/produits/{esc(q["slug"])}"><div class="im"><img src="{esc(q.get("image") or "")}" alt="{esc(q["name"])}" loading="lazy"></div>'
        f'<div class="tx"><b>{esc(q["name"])}</b><span>{fr_price(q)}</span></div></a>' for q in others)
    img = f'<img id="ppMain" src="{esc(p["image"])}" alt="{esc(p["name"])}">' if p.get('image') else ''
    extras = EXTRA_IMAGES.get(p['slug'], [])
    thumbs = ''
    if extras and p.get('image'):
        js = ("var m=document.getElementById('ppMain');m.src=this.dataset.src;"
              "document.querySelectorAll('.pp-thumbs button').forEach(function(b){b.classList.remove('on')});this.classList.add('on')")
        btns = []
        for i, u in enumerate([p['image']] + extras):
            cls = 'on' if i == 0 else ''
            alt = esc(p['name']) + ' – photo ' + str(i + 1)
            btns.append(f'<button type="button" class="{cls}" data-src="{esc(u)}" onclick="{js}"><img src="{esc(u)}" alt="{alt}"></button>')
        thumbs = '<div class="pp-thumbs">' + ''.join(btns) + '</div>'
    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="{url}">
<meta property="og:type" content="product">
<meta property="og:title" content="{esc(p['name'])}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{url}">
{f'<meta property="og:image" content="{SITE}{esc(p["image"])}">' if p.get('image') else ''}
<meta property="product:price:amount" content="{price(p)}">
<meta property="product:price:currency" content="EUR">
{style}
{PAGE_CSS}
{links}
{jsonld(p)}
</head>
<body>
<!-- Page générée automatiquement par _boutique/build.py — ne pas modifier à la main -->
{header}

<div class="shop-light">
{shopbar}
<main class="pp">
  <nav class="pp-crumb" aria-label="Fil d'Ariane"><a href="/">Accueil</a> / <a href="/boutique.html">Boutique</a> / <a href="/boutique.html#{esc(p['category'])}">{esc(cat)}</a> / {esc(p['name'])}</nav>
  <div class="pp-grid">
    <div><div class="pp-img">{img}</div>{thumbs}</div>
    <div>
      <span class="label">{esc(CAT_FULL.get(p['category'], cat))}</span>
      <h1>{esc(p['name'])}</h1>
      <div class="pp-price">{fr_price(p)}</div>
      <div class="pp-ttc">Prix TTC · Réf. SLP-{p['id']}</div>
      {stock}
      <div class="pp-actions">{buy}<a class="btn btn-ghost" href="/boutique.html">Toute la boutique</a></div>
      <div class="pp-trust"><div><b>Garantie 2 ans</b>Matériel testé par nos techniciens</div><div><b>Livraison France</b>Expédition soignée</div><div><b>Paiement sécurisé</b>Carte bancaire via Stripe</div></div>
      {intro}
      {f'<h2>Caractéristiques techniques</h2><ul class="pp-specs">{spec_html}</ul>' if spec_html else ''}
      {need_block(p, products)}
      {'' if sp else '<p class="pp-intro">Fiche technique détaillée sur demande : <a href="/contact.html" style="color:var(--paper)">contactez-nous</a>.</p>'}
    </div>
  </div>
  <section class="pp-more">
    <h2>Vous aimerez aussi</h2>
    <div class="pp-more-grid">{more}</div>
  </section>
</main>
</div>

{footer}
{TRACK_JS.replace('__SLUG__', p['slug'])}
</body>
</html>
"""


def feed(products):
    items = []
    for p in products:
        u = f"{SITE}/produits/{p['slug']}"
        items.append(f"""  <item>
    <g:id>SLP-{p['id']}</g:id>
    <g:title>{esc(p['name'])}</g:title>
    <g:description>{esc(summary(p))}</g:description>
    <g:link>{u}</g:link>
    {f'<g:image_link>{SITE}{esc(p["image"])}</g:image_link>' if p.get('image') else ''}
    <g:availability>{'in_stock' if in_stock(p) else 'out_of_stock'}</g:availability>
    <g:price>{price(p)} EUR</g:price>
    <g:condition>new</g:condition>
    <g:brand>SLP Sound Light Prod</g:brand>
    <g:identifier_exists>no</g:identifier_exists>
    <g:google_product_category>{esc(GOOGLE_CAT.get(p['category'], ''))}</g:google_product_category>
    <g:product_type>{esc(CAT_FULL.get(p['category'], ''))}</g:product_type>
  </item>""")
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">\n<channel>\n'
            f'  <title>Boutique SLP Sound Light Prod</title>\n  <link>{SITE}/</link>\n'
            '  <description>Matériel son et lumière garanti 2 ans</description>\n' + '\n'.join(items) + '\n</channel>\n</rss>\n')


def update_boutique(products):
    f = ROOT / 'boutique.html'
    s = f.read_text(encoding='utf-8')
    groups = []
    for c in ('lumiere', 'son', 'effets', 'consommables'):
        ps = [p for p in products if p['category'] == c]
        if ps:
            groups.append(f'<div class="refs-col"><h3>{CAT_FULL[c]}</h3><ul>' + ''.join(
                f'<li><a href="/produits/{esc(p["slug"])}">{esc(p["name"])}</a> <span>{fr_price(p)}</span></li>' for p in ps) + '</ul></div>')
    store = {'@context': 'https://schema.org', '@type': 'OnlineStore', 'name': 'Boutique SLP Sound Light Prod',
             'url': SITE + '/', 'description': 'Matériel son et lumière professionnel garanti 2 ans, livré partout en France.',
             'parentOrganization': {'@type': 'Organization', 'name': 'SLP Sound Light Prod', 'url': ORG + '/'},
             'hasMerchantReturnPolicy': {'@type': 'MerchantReturnPolicy', 'applicableCountry': 'FR',
                                         'returnPolicyCategory': 'https://schema.org/MerchantReturnFiniteReturnWindow', 'merchantReturnDays': 14}}
    itemlist = {'@context': 'https://schema.org', '@type': 'ItemList', 'name': 'Catalogue de la boutique SLP',
                'itemListElement': [{'@type': 'ListItem', 'position': i, 'url': f"{SITE}/produits/{p['slug']}", 'name': p['name']}
                                    for i, p in enumerate(products, 1)]}
    # La liste visible des références a été retirée (peu utile pour le visiteur) : on ne garde que les données structurées
    block = ('<!-- refs:start (généré par _boutique/build.py) -->\n'
             '<script type="application/ld+json">' + json.dumps(store, ensure_ascii=False) + '</script>\n'
             '<script type="application/ld+json">' + json.dumps(itemlist, ensure_ascii=False) + '</script>\n<!-- refs:end -->')
    # Rayon Sonorisation masqué tant qu'il n'a aucun produit (le lien du menu reçoit l'attribut hidden)
    has_son = any(p['category'] == 'son' for p in products)
    s = re.sub(r'<a class="top" href="/boutique\.html#son"[^>]*>', '<a class="top" href="/boutique.html#son"' + ('' if has_son else ' hidden') + '>', s, count=1)
    if '<!-- refs:start' in s:
        s = re.sub(r'<!-- refs:start.*?<!-- refs:end -->', lambda _: block, s, flags=re.S)
    else:
        s = s.replace('<footer>', block + '\n\n<footer>', 1)
    f.write_text(s, encoding='utf-8')


def update_sitemap(products):
    """Sitemap de la boutique (domaine .store) ; le sitemap du .fr ne liste plus la boutique ni les fiches."""
    f = ROOT / 'sitemap.xml'
    s = f.read_text(encoding='utf-8')
    s = re.sub(r'\s*<!-- produits:start -->.*?<!-- produits:end -->', '', s, flags=re.S)
    s = re.sub(r'\s*<url><loc>https://soundlightprod\.fr/boutique</loc>.*?</url>', '', s, flags=re.S)
    f.write_text(s, encoding='utf-8')
    urls = (f"\n  <url><loc>{SITE}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>" + ''.join(
        f"\n  <url><loc>{SITE}/produits/{p['slug']}</loc><changefreq>weekly</changefreq><priority>0.7</priority>"
        + (f"<image:image><image:loc>{SITE}{esc(p['image'])}</image:loc></image:image>" if p.get('image') else '') + '</url>'
        for p in products))
    (ROOT / 'sitemap-store.xml').write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
        'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">' + urls + '\n</urlset>\n', encoding='utf-8')


def main():
    products = load(sys.argv[1] if len(sys.argv) > 1 else API)
    if not products:
        sys.exit('Catalogue vide : rien à générer (API indisponible ?)')
    order = {'lumiere': 0, 'son': 1, 'effets': 2, 'consommables': 3}
    products.sort(key=lambda p: (order.get(p['category'], 9), p['id']))
    out = ROOT / 'produits'
    out.mkdir(exist_ok=True)
    keep = set()
    tpl = template()
    for p in products:
        fn = out / f"{p['slug']}.html"
        fn.write_text(page(p, products, tpl), encoding='utf-8')
        keep.add(fn.name)
    for old in out.glob('*.html'):
        if old.name not in keep:
            old.unlink()
    (out / 'flux-google.xml').write_text(feed(products), encoding='utf-8')
    update_boutique(products)
    update_sitemap(products)
    print(f'{len(products)} produits générés')


if __name__ == '__main__':
    main()
