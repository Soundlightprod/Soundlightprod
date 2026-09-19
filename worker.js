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

function requireAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace("Bearer ", "");
  return token && token === env.ADMIN_PASSWORD;
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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

        const session = await stripeRequest(env, "checkout/sessions", {
          mode: "payment",
          payment_method_types: ["card"],
          line_items,
          customer_email,
          shipping_address_collection: { allowed_countries: SHIPPING_COUNTRIES },
          success_url: `${env.SITE_ORIGIN}/boutique-merci.html?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${env.SITE_ORIGIN}/boutique.html`,
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
           ORDER BY COALESCE(event_date, created_at) DESC
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
           WHERE type IN ('concert', 'cabaret', 'dj') AND is_public = 1
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

        if (!artist_slug || !["concert", "cabaret", "dj", "indisponible", "actu"].includes(type)) {
          return json({ error: "Champs manquants ou invalides" }, 400, origin);
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
        if (!artist_slug || !["concert", "cabaret", "dj", "actu"].includes(type) || !text || !expires_at) {
          return json({ error: "Champs manquants ou invalides" }, 400, origin);
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
        if (["concert", "cabaret", "dj"].includes(type)) {
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
           FROM actualites WHERE id = ? AND type IN ('concert', 'cabaret', 'dj')`
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

      // POST /api/track-visit — { artist_slug, session_id } : enregistre une visite (public, appelé
      // depuis chaque page). session_id (généré côté navigateur, une fois par onglet/session) permet
      // de reconstituer le parcours d'un même visiteur à travers plusieurs pages.
      if (url.pathname === "/api/track-visit" && request.method === "POST") {
        const { artist_slug, session_id } = await request.json().catch(() => ({}));
        if (!artist_slug) return json({ ok: false }, 200, origin);
        const cf = request.cf || {};
        await env.DB.prepare(
          "INSERT INTO page_visits (artist_slug, city, region, country, latitude, longitude, session_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(artist_slug, cf.city || null, cf.region || null, cf.country || null, cf.latitude ? Number(cf.latitude) : null, cf.longitude ? Number(cf.longitude) : null, session_id || null).run();
        return json({ ok: true }, 200, origin);
      }

      // GET /api/admin/visits-journey?session=<id> — toutes les pages vues dans la même session (admin)
      if (url.pathname === "/api/admin/visits-journey" && request.method === "GET") {
        if (!requireAdmin(request, env)) return json({ error: "Non autorisé" }, 401, origin);
        const session = url.searchParams.get("session");
        if (!session) return json({ visits: [] }, 200, origin);
        const { results } = await env.DB.prepare(
          "SELECT id, artist_slug as page, visited_at FROM page_visits WHERE session_id = ? ORDER BY visited_at ASC"
        ).bind(session).all();
        return json({ visits: results }, 200, origin);
      }

      // GET /api/admin/visits?artist=<slug> — historique des visites d'une fiche (admin)
      if (url.pathname === "/api/admin/visits" && request.method === "GET") {
        if (!requireAdmin(request, env)) return json({ error: "Non autorisé" }, 401, origin);
        const artist = url.searchParams.get("artist");
        if (!artist) return json({ total: 0, visits: [] }, 200, origin);
        const { results } = await env.DB.prepare(
          "SELECT id, city, region, country, visited_at, session_id FROM page_visits WHERE artist_slug = ? ORDER BY visited_at DESC LIMIT 200"
        ).bind(artist).all();
        const totalRow = await env.DB.prepare(
          "SELECT COUNT(*) as n FROM page_visits WHERE artist_slug = ?"
        ).bind(artist).first();
        return json({ total: totalRow?.n || 0, visits: results }, 200, origin);
      }

      // DELETE /api/admin/visits/:id — supprime une visite (ex: une de tes propres visites de test)
      const visitDeleteMatch = url.pathname.match(/^\/api\/admin\/visits\/(\d+)$/);
      if (visitDeleteMatch && request.method === "DELETE") {
        if (!requireAdmin(request, env)) return json({ error: "Non autorisé" }, 401, origin);
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
        if (!requireAdmin(request, env)) return json({ error: "Non autorisé" }, 401, origin);
        const granularity = url.searchParams.get("granularity") === "month" ? "month" : "day";
        const substrLen = granularity === "month" ? 7 : 10;
        const { results } = await env.DB.prepare(
          `SELECT substr(visited_at, 1, ${substrLen}) as period, COUNT(*) as count
           FROM page_visits
           GROUP BY period
           ORDER BY period ASC`
        ).all();
        return json({ granularity, points: results }, 200, origin);
      }

      // GET /api/admin/visits-summary — nombre de visites par page, tout le site (admin)
      if (url.pathname === "/api/admin/visits-summary" && request.method === "GET") {
        if (!requireAdmin(request, env)) return json({ error: "Non autorisé" }, 401, origin);
        const { results } = await env.DB.prepare(
          `SELECT artist_slug as page, COUNT(*) as total, MAX(visited_at) as last_visit
           FROM page_visits GROUP BY artist_slug ORDER BY total DESC`
        ).all();
        const grandTotal = await env.DB.prepare("SELECT COUNT(*) as n FROM page_visits").first();
        return json({ grand_total: grandTotal?.n || 0, pages: results }, 200, origin);
      }

      // GET /api/admin/visits-map?period=today|week|month|all — points géolocalisés pour la carte (admin)
      if (url.pathname === "/api/admin/visits-map" && request.method === "GET") {
        if (!requireAdmin(request, env)) return json({ error: "Non autorisé" }, 401, origin);
        const cutoff = periodCutoff(url.searchParams.get("period"));
        const { results } = await env.DB.prepare(
          `SELECT id, artist_slug as page, city, region, country, latitude, longitude, visited_at, session_id
           FROM page_visits WHERE latitude IS NOT NULL AND longitude IS NOT NULL
           AND (? IS NULL OR visited_at >= ?)
           ORDER BY visited_at DESC LIMIT 1000`
        ).bind(cutoff, cutoff).all();
        return json(results, 200, origin);
      }

      // GET /api/admin/visits-breakdown?period=today|week|month|all — répartition pays/région/ville (admin)
      if (url.pathname === "/api/admin/visits-breakdown" && request.method === "GET") {
        if (!requireAdmin(request, env)) return json({ error: "Non autorisé" }, 401, origin);
        const cutoff = periodCutoff(url.searchParams.get("period"));
        const byCountry = await env.DB.prepare(
          `SELECT COALESCE(country, 'Inconnu') as label, COUNT(*) as total FROM page_visits
           WHERE (? IS NULL OR visited_at >= ?) GROUP BY country ORDER BY total DESC`
        ).bind(cutoff, cutoff).all();
        const byRegion = await env.DB.prepare(
          `SELECT COALESCE(region, 'Inconnu') as label, COUNT(*) as total FROM page_visits
           WHERE (? IS NULL OR visited_at >= ?) GROUP BY region ORDER BY total DESC`
        ).bind(cutoff, cutoff).all();
        const byCity = await env.DB.prepare(
          `SELECT COALESCE(city, 'Inconnu') as label, COUNT(*) as total FROM page_visits
           WHERE (? IS NULL OR visited_at >= ?) GROUP BY city ORDER BY total DESC`
        ).bind(cutoff, cutoff).all();
        const totalRow = await env.DB.prepare(
          `SELECT COUNT(*) as n FROM page_visits WHERE (? IS NULL OR visited_at >= ?)`
        ).bind(cutoff, cutoff).first();
        return json({
          total: totalRow?.n || 0,
          by_country: byCountry.results,
          by_region: byRegion.results,
          by_city: byCity.results,
        }, 200, origin);
      }

      // GET /api/admin/artist-tokens — liste les identifiants d'accès groupe (pour l'admin)
      if (url.pathname === "/api/admin/artist-tokens" && request.method === "GET") {
        if (!requireAdmin(request, env)) return json({ error: "Non autorisé" }, 401, origin);
        const { results } = await env.DB.prepare("SELECT artist_slug, token, password FROM artist_tokens").all();
        return json(results, 200, origin);
      }

      // POST /api/admin/artist-tokens/:slug/regenerate — régénère le MOT DE PASSE d'un groupe
      // (le jeton de session reste stable ; c'est le mot de passe qui protège l'accès).
      const tokenRegenMatch = url.pathname.match(/^\/api\/admin\/artist-tokens\/([a-z-]+)\/regenerate$/);
      if (tokenRegenMatch && request.method === "POST") {
        if (!requireAdmin(request, env)) return json({ error: "Non autorisé" }, 401, origin);
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
      if (!url.pathname.startsWith("/api/")) {
        return env.ASSETS.fetch(request);
      }

      return json({ error: "Route inconnue" }, 404, origin);
    } catch (err) {
      return json({ error: err.message || "Erreur serveur" }, 500, origin);
    }
  },
};
