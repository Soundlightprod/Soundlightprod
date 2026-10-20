#!/usr/bin/env python3
"""Met en ligne sur la chaîne YouTube SLP les vidéos fournisseur des produits de la boutique
qui n'en ont pas encore, puis note leur identifiant dans _boutique/videos_youtube.json
(le workflow « Boutique — pages produit » ajoute ensuite la vidéo sur la fiche).

Secrets attendus (dépôt GitHub → Settings → Secrets → Actions) :
  YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN  (autorisation « youtube.upload » de la chaîne SLP)

Usage : python3 _boutique/youtube_upload.py [nombre max de vidéos, défaut 6] [slug ...]
"""
import json, os, pathlib, sys, urllib.parse, urllib.request, urllib.error

HERE = pathlib.Path(__file__).resolve().parent
YT_FILE = HERE / 'videos_youtube.json'
SRC_FILE = HERE / 'videos_fournisseur.json'
CDN = 'https://shopcdnalpha.grainajz.com/'
API = 'https://slp-api.raspy-silence-d4c7.workers.dev/api/products'
STORE = 'https://soundlightprod.store/produits/'
PRIVACY = 'unlisted'   # comme les vidéos déjà en ligne (non répertoriées, visibles sur les fiches)


def http(url, data=None, headers=None, method=None, timeout=600):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        return urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'replace')[:600]
        raise SystemExit(f'Erreur {e.code} sur {url.split("?")[0]} : {body}')


def access_token():
    need = ['YT_CLIENT_ID', 'YT_CLIENT_SECRET', 'YT_REFRESH_TOKEN']
    missing = [k for k in need if not os.environ.get(k)]
    if missing:
        msg = 'Autorisation YouTube pas encore installée (secrets manquants : ' + ', '.join(missing) + ') : rien n’a été mis en ligne.'
        print(msg)
        if os.environ.get('GITHUB_STEP_SUMMARY'):
            open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8').write(msg + '\n')
        raise SystemExit(0)
    data = urllib.parse.urlencode({
        'client_id': os.environ['YT_CLIENT_ID'], 'client_secret': os.environ['YT_CLIENT_SECRET'],
        'refresh_token': os.environ['YT_REFRESH_TOKEN'], 'grant_type': 'refresh_token'}).encode()
    return json.load(http('https://oauth2.googleapis.com/token', data))['access_token']


def product_names():
    try:
        req = urllib.request.Request(API, headers={'User-Agent': 'slp-youtube-upload'})
        rows = json.load(urllib.request.urlopen(req, timeout=30))
        rows = (rows.get('products') or rows.get('results') or []) if isinstance(rows, dict) else rows
        return {p['slug']: p['name'] for p in rows if p.get('slug')}
    except Exception as e:
        print('Catalogue indisponible, noms tirés des slugs :', e)
        return {}


def upload(token, path, name, slug):
    meta = {
        'snippet': {
            'title': f'{name} – démo lumière | SLP'[:100],
            'description': (f'{name} en action : couleurs, effets et rendu sur scène.\n'
                            f'Disponible sur la boutique SLP, garanti 2 ans, livré partout en France :\n{STORE}{slug}\n\n'
                            'SLP Sound Light Prod : son, lumière et spectacles clé en main.\n'
                            '#eclairage #lumierescene #sonorisation'),
            'tags': ['éclairage scénique', 'jeu de lumière', 'SLP', 'Sound Light Prod', 'boutique'],
            'categoryId': '22', 'defaultLanguage': 'fr', 'defaultAudioLanguage': 'fr'},
        'status': {'privacyStatus': PRIVACY, 'selfDeclaredMadeForKids': False, 'embeddable': True},
    }
    size = path.stat().st_size
    start = http('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
                 json.dumps(meta).encode(), {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8',
                                             'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': str(size)}, 'POST')
    loc = start.headers['Location']
    res = http(loc, path.read_bytes(), {'Authorization': 'Bearer ' + token, 'Content-Type': 'video/mp4',
                                        'Content-Length': str(size)}, 'PUT', timeout=1800)
    return json.load(res)['id']


def main():
    args = sys.argv[1:]
    limit = int(args.pop(0)) if args and args[0].isdigit() else 6
    yt = json.loads(YT_FILE.read_text(encoding='utf-8'))
    src = json.loads(SRC_FILE.read_text(encoding='utf-8'))
    todo = [s for s in (args or src) if s in src and s not in yt][:limit]
    if not todo:
        print('Rien à mettre en ligne : toutes les vidéos fournisseur sont déjà sur YouTube.')
        return
    names = product_names()
    token = access_token()
    tmp = pathlib.Path(os.environ.get('RUNNER_TEMP', '/tmp')) / 'videos'
    tmp.mkdir(parents=True, exist_ok=True)
    for slug in todo:
        name = names.get(slug) or slug.replace('-', ' ')
        f = tmp / (slug + '.mp4')
        print(f'↓ {slug}')
        f.write_bytes(http(CDN + src[slug], headers={'User-Agent': 'Mozilla/5.0 slp-boutique'}).read())
        print(f'↑ {name} ({round(f.stat().st_size / 1e6, 1)} Mo)')
        vid = upload(token, f, name, slug)
        f.unlink()
        yt[slug] = vid
        YT_FILE.write_text(json.dumps(yt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(f'✓ https://www.youtube.com/watch?v={vid}')
        summary = os.environ.get('GITHUB_STEP_SUMMARY')
        if summary:
            with open(summary, 'a', encoding='utf-8') as s:
                s.write(f'- {name} : https://www.youtube.com/watch?v={vid}\n')


if __name__ == '__main__':
    main()
