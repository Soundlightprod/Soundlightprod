"""Version anglaise de SLP Store (slpstore.fr/en/) : générée à partir des pages françaises.

Appelé à la fin de build.py : prix, stock, promos et délais sont donc toujours ceux du français.
Sortie : store-en/ (le Worker l'affiche sous /en/ sur slpstore.fr ; le dossier en/ est celui du .com).
Traductions : _boutique/en/*.json. Un texte absent des dictionnaires reste en français (signalé à la fin).
"""
import html, json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIR = pathlib.Path(__file__).parent / 'en'
SITE = 'https://slpstore.fr'
load = lambda n: json.loads((DIR / n).read_text(encoding='utf-8'))
norm = lambda s: re.sub(r'\s+', ' ', s.replace('\xa0', ' ')).strip()

UI = {norm(k): v for k, v in load('ui.json').items()}
NAMES = load('noms.json')
SPECS = load('specs.json')
TEXTS = load('textes.json')                     # slug -> présentation en anglais
JS = load('js.json')                            # page -> [[fr, en], ...]
FR_TEXTS = json.loads((DIR.parent / 'textes_slp.json').read_text(encoding='utf-8'))
BASE = {}
for d in (SPECS, NAMES, UI):
    BASE.update({norm(k): v for k, v in d.items()})
for slug, fr in FR_TEXTS.items():
    if slug in TEXTS:
        BASE[norm(fr)] = TEXTS[slug]

missing = set()


def money(s):
    s = re.sub(r'(\d+),(\d{2})(?:\s|\xa0|&nbsp;)?€', r'€\1.\2', s)
    return re.sub(r'(?<![€\d.,])(\d+)(?:\s|\xa0|&nbsp;)?€(?!\d)', r'€\1', s)


def name(n):
    return NAMES.get(n, BASE.get(norm(n), n))


CAT = r'(?:Sonorisation|Éclairage scénique|Machines à effets|Consommables|Matériel)'
RULES = [
    (rf'(.+?) — (?:[^|—]+, )?({CAT}) \| Boutique SLP', lambda m: f'{name(m[1])} — {tr(m[2])} | SLP Store'),
    (r'/ (.+)', lambda m: '/ ' + name(m[1])),
    (r'Prix TTC · soit (.+?) HT · Réf\. (SLP-\d+)', lambda m: f'Price incl. VAT · {m[1]} excl. VAT · Ref. {m[2]}'),
    (r'Livraison estimée : environ (\d+) jours? après la commande\.', lambda m: f'Estimated delivery in France: about {m[1]} days after ordering.'),
    (r'(.+?) (−\d+ ?%) · jusqu\'au (\d\d)/(\d\d)', lambda m: f'{m[1]} {m[2].replace(" ", "")} · until {m[3]}/{m[4]}'),
    (r'Lot de (\d+)', lambda m: f'Set of {m[1]}'),
    (r'soit (.+?) l\'unité', lambda m: f'{m[1]} each'),
    (r'(−.+?) d\'économie', lambda m: f'{m[1]} saved'),
    (r'(.+?) – photo (\d+)', lambda m: f'{name(m[1])} – photo {m[2]}'),
    (r'(.+?) — vidéo', lambda m: f'{name(m[1])} — video'),
    (r'Lire la vidéo : (.+)', lambda m: 'Play the video: ' + name(m[1])),
    (r'Toutes nos références \((\d+)\)', lambda m: f'All our products ({m[1]})'),
]


def tr(text):
    k = norm(html.unescape(text))
    if k in BASE:
        return BASE[k]
    for rx, fn in RULES:
        m = re.fullmatch(rx, k)
        if m:
            return fn(m)
    if re.search(r'[éèêàçù]|\b(le|la|les|des|une|votre|pour|avec|sur|et)\b', k) and not re.search(r'@|SIRET|^https?:|^Français$', k) and k not in TEXTS.values():
        missing.add(k)
    return None


def translate_markup(s):
    parts = re.split(r'(<script\b.*?</script>|<style\b.*?</style>|<!--.*?-->)', s, flags=re.S)
    for i in range(0, len(parts), 2):
        def node(m):
            raw = m[1].strip()
            if not re.search(r'[A-Za-zÀ-ÿ]', raw):
                return m[0]
            t = tr(raw)
            return m[0] if t is None else '>' + m[1].replace(raw, html.escape(t, quote=False))

        def attr(m):
            t = tr(m[2])
            return m[0] if t is None else f'{m[1]}="{html.escape(t, quote=True)}"'
        p = re.sub(r'>([^<>]+)(?=<|$)', node, parts[i])
        p = re.sub(r'\b(alt|title|aria-label|placeholder)="([^"]+)"', attr, p)
        p = re.sub(r'(?<=property="og:title" )(content)="([^"]+)"', attr, p)
        p = re.sub(r'(?<=name="description" )(content)="([^"]+)"', attr, p)
        parts[i] = money(p)
    return ''.join(parts)


