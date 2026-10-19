// SLP — API Worker : boutique (vente, sur soundlightprod.fr) + location de matériel (sur csanimations.fr)
//                    + actualités artistes + agenda de disponibilités
// Déploiement : wrangler deploy (depuis /worker)
// Variables/secrets attendues (wrangler secret put ...) :
//   STRIPE_SECRET_KEY        clé secrète Stripe (sk_live_... ou sk_test_...)
//   STRIPE_WEBHOOK_SECRET    secret du webhook Stripe (whsec_...)
//   ADMIN_PASSWORD           mot de passe pour l'espace admin
//   SITE_ORIGIN              ex: https://soundlightprod.fr (pour les retours Stripe de la boutique)
//   ALLOWED_ORIGINS          ex: https://soundlightprod.fr,https://csanimations.fr (CORS, séparés par des virgules)
// Binding D1 attendu dans wrangler.toml : DB
//
// Colonne supplémentaire nécessaire sur la table orders (une seule fois) :
//   ALTER TABLE orders ADD COLUMN shipping_address TEXT;
//
// Tables actualites et artist_agenda déjà créées sur D1 (migration appliquée le 14/09/2026).

// Pays vers lesquels Stripe autorise la saisie d'une adresse de livraison.
// Ajoute/retire des codes ISO 2 lettres selon où tu livres.
const SHIPPING_COUNTRIES = ["FR", "BE", "CH", "LU", "MC", "DE", "ES", "IT"];

function resolveOrigin(request, env) {
  const requestOrigin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || env.SITE_ORIGIN || "").split(",").map((s) => s.trim());
  return allowed.includes(requestOrigin) ? requestOrigin : (env.SITE_ORIGIN || allowed[0] || "*");
}

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
  };
}

function json(data, status = 200, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}

async function ensureChatTables(env) {
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS chat_threads (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT UNIQUE NOT NULL, name TEXT, contact TEXT, page TEXT, lang TEXT, city TEXT, ip_hash TEXT, site TEXT, status TEXT DEFAULT 'open', unread_admin INTEGER DEFAULT 0, notified_at TEXT, created_at TEXT, last_visitor_at TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id INTEGER NOT NULL, sender TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS chat_presence (id INTEGER PRIMARY KEY, last_seen TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS push_subs (id INTEGER PRIMARY KEY AUTOINCREMENT, endpoint TEXT UNIQUE NOT NULL, p256dh TEXT, auth TEXT, created_at TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS push_vapid (id INTEGER PRIMARY KEY, pub TEXT, priv TEXT)"),
  ]);
}

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function getVapid(env) {
  let row = await env.DB.prepare("SELECT pub, priv FROM push_vapid WHERE id = 1").first();
  if (!row) {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const pub = b64u(await crypto.subtle.exportKey("raw", kp.publicKey));
    const priv = JSON.stringify(await crypto.subtle.exportKey("jwk", kp.privateKey));
    await env.DB.prepare("INSERT OR IGNORE INTO push_vapid (id, pub, priv) VALUES (1, ?, ?)").bind(pub, priv).run();
    row = await env.DB.prepare("SELECT pub, priv FROM push_vapid WHERE id = 1").first();
  }
  return row;
}
// Notification push (sans contenu) vers les appareils d'admin abonnés ; le service worker affiche le texte.
async function sendAdminPush(env) {
  const subs = (await env.DB.prepare("SELECT id, endpoint FROM push_subs").all()).results || [];
  if (!subs.length) return;
  const v = await getVapid(env);
  const key = await crypto.subtle.importKey("jwk", JSON.parse(v.priv), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const enc = new TextEncoder();
  await Promise.all(subs.map(async (sub) => {
    try {
      const aud = new URL(sub.endpoint).origin;
      const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
      const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "mailto:contact@soundlightprod.fr" })));
      const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(head + "." + claims));
      const r = await fetch(sub.endpoint, { method: "POST", headers: { Authorization: `vapid t=${head}.${claims}.${b64u(sig)}, k=${v.pub}`, TTL: "3600", Urgency: "high" } });
      if (r.status === 404 || r.status === 410) await env.DB.prepare("DELETE FROM push_subs WHERE id = ?").bind(sub.id).run();
    } catch (e) { /* push best-effort */ }
  }));
}

function requireAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace("Bearer ", "");
  return token && token === env.ADMIN_PASSWORD;
}


// --- Statistiques des comptes sociaux (SLP) : abonnés / portée / vues -----------------------
// Secrets Worker attendus pour la collecte automatique Meta (wrangler secret put ...) :
//   META_ACCESS_TOKEN  jeton longue durée de la Page Facebook SLP
//   META_PAGE_ID       identifiant de la Page Facebook
//   META_IG_ID         identifiant du compte Instagram professionnel lié
// TikTok : saisie manuelle depuis l'admin (POST /api/admin/social-stats).
async function ensureSocialTable(env) {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS social_stats (day TEXT NOT NULL, platform TEXT NOT NULL, followers INTEGER, reach INTEGER, views INTEGER, source TEXT DEFAULT 'auto', note TEXT, PRIMARY KEY (day, platform))"
  ).run();
  try { await env.DB.prepare("ALTER TABLE social_stats ADD COLUMN likes INTEGER").run(); } catch (e) { /* colonne déjà là */ }
  try { await env.DB.prepare("ALTER TABLE social_stats ADD COLUMN shares INTEGER").run(); } catch (e) { /* colonne déjà là */ }
}

async function saveSocialStat(env, day, platform, { followers = null, reach = null, views = null, likes = null, shares = null, source = "auto", note = null }) {
  await ensureSocialTable(env);
  await env.DB.prepare(
    "INSERT INTO social_stats (day, platform, followers, reach, views, likes, shares, source, note) VALUES (?,?,?,?,?,?,?,?,?) " +
    "ON CONFLICT(day, platform) DO UPDATE SET followers=COALESCE(excluded.followers, followers), reach=COALESCE(excluded.reach, reach), views=COALESCE(excluded.views, views), likes=COALESCE(excluded.likes, likes), shares=COALESCE(excluded.shares, shares), source=excluded.source, note=excluded.note"
  ).bind(day, platform, followers, reach, views, likes, shares, source, note).run();
}

async function metaGet(env, path, params = {}) {
  const qs = new URLSearchParams({ ...params, access_token: env.META_ACCESS_TOKEN });
  const r = await fetch("https://graph.facebook.com/v21.0/" + path + "?" + qs);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "Erreur API Meta");
  return j;
}

function lastInsightValue(j) {
  const v = j && j.data && j.data[0] && j.data[0].values;
  if (!v || !v.length) return null;
  return v[v.length - 1].value;
}

async function collectMetaStats(env) {
  if (!env.META_ACCESS_TOKEN) return { skipped: "META_ACCESS_TOKEN absent" };
  const day = new Date().toISOString().slice(0, 10);
  const out = {};
  if (env.META_PAGE_ID) {
    try {
      const p = await metaGet(env, env.META_PAGE_ID, { fields: "followers_count,fan_count" });
      let views = null, note = null;
      try { views = lastInsightValue(await metaGet(env, env.META_PAGE_ID + "/insights", { metric: "page_media_view", period: "day" })); }
      catch (e) { note = "vues: " + e.message; }
      await saveSocialStat(env, day, "facebook", { followers: p.followers_count ?? p.fan_count ?? null, views, note });
      out.facebook = "ok";
    } catch (e) { out.facebook = e.message; await saveSocialStat(env, day, "facebook", { note: e.message }); }
  }
  if (env.META_IG_ID) {
    try {
      const p = await metaGet(env, env.META_IG_ID, { fields: "followers_count" });
      let reach = null, views = null, note = null;
      try { reach = lastInsightValue(await metaGet(env, env.META_IG_ID + "/insights", { metric: "reach", period: "day" })); }
      catch (e) { note = "portée: " + e.message; }
      try { views = lastInsightValue(await metaGet(env, env.META_IG_ID + "/insights", { metric: "views", period: "day", metric_type: "total_value" })); }
      catch (e) { /* métrique indisponible selon le compte */ }
      await saveSocialStat(env, day, "instagram", { followers: p.followers_count ?? null, reach, views, note });
      out.instagram = "ok";
    } catch (e) { out.instagram = e.message; await saveSocialStat(env, day, "instagram", { note: e.message }); }
  }
  return out;
}

// --- Stripe REST helpers (pas de SDK, appel direct à l'API) ---
async function stripeRequest(env, path, params) {
  const body = new URLSearchParams();
  const flatten = (obj, prefix = "") => {
    for (const key in obj) {
      const val = obj[key];
      const fullKey = prefix ? `${prefix}[${key}]` : key;
      if (Array.isArray(val)) {
        val.forEach((v, i) => {
          if (typeof v === "object") flatten(v, `${fullKey}[${i}]`);
          else body.append(`${fullKey}[${i}]`, v);
        });
      } else if (typeof val === "object" && val !== null) {
        flatten(val, fullKey);
      } else {
        body.append(fullKey, val);
      }
    }
  };
  flatten(params);

  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Erreur Stripe");
  return data;
}

// Récupère une session Stripe Checkout (GET) pour lire l'adresse de livraison au moment du webhook
async function stripeGet(env, path) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Erreur Stripe");
  return data;
}

