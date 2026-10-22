#!/usr/bin/env python3
"""Télécharge les photos supplémentaires des produits d'éclairage (fournisseur AICPOSE) dans galerie-produits/
et écrit galerie-produits/index.json (slug -> chemins du site). Lancé par le workflow « Photos produits »."""
import json, pathlib, re, sys, time, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE = 'https://shopcdnalpha.grainajz.com/category/397951/3881/'
OUT = ROOT / 'galerie-produits'
OUT.mkdir(exist_ok=True)
manifest = json.loads((pathlib.Path(__file__).parent / 'aicpose_images.json').read_text(encoding='utf-8'))
index, fails = {}, 0
for slug, paths in manifest.items():
    files = []
    for i, p in enumerate(paths, 1):
        ext = re.search(r'\.(jpe?g|png|webp)$', p, re.I)
        name = f'{slug}-{i}{ext.group(0).lower() if ext else ".jpg"}'
        dest = OUT / name
        if not dest.exists() or dest.stat().st_size < 1000:
            for attempt in range(3):
                try:
                    req = urllib.request.Request(BASE + p, headers={'User-Agent': 'Mozilla/5.0 slp-boutique'})
                    dest.write_bytes(urllib.request.urlopen(req, timeout=40).read())
                    break
                except Exception as e:
                    print('échec', slug, i, e, file=sys.stderr)
                    time.sleep(2)
        if dest.exists() and dest.stat().st_size >= 1000:
            files.append('/galerie-produits/' + name)
        else:
            fails += 1
    if files:
        index[slug] = files

# Photos AliExpress (URLs complètes) : la 1re = photo principale du produit (non listée dans index.json)
ali = pathlib.Path(__file__).parent / 'aliexpress_images.json'
if ali.exists():
    for slug, urls in json.loads(ali.read_text(encoding='utf-8')).items():
        files = []
        for i, u in enumerate(urls, 1):
            ext = re.search(r'\.(jpe?g|png|webp)$', u, re.I)
            name = f'{slug}-{i}{ext.group(0).lower() if ext else ".jpg"}'
            dest = OUT / name
            if not dest.exists() or dest.stat().st_size < 1000:
                for attempt in range(3):
                    try:
                        req = urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0 slp-boutique'})
                        dest.write_bytes(urllib.request.urlopen(req, timeout=40).read())
                        break
                    except Exception as e:
                        print('échec', slug, i, e, file=sys.stderr)
                        time.sleep(2)
            if dest.exists() and dest.stat().st_size >= 1000:
                if i > 1:
                    files.append('/galerie-produits/' + name)
            else:
                fails += 1
        if files:
            index[slug] = files
(OUT / 'index.json').write_text(json.dumps(index, indent=1), encoding='utf-8')
print(sum(len(v) for v in index.values()), 'photos,', fails, 'échecs')
