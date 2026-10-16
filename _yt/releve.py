"""Relevé YouTube -> base Cloudflare D1 (slp-db).

Lancé par .github/workflows/youtube.yml, deux fois par jour.
Lecture seule côté YouTube (API YouTube Data v3, clé d'API simple).
N'affiche aucune donnée dans les journaux (le dépôt est public) : seulement des compteurs.

Vidéos suivies :
  - toutes les vidéos publiques de la chaîne SLP ;
  - les vidéos intégrées dans les pages du site (iframes youtube.com/embed/…) ;
  - les vidéos dont le lien est dans un mail Brevo (table brevo_liens, remplie par le rapport).
Pour chacune : titre, chaîne, et compteurs du jour (vues, j'aime, commentaires) dans yt_stats.
Les vues d'un jour = différence entre deux relevés.

Secrets attendus (Settings > Secrets and variables > Actions) :
  YT_API_KEY             clé d'API Google avec « YouTube Data API v3 » activée
  CLOUDFLARE_API_TOKEN   jeton Cloudflare avec la permission « D1 : Edit » (déjà là pour Search Console)
  CLOUDFLARE_ACCOUNT_ID  identifiant du compte Cloudflare (déjà là)
"""

import datetime as dt
import glob
import os
import re
import sys
from zoneinfo import ZoneInfo

import requests

D1_DATABASE_ID = "c34e8fe6-a869-40cb-961b-778d03fca13b"
CHAINE_SLP = "UC6dZffs_G3DbbZPNEhjisLg"
API = "https://www.googleapis.com/youtube/v3/"
ID_RE = re.compile(r"youtube(?:-nocookie)?\.com/(?:embed/|watch\?v=)([A-Za-z0-9_-]{11})")


def d1(sql, params=None):
    acct = os.environ["CLOUDFLARE_ACCOUNT_ID"].strip()
    url = f"https://api.cloudflare.com/client/v4/accounts/{acct}/d1/database/{D1_DATABASE_ID}/query"
    r = requests.post(
        url,
        headers={"Authorization": f"Bearer {os.environ['CLOUDFLARE_API_TOKEN'].strip()}"},
        json={"sql": sql, "params": params or []},
        timeout=60,
    )
    data = r.json()
    if not r.ok or not data.get("success"):
        errs = "; ".join(e.get("message", "") for e in data.get("errors", []))
        raise RuntimeError(f"D1 a refusé l'écriture ({r.status_code}) : {errs}")
    return data["result"][0].get("results", [])


def upsert(table, cols, rows):
    per = max(1, 100 // len(cols))  # D1 : 100 paramètres par requête
    for i in range(0, len(rows), per):
        chunk = rows[i:i + per]
        ph = ",".join("(" + ",".join("?" * len(cols)) + ")" for _ in chunk)
        d1(f"INSERT OR REPLACE INTO {table} ({','.join(cols)}) VALUES {ph}", [v for row in chunk for v in row])


def yt(endpoint, **params):
    params["key"] = os.environ["YT_API_KEY"].strip()
    r = requests.get(API + endpoint, params=params, timeout=60)
    if r.status_code in (400, 403):
        try:
            raison = r.json()["error"]["errors"][0].get("reason", "")
        except Exception:
            raison = ""
        raise RuntimeError(f"YouTube refuse la requête ({r.status_code} {raison}) : vérifier la clé YT_API_KEY et que « YouTube Data API v3 » est activée")
    if not r.ok:
        raise RuntimeError(f"YouTube a répondu {r.status_code} sur {endpoint}")
    return r.json()


def sans_secret(msg):
    for k in ("YT_API_KEY", "CLOUDFLARE_API_TOKEN"):
        v = (os.environ.get(k) or "").strip()
        if len(v) >= 8:
            msg = msg.replace(v, "***")
    return re.sub(r"key=[^&\s]+", "key=***", msg)


def videos_de_la_chaine():
    ch = yt("channels", part="contentDetails", id=CHAINE_SLP).get("items", [])
    if not ch:
        return []
    uploads = ch[0]["contentDetails"]["relatedPlaylists"]["uploads"]
    ids, token = [], None
    while True:
        p = {"part": "contentDetails", "playlistId": uploads, "maxResults": 50}
        if token:
            p["pageToken"] = token
        page = yt("playlistItems", **p)
        ids += [it["contentDetails"]["videoId"] for it in page.get("items", [])]
        token = page.get("nextPageToken")
        if not token or len(ids) >= 500:
            return ids


def videos_du_site():
    ids = set()
    for f in glob.glob("*.html") + glob.glob("en/*.html") + glob.glob("es/*.html") + glob.glob("it/*.html"):
        try:
            ids.update(ID_RE.findall(open(f, encoding="utf-8", errors="ignore").read()))
        except OSError:
            pass
    return ids


def main():
    now = dt.datetime.now(dt.timezone.utc)
    jour = now.astimezone(ZoneInfo("Europe/Paris")).date().isoformat()

    chaine = videos_de_la_chaine()
    site = videos_du_site()
    try:
        mails = {r["video_id"] for r in d1("SELECT DISTINCT video_id FROM brevo_liens WHERE video_id IS NOT NULL")}
    except Exception:
        mails = set()
    origine = {}
    for v in chaine:
        origine.setdefault(v, []).append("chaine")
    for v in site:
        origine.setdefault(v, []).append("site")
    for v in mails:
        origine.setdefault(v, []).append("mail")
    ids = list(origine)

    vids, stats = [], []
    for i in range(0, len(ids), 50):
        for it in yt("videos", part="snippet,statistics,contentDetails", id=",".join(ids[i:i + 50]), maxResults=50).get("items", []):
            sn, st = it.get("snippet", {}), it.get("statistics", {})
            vids.append([it["id"], sn.get("title"), sn.get("channelTitle"), (sn.get("publishedAt") or "")[:10] or None,
                         it.get("contentDetails", {}).get("duration"), ",".join(origine.get(it["id"], [])), now.isoformat()])
            stats.append([it["id"], jour, int(st.get("viewCount", 0)), int(st.get("likeCount", 0)) if "likeCount" in st else None,
                          int(st.get("commentCount", 0)) if "commentCount" in st else None, now.isoformat()])
    upsert("yt_videos", ["video_id", "titre", "chaine", "publie_le", "duree", "origine", "releve_le"], vids)
    upsert("yt_stats", ["video_id", "jour", "vues", "likes", "commentaires", "releve_le"], stats)

    total = sum(s[2] for s in stats)
    bilan = f"{len(stats)} vidéos relevées (chaîne {len(chaine)}, site {len(site)}, mails {len(mails)}) · {total} vues au total"
    d1("INSERT INTO yt_releves (fait_le, ok, message) VALUES (?, 1, ?)", [now.isoformat(), bilan])
    print("Relevé terminé :", bilan)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        msg = sans_secret(str(e))[:500]
        print("Échec du relevé :", msg)
        try:
            d1("INSERT INTO yt_releves (fait_le, ok, message) VALUES (?, 0, ?)",
               [dt.datetime.now(dt.timezone.utc).isoformat(), msg])
        except Exception:
            pass
        sys.exit(1)