// Vérifie la signature du webhook Stripe (implémentation minimale HMAC-SHA256)
async function verifyStripeSignature(payload, sigHeader, secret) {
  const parts = Object.fromEntries(
    sigHeader.split(",").map((p) => p.split("="))
  );
  const signedPayload = `${parts.t}.${payload}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(signedPayload));
  const expected = [...new Uint8Array(sigBuf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return expected === parts.v1;
}

function formatAddress(details) {
  if (!details) return "";
  const a = details.address || {};
  const parts = [
    details.name,
    a.line1,
    a.line2,
    [a.postal_code, a.city].filter(Boolean).join(" "),
    a.state,
    a.country,
  ].filter(Boolean);
  return parts.join(", ");
}

// Étend start_date..end_date jour par jour et bloque ces dates dans artist_agenda
// pour un artiste donné. Ignore les jours déjà occupés (renvoyés dans "conflicts")
// au lieu de les écraser — c'est ce qui empêche les doublons (concert+concert,
// concert+indispo). source_actu_id (nullable) relie le blocage à l'actu qui l'a créé,
// pour pouvoir tout supprimer d'un coup. status : 'option' | 'validee'.
async function blockAgendaDates(env, artist_slug, start_date, end_date, type, label, source_actu_id, status, publish_at, expires_at) {
  const dates = [];
  let cur = new Date(start_date + "T00:00:00Z");
  const last = new Date((end_date || start_date) + "T00:00:00Z");
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  if (!dates.length) return { inserted: [], conflicts: [] };

  const placeholders = dates.map(() => "?").join(",");
  const { results: existing } = await env.DB.prepare(
    `SELECT date FROM artist_agenda WHERE artist_slug = ? AND date IN (${placeholders})`
  ).bind(artist_slug, ...dates).all();
  const existingDates = new Set(existing.map((r) => r.date));

  const toInsert = dates.filter((d) => !existingDates.has(d));
  if (toInsert.length) {
    const stmts = toInsert.map((d) =>
      env.DB.prepare(
        "INSERT INTO artist_agenda (artist_slug, date, type, label, source_actu_id, status, publish_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(artist_slug, d, type, label || null, source_actu_id || null, status || "validee", publish_at || null, expires_at || null)
    );
    await env.DB.batch(stmts);
  }

  return { inserted: toInsert, conflicts: [...existingDates] };
}

// Colonnes de la feuille de route, dans l'ordre — utilisées pour construire les
// requêtes SQL et pour sérialiser/désérialiser les deux champs JSON (timing_steps,
// comfort_flags) de façon centralisée.
const ROADMAP_COLUMNS = [
  "venue_name", "venue_address", "venue_postal_code", "venue_city",
  "event_time", "show_type", "arrival_time", "duration", "timing_steps",
  "technical_notes", "tech_artist_needs", "tech_contact_name", "tech_contact_phone",
  "comfort_flags", "meal_details", "meal_count",
  "hotel_details", "hotel_rooms", "hotel_breakfast",
  "transport_details", "venue_contact_name", "venue_contact_phone",
  "slp_contact_name", "slp_contact_phone", "additional_notes",
];

function roadmapValuesFromBody(body) {
  return ROADMAP_COLUMNS.map((col) => {
    const val = body[col];
    if (col === "timing_steps" || col === "comfort_flags") {
      return val ? JSON.stringify(val) : null;
    }
    if (col === "hotel_breakfast") {
      return val ? 1 : 0;
    }
    return val || null;
  });
}

// Calcule la date de départ (format identique à visited_at) pour un filtre de période,
// ou null pour "tout" (aucun filtre). 'today' = depuis minuit UTC aujourd'hui.
// Suivi des lectures YouTube : ajoute /yt-track.js en bas de chaque page HTML du site (pas l'admin).
// Le script ne fait rien s'il n'y a pas de vidéo YouTube dans la page.
function withVideoTracking(resp, url) {
  const ct = resp.headers.get("Content-Type") || "";
  if (!ct.includes("text/html") || /^\/(admin|mon-agenda)/.test(url.pathname)) return resp;
  return new HTMLRewriter().on("body", {
    element(el) { el.append('<script src="/yt-track.js" defer></script><script src="/chat.js" defer></script>', { html: true }); },
  }).transform(resp);
}

function domainFromRequest(request) { try { const o = request.headers.get("Origin") || request.headers.get("Referer") || ""; return o ? new URL(o).hostname.toLowerCase().replace(/^www\./, "").slice(0, 60) : null; } catch (e) { return null; } }
function langFromReferer(request) { try { const m = new URL(request.headers.get("Referer") || "").pathname.match(/^\/(en|es|it)(\/|$)/); return m ? m[1] : "fr"; } catch (e) { return "fr"; } }
function siteFromRequest(request, body) { const o = (request.headers.get("Origin") || request.headers.get("Referer") || "").toLowerCase(); if (o.includes("soundlightprod.store")) return "store"; if (o.includes("bookmyband")) return "bmb"; if (o.includes("csanimations")) return "csa"; if (o.includes("soundlightprod")) return "slp"; return ["slp", "bmb", "csa", "store"].includes(body && body.site) ? body.site : "slp"; } // Profil anonyme d'une visite : réseau (opérateur / organisation), appareil, provenance, robot ou non.
const HOSTING_RE = /amazon|aws|google|microsoft|azure|apple|meta platforms|facebook|digitalocean|ovh|hetzner|linode|akamai connected|oracle|alibaba|tencent|huawei cloud|contabo|scaleway|online s\.a\.s|vultr|choopa|leaseweb|m247|datacamp|hostinger|godaddy|cogent|hurricane electric|zscaler|censys|shodan|clouvider|g-core|gcore|constant company|psychz|colocrossing|servers\.com|hostroyale|packethub|tzulo|internet utilities|chiron|elisteka|wookra|palo alto/i;
const BOT_UA_RE = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|embedly|whatsapp|python|curl|wget|httpclient|go-http|axios|node-fetch|phantom|puppeteer|playwright|selenium/i;
function visitProfile(request, body, cf) {
  const ua = request.headers.get("User-Agent") || "";
  const network = cf.asOrganization || null;
  const device = /iPad|Tablet/i.test(ua) ? "Tablette" : /Mobi|Android|iPhone/i.test(ua) ? "Mobile" : "Ordinateur";
  let referrer = null;
  try { if (body && body.ref) { const h = new URL(body.ref).hostname.replace(/^www\./, ""); if (h && !/soundlightprod|bookmyband|csanimations/.test(h)) referrer = h; } } catch (e) {}
  const isBot = BOT_UA_RE.test(ua) || (network && HOSTING_RE.test(network)) ? 1 : 0;
  return { network, device, referrer, isBot };
}

function siteWhere(url) { const p = ["NOT (COALESCE(city,'') = 'Pessac' AND COALESCE(network,'') LIKE '%Free SAS%' AND COALESCE(device,'') = 'Ordinateur')"]; const s = url.searchParams.get("site"); if (["slp", "bmb", "csa", "store"].includes(s)) p.push("site = '" + s + "'"); const re = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/; const f = url.searchParams.get("from"), t = url.searchParams.get("to"); if (f && re.test(f)) p.push("visited_at >= '" + f + " 00:00:00'"); if (t && re.test(t)) p.push("visited_at <= '" + t + " 23:59:59'"); if (url.searchParams.get("bots") === "0") p.push("is_bot = 0"); return p.length ? p.join(" AND ") : "1=1"; } 
function periodCutoff(period) {
  const now = new Date();
  if (period === "today") {
    return now.toISOString().slice(0, 10) + " 00:00:00";
  }
  if (period === "week") {
    const d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 19).replace("T", " ");
  }
  if (period === "month") {
    const d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 19).replace("T", " ");
  }
  return null;
}

const FR_SITE = "https://soundlightprod.fr";
const INTL_SITE = "https://soundlightprod.com";
const INTL_LANGS = ["en", "es", "it"];

// Boutique sur soundlightprod.store
//   "off"   : le .store renvoie vers la boutique du .fr (état historique)
//   "serve" : le .store sert la boutique, non indexée (robots.txt interdit tout) ; le .fr ne change pas
//   "main"  : le .store est le domaine principal de la boutique ; /boutique et /produits/* du .fr redirigent (301) vers lui
const STORE_MODE = "main";
const STORE_SITE = "https://soundlightprod.store";
// Pages HTML servies sur le .store (le reste du site redirige vers le .fr)
const STORE_PAGES = /^\/(boutique|boutique-merci|cgv-boutique|mentions-legales)(\.html)?$/;

function redirect(to, status = 301) {
  return new Response(null, { status, headers: { Location: to, "Cache-Control": status === 302 ? "no-store" : "public, max-age=3600" } });
}

// Renvoie une redirection si la requête n'est pas sur le bon domaine pour sa langue, sinon null.
function routeDomain(request, url) {
  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  const isApi = path.startsWith("/api/");

  // .store (et www.) → boutique
  if (host.endsWith("soundlightprod.store")) {
    if (STORE_MODE === "off") return redirect(`${FR_SITE}/boutique.html`);
    if (host.startsWith("www.")) return redirect(`${STORE_SITE}${path}${url.search}`);
    if (isApi || path.startsWith("/admin")) return isApi ? null : redirect(`${FR_SITE}${path}${url.search}`);
    if (path === "/robots.txt") {
      const body = STORE_MODE === "main"
        ? `User-agent: *\nAllow: /\n\nSitemap: ${STORE_SITE}/sitemap.xml\n`
        : "User-agent: *\nDisallow: /\n";
      return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    if (path === "/" || path === "/sitemap.xml") return null; // réécrits vers boutique / sitemap-store.xml dans fetch
    // /boutique et /boutique.html → racine (même contenu, une seule adresse)
    if (/^\/boutique(\.html)?$/.test(path)) return redirect(`${STORE_SITE}/${url.search}`);
    if (path.startsWith("/produits/") && path.endsWith(".html")) return redirect(`${STORE_SITE}${path.replace(/\.html$/, "")}${url.search}`);
    if (path.startsWith("/produits/") || STORE_PAGES.test(path)) return null;
    // Fichiers statiques (images, css, js, polices, xml…) : servis tels quels
    if (/\.[a-z0-9]{2,5}$/i.test(path) && !path.endsWith(".html")) return null;
    // Toute autre page du site (accueil, artistes, contact…) → .fr
    return redirect(`${FR_SITE}${path.replace(/\.html$/, "")}${url.search}`);
  }

  // Boutique déplacée sur le .store : /boutique et fiches produit du .fr → .store
  if (STORE_MODE === "main" && host.endsWith("soundlightprod.fr") && !isApi) {
    if (/^\/boutique(\.html)?$/.test(path)) return redirect(`${STORE_SITE}/${url.search}`);
    if (path.startsWith("/produits/")) return redirect(`${STORE_SITE}${path.replace(/\.html$/, "")}${url.search}`);
  }

  // Ancienne fiche DJ provisoire remplacée par la fiche DJ Animation
  if (path.endsWith("/dj-provisoire.html") || path.endsWith("/dj-provisoire")) {
    return redirect(`${url.origin}${path.replace(/dj-provisoire(\.html)?$/, "dj-animation")}`);
  }

  // Ancienne page « Notre philosophie de travail » fusionnée dans l'accueil
  const philo = path.match(/^(\/(?:en|es|it))?\/diffusion(\.html)?$/);
  if (philo) return redirect(`${url.origin}${philo[1] || ""}/`);

  // Anciennes adresses de fiches (nom de groupe retiré des URL)
  const RENAMED = { "the-best-abba-tribute": "tribute-abba", "calo-2-0": "tribute-calogero" };
  const renamedMatch = path.match(/^(.*\/)(the-best-abba-tribute|calo-2-0)(\.html)?$/);
  if (renamedMatch) {
    return redirect(`${url.origin}${renamedMatch[1]}${RENAMED[renamedMatch[2]]}${url.search}`);
  }

  const isCom = host.endsWith("soundlightprod.com");
  const langPrefix = INTL_LANGS.find((l) => path === `/${l}` || path.startsWith(`/${l}/`));

  if (isCom) {
    if (host.startsWith("www.")) return redirect(`${INTL_SITE}${path}${url.search}`);
    if (isApi) return null;
    if (path === "/robots.txt") {
      return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${INTL_SITE}/sitemap-intl.xml\n`, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    if (path === "/sitemap.xml") return redirect(`${INTL_SITE}/sitemap-intl.xml`);
    // Racine : choix de la langue selon le navigateur (FR → .fr, ES → /es/, IT → /it/, sinon /en/)
    if (path === "/" || path === "") {
      const al = (request.headers.get("Accept-Language") || "").toLowerCase();
      const first = al.split(",")[0].trim().slice(0, 2);
      if (first === "fr") return redirect(`${FR_SITE}/`, 302);
      return redirect(`${INTL_SITE}/${["es", "it"].includes(first) ? first : "en"}/`, 302);
    }
    if (langPrefix) return null;
    // Pages françaises (et pages non traduites : boutique, admin…) → .fr
    if (path.endsWith(".html")) return redirect(`${FR_SITE}${path.replace(/\.html$/, "")}${url.search}`);
    // Pages françaises sans extension (adresses « propres ») → .fr
    if (!/\.[a-z0-9]{2,5}$/i.test(path)) return redirect(`${FR_SITE}${path}${url.search}`);
    return null; // images, PDF, etc. servis tels quels
  }

  // Sur le .fr : les pages traduites vivent sur le .com
  if (langPrefix && host.endsWith("soundlightprod.fr")) {
    return redirect(`${INTL_SITE}${path}${url.search}`);
  }
  return null;
}


// Accès admin : mot de passe du site, ou à défaut vérification auprès de l'API admin (slp-api)
async function isAdminForMeteo(request, env) {
  if (requireAdmin(request, env)) return true;
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ") || auth.length < 9) return false;
  try {
    const r = await fetch("https://slp-api.raspy-silence-d4c7.workers.dev/api/admin/products", { headers: { Authorization: auth } });
    return r.ok;
  } catch (e) {
    return false;
  }
}

// Heure de Paris pour SQLite (heure d'été jusqu'au 25/10/2026, d'hiver ensuite ; à revoir le 28/03/2027)
const PARIS_OFFSET = (col) => `CASE WHEN ${col} >= '2026-10-25 01:00:00' AND ${col} < '2027-03-28 01:00:00' THEN '+1 hours' WHEN ${col} >= '2027-10-31 01:00:00' THEN '+1 hours' ELSE '+2 hours' END`;

// Tests de Nj : son PC (Free SAS, Pessac, ordinateur) ; tout le reste est un vrai visiteur
const NOT_TEST = "NOT (COALESCE(city,'') = 'Pessac' AND COALESCE(network,'') LIKE '%Free SAS%' AND COALESCE(device,'') = 'Ordinateur')";
const MAIL_REF = "(referrer LIKE 'emailing-sendinblue%' OR referrer LIKE '%sendibm%' OR referrer LIKE '%em.soundlightprod%')";

