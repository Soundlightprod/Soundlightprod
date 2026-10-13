"""Relevé Google Search Console -> base Cloudflare D1 (slp-db).

Lancé par .github/workflows/search-console.yml, deux fois par jour.
Lecture seule côté Google. N'affiche aucune donnée dans les journaux
(le dépôt est public) : seulement des compteurs.

Secrets attendus (Settings > Secrets and variables > Actions) :
  GSC_SA_KEY             contenu JSON de la clé du compte de service Google
  CLOUDFLARE_API_TOKEN   jeton Cloudflare avec la permission « D1 : Edit »
  CLOUDFLARE_ACCOUNT_ID  identifiant du compte Cloudflare
"""

import datetime as dt
import json
import os
import sys
import time
import urllib.parse
import xml.etree.ElementTree as ET

import requests
from google.oauth2 import service_account
from google.auth.transport.requests import AuthorizedSession

D1_DATABASE_ID = "c34e8fe6-a869-40cb-961b-778d03fca13b"
SITES = {
    "slp": {"property": "sc-domain:soundlightprod.fr", "sitemap": "https://soundlightprod.fr/sitemap.xml"},
    "bmb": {"property": "sc-domain:bookmyband.fr", "sitemap": "https://bookmyband.fr/sitemap.xml"},
    # Propriété à ajouter dans Search Console (et à partager avec le compte de service) ; tant que ce n'est pas fait, on l'ignore.
    "store": {"property": "sc-domain:soundlightprod.store", "sitemap": "https://soundlightprod.store/sitemap.xml", "optionnel": True},
}
MAX_INSPECTIONS_PAR_SITE = 300  # quota Google : 2000 par jour et par propriété


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
    # D1 accepte 100 paramètres par requête
    per = max(1, 100 // len(cols))
    for i in range(0, len(rows), per):
        chunk = rows[i:i + per]
        ph = ",".join("(" + ",".join("?" * len(cols)) + ")" for _ in chunk)
        d1(f"INSERT OR REPLACE INTO {table} ({','.join(cols)}) VALUES {ph}", [v for row in chunk for v in row])


def search_analytics(sess, prop, body):
    url = "https://searchconsole.googleapis.com/webmasters/v3/sites/" + urllib.parse.quote(prop, safe="") + "/searchAnalytics/query"
    r = sess.post(url, json=body, timeout=60)
    if r.status_code == 403:
        raise RuntimeError(f"Google refuse l'accès à {prop} : le compte de service n'est pas ajouté comme utilisateur de cette propriété dans Search Console")
    r.raise_for_status()
    return r.json().get("rows", [])


def sitemap_urls(url):
    try:
        r = requests.get(url, timeout=30, headers={"User-Agent": "slp-search-console-releve"})
        r.raise_for_status()
        root = ET.fromstring(r.content)
    except Exception:
        return []
    ns = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
    out = []
    for sm in root.findall(f"{ns}sitemap/{ns}loc"):
        out += sitemap_urls(sm.text.strip())
    out += [u.text.strip() for u in root.findall(f"{ns}url/{ns}loc")]
    return list(dict.fromkeys(out))


def main():
    now = dt.datetime.now(dt.timezone.utc)
    today = now.date()
    releve = today.isoformat()
    creds = service_account.Credentials.from_service_account_info(
        json.loads(os.environ["GSC_SA_KEY"]),
        scopes=["https://www.googleapis.com/auth/webmasters.readonly"],
    )
    sess = AuthorizedSession(creds)
    bilan = []

    for site, cfg in SITES.items():
        prop = cfg["property"]
        start = (today - dt.timedelta(days=35)).isoformat()
        end = today.isoformat()

        # 1. Courbe jour par jour (les derniers jours sont provisoires chez Google)
        try:
            rows = search_analytics(sess, prop, {"startDate": start, "endDate": end, "dimensions": ["date"], "dataState": "all", "rowLimit": 100})
        except Exception as e:
            if not cfg.get("optionnel"):
                raise
            bilan.append(f"{site}: propriété Search Console pas encore accessible ({str(e)[:60]})")
            continue
        upsert("gsc_jours", ["site", "jour", "clics", "impressions", "ctr", "position", "releve_le"],
               [[site, r["keys"][0], int(r["clicks"]), int(r["impressions"]), r["ctr"], round(r["position"], 1), now.isoformat()] for r in rows])

        # 2. Recherches des 28 derniers jours
        q_start = (today - dt.timedelta(days=28)).isoformat()
        rows = search_analytics(sess, prop, {"startDate": q_start, "endDate": end, "dimensions": ["query"], "dataState": "all", "rowLimit": 500})
        d1("DELETE FROM gsc_requetes WHERE site = ? AND releve = ?", [site, releve])
        upsert("gsc_requetes", ["site", "releve", "requete", "clics", "impressions", "ctr", "position"],
               [[site, releve, r["keys"][0], int(r["clicks"]), int(r["impressions"]), r["ctr"], round(r["position"], 1)] for r in rows])
        bilan.append(f"{site}: {len(rows)} recherches")

        # 3. Indexation page par page, une fois par jour
        deja = d1("SELECT COUNT(*) AS n FROM gsc_index WHERE site = ? AND releve = ?", [site, releve])[0]["n"]
        if deja:
            bilan.append(f"{site}: indexation déjà relevée aujourd'hui")
            continue
        urls = sitemap_urls(cfg["sitemap"])[:MAX_INSPECTIONS_PAR_SITE]
        out = []
        for u in urls:
            r = sess.post("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
                          json={"inspectionUrl": u, "siteUrl": prop, "languageCode": "fr"}, timeout=60)
            if r.status_code == 429:
                time.sleep(30)
                r = sess.post("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
                              json={"inspectionUrl": u, "siteUrl": prop, "languageCode": "fr"}, timeout=60)
            if not r.ok:
                out.append([site, releve, u, "ERREUR", f"inspection impossible ({r.status_code})", None])
                continue
            st = r.json().get("inspectionResult", {}).get("indexStatusResult", {})
            out.append([site, releve, u, st.get("verdict"), st.get("coverageState"), st.get("lastCrawlTime")])
            time.sleep(0.15)
        upsert("gsc_index", ["site", "releve", "url", "verdict", "etat", "dernier_passage"], out)
        indexees = sum(1 for o in out if o[3] == "PASS")
        bilan.append(f"{site}: {indexees}/{len(out)} pages indexées")

    d1("INSERT INTO gsc_releves (fait_le, ok, message) VALUES (?, 1, ?)", [now.isoformat(), " · ".join(bilan)])
    print("Relevé terminé :", " · ".join(bilan))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        msg = str(e)[:500]
        print("Échec du relevé :", msg)
        try:
            d1("INSERT INTO gsc_releves (fait_le, ok, message) VALUES (?, 0, ?)",
               [dt.datetime.now(dt.timezone.utc).isoformat(), msg])
        except Exception:
            pass
        sys.exit(1)