def links(s):
    """Liens internes vers les pages anglaises ; fichiers et pages restées en français en chemins absolus."""
    s = re.sub(r'\b(href|src|action)="(?!https?:|mailto:|tel:|/|#|data:|\$|\')([^"]+)"', r'\1="/\2"', s)
    s = s.replace('href="/./"', 'href="/en/"')
    s = re.sub(r'((?:href|action)=\\?["\'])/boutique(?:\.html)?(?=[?#"\'\\])', r'\1/en/', s)
    s = re.sub(r'((?:href|action)=\\?["\'])/(contact-boutique|produits/)', r'\1/en/\2', s)
    s = re.sub(r'(<nav class="pp-crumb"[^>]*><a href=")/(")', r'\1/en/\2', s)
    s = s.replace('<a href="/" aria-label="SLP Store', '<a href="/en/" aria-label="SLP Store')
    s = s.replace('<a class="back" href="/">', '<a class="back" href="/en/">')
    s = s.replace('<a href="/./">', '<a href="/en/">')
    return s


def script_pairs(s, page):
    for fr, en in JS.get(page, []):
        if fr not in s:
            missing.add(f'[script {page}] {fr[:70]}')
        s = s.replace(fr, en)
    return s


def common(s, fr_url, en_url):
    s = s.replace('<html lang="fr">', '<html lang="en">', 1)
    # lien de langue : sur la page anglaise, il ramène à la même page en français
    s = re.sub(r'<a class="lang-switch"[^>]*>[^<]*</a>',
               lambda _: f'<a class="lang-switch" href="{fr_url[len(SITE):]}" lang="fr" hreflang="fr" style="color:inherit">Français</a>', s)
    s = s.replace(f'<link rel="canonical" href="{fr_url}">', f'<link rel="canonical" href="{en_url}">')
    s = s.replace(f'<meta property="og:url" content="{fr_url}">', f'<meta property="og:url" content="{en_url}">')
    return s


def product_page(s, slug, products):
    fr_url, en_url = f'{SITE}/produits/{slug}', f'{SITE}/en/produits/{slug}'
    p = next(x for x in products if x['slug'] == slug)
    # données structurées : une seule offre déclarée à Google, celle de la page française
    s = re.sub(r'<script type="application/ld\+json">.*?</script>\n?', '', s, flags=re.S)
    desc = TEXTS.get(slug) or f"{name(p['name'])}: 2-year warranty, delivered across France by SLP."
    if len(desc) > 158:
        desc = desc[:158].rsplit(' ', 1)[0].rstrip(' ,;:—-') + '…'
    for attr in ('name="description"', 'property="og:description"'):
        s = re.sub(rf'<meta {attr} content="[^"]*">', lambda _: f'<meta {attr} content="{html.escape(desc, quote=True)}">', s)
    wa = "Hello, I have a question about: " + name(p['name']) + f" (ref. SLP-{p['id']}) — SLP Store"
    from urllib.parse import quote
    s = re.sub(r'(class="pp-wa" href="https://wa\.me/\d+\?text=)[^"]*', lambda m: m[1] + quote(wa), s)
    s = s.replace(f"artist_slug:'boutique/{slug}'", f"artist_slug:'boutique/{slug}',lang:'en'")
    s = translate_markup(common(s, fr_url, en_url))
    return links(s)


def static_page(src, page, fr_url, en_url):
    s = (ROOT / src).read_text(encoding='utf-8')
    if page == 'boutique':
        s = re.sub(r'<script type="application/ld\+json">.*?</script>\n?', '', s, flags=re.S)
        data = json.dumps({**SPECS, **NAMES}, ensure_ascii=False).replace('</', '<\\/')
        s = s.replace('  const API_BASE =', f'  const EN = {data};\n  const API_BASE =', 1)
    # redirections de retour de paiement : propres aux pages françaises
    s = re.sub(r'<script>try\{if\(sessionStorage\.getItem\("slp_lang"\).*?</script>\n?', '', s)
    s = script_pairs(s, page)
    s = translate_markup(common(s, fr_url, en_url))
    s = links(s)
    if f'rel="canonical" href="{en_url}"' not in s:
        s = s.replace('</head>', f'<link rel="canonical" href="{en_url}">\n</head>', 1)
    if 'hreflang="en" href=' not in s:
        s = s.replace('</head>', alternates(fr_url, en_url) + '\n</head>', 1)
    return s


def alternates(fr_url, en_url):
    return (f'<link rel="alternate" hreflang="fr" href="{fr_url}">'
            f'<link rel="alternate" hreflang="en" href="{en_url}">'
            f'<link rel="alternate" hreflang="x-default" href="{fr_url}">')


def build(products):
    missing.clear()
    out = ROOT / 'store-en'
    (out / 'produits').mkdir(parents=True, exist_ok=True)
    for src, page, path in [('boutique.html', 'boutique', ''), ('boutique-merci.html', 'merci', 'boutique-merci'),
                            ('contact-boutique.html', 'contact', 'contact-boutique')]:
        (out / src).write_text(static_page(src, page, f'{SITE}/{path}', f'{SITE}/en/{path}'), encoding='utf-8')
    keep = set()
    for p in products:
        f = ROOT / 'produits' / f"{p['slug']}.html"
        (out / 'produits' / f.name).write_text(product_page(f.read_text(encoding='utf-8'), p['slug'], products), encoding='utf-8')
        keep.add(f.name)
    for old in (out / 'produits').glob('*.html'):
        if old.name not in keep:
            old.unlink()
    if missing:
        print(f'Anglais : {len(missing)} texte(s) sans traduction (restés en français) :')
        for m in sorted(missing):
            print('  ·', m)