async function meteoData(env) {
  const q = async (sql, ...params) => (await env.DB.prepare(sql).bind(...params).all()).results || [];
  const safe = async (sql) => { try { return await q(sql); } catch (e) { return []; } };
  const today = `date(datetime('now', ${PARIS_OFFSET("datetime('now')")}))`;
  const [rapport, sites, googleJours, googleReleve, requetes, index, brevo, mails, prospects, liens, ytReleve, ytVideos, ytStats, contactClics, contactPages, contactDemandes, videoSite] = await Promise.all([
    q("SELECT cree_le, moment, titre, resume_json, actions_json, texte FROM rapports ORDER BY id DESC LIMIT 1"),
    q(`WITH t AS (SELECT ${today} AS today), s(site, nom) AS (VALUES ('slp','SLP Sound Light Prod'),('bmb','Book My Band'),('csa','CS Animations'),('store','Boutique .store')),
       v AS (SELECT site, session_id, date(visited_at, ${PARIS_OFFSET("visited_at")}) AS jour, ${NOT_TEST} AS vrai FROM page_visits WHERE is_bot = 0 AND visited_at >= datetime('now', '-16 days'))
       SELECT s.site, s.nom,
         COUNT(DISTINCT CASE WHEN v.vrai AND v.jour = t.today THEN v.session_id END) AS aujourdhui,
         SUM(CASE WHEN v.vrai AND v.jour = t.today THEN 1 ELSE 0 END) AS pages_aujourdhui,
         COUNT(DISTINCT CASE WHEN v.vrai AND v.jour = date(t.today, '-1 day') THEN v.session_id END) AS hier,
         SUM(CASE WHEN v.vrai AND v.jour = date(t.today, '-1 day') THEN 1 ELSE 0 END) AS pages_hier,
         COUNT(DISTINCT CASE WHEN v.vrai AND v.jour = date(t.today, '-2 day') THEN v.session_id END) AS avant_hier,
         COUNT(DISTINCT CASE WHEN v.vrai AND v.jour BETWEEN date(t.today, '-7 day') AND date(t.today, '-1 day') THEN v.session_id END) AS sept_jours,
         COUNT(DISTINCT CASE WHEN v.vrai AND v.jour BETWEEN date(t.today, '-14 day') AND date(t.today, '-8 day') THEN v.session_id END) AS sept_jours_avant,
         COUNT(DISTINCT CASE WHEN NOT v.vrai AND v.jour >= date(t.today, '-1 day') THEN v.session_id END) AS tests
       FROM s CROSS JOIN t LEFT JOIN v ON v.site = s.site GROUP BY s.site, s.nom, t.today`),
    q("SELECT site, jour, clics, impressions, position FROM gsc_jours WHERE jour >= date('now', '-30 days') ORDER BY jour, site"),
    q("SELECT fait_le, ok, message FROM gsc_releves ORDER BY id DESC LIMIT 1"),
    q(`WITH last AS (SELECT site, MAX(releve) AS r FROM gsc_requetes GROUP BY site),
       prev AS (SELECT q.site, MAX(q.releve) AS r FROM gsc_requetes q JOIN last l ON l.site = q.site AND q.releve < l.r GROUP BY q.site)
       SELECT q.site, q.requete, q.clics, q.impressions, q.position,
         (SELECT p2.impressions FROM gsc_requetes p2 JOIN prev p ON p.site = p2.site AND p2.releve = p.r WHERE p2.site = q.site AND p2.requete = q.requete) AS impressions_avant,
         (SELECT p2.position FROM gsc_requetes p2 JOIN prev p ON p.site = p2.site AND p2.releve = p.r WHERE p2.site = q.site AND p2.requete = q.requete) AS position_avant
       FROM gsc_requetes q JOIN last l ON l.site = q.site AND q.releve = l.r ORDER BY q.impressions DESC LIMIT 60`),
    q(`SELECT site, releve, COUNT(*) AS total, SUM(verdict = 'PASS') AS indexees,
         SUM(etat LIKE '%tectée%' OR etat LIKE '%iscovered%' OR etat LIKE '%xplorée%' OR etat LIKE '%rawled%') AS detectees,
         SUM(etat LIKE '%ouble%' OR etat LIKE '%uplicate%') AS doublons,
         SUM(etat LIKE '%edirect%') AS redirections,
         SUM(etat LIKE '%ne reconnaît pas%' OR etat LIKE '%unknown%') AS inconnues
       FROM gsc_index GROUP BY site, releve ORDER BY releve`),
    q("SELECT * FROM brevo_campagnes WHERE envoyes > 0 ORDER BY date_envoi DESC, id DESC LIMIT 6"),
    q(`SELECT date(visited_at, ${PARIS_OFFSET("visited_at")}) AS jour, COUNT(DISTINCT session_id) AS visiteurs FROM page_visits
       WHERE is_bot = 0 AND ${MAIL_REF} AND ${NOT_TEST} AND visited_at >= datetime('now', '-14 days') GROUP BY jour ORDER BY jour`),
    // Visiteurs à suivre : hier et aujourd'hui, au moins 3 pages vues (tous sites confondus)
    q(`WITH t AS (SELECT ${today} AS today),
       v AS (SELECT session_id, site, artist_slug, visited_at, city, region, country, network, device, referrer, lang, domaine, date(visited_at, ${PARIS_OFFSET("visited_at")}) AS jour
             FROM page_visits WHERE is_bot = 0 AND ${NOT_TEST} AND visited_at >= datetime('now', '-3 days') ORDER BY visited_at)
       -- ville, réseau, appareil et provenance = ceux de la première page vue (colonnes « nues » de SQLite liées au MIN)
       SELECT session_id, MIN(visited_at) AS debut, GROUP_CONCAT(DISTINCT site) AS sites, city AS ville, region,
         network AS reseau, device AS appareil, referrer AS provenance, GROUP_CONCAT(DISTINCT lang) AS langues, GROUP_CONCAT(DISTINCT domaine) AS domaines, country AS pays, COUNT(*) AS pages, GROUP_CONCAT(artist_slug, ' › ') AS parcours
       FROM v, t WHERE v.jour >= date(t.today, '-1 day') GROUP BY session_id HAVING COUNT(*) >= 3 ORDER BY pages DESC, debut DESC LIMIT 12`),
    safe("SELECT campagne_id, url, type, video_id, clics FROM brevo_liens WHERE clics > 0 ORDER BY campagne_id, clics DESC"),
    safe("SELECT fait_le, ok, message FROM yt_releves ORDER BY fait_le DESC LIMIT 1"),
    safe("SELECT video_id, titre, origine FROM yt_videos"),
    safe("SELECT video_id, jour, vues FROM yt_stats WHERE jour >= date('now', '-9 days') ORDER BY jour"),
    safe(`SELECT action, COUNT(DISTINCT COALESCE(session_id, id)) AS n, SUM(cree_le >= datetime('now', '-1 day')) AS n24 FROM contact_events
       WHERE is_bot = 0 AND ${NOT_TEST} AND cree_le >= datetime('now', '-7 days') GROUP BY action`),
    safe(`SELECT page, COUNT(DISTINCT COALESCE(session_id, id)) AS n FROM contact_events
       WHERE is_bot = 0 AND ${NOT_TEST} AND cree_le >= datetime('now', '-7 days') AND action IN ('devis', 'appel', 'whatsapp', 'mail', 'envoi') GROUP BY page ORDER BY n DESC LIMIT 8`),
    safe("SELECT id, cree_le, nom, email, telephone, sujet, date_event, lieu, message, page_origine, city, device, mail_envoye, mail_erreur FROM contact_requests ORDER BY id DESC LIMIT 10"),
    safe(`SELECT video_id, page, COUNT(DISTINCT CASE WHEN event = 'play' THEN session_id END) AS lectures,
         COUNT(DISTINCT CASE WHEN event IN ('75', 'fin') THEN session_id END) AS jusqu_au_bout
       FROM video_events WHERE is_bot = 0 AND ${NOT_TEST} AND created_at >= datetime('now', '-7 days') GROUP BY video_id, page ORDER BY lectures DESC`),
  ]);
  return { rapport: rapport[0] || null, sites, prospects, contact: { clics: contactClics, pages: contactPages, demandes: contactDemandes }, google: { releve: googleReleve[0] || null, jours: googleJours, requetes, index }, brevo, liens, mails,
    youtube: { releve: ytReleve[0] || null, videos: ytVideos, stats: ytStats, site: videoSite } };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ============ DOMAINES & LANGUES ============
    // soundlightprod.fr    : site français (racine)
    // soundlightprod.com   : versions anglaise (/en/), espagnole (/es/) et italienne (/it/) uniquement
    // soundlightprod.store : boutique (voir STORE_MODE)
    // Validation Google Search Console (fichiers de vérification, servis tels quels sur .fr et .com)
    if (/^\/google[0-9a-f]{16}\.html$/.test(url.pathname)) {
      return new Response(`google-site-verification: ${url.pathname.slice(1)}`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    const domainRedirect = routeDomain(request, url);
    if (domainRedirect) return domainRedirect;

    // .store : la racine affiche la boutique, /sitemap.xml sert le sitemap de la boutique
    if (STORE_MODE !== "off" && url.hostname.toLowerCase().endsWith("soundlightprod.store") && request.method === "GET") {
      const rewrite = url.pathname === "/" ? "/boutique" : url.pathname === "/sitemap.xml" ? "/sitemap-store.xml" : null;
      if (rewrite) return env.ASSETS.fetch(new Request(new URL(rewrite + url.search, url.origin), request));
    }

    const origin = resolveOrigin(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors(origin) });
    }

    try {
      // ============ BOUTIQUE (VENTE) ============

      // GET /api/products — catalogue public
      if (url.pathname === "/api/products" && request.method === "GET") {
        const { results } = await env.DB.prepare(
          "SELECT id, slug, name, category, description, price_cents, image, stock_qty FROM products WHERE active = 1 ORDER BY category, name"
        ).all();
        return json(results, 200, origin);
      }

      // POST /api/admin/send-roadmap-email — { to, subject, pdf_base64, filename } : envoie la
      // feuille de route en pièce jointe PDF via Resend.
      if (url.pathname === "/api/admin/send-roadmap-email" && request.method === "POST") {
        if (!requireAdmin(request, env)) return json({ error: "Non autorisé" }, 401, origin);
        const { to, subject, pdf_base64, filename } = await request.json();
        if (!to || !pdf_base64) return json({ error: "Destinataire et PDF requis" }, 400, origin);

        // Compatible avec les deux façons de configurer ce secret : "Secrets Store" (objet avec
        // une méthode .get()) ou un secret classique "wrangler secret put" (chaîne directe).
        const resendKey = typeof env.RESEND_API_KEY?.get === "function"
          ? await env.RESEND_API_KEY.get()
          : env.RESEND_API_KEY;
        const resendRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "SLP Sound Light Prod <contact@soundlightprod.fr>",
            to: [to],
            subject: subject || "Feuille de route",
            html: "<p>Bonjour,</p><p>Veuillez trouver ci-joint la feuille de route.</p><p>Cordialement,<br>SLP — Sound Light Prod</p>",
            attachments: [{ filename: filename || "feuille-de-route.pdf", content: pdf_base64 }],
          }),
        });

        if (!resendRes.ok) {
          const errText = await resendRes.text();
          return json({ error: `Échec de l'envoi (${resendRes.status}) : ${errText}` }, 502, origin);
        }
        return json({ ok: true }, 200, origin);
      }

      // GET /api/admin/products — tous les produits (actifs ou non) avec stock, pour le récap admin
      if (url.pathname === "/api/admin/products" && request.method === "GET") {
        if (!requireAdmin(request, env)) return json({ error: "Non autorisé" }, 401, origin);
        const { results } = await env.DB.prepare(
          "SELECT id, slug, name, category, price_cents, stock_qty, active FROM products ORDER BY category, name"
        ).all();
        return json(results, 200, origin);
      }

      // POST /api/admin/products/:id/stock — { stock_qty, active } : mise à jour rapide depuis le récap
      const productStockMatch = url.pathname.match(/^\/api\/admin\/products\/(\d+)\/stock$/);
      if (productStockMatch && request.method === "POST") {
        if (!requireAdmin(request, env)) return json({ error: "Non autorisé" }, 401, origin);
        const { stock_qty, active } = await request.json();
        await env.DB.prepare("UPDATE products SET stock_qty = ?, active = ? WHERE id = ?")
          .bind(Math.max(0, parseInt(stock_qty) || 0), active ? 1 : 0, productStockMatch[1]).run();
        return json({ ok: true }, 200, origin);
      }

      // POST /api/checkout — crée une session Stripe Checkout pour le panier
      if (url.pathname === "/api/checkout" && request.method === "POST") {
        const { items, customer_email, customer_name, customer_phone } = await request.json();
        if (!items || !items.length) return json({ error: "Panier vide" }, 400, origin);

        const ids = items.map((i) => i.product_id);
        const placeholders = ids.map(() => "?").join(",");
        const { results: dbProducts } = await env.DB.prepare(
          `SELECT * FROM products WHERE id IN (${placeholders}) AND active = 1`
        ).bind(...ids).all();

        const line_items = [];
        const orderItems = [];
        let total_cents = 0;
        for (const cartItem of items) {
          const p = dbProducts.find((d) => d.id === cartItem.product_id);
          if (!p) continue;
          const qty = Math.max(1, parseInt(cartItem.qty) || 1);
          // Le stock n'empêche jamais la commande : certains articles (jets de scène, consommables)
          // restent commandables même à 0 en stock, en réappro rapide.
          line_items.push({
            price_data: {
              currency: "eur",
              product_data: { name: p.name },
              unit_amount: p.price_cents,
            },
            quantity: qty,
          });
          orderItems.push({ product_id: p.id, name: p.name, qty, price_cents: p.price_cents });
          total_cents += p.price_cents * qty;
        }
        if (!line_items.length) return json({ error: "Aucun article valide" }, 400, origin);

        // Retour de paiement : sur le domaine d'où vient le client (.fr ou .store), sinon SITE_ORIGIN
        const reqOrigin = request.headers.get("Origin") || "";
        const returnBase = /^https:\/\/(www\.)?soundlightprod\.(fr|store)$/.test(reqOrigin) ? reqOrigin.replace("://www.", "://") : env.SITE_ORIGIN;
        const session = await stripeRequest(env, "checkout/sessions", {
          mode: "payment",
          payment_method_types: ["card"],
          line_items,
          customer_email,
          shipping_address_collection: { allowed_countries: SHIPPING_COUNTRIES },
          success_url: `${returnBase}/boutique-merci.html?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${returnBase}/boutique.html`,
        });

        await env.DB.prepare(
          `INSERT INTO orders (stripe_session_id, customer_name, customer_email, customer_phone, items_json, total_cents, status)
           VALUES (?, ?, ?, ?, ?, ?, 'pending')`
        ).bind(session.id, customer_name || "", customer_email, customer_phone || "", JSON.stringify(orderItems), total_cents).run();

        return json({ url: session.url }, 200, origin);
      }

      // POST /api/webhook/stripe — confirmation de paiement
      if (url.pathname === "/api/webhook/stripe" && request.method === "POST") {
        const payload = await request.text();
        const sig = request.headers.get("Stripe-Signature") || "";
        const valid = await verifyStripeSignature(payload, sig, env.STRIPE_WEBHOOK_SECRET);
        if (!valid) return json({ error: "Signature invalide" }, 400, origin);

        const event = JSON.parse(payload);
        if (event.type === "checkout.session.completed") {
          const session = event.data.object;
          const order = await env.DB.prepare("SELECT * FROM orders WHERE stripe_session_id = ?")
            .bind(session.id).first();
          if (order && order.status !== "paid") {
            // Récupère l'adresse de livraison saisie sur la page Stripe
            let shippingAddress = formatAddress(session.shipping_details || session.customer_details);
            if (!shippingAddress) {
              try {
                const full = await stripeGet(env, `checkout/sessions/${session.id}`);
                shippingAddress = formatAddress(full.shipping_details || full.customer_details);
              } catch (e) { /* pas bloquant si ça échoue */ }
            }

            await env.DB.prepare(
              "UPDATE orders SET status = 'paid', paid_at = datetime('now'), shipping_address = ? WHERE id = ?"
            ).bind(shippingAddress || "", order.id).run();

            const items = JSON.parse(order.items_json);
            for (const it of items) {
              await env.DB.prepare(
                "UPDATE products SET stock_qty = MAX(0, stock_qty - ?) WHERE id = ?"
              ).bind(it.qty, it.product_id).run();
            }
          }
        }
        return json({ received: true }, 200, origin);
      }

      // ============ LOCATION ============

      // GET /api/rental-items — catalogue public
      if (url.pathname === "/api/rental-items" && request.method === "GET") {
        const { results } = await env.DB.prepare(
          "SELECT id, slug, name, category, description, daily_rate_cents, deposit_cents, image, qty_available FROM rental_items WHERE active = 1 ORDER BY category, name"
        ).all();
        return json(results, 200, origin);
      }

      // GET /api/availability?item_id=&start=&end= — quantité dispo sur la période
      if (url.pathname === "/api/availability" && request.method === "GET") {
        const item_id = url.searchParams.get("item_id");
        const start = url.searchParams.get("start");
        const end = url.searchParams.get("end");
        const item = await env.DB.prepare("SELECT * FROM rental_items WHERE id = ?").bind(item_id).first();
        if (!item) return json({ error: "Article inconnu" }, 404, origin);

        const { results: overlapping } = await env.DB.prepare(
          `SELECT qty FROM reservations
           WHERE item_id = ? AND status = 'confirmed'
           AND start_date <= ? AND end_date >= ?`
        ).bind(item_id, end, start).all();

        const reserved = overlapping.reduce((sum, r) => sum + r.qty, 0);
        const available = Math.max(0, item.qty_available - reserved);
        return json({ available, total: item.qty_available }, 200, origin);
      }

      // POST /api/reservations — demande de pré-réservation (statut pending)
      if (url.pathname === "/api/reservations" && request.method === "POST") {
        const { item_id, qty, start_date, end_date, customer_name, customer_email, customer_phone, notes } = await request.json();
        if (!item_id || !start_date || !end_date || !customer_name || !customer_email) {
          return json({ error: "Champs manquants" }, 400, origin);
        }
        const item = await env.DB.prepare("SELECT * FROM rental_items WHERE id = ? AND active = 1").bind(item_id).first();
        if (!item) return json({ error: "Article inconnu" }, 404, origin);

        const reqQty = Math.max(1, parseInt(qty) || 1);
        const { results: overlapping } = await env.DB.prepare(
          `SELECT qty FROM reservations WHERE item_id = ? AND status = 'confirmed' AND start_date <= ? AND end_date >= ?`
        ).bind(item_id, end_date, start_date).all();
        const reserved = overlapping.reduce((sum, r) => sum + r.qty, 0);
        const available = item.qty_available - reserved;
        if (reqQty > available) {
          return json({ error: `Seulement ${Math.max(0, available)} disponible(s) sur cette période` }, 409, origin);
        }

        const result = await env.DB.prepare(
          `INSERT INTO reservations (item_id, qty, customer_name, customer_email, customer_phone, start_date, end_date, notes, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
        ).bind(item_id, reqQty, customer_name, customer_email, customer_phone || "", start_date, end_date, notes || "").run();

        return json({ ok: true, reservation_id: result.meta.last_row_id }, 200, origin);
      }

      // ============ ÉVÉNEMENTS ARTISTES (actualités + agenda unifiés) ============
      // Un "événement" a un type : 'concert' | 'indisponible' | 'actu'.
      // - concert : crée une actu PUBLIQUE (visible sur la fiche artiste + l'agenda public)
      //             ET bloque automatiquement le(s) jour(s) dans artist_agenda.
      // - indisponible : bloque seulement le(s) jour(s) dans artist_agenda, jamais public.
      // - actu : actu libre (ex: sortie d'album), sans blocage de date.
      // artist_agenda garde la contrainte UNIQUE(artist_slug, date) : impossible de
      // bloquer deux fois la même date pour le même artiste (concert+concert,
      // concert+indispo, ou doublon).

      // GET /api/actualites?artist=<slug> — actus publiques et actives pour une fiche artiste (public)
      // Un concert dont une date est encore en statut "option" n'est jamais public :
      // seules les dates VALIDÉES apparaissent sur le site (fiche artiste + agenda public).
      if (url.pathname === "/api/actualites" && request.method === "GET") {
        const artist = url.searchParams.get("artist");
        if (!artist || artist === "presta-technique") return json([], 200, origin);
        const today = new Date().toISOString().slice(0, 10);
        const { results } = await env.DB.prepare(
          `SELECT id, artist_slug, type, text, photo_url, requalified, publish_at, event_date, event_end_date, expires_at, created_at,
                  event_time, venue_name, venue_city
           FROM actualites
           WHERE artist_slug = ? AND is_public = 1
           AND (publish_at IS NULL OR publish_at = '' OR publish_at <= ?)
           AND expires_at >= ?
           AND id NOT IN (SELECT DISTINCT source_actu_id FROM artist_agenda WHERE source_actu_id IS NOT NULL AND status = 'option')
           ORDER BY COALESCE(event_date, created_at) ASC
           LIMIT 5`
        ).bind(artist, today, today).all();
        return json(results, 200, origin);
      }

      // GET /api/agenda-public — tous les concerts publics ET VALIDÉS à venir, tous artistes (pour la page Agenda du site)
      // Les prestations techniques (artist_slug 'presta-technique') ne sont JAMAIS publiques, même
      // si "Visible au public" a été coché par erreur : c'est une catégorie interne, sans fiche.
      if (url.pathname === "/api/agenda-public" && request.method === "GET") {
        const today = new Date().toISOString().slice(0, 10);
        const { results } = await env.DB.prepare(
          `SELECT id, artist_slug, guest_name, type, text, photo_url, event_date, event_end_date, event_time, venue_name, venue_city
           FROM actualites
           WHERE type IN ('concert', 'cabaret', 'dj', 'animation', 'karaoke') AND is_public = 1
           AND artist_slug != 'presta-technique'
           AND (publish_at IS NULL OR publish_at = '' OR publish_at <= ?)
           AND event_date >= ?
           AND id NOT IN (SELECT DISTINCT source_actu_id FROM artist_agenda WHERE source_actu_id IS NOT NULL AND status = 'option')
           ORDER BY event_date ASC`
        ).bind(today, today).all();
        return json(results, 200, origin);
      }

      // GET /api/admin/actualites — toutes les actus, tous artistes (admin)
      if (url.pathname === "/api/admin/actualites" && request.method === "GET") {
        if (!requireAdmin(request, env)) return json({ error: "Non autorisé" }, 401, origin);
        const { results } = await env.DB.prepare(
          `SELECT id, artist_slug, guest_name, type, text, photo_url, is_public, requalified, publish_at, event_date, event_end_date, expires_at, created_at,
                  ${ROADMAP_COLUMNS.join(", ")}
           FROM actualites ORDER BY created_at DESC`
        ).all();
        return json(results, 200, origin);
      }

      // POST /api/admin/actualites — point d'entrée unique pour créer un événement.
      // Body : { artist_slug, type, text, photo_url, is_public, requalified, start_date, end_date,
      //          publish_at, expires_at, label, ...champs de feuille de route (ROADMAP_COLUMNS) }
      // timing_steps et comfort_flags sont des tableaux JS, sérialisés en JSON en base.
      // - type 'actu'         : insère uniquement dans actualites (start_date -> event_date, optionnel).
      // - type 'concert'      : insère dans actualites (publique) PUIS bloque start_date..end_date
      //                          dans artist_agenda (lié via source_actu_id). Les champs de feuille
      //                          de route sont optionnels et consultables/imprimables par le groupe
      //                          depuis son agenda, et par l'admin depuis son tableau.
      //                          requalified=1 signale un concert né de la requalification d'une
      //                          indisponibilité — affiché d'une couleur différente côté groupe.
      // - type 'indisponible' : bloque start_date..end_date dans artist_agenda seulement,
      //                          rien dans actualites (jamais publique).
      if (url.pathname === "/api/admin/actualites" && request.method === "POST") {
        if (!requireAdmin(request, env)) return json({ error: "Non autorisé" }, 401, origin);
        const body = await request.json();
        const { artist_slug, guest_name, type, text, photo_url, publish_at, expires_at, label, status } = body;
        const is_public = body.is_public === false || body.is_public === 0 ? 0 : 1;
        const requalified = body.requalified ? 1 : 0;
        const start_date = body.start_date || null;
        const end_date = body.end_date || start_date;
        const roadmap = roadmapValuesFromBody(body);

        {
          const problems = [];
          if (!artist_slug) problems.push("l'artiste n'est pas choisi");
          if (!type) problems.push("le type d'événement n'est pas choisi");
          else if (!["concert", "cabaret", "dj", "animation", "karaoke", "indisponible", "actu"].includes(type)) problems.push(`le type « ${type} » n'est pas reconnu`);
          if (problems.length) return json({ error: "Enregistrement impossible : " + problems.join(" ; ") + "." }, 400, origin);
        }

        // --- Cas "indisponible" : blocage pur, pas d'actu ---
        if (type === "indisponible") {
          if (!start_date) return json({ error: "Date de début requise" }, 400, origin);
          const { inserted, conflicts } = await blockAgendaDates(env, artist_slug, start_date, end_date, "indisponible", label || text || null, null, status, publish_at, expires_at);
          return json({ ok: true, inserted, conflicts }, 201, origin);
        }

        // --- Cas "actu" : pas de blocage d'agenda, pas de feuille de route ---
        if (type === "actu") {
          if (!text || !expires_at) return json({ error: "Texte et date de suppression requis" }, 400, origin);
          const result = await env.DB.prepare(
            `INSERT INTO actualites (artist_slug, guest_name, type, text, photo_url, is_public, publish_at, event_date, event_end_date, expires_at)
             VALUES (?, ?, 'actu', ?, ?, ?, ?, ?, ?, ?)`
          ).bind(artist_slug, guest_name || null, text, photo_url || null, is_public, publish_at || null, start_date, end_date, expires_at).run();
          return json({ ok: true, actu_id: result.meta.last_row_id }, 201, origin);
        }

        // --- Cas "concert" / "cabaret" / "dj" : actu publique + feuille de route + blocage
        // automatique de l'agenda. Les trois se comportent exactement pareil, seul le type
        // enregistré change (utilisé pour l'icône et la catégorie sur les calendriers).
        // Un artiste sans fiche sur le site (invité) utilise un artist_slug dédié (ex: invite-xxx)
        // et guest_name pour l'affichage : is_public reste pertinent pour l'agenda public, mais
        // comme aucune fiche ne l'interroge, il n'apparaît jamais dans un "Quoi de neuf".
        if (!text || !expires_at) return json({ error: "Texte et date de suppression requis" }, 400, origin);
        if (!start_date) return json({ error: "Date de l'événement requise" }, 400, origin);

        const result = await env.DB.prepare(
          `INSERT INTO actualites (artist_slug, guest_name, type, text, photo_url, is_public, requalified, publish_at, event_date, event_end_date, expires_at,
                                    ${ROADMAP_COLUMNS.join(", ")})
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${ROADMAP_COLUMNS.map(() => "?").join(", ")})`
        ).bind(artist_slug, guest_name || null, type, text, photo_url || null, is_public, requalified, publish_at || null, start_date, end_date, expires_at, ...roadmap).run();
        const actuId = result.meta.last_row_id;

        const { inserted, conflicts } = await blockAgendaDates(env, artist_slug, start_date, end_date, type, text, actuId, status, publish_at, expires_at);
        return json({ ok: true, actu_id: actuId, inserted, conflicts }, 201, origin);
      }

      // PUT /api/admin/actualites/:id — modifie une actu/concert existante.
      // Même body que le POST. Si le type est/devient 'concert', les jours bloqués
      // liés (source_actu_id) sont supprimés puis recréés avec les nouvelles dates
      // (les conflits éventuels avec d'autres événements sont renvoyés, pas écrasés).
      // Si le type devient 'actu', les jours liés sont simplement libérés.
      const actuUpdateMatch = url.pathname.match(/^\/api\/admin\/actualites\/(\d+)$/);
      if (actuUpdateMatch && request.method === "PUT") {
        if (!requireAdmin(request, env)) return json({ error: "Non autorisé" }, 401, origin);
        const id = actuUpdateMatch[1];
        const existingActu = await env.DB.prepare("SELECT * FROM actualites WHERE id = ?").bind(id).first();
        if (!existingActu) return json({ error: "Actu introuvable" }, 404, origin);

        const body = await request.json();
        const { artist_slug, guest_name, type, text, photo_url, publish_at, expires_at, status } = body;
        const is_public = body.is_public === false || body.is_public === 0 ? 0 : 1;
        const start_date = body.start_date || null;
        const end_date = body.end_date || start_date;
        {
          const problems = [];
          if (!artist_slug) problems.push("l'artiste n'est pas choisi");
          if (!type) problems.push("le type d'événement n'est pas choisi");
          else if (!["concert", "cabaret", "dj", "animation", "karaoke", "actu"].includes(type)) problems.push(`le type « ${type} » ne peut pas être appliqué à une modification (une indisponibilité ne se modifie pas ici)`);
          if (!text) problems.push("le texte est vide");
          if (!expires_at) problems.push("la date de suppression est vide");
          if (problems.length) return json({ error: "Modification impossible : " + problems.join(" ; ") + "." }, 400, origin);
        }

        await env.DB.prepare(
          `UPDATE actualites SET artist_slug=?, guest_name=?, type=?, text=?, photo_url=?, is_public=?, publish_at=?, event_date=?, event_end_date=?, expires_at=?,
                  ${ROADMAP_COLUMNS.map((c) => c + "=?").join(", ")}
           WHERE id=?`
        ).bind(
          artist_slug, guest_name || null, type, text, photo_url || null, is_public, publish_at || null, start_date, end_date, expires_at,
          ...roadmapValuesFromBody(body),
          id
        ).run();
        // requalified n'est jamais modifiable depuis le formulaire d'édition — il est fixé
        // une fois pour toutes à la création, la ligne SET ci-dessus le laisse donc inchangé.

        // Libère les jours précédemment bloqués par cette actu, puis rebloque si concert/cabaret/dj
        await env.DB.prepare("DELETE FROM artist_agenda WHERE source_actu_id = ?").bind(id).run();
        let conflicts = [];
        if (["concert", "cabaret", "dj", "animation", "karaoke"].includes(type)) {
          if (!start_date) return json({ error: "Date de l'événement requise" }, 400, origin);
          const result = await blockAgendaDates(env, artist_slug, start_date, end_date, type, text, id, status, publish_at, expires_at);
          conflicts = result.conflicts;
        }

        return json({ ok: true, conflicts }, 200, origin);
      }

      // POST /api/admin/actualites/:id/visibility — { is_public: 0|1 } : masquer/afficher au public
      const actuVisibilityMatch = url.pathname.match(/^\/api\/admin\/actualites\/(\d+)\/visibility$/);
      if (actuVisibilityMatch && request.method === "POST") {
        if (!requireAdmin(request, env)) return json({ error: "Non autorisé" }, 401, origin);
        const { is_public } = await request.json();
        await env.DB.prepare("UPDATE actualites SET is_public = ? WHERE id = ?")
          .bind(is_public ? 1 : 0, actuVisibilityMatch[1]).run();
        return json({ ok: true }, 200, origin);
      }

      // DELETE /api/admin/actualites/:id — supprime l'actu ET les jours d'agenda qu'elle avait bloqués
      const actuDeleteMatch = url.pathname.match(/^\/api\/admin\/actualites\/(\d+)$/);
      if (actuDeleteMatch && request.method === "DELETE") {
        if (!requireAdmin(request, env)) return json({ error: "Non autorisé" }, 401, origin);
        await env.DB.prepare("DELETE FROM artist_agenda WHERE source_actu_id = ?").bind(actuDeleteMatch[1]).run();
        await env.DB.prepare("DELETE FROM actualites WHERE id = ?").bind(actuDeleteMatch[1]).run();
        return json({ ok: true }, 200, origin);
      }

      // ============ AGENDA / DISPONIBILITÉS (lecture + blocage manuel) ============

      // GET /api/admin/agenda — toutes les dates bloquées, tous artistes
      if (url.pathname === "/api/admin/agenda" && request.method === "GET") {
        if (!requireAdmin(request, env)) return json({ error: "Non autorisé" }, 401, origin);
        const { results } = await env.DB.prepare(
          `SELECT a.id, a.artist_slug, a.date, a.type, a.label, a.status, a.publish_at, a.expires_at, a.source_actu_id, a.created_at,
                  u.guest_name, u.venue_name, u.venue_city, u.requalified
           FROM artist_agenda a
           LEFT JOIN actualites u ON u.id = a.source_actu_id
           ORDER BY a.date ASC`
        ).all();
        return json(results, 200, origin);
      }

      // POST /api/admin/agenda/:id/status — { status: 'option'|'validee' } : bascule le statut d'une date
      const agendaStatusMatch = url.pathname.match(/^\/api\/admin\/agenda\/(\d+)\/status$/);
      if (agendaStatusMatch && request.method === "POST") {
        if (!requireAdmin(request, env)) return json({ error: "Non autorisé" }, 401, origin);
        const { status } = await request.json();
        if (!["option", "validee"].includes(status)) return json({ error: "Statut invalide" }, 400, origin);
        await env.DB.prepare("UPDATE artist_agenda SET status = ? WHERE id = ?").bind(status, agendaStatusMatch[1]).run();
        return json({ ok: true }, 200, origin);
      }

      // PUT /api/admin/agenda/:id — modifie une indisponibilité seule (jamais une date
      // liée à un concert : celles-ci se modifient depuis l'actu correspondante).
      const agendaUpdateMatch = url.pathname.match(/^\/api\/admin\/agenda\/(\d+)$/);
      if (agendaUpdateMatch && request.method === "PUT") {
        if (!requireAdmin(request, env)) return json({ error: "Non autorisé" }, 401, origin);
        const id = agendaUpdateMatch[1];
        const row = await env.DB.prepare("SELECT * FROM artist_agenda WHERE id = ?").bind(id).first();
        if (!row) return json({ error: "Entrée introuvable" }, 404, origin);
        if (row.source_actu_id) {
          return json({ error: "Cette date provient d'un concert : modifie-la depuis l'actu correspondante." }, 400, origin);
        }
        const { date, label, publish_at, expires_at, status } = await request.json();
        if (!date) return json({ error: "Date requise" }, 400, origin);

        if (date !== row.date) {
          const conflict = await env.DB.prepare(
            "SELECT id FROM artist_agenda WHERE artist_slug = ? AND date = ? AND id != ?"
          ).bind(row.artist_slug, date, id).first();
          if (conflict) return json({ error: `La date ${date} est déjà occupée pour cet artiste.` }, 409, origin);
        }

        await env.DB.prepare(
          "UPDATE artist_agenda SET date=?, label=?, publish_at=?, expires_at=?, status=? WHERE id=?"
        ).bind(date, label || null, publish_at || null, expires_at || null, status || row.status || "validee", id).run();
        return json({ ok: true }, 200, origin);
      }

      // DELETE /api/admin/agenda/:id
      const agendaDeleteMatch = url.pathname.match(/^\/api\/admin\/agenda\/(\d+)$/);
      if (agendaDeleteMatch && request.method === "DELETE") {
        if (!requireAdmin(request, env)) return json({ error: "Non autorisé" }, 401, origin);
        await env.DB.prepare("DELETE FROM artist_agenda WHERE id = ?").bind(agendaDeleteMatch[1]).run();
        return json({ ok: true }, 200, origin);
      }

      // ============ ACCÈS GROUPES (lien à jeton, sans mot de passe admin) ============
      // Chaque artiste a un jeton unique (table artist_tokens) qui lui donne :
      // - lecture seule de tout son agenda (concerts + indispos)
      // - le droit d'ajouter SES PROPRES indisponibilités (jamais de concert,
      //   jamais sur un autre artiste)
      // - le droit de supprimer une indispo qu'il a lui-même ajoutée (jamais un concert)
      // - la consultation/impression de la feuille de route d'UN de ses concerts

      async function resolveArtistToken(env, token) {
        if (!token) return null;
        const row = await env.DB.prepare("SELECT artist_slug FROM artist_tokens WHERE token = ?").bind(token).first();
        return row ? row.artist_slug : null;
      }

      // POST /api/band-agenda/login — { artist_slug, password } : vérifie le mot de passe du groupe
      // et renvoie son jeton de session (utilisé ensuite pour GET/POST/DELETE band-agenda).
      if (url.pathname === "/api/band-agenda/login" && request.method === "POST") {
        const { artist_slug, password } = await request.json();
        if (!artist_slug || !password) return json({ error: "Champs manquants" }, 400, origin);
        const row = await env.DB.prepare("SELECT token, password FROM artist_tokens WHERE artist_slug = ?").bind(artist_slug).first();
        if (!row || !row.password || row.password !== password) {
          return json({ error: "Mot de passe incorrect" }, 401, origin);
        }
        return json({ token: row.token }, 200, origin);
      }

      // GET /api/band-agenda?token=XXX — lecture seule de l'agenda de l'artiste
      if (url.pathname === "/api/band-agenda" && request.method === "GET") {
        const artist_slug = await resolveArtistToken(env, url.searchParams.get("token"));
        if (!artist_slug) return json({ error: "Lien invalide" }, 401, origin);
        const { results } = await env.DB.prepare(
          `SELECT a.id, a.date, a.type, a.label, a.status, a.source_actu_id, u.venue_name, u.venue_city, u.requalified
           FROM artist_agenda a
           LEFT JOIN actualites u ON u.id = a.source_actu_id
           WHERE a.artist_slug = ?
           ORDER BY a.date ASC`
        ).bind(artist_slug).all();
        return json({ artist_slug, entries: results }, 200, origin);
      }

      // GET /api/band-agenda/roadmap?token=XXX&actu_id=YYY — feuille de route d'un concert,
      // consultable/imprimable par le groupe concerné uniquement (jamais un autre artiste).
      if (url.pathname === "/api/band-agenda/roadmap" && request.method === "GET") {
        const artist_slug = await resolveArtistToken(env, url.searchParams.get("token"));
        if (!artist_slug) return json({ error: "Lien invalide" }, 401, origin);
        const actuId = url.searchParams.get("actu_id");
        const actu = await env.DB.prepare(
          `SELECT artist_slug, guest_name, text, event_date, event_end_date, ${ROADMAP_COLUMNS.join(", ")}
           FROM actualites WHERE id = ? AND type IN ('concert', 'cabaret', 'dj', 'animation', 'karaoke')`
        ).bind(actuId).first();
        if (!actu || actu.artist_slug !== artist_slug) return json({ error: "Introuvable" }, 404, origin);
        return json(actu, 200, origin);
      }

      // POST /api/band-agenda — { token, start_date, end_date, label } : ajoute une indispo
      if (url.pathname === "/api/band-agenda" && request.method === "POST") {
        const body = await request.json();
        const artist_slug = await resolveArtistToken(env, body.token);
        if (!artist_slug) return json({ error: "Lien invalide" }, 401, origin);
        if (!body.start_date) return json({ error: "Date de début requise" }, 400, origin);
        const { inserted, conflicts } = await blockAgendaDates(
          env, artist_slug, body.start_date, body.end_date || body.start_date, "indisponible", body.label || null, null
        );
        return json({ ok: true, inserted, conflicts }, 201, origin);
      }

      // DELETE /api/band-agenda/:id?token=XXX — supprime UNE indispo qui appartient bien à cet artiste
      const bandAgendaDeleteMatch = url.pathname.match(/^\/api\/band-agenda\/(\d+)$/);
      if (bandAgendaDeleteMatch && request.method === "DELETE") {
        const artist_slug = await resolveArtistToken(env, url.searchParams.get("token"));
        if (!artist_slug) return json({ error: "Lien invalide" }, 401, origin);
        const row = await env.DB.prepare("SELECT * FROM artist_agenda WHERE id = ?").bind(bandAgendaDeleteMatch[1]).first();
        if (!row || row.artist_slug !== artist_slug) return json({ error: "Introuvable" }, 404, origin);
        if (row.type !== "indisponible") return json({ error: "Seule une indisponibilité peut être supprimée ici." }, 400, origin);
        await env.DB.prepare("DELETE FROM artist_agenda WHERE id = ?").bind(bandAgendaDeleteMatch[1]).run();
        return json({ ok: true }, 200, origin);
      }

      // ============ VISITES DES FICHES ARTISTES ============
      // Localisation approximative fournie automatiquement par Cloudflare (request.cf) —
      // pas d'IP stockée, pas de cookie, juste ville/région/pays + date. Jamais exposé
      // aux groupes eux-mêmes, uniquement consultable par l'admin.

      // POST /api/track-video — { video_id, event, session_id, page, ref } : lecture d'une vidéo YouTube
      // intégrée au site (public, envoyé par /yt-track.js). event : play | 25 | 50 | 75 | fin.
      // Même profil anonyme que les visites (pas d'IP), même session_id pour relier au parcours.
      if (url.pathname === "/api/track-video" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const videoId = String(body.video_id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20);
        const ev = ["play", "25", "50", "75", "fin"].includes(body.event) ? body.event : null;
        if (!videoId || !ev) return json({ ok: false }, 200, origin);
        const site = siteFromRequest(request, body); const vp = visitProfile(request, body, request.cf || {}); const cf = request.cf || {};
        await env.DB.prepare(
          "INSERT INTO video_events (site, page, video_id, event, session_id, is_bot, city, network, device, referrer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(site, String(body.page || "").slice(0, 120) || null, videoId, ev, String(body.session_id || "").slice(0, 40) || null, vp.isBot, cf.city || null, vp.network, vp.device, vp.referrer).run();
        return json({ ok: true }, 200, origin);
      }

      // ============ CHAT EN DIRECT (visiteur <-> Nj) ============
      // Public : POST /api/chat/send, GET /api/chat/poll ; Admin : /api/admin/chat/*
      if (url.pathname.startsWith("/api/chat/") || url.pathname.startsWith("/api/admin/chat/")) {
        await ensureChatTables(env);
        const t = (v, n) => String(v || "").trim().slice(0, n);
        const now = () => new Date().toISOString().slice(0, 19).replace("T", " ");

        // POST /api/chat/send — { token?, body, name?, contact?, page, lang, site_web } : message du visiteur
        if (url.pathname === "/api/chat/send" && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          if (t(body.site_web, 50)) return json({ ok: true, token: "x" }, 200, origin); // champ piège (robots)
          const text = t(body.body, 1000);
          if (!text) return json({ ok: false, error: "Message vide." }, 400, origin);
          const cf = request.cf || {};
          let th = null, token = t(body.token, 64);
          if (token) th = await env.DB.prepare("SELECT * FROM chat_threads WHERE token = ?").bind(token).first();
          if (!th) {
            const ipRaw = request.headers.get("CF-Connecting-IP") || "";
            const ipHash = ipRaw ? [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ipRaw + "slp")))].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("") : null;
            if (ipHash) {
              const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM chat_threads WHERE ip_hash = ? AND created_at >= datetime('now', '-1 hour')").bind(ipHash).first();
              if (r && r.n >= 6) return json({ ok: false, error: "Trop de conversations d'un coup : appelez-nous au 06 31 94 96 53." }, 429, origin);
            }
            token = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
            await env.DB.prepare("INSERT INTO chat_threads (token, name, contact, page, lang, city, ip_hash, site, created_at, last_visitor_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
              .bind(token, t(body.name, 80) || null, t(body.contact, 120) || null, t(body.page, 200) || null, t(body.lang, 4) || "fr", cf.city || null, ipHash, siteFromRequest(request, body), now(), now()).run();
            th = await env.DB.prepare("SELECT * FROM chat_threads WHERE token = ?").bind(token).first();
          } else {
            const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE thread_id = ? AND sender = 'visitor' AND created_at >= datetime('now', '-10 minutes')").bind(th.id).first();
            if (r && r.n >= 20) return json({ ok: false, error: "Un peu de calme 🙂 réessayez dans quelques minutes." }, 429, origin);
          }
          if (th.status === "closed") await env.DB.prepare("UPDATE chat_threads SET status = 'open' WHERE id = ?").bind(th.id).run();
          const nm = t(body.name, 80), ct = t(body.contact, 120);
          if (nm || ct) await env.DB.prepare("UPDATE chat_threads SET name = COALESCE(?, name), contact = COALESCE(?, contact) WHERE id = ?").bind(nm || null, ct || null, th.id).run();
          const ins = await env.DB.prepare("INSERT INTO chat_messages (thread_id, sender, body, created_at) VALUES (?, 'visitor', ?, ?)").bind(th.id, text, now()).run();
          await env.DB.prepare("UPDATE chat_threads SET last_visitor_at = ?, unread_admin = unread_admin + 1 WHERE id = ?").bind(now(), th.id).run();
          try { await sendAdminPush(env); } catch (e) {}
          // Mail de notification : au plus un toutes les 10 min par conversation (ou tout de suite si le visiteur laisse ses coordonnées)
          const fresh = await env.DB.prepare("SELECT * FROM chat_threads WHERE id = ?").bind(th.id).first();
          const lastN = fresh.notified_at ? Date.parse(fresh.notified_at.replace(" ", "T") + "Z") : 0;
          if (Date.now() - lastN > 10 * 60 * 1000 || ct) {
            try {
              const resendKey = typeof env.RESEND_API_KEY?.get === "function" ? await env.RESEND_API_KEY.get() : env.RESEND_API_KEY;
              if (resendKey) {
                const esc = (x) => String(x || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
                const who = fresh.name || "Un visiteur";
                await fetch("https://api.resend.com/emails", {
                  method: "POST", headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
                  body: JSON.stringify({
                    from: "Chat SLP <contact@soundlightprod.fr>", to: ["contact@soundlightprod.fr"],
                    subject: `💬 Chat SLP : ${who} — ${text.slice(0, 60)}`,
                    html: `<p><b>${esc(who)}</b> vous écrit sur le site${fresh.city ? ` (${esc(fresh.city)})` : ""}${fresh.page ? `, page « ${esc(fresh.page)} »` : ""}.</p><p style="white-space:pre-wrap;border-left:3px solid #ffb238;padding-left:10px">${esc(text)}</p>${fresh.contact ? `<p>Coordonnées laissées : <b>${esc(fresh.contact)}</b></p>` : ""}<p><a href="https://soundlightprod.fr/admin.html#chat">Répondre dans l'admin → onglet Chat</a></p>`,
                  }),
                });
                await env.DB.prepare("UPDATE chat_threads SET notified_at = ? WHERE id = ?").bind(now(), th.id).run();
              }
            } catch (e) { /* la conversation est enregistrée quoi qu'il arrive */ }
          }
          return json({ ok: true, token, id: ins.meta && ins.meta.last_row_id }, 200, origin);
        }

        // GET /api/chat/poll?token=&after= — nouveaux messages (de Nj) + présence
        if (url.pathname === "/api/chat/poll" && request.method === "GET") {
          const th = await env.DB.prepare("SELECT * FROM chat_threads WHERE token = ?").bind(t(url.searchParams.get("token"), 64)).first();
          if (!th) return json({ ok: false, gone: true }, 200, origin);
          const after = parseInt(url.searchParams.get("after") || "0", 10) || 0;
          const rows = await env.DB.prepare("SELECT id, sender, body, created_at FROM chat_messages WHERE thread_id = ? AND id > ? AND sender = 'admin' ORDER BY id LIMIT 50").bind(th.id, after).all();
          const pres = await env.DB.prepare("SELECT last_seen FROM chat_presence WHERE id = 1").first();
          const online = !!(pres && Date.now() - Date.parse(pres.last_seen.replace(" ", "T") + "Z") < 3 * 60 * 1000);
          return json({ ok: true, messages: rows.results || [], online, closed: th.status === "closed" }, 200, origin);
        }

        // ----- Admin -----
        if (url.pathname.startsWith("/api/admin/chat/")) {
          if (!(await isAdminForMeteo(request, env))) return json({ error: "Non autorisé" }, 401, origin);
          // Notifications push : clé publique + abonnement de cet appareil
          if (url.pathname === "/api/admin/chat/push-key" && request.method === "GET") {
            const v = await getVapid(env); return json({ ok: true, key: v.pub }, 200, origin);
          }
          if (url.pathname === "/api/admin/chat/push-subscribe" && request.method === "POST") {
            const body = await request.json().catch(() => ({}));
            const sub = body.subscription || {};
            if (!sub.endpoint || !/^https:\/\//.test(sub.endpoint)) return json({ error: "Abonnement invalide" }, 400, origin);
            await env.DB.prepare("INSERT INTO push_subs (endpoint, p256dh, auth, created_at) VALUES (?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth")
              .bind(sub.endpoint, t(sub.keys && sub.keys.p256dh, 200) || null, t(sub.keys && sub.keys.auth, 100) || null, now()).run();
            return json({ ok: true }, 200, origin);
          }
          if (url.pathname === "/api/admin/chat/push-test" && request.method === "POST") {
            await sendAdminPush(env); return json({ ok: true }, 200, origin);
          }
          // GET /api/admin/chat/threads — liste (et marque Nj « en ligne »)
          if (url.pathname === "/api/admin/chat/threads" && request.method === "GET") {
            await env.DB.prepare("INSERT INTO chat_presence (id, last_seen) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen").bind(now()).run();
            const rows = await env.DB.prepare(
              "SELECT t.id, t.name, t.contact, t.page, t.lang, t.city, t.status, t.unread_admin, t.created_at, t.last_visitor_at, " +
              "(SELECT body FROM chat_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_body, " +
              "(SELECT sender FROM chat_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_sender " +
              "FROM chat_threads t ORDER BY t.unread_admin > 0 DESC, t.last_visitor_at DESC LIMIT 100"
            ).all();
            return json({ ok: true, threads: rows.results || [] }, 200, origin);
          }
          // GET /api/admin/chat/thread?id= — messages d'une conversation (marque comme lue)
          if (url.pathname === "/api/admin/chat/thread" && request.method === "GET") {
            const id = parseInt(url.searchParams.get("id") || "0", 10);
            const th = await env.DB.prepare("SELECT id, name, contact, page, lang, city, status, created_at FROM chat_threads WHERE id = ?").bind(id).first();
            if (!th) return json({ error: "Conversation introuvable" }, 404, origin);
            await env.DB.prepare("UPDATE chat_threads SET unread_admin = 0 WHERE id = ?").bind(id).run();
            await env.DB.prepare("INSERT INTO chat_presence (id, last_seen) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen").bind(now()).run();
            const rows = await env.DB.prepare("SELECT id, sender, body, created_at FROM chat_messages WHERE thread_id = ? ORDER BY id").bind(id).all();
            return json({ ok: true, thread: th, messages: rows.results || [] }, 200, origin);
          }
          // POST /api/admin/chat/reply — { id, body }
          if (url.pathname === "/api/admin/chat/reply" && request.method === "POST") {
            const body = await request.json().catch(() => ({}));
            const id = parseInt(body.id || 0, 10), text = t(body.body, 2000);
            if (!id || !text) return json({ error: "Message vide" }, 400, origin);
            const th = await env.DB.prepare("SELECT id FROM chat_threads WHERE id = ?").bind(id).first();
            if (!th) return json({ error: "Conversation introuvable" }, 404, origin);
            await env.DB.prepare("INSERT INTO chat_messages (thread_id, sender, body, created_at) VALUES (?, 'admin', ?, ?)").bind(id, text, now()).run();
            await env.DB.prepare("UPDATE chat_threads SET status = 'open', unread_admin = 0 WHERE id = ?").bind(id).run();
            await env.DB.prepare("INSERT INTO chat_presence (id, last_seen) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen").bind(now()).run();
            return json({ ok: true }, 200, origin);
          }
          // POST /api/admin/chat/close — { id } ; DELETE via { id, delete: true }
          if (url.pathname === "/api/admin/chat/close" && request.method === "POST") {
            const body = await request.json().catch(() => ({}));
            const id = parseInt(body.id || 0, 10);
            if (!id) return json({ error: "id manquant" }, 400, origin);
            if (body.delete) { await env.DB.prepare("DELETE FROM chat_messages WHERE thread_id = ?").bind(id).run(); await env.DB.prepare("DELETE FROM chat_threads WHERE id = ?").bind(id).run(); }
            else await env.DB.prepare("UPDATE chat_threads SET status = 'closed' WHERE id = ?").bind(id).run();
            return json({ ok: true }, 200, origin);
          }
        }
      }

      // POST /api/contact — formulaire de contact : enregistré dans D1 (jamais perdu) puis envoyé par mail via Resend
      if (url.pathname === "/api/contact" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const t = (v, n) => String(v || "").trim().slice(0, n);
        if (t(body.site_web, 200)) return json({ ok: true }, 200, origin); // champ piège : rempli seulement par les robots
        const d = { nom: t(body.nom, 120), email: t(body.email, 160), telephone: t(body.telephone, 40), sujet: t(body.sujet, 120),
          date_event: t(body.date_event, 80), lieu: t(body.lieu, 120), message: t(body.message, 4000), page: t(body.page, 200), sid: t(body.session_id, 60) };
        if (!d.nom || (!d.email && !d.telephone)) return json({ ok: false, error: "Indiquez votre nom et un email ou un téléphone." }, 400, origin);
        if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) return json({ ok: false, error: "L'adresse email semble incomplète." }, 400, origin);
        const cf = request.cf || {}; const vp = visitProfile(request, body, cf); const site = siteFromRequest(request, body);
        const ipRaw = request.headers.get("CF-Connecting-IP") || "";
        const ipHash = ipRaw ? [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ipRaw + "slp")))].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("") : null;
        if (ipHash) {
          const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM contact_requests WHERE ip_hash = ? AND cree_le >= datetime('now', '-1 hour')").bind(ipHash).first();
          if (r && r.n >= 5) return json({ ok: false, error: "Trop d'envois d'un coup : appelez-nous au 06 31 94 96 53." }, 429, origin);
        }
        const ins = await env.DB.prepare(
          "INSERT INTO contact_requests (site, nom, email, telephone, sujet, date_event, lieu, message, page_origine, session_id, city, network, device, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(site, d.nom, d.email || null, d.telephone || null, d.sujet || null, d.date_event || null, d.lieu || null, d.message || null, d.page || null, d.sid || null, cf.city || null, vp.network, vp.device, ipHash).run();
        const id = ins.meta && ins.meta.last_row_id;
        const esc = (x) => String(x || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
        const ligne = (k, v) => v ? `<tr><td style="padding:4px 12px 4px 0;color:#666">${k}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>` : "";
        let mailOk = 0, mailErr = null;
        try {
          const resendKey = typeof env.RESEND_API_KEY?.get === "function" ? await env.RESEND_API_KEY.get() : env.RESEND_API_KEY;
          if (!resendKey) throw new Error("clé Resend absente");
          const r = await fetch("https://api.resend.com/emails", {
            method: "POST", headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: "Site SLP <contact@soundlightprod.fr>", to: ["contact@soundlightprod.fr"], ...(d.email ? { reply_to: d.email } : {}),
              subject: `Nouvelle demande : ${d.sujet || "Contact"} — ${d.nom}`,
              html: `<p>Nouvelle demande reçue depuis le site (n°${id}).</p><table>${ligne("Nom", d.nom)}${ligne("Téléphone", d.telephone)}${ligne("Email", d.email)}${ligne("Sujet", d.sujet)}${ligne("Date", d.date_event)}${ligne("Lieu", d.lieu)}${ligne("Venu de", d.page)}${ligne("Ville (approx.)", cf.city)}</table><p style="white-space:pre-wrap;border-left:3px solid #ffb238;padding-left:10px">${esc(d.message)}</p><p style="color:#666">Répondre à ce mail écrit directement au client${d.email ? "" : " (pas d'email : rappelez-le au téléphone)"}.</p>`,
            }),
          });
          if (r.ok) mailOk = 1; else mailErr = `${r.status} ${(await r.text()).slice(0, 200)}`;
        } catch (e) { mailErr = String(e.message || e).slice(0, 200); }
        await env.DB.prepare("UPDATE contact_requests SET mail_envoye = ?, mail_erreur = ? WHERE id = ?").bind(mailOk, mailErr, id).run();
        await env.DB.prepare("INSERT INTO contact_events (site, action, page, session_id, city, network, device, is_bot) VALUES (?, 'envoi', ?, ?, ?, ?, ?, ?)")
          .bind(site, d.page || null, d.sid || null, cf.city || null, vp.network, vp.device, vp.isBot).run();
        return json({ ok: true }, 200, origin);
      }

      // POST /api/contact-event — { action: appel|whatsapp|mail|formulaire|devis, page, session_id } : clics vers le contact
      if (url.pathname === "/api/contact-event" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const action = ["appel", "whatsapp", "mail", "formulaire", "devis"].includes(body.action) ? body.action : null;
        if (!action) return json({ ok: false }, 200, origin);
        const cf = request.cf || {}; const vp = visitProfile(request, body, cf);
        await env.DB.prepare("INSERT INTO contact_events (site, action, page, session_id, city, network, device, is_bot) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(siteFromRequest(request, body), action, String(body.page || "").slice(0, 200) || null, String(body.session_id || "").slice(0, 60) || null, cf.city || null, vp.network, vp.device, vp.isBot).run();
        return json({ ok: true }, 200, origin);
      }

      // POST /api/agenda-visit — { artist_slug, action, session_id } : usage des agendas de groupes (compté à part des visites du site)
      if (url.pathname === "/api/agenda-visit" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const action = ["ouverture", "connexion", "ajout", "suppression", "feuille"].includes(body.action) ? body.action : null;
        const slug = String(body.artist_slug || "").slice(0, 80);
        if (!action || !slug) return json({ ok: false }, 200, origin);
        const known = await env.DB.prepare("SELECT 1 AS ok FROM artist_tokens WHERE artist_slug = ?").bind(slug).first();
        if (!known) return json({ ok: false }, 200, origin);
        const cf = request.cf || {}; const vp = visitProfile(request, body, cf);
        await env.DB.prepare("INSERT INTO agenda_visits (artist_slug, action, session_id, city, country, network, device, is_bot) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(slug, action, String(body.session_id || "").slice(0, 60) || null, cf.city || null, cf.country || null, vp.network, vp.device, vp.isBot).run();
        return json({ ok: true }, 200, origin);
      }

      // GET /api/admin/agenda-usage — utilisation des agendas par groupe (admin)
      if (url.pathname === "/api/admin/agenda-usage" && request.method === "GET") {
        if (!(await isAdminForMeteo(request, env))) return json({ error: "Non autorisé" }, 401, origin);
        const { results } = await env.DB.prepare(
          `SELECT t.artist_slug AS groupe,
             COUNT(DISTINCT CASE WHEN a.action = 'ouverture' AND a.visited_at >= datetime('now', '-7 days') THEN a.session_id END) AS ouvertures_7j,
             COUNT(DISTINCT CASE WHEN a.action = 'ouverture' AND a.visited_at >= datetime('now', '-30 days') THEN a.session_id END) AS ouvertures_30j,
             COUNT(DISTINCT CASE WHEN a.action = 'ouverture' THEN a.session_id END) AS ouvertures_total,
             SUM(CASE WHEN a.action = 'connexion' AND a.visited_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS connexions_30j,
             SUM(CASE WHEN a.action = 'ajout' AND a.visited_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS ajouts_30j,
             SUM(CASE WHEN a.action = 'feuille' AND a.visited_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS feuilles_30j,
             MAX(a.visited_at) AS derniere
           FROM artist_tokens t LEFT JOIN agenda_visits a ON a.artist_slug = t.artist_slug AND a.is_bot = 0
             AND NOT (COALESCE(a.city,'') = 'Pessac' AND COALESCE(a.network,'') LIKE '%Free SAS%' AND COALESCE(a.device,'') = 'Ordinateur')
           GROUP BY t.artist_slug ORDER BY ouvertures_30j DESC, derniere DESC`
        ).all();
        const one = url.searchParams.get("artist");
        let evenements = [];
        if (one) {
          evenements = (await env.DB.prepare(
            `SELECT action, visited_at, city, country, device, network, session_id FROM agenda_visits
             WHERE artist_slug = ? AND is_bot = 0
             AND NOT (COALESCE(city,'') = 'Pessac' AND COALESCE(network,'') LIKE '%Free SAS%' AND COALESCE(device,'') = 'Ordinateur')
             ORDER BY visited_at DESC LIMIT 100`
          ).bind(one).all()).results;
        }
        return json({ groupes: results, evenements }, 200, origin);
      }

      // POST /api/track-visit — { artist_slug, session_id } : enregistre une visite (public, appelé
      // depuis chaque page). session_id (généré côté navigateur, une fois par onglet/session) permet
      // de reconstituer le parcours d'un même visiteur à travers plusieurs pages.
      if (url.pathname === "/api/track-visit" && request.method === "POST") {
        const body = await request.json().catch(() => ({})); const { artist_slug, session_id } = body; const site = siteFromRequest(request, body); const vp = visitProfile(request, body, request.cf || {});
        if (!artist_slug) return json({ ok: false }, 200, origin);
        const cf = request.cf || {};
        await env.DB.prepare(
          "INSERT INTO page_visits (artist_slug, city, region, country, latitude, longitude, session_id, site, is_bot, network, device, referrer, postal_code, lang, domaine) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(artist_slug, cf.city || null, cf.region || null, cf.country || null, cf.latitude ? Number(cf.latitude) : null, cf.longitude ? Number(cf.longitude) : null, session_id || null, site, vp.isBot, vp.network, vp.device, vp.referrer, cf.postalCode || null, (["fr", "en", "es", "it"].includes(body.lang) ? body.lang : langFromReferer(request)), domainFromRequest(request)).run();
        // Rafales de robots : 6 sessions différentes ou plus en 2 secondes (scanners répartis sur des dizaines de réseaux) = robots.
        // Marquées is_bot = 2 (comptées comme robots partout, car les stats filtrent is_bot = 0) ; les visites de la rafale déjà
        // enregistrées sont reclassées aussi. Un vrai visiteur ne produit jamais ça (0 cas en un mois de données).
        if (!vp.isBot) {
          try {
            const b = await env.DB.prepare("SELECT COUNT(DISTINCT session_id) AS n FROM page_visits WHERE visited_at >= datetime('now', '-2 seconds') AND is_bot IN (0, 2)").first();
            if (b && b.n >= 6) await env.DB.prepare("UPDATE page_visits SET is_bot = 2 WHERE is_bot = 0 AND visited_at >= datetime('now', '-3 seconds')").run();
          } catch (e) { /* ne bloque jamais l'enregistrement de la visite */ }
        }
        return json({ ok: true }, 200, origin);
      }

      // GET /api/admin/visits-journey?session=<id> — toutes les pages vues dans la même session (admin)
      if (url.pathname === "/api/admin/visits-journey" && request.method === "GET") {
        if (!(await isAdminForMeteo(request, env))) return json({ error: "Non autorisé" }, 401, origin);
        const session = url.searchParams.get("session");
        if (!session) return json({ visits: [] }, 200, origin);
        const { results } = await env.DB.prepare(
          "SELECT id, artist_slug as page, visited_at, site, network, device, referrer, lang, domaine, city, country FROM page_visits WHERE session_id = ? ORDER BY visited_at ASC"
        ).bind(session).all();
        return json({ visits: results }, 200, origin);
      }

      // GET /api/admin/visits?artist=<slug> — historique des visites d'une fiche (admin)
      if (url.pathname === "/api/admin/visits" && request.method === "GET") {
        if (!(await isAdminForMeteo(request, env))) return json({ error: "Non autorisé" }, 401, origin);
        const artist = url.searchParams.get("artist");
        if (!artist) return json({ total: 0, visits: [] }, 200, origin);
        const { results } = await env.DB.prepare(
          "SELECT id, city, region, country, visited_at, session_id, site, network, device, referrer, is_bot, postal_code, lang, domaine FROM page_visits WHERE artist_slug = ? AND " + siteWhere(url) + " ORDER BY visited_at DESC LIMIT 200"
        ).bind(artist).all();
        const totalRow = await env.DB.prepare(
          "SELECT COUNT(*) as n FROM page_visits WHERE artist_slug = ? AND " + siteWhere(url)
        ).bind(artist).first();
        return json({ total: totalRow?.n || 0, visits: results }, 200, origin);
      }

      // DELETE /api/admin/visits/:id — supprime une visite (ex: une de tes propres visites de test)
      const visitDeleteMatch = url.pathname.match(/^\/api\/admin\/visits\/(\d+)$/);
      if (visitDeleteMatch && request.method === "DELETE") {
        if (!(await isAdminForMeteo(request, env))) return json({ error: "Non autorisé" }, 401, origin);
        await env.DB.prepare("DELETE FROM page_visits WHERE id = ?").bind(visitDeleteMatch[1]).run();
        return json({ ok: true }, 200, origin);
      }

      // GET /api/agenda.ics?key=<ADMIN_PASSWORD> — flux iCalendar (.ics) du planning complet (onglet
      // "Planning SLP"), à coller dans Google Calendar / Apple Calendar / Outlook en "S'abonner à
      // partir d'une URL". TimeTree ne propose plus d'API publique (fermée en 2023) mais sait importer
      // un calendrier Google/Apple/Outlook déjà connecté — ce flux permet donc de relier indirectement
      // SLP à TimeTree en passant par l'un de ces calendriers comme intermédiaire.
      // Protégé par une clé simple en paramètre d'URL (les applis de calendrier ne peuvent pas envoyer
      // d'en-tête Authorization) : on réutilise le mot de passe admin comme clé partagée.
      if (url.pathname === "/api/agenda.ics" && request.method === "GET") {
        if (url.searchParams.get("key") !== env.ADMIN_PASSWORD) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { results } = await env.DB.prepare(
          `SELECT a.id, a.artist_slug, a.date, a.type, a.label, a.status, u.guest_name, u.venue_name, u.venue_city
           FROM artist_agenda a
           LEFT JOIN actualites u ON u.id = a.source_actu_id
           ORDER BY a.date ASC`
        ).all();

        const ARTIST_LABELS = {
          "alchimie": "Alchimie", "cache-candy": "Cache Candy", "the-fine-allies": "The Fine Allies",
          "noon-coverband": "NooN Coverband", "panache": "Panache", "voice-of-freedom": "Voice of Freedom",
          "presta-technique": "Prestation technique",
        };
        const foldLine = (line) => {
          // RFC 5545 : replie les lignes de plus de 75 octets avec un saut de ligne + espace
          const chunks = [];
          let rest = line;
          while (rest.length > 74) {
            chunks.push(rest.slice(0, 74));
            rest = " " + rest.slice(74);
          }
          chunks.push(rest);
          return chunks.join("\r\n");
        };
        const escapeIcs = (s) => (s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
        const dateStamp = (d) => d.replace(/-/g, "");

        const lines = [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "PRODID:-//SLP Sound Light Prod//Planning//FR",
          "CALSCALE:GREGORIAN",
          "X-WR-CALNAME:Planning SLP",
        ];

        for (const r of results) {
          const label = r.guest_name || ARTIST_LABELS[r.artist_slug] || r.artist_slug;
          const icon = r.type === "indisponible" ? "🚫" : (r.type === "cabaret" ? "🎭" : (r.type === "dj" ? "🎧" : "🎤"));
          const summary = `${icon} ${label}${r.label ? " — " + r.label : ""}`;
          const venue = [r.venue_name, r.venue_city].filter(Boolean).join(", ");
          const nextDay = new Date(r.date + "T00:00:00Z");
          nextDay.setUTCDate(nextDay.getUTCDate() + 1);
          lines.push("BEGIN:VEVENT");
          lines.push(`UID:slp-agenda-${r.id}@soundlightprod.fr`);
          lines.push(`DTSTAMP:${dateStamp(r.date)}T000000Z`);
          lines.push(`DTSTART;VALUE=DATE:${dateStamp(r.date)}`);
          lines.push(`DTEND;VALUE=DATE:${dateStamp(nextDay.toISOString().slice(0, 10))}`);
          lines.push(foldLine(`SUMMARY:${escapeIcs(summary)}`));
          if (venue) lines.push(foldLine(`LOCATION:${escapeIcs(venue)}`));
          lines.push(`STATUS:${r.status === "option" ? "TENTATIVE" : "CONFIRMED"}`);
          lines.push("END:VEVENT");
        }

        lines.push("END:VCALENDAR");

        return new Response(lines.join("\r\n") + "\r\n", {
          headers: {
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition": 'inline; filename="planning-slp.ics"',
          },
        });
      }

      // GET /api/admin/visits-timeseries?granularity=day|month — nombre de visites groupées par
      // jour ou par mois, tout le site confondu (admin), pour le graphique d'évolution.
      if (url.pathname === "/api/admin/visits-timeseries" && request.method === "GET") {
        if (!(await isAdminForMeteo(request, env))) return json({ error: "Non autorisé" }, 401, origin);
        const granularity = url.searchParams.get("granularity") === "month" ? "month" : "day";
        const substrLen = granularity === "month" ? 7 : 10;
        const { results } = await env.DB.prepare(
          `SELECT substr(visited_at, 1, ${substrLen}) as period, COUNT(*) as count
           FROM page_visits
           WHERE ` + siteWhere(url) + ` GROUP BY period
           ORDER BY period ASC`
        ).all();
        return json({ granularity, points: results }, 200, origin);
      }

      // GET /api/admin/visits-summary — nombre de visites par page, tout le site (admin)
      if (url.pathname === "/api/admin/visits-summary" && request.method === "GET") {
        if (!(await isAdminForMeteo(request, env))) return json({ error: "Non autorisé" }, 401, origin);
        const { results } = await env.DB.prepare(
          `SELECT site, artist_slug as page, COUNT(*) as total, MAX(visited_at) as last_visit
           FROM page_visits WHERE ` + siteWhere(url) + ` GROUP BY site, artist_slug ORDER BY total DESC`
        ).all();
        const grandTotal = await env.DB.prepare("SELECT COUNT(*) as n FROM page_visits WHERE " + siteWhere(url)).first();
        const u2 = new URL(url); u2.searchParams.delete("site"); const bySite = await env.DB.prepare("SELECT site, COUNT(*) as n FROM page_visits WHERE " + siteWhere(u2) + " GROUP BY site").all(); return json({ grand_total: grandTotal?.n || 0, pages: results, by_site: bySite.results }, 200, origin);
      }

      // GET /api/admin/visits-map?period=today|week|month|all — points géolocalisés pour la carte (admin)
      if (url.pathname === "/api/admin/visits-map" && request.method === "GET") {
        if (!(await isAdminForMeteo(request, env))) return json({ error: "Non autorisé" }, 401, origin);
        const cutoff = periodCutoff(url.searchParams.get("period"));
        const { results } = await env.DB.prepare(
          `SELECT id, artist_slug as page, city, region, country, latitude, longitude, visited_at, session_id, site, network, device, referrer, is_bot, postal_code, lang, domaine
           FROM page_visits WHERE latitude IS NOT NULL AND longitude IS NOT NULL
           AND (? IS NULL OR visited_at >= ?) AND ` + siteWhere(url) + `
           ORDER BY visited_at DESC LIMIT 1000`
        ).bind(cutoff, cutoff).all();
        return json(results, 200, origin);
      }

      // GET /api/admin/visits-breakdown?period=today|week|month|all — répartition pays/région/ville (admin)
      if (url.pathname === "/api/admin/visits-breakdown" && request.method === "GET") {
        if (!(await isAdminForMeteo(request, env))) return json({ error: "Non autorisé" }, 401, origin);
        const cutoff = periodCutoff(url.searchParams.get("period"));
        const byCountry = await env.DB.prepare(
          `SELECT COALESCE(country, 'Inconnu') as label, COUNT(*) as total FROM page_visits
           WHERE (? IS NULL OR visited_at >= ?) AND ` + siteWhere(url) + ` GROUP BY country ORDER BY total DESC`
        ).bind(cutoff, cutoff).all();
        const byRegion = await env.DB.prepare(
          `SELECT COALESCE(region, 'Inconnu') as label, COUNT(*) as total FROM page_visits
           WHERE (? IS NULL OR visited_at >= ?) AND ` + siteWhere(url) + ` GROUP BY region ORDER BY total DESC`
        ).bind(cutoff, cutoff).all();
        const byCity = await env.DB.prepare(
          `SELECT COALESCE(city, 'Inconnu') as label, COUNT(*) as total FROM page_visits
           WHERE (? IS NULL OR visited_at >= ?) AND ` + siteWhere(url) + ` GROUP BY city ORDER BY total DESC`
        ).bind(cutoff, cutoff).all();
        const totalRow = await env.DB.prepare(
          `SELECT COUNT(*) as n FROM page_visits WHERE (? IS NULL OR visited_at >= ?) AND ` + siteWhere(url)
        ).bind(cutoff, cutoff).first();
        return json({
          total: totalRow?.n || 0,
          by_country: byCountry.results,
          by_region: byRegion.results,
          by_city: byCity.results,
          by_postal: (await env.DB.prepare(`SELECT COALESCE(postal_code || ' ' || COALESCE(city, ''), 'Inconnu') as label, COUNT(*) as total FROM page_visits WHERE (? IS NULL OR visited_at >= ?) AND ` + siteWhere(url) + ` GROUP BY label ORDER BY total DESC LIMIT 50`).bind(cutoff, cutoff).all()).results,
          by_network: (await env.DB.prepare(`SELECT COALESCE(network, 'Inconnu') as label, COUNT(*) as total FROM page_visits WHERE (? IS NULL OR visited_at >= ?) AND ` + siteWhere(url) + ` GROUP BY network ORDER BY total DESC LIMIT 50`).bind(cutoff, cutoff).all()).results,
          by_device: (await env.DB.prepare(`SELECT COALESCE(device, 'Inconnu') as label, COUNT(*) as total FROM page_visits WHERE (? IS NULL OR visited_at >= ?) AND ` + siteWhere(url) + ` GROUP BY device ORDER BY total DESC`).bind(cutoff, cutoff).all()).results,
          by_lang: (await env.DB.prepare(`SELECT COALESCE(lang, 'inconnu') as label, COUNT(*) as total, COUNT(DISTINCT session_id) as visiteurs FROM page_visits WHERE lang IS NOT NULL AND (? IS NULL OR visited_at >= ?) AND ` + siteWhere(url) + ` GROUP BY COALESCE(lang, 'inconnu') ORDER BY total DESC`).bind(cutoff, cutoff).all()).results,
          by_domain: (await env.DB.prepare(`SELECT COALESCE(domaine, 'Inconnu') as label, COUNT(*) as total FROM page_visits WHERE domaine IS NOT NULL AND (? IS NULL OR visited_at >= ?) AND ` + siteWhere(url) + ` GROUP BY domaine ORDER BY total DESC LIMIT 20`).bind(cutoff, cutoff).all()).results,
          by_lang_place: (await env.DB.prepare(`SELECT COALESCE(lang, 'inconnu') as lang, COALESCE(domaine, 'inconnu') as domaine, COALESCE(country, 'Inconnu') as country, COALESCE(city, 'Inconnu') as city, COUNT(*) as total, COUNT(DISTINCT session_id) as visiteurs FROM page_visits WHERE lang IS NOT NULL AND (? IS NULL OR visited_at >= ?) AND ` + siteWhere(url) + ` GROUP BY COALESCE(lang, 'inconnu'), domaine, country, city ORDER BY total DESC LIMIT 60`).bind(cutoff, cutoff).all()).results,
          by_referrer: (await env.DB.prepare(`SELECT COALESCE(referrer, 'Accès direct / inconnu') as label, COUNT(*) as total FROM page_visits WHERE (? IS NULL OR visited_at >= ?) AND ` + siteWhere(url) + ` GROUP BY referrer ORDER BY total DESC LIMIT 30`).bind(cutoff, cutoff).all()).results,
        }, 200, origin);
      }

      // GET /api/admin/artist-tokens — liste les identifiants d'accès groupe (pour l'admin)
      if (url.pathname === "/api/admin/artist-tokens" && request.method === "GET") {
        if (!(await isAdminForMeteo(request, env))) return json({ error: "Non autorisé" }, 401, origin);
        const { results } = await env.DB.prepare("SELECT artist_slug, token, password FROM artist_tokens").all();
        return json(results, 200, origin);
      }

      // POST /api/admin/artist-tokens/:slug/regenerate — régénère le MOT DE PASSE d'un groupe
      // (le jeton de session reste stable ; c'est le mot de passe qui protège l'accès).
      const tokenRegenMatch = url.pathname.match(/^\/api\/admin\/artist-tokens\/([a-z-]+)\/regenerate$/);
      if (tokenRegenMatch && request.method === "POST") {
        if (!(await isAdminForMeteo(request, env))) return json({ error: "Non autorisé" }, 401, origin);
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let newPassword = "";
        const randomBytes = crypto.getRandomValues(new Uint8Array(8));
        for (let i = 0; i < 8; i++) newPassword += chars[randomBytes[i] % chars.length];
        await env.DB.prepare("UPDATE artist_tokens SET password = ? WHERE artist_slug = ?")
          .bind(newPassword, tokenRegenMatch[1]).run();
        return json({ ok: true, password: newPassword }, 200, origin);
      }

      // ============ ADMIN ============

      // POST /api/admin/login — vérifie le mot de passe
      if (url.pathname === "/api/admin/login" && request.method === "POST") {
        const { password } = await request.json();
        if (password === env.ADMIN_PASSWORD) return json({ token: env.ADMIN_PASSWORD }, 200, origin);
        return json({ error: "Mot de passe incorrect" }, 401, origin);
      }

      // GET /api/admin/reservations — liste toutes les réservations
      if (url.pathname === "/api/admin/reservations" && request.method === "GET") {
        if (!requireAdmin(request, env)) return json({ error: "Non autorisé" }, 401, origin);
        const { results } = await env.DB.prepare(
          `SELECT r.*, i.name as item_name FROM reservations r
           JOIN rental_items i ON i.id = r.item_id
           ORDER BY r.status = 'pending' DESC, r.start_date ASC`
        ).all();
        return json(results, 200, origin);
      }

      // POST /api/admin/reservations/:id/decide — valide ou refuse
      const decideMatch = url.pathname.match(/^\/api\/admin\/reservations\/(\d+)\/decide$/);
      if (decideMatch && request.method === "POST") {
        if (!requireAdmin(request, env)) return json({ error: "Non autorisé" }, 401, origin);
        const { decision } = await request.json(); // 'confirmed' | 'refused'
        if (!["confirmed", "refused"].includes(decision)) return json({ error: "Décision invalide" }, 400, origin);
        await env.DB.prepare(
          "UPDATE reservations SET status = ?, decided_at = datetime('now') WHERE id = ?"
        ).bind(decision, decideMatch[1]).run();
        return json({ ok: true }, 200, origin);
      }

      // GET /api/admin/orders — liste les commandes boutique
      if (url.pathname === "/api/admin/orders" && request.method === "GET") {
        if (!requireAdmin(request, env)) return json({ error: "Non autorisé" }, 401, origin);
        const { results } = await env.DB.prepare("SELECT * FROM orders ORDER BY created_at DESC").all();
        return json(results, 200, origin);
      }

      // DELETE /api/admin/orders/:id — supprime une commande boutique
      const orderDeleteMatch = url.pathname.match(/^\/api\/admin\/orders\/(\d+)$/);
      if (orderDeleteMatch && request.method === "DELETE") {
        if (!requireAdmin(request, env)) return json({ error: "Non autorisé" }, 401, origin);
        await env.DB.prepare("DELETE FROM orders WHERE id = ?").bind(orderDeleteMatch[1]).run();
        return json({ ok: true }, 200, origin);
      }

      // Toute route non gérée : si ce n'est pas un appel /api/*, on sert le fichier statique
      // correspondant (site + admin). C'est indispensable avec run_worker_first: true — sans ça,
      // le Worker intercepte TOUTES les requêtes, y compris les pages du site, avant les assets.
      // GET /api/admin/social-stats — historique abonnés / portée / vues par réseau (admin)
      if (url.pathname === "/api/admin/social-stats" && request.method === "GET") {
        if (!(await isAdminForMeteo(request, env))) return json({ error: "Non autorisé" }, 401, origin);
        await ensureSocialTable(env);
        const { results } = await env.DB.prepare("SELECT * FROM social_stats ORDER BY day DESC LIMIT 400").all();
        return json({ rows: results || [], meta_configured: !!env.META_ACCESS_TOKEN }, 200, origin);
      }
      // POST /api/admin/social-stats — saisie manuelle (ex. TikTok) {platform, followers?, reach?, views?, day?}
      if (url.pathname === "/api/admin/social-stats" && request.method === "POST") {
        if (!(await isAdminForMeteo(request, env))) return json({ error: "Non autorisé" }, 401, origin);
        const b = await request.json();
        const platform = String(b.platform || "").toLowerCase();
        if (!["facebook", "instagram", "tiktok"].includes(platform)) return json({ error: "Réseau inconnu" }, 400, origin);
        const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Math.round(Number(v)));
        const day = /^\d{4}-\d{2}-\d{2}$/.test(b.day || "") ? b.day : new Date().toISOString().slice(0, 10);
        await saveSocialStat(env, day, platform, { followers: num(b.followers), reach: num(b.reach), views: num(b.views), likes: num(b.likes), shares: num(b.shares), source: "manuel" });
        return json({ ok: true }, 200, origin);
      }
      // POST /api/admin/social-stats/refresh — relance la collecte Meta maintenant (admin)
      if (url.pathname === "/api/admin/social-stats/refresh" && request.method === "POST") {
        if (!(await isAdminForMeteo(request, env))) return json({ error: "Non autorisé" }, 401, origin);
        return json(await collectMetaStats(env), 200, origin);
      }

      // GET /api/admin/meteo — rapport du jour : visites, Google, Brevo (admin)
      if (url.pathname === "/api/admin/meteo" && request.method === "GET") {
        if (!(await isAdminForMeteo(request, env))) return json({ error: "Non autorisé" }, 401, origin);
        return json(await meteoData(env), 200, origin);
      }

      if (!url.pathname.startsWith("/api/")) {
        return withVideoTracking(await env.ASSETS.fetch(request), url);
      }

      return json({ error: "Route inconnue" }, 404, origin);
    } catch (err) {
      return json({ error: err.message || "Erreur serveur" }, 500, origin);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(collectMetaStats(env));
  },
};
