// CRM SLP : base unique prospects + clients, suivi des échanges et des devis, export CSV pour Brevo.
// Toutes les routes sont sous /api/admin/crm/* et protégées par le mot de passe admin (vérifié dans worker.js).

const COLS = ["statut", "etape", "organisation", "categorie", "prenom", "nom", "fonction", "email", "telephone", "ville", "code_postal",
  "departement", "source", "evenement", "date_evenement", "budget", "priorite", "notes", "prochaine_action", "date_relance",
  "no_mailing", "perdu_raison"];
const STATUTS = ["prospect", "client", "perdu"];
const ETAPES = ["nouveau", "contacte", "echange", "proposition", "devis", "negociation"];
const OFFRE_STATUTS = ["brouillon", "envoyee", "acceptee", "refusee"];
const MAX_FICHIER = 15 * 1024 * 1024;
const DEVIS_STATUTS = ["brouillon", "envoye", "accepte", "refuse"];

let ready = false;
export async function ensureCrmSchema(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS crm_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      statut TEXT NOT NULL DEFAULT 'prospect',
      etape TEXT NOT NULL DEFAULT 'nouveau',
      organisation TEXT, categorie TEXT, prenom TEXT, nom TEXT, fonction TEXT,
      email TEXT, telephone TEXT, ville TEXT, code_postal TEXT, departement TEXT,
      source TEXT, evenement TEXT, date_evenement TEXT, budget TEXT,
      priorite INTEGER NOT NULL DEFAULT 0,
      notes TEXT, prochaine_action TEXT, date_relance TEXT,
      no_mailing INTEGER NOT NULL DEFAULT 0,
      perdu_raison TEXT, client_depuis TEXT, brevo_le TEXT, site_request_id INTEGER,
      cree_le TEXT NOT NULL DEFAULT (datetime('now')),
      maj_le TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS crm_contacts_email_u ON crm_contacts(email) WHERE email IS NOT NULL AND email != ''"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS crm_contacts_statut ON crm_contacts(statut, etape)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS crm_journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id INTEGER NOT NULL, type TEXT NOT NULL DEFAULT 'note',
      texte TEXT, cree_le TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS crm_journal_contact ON crm_journal(contact_id)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS crm_devis (
      id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id INTEGER NOT NULL, ref TEXT, objet TEXT,
      montant_ht REAL, statut TEXT NOT NULL DEFAULT 'brouillon', date_envoi TEXT,
      cree_le TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS crm_devis_contact ON crm_devis(contact_id)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS crm_offres (
      id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id INTEGER NOT NULL, ref TEXT, objet TEXT,
      montant_ht REAL, statut TEXT NOT NULL DEFAULT 'brouillon', date_envoi TEXT,
      cree_le TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS crm_offres_contact ON crm_offres(contact_id)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS crm_fichiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id INTEGER NOT NULL, kind TEXT NOT NULL, parent_id INTEGER NOT NULL,
      nom TEXT NOT NULL, cle TEXT NOT NULL, taille INTEGER, cree_le TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS crm_fichiers_contact ON crm_fichiers(contact_id)"),
  ]);
  // date et heure réelles de l'échange (heure de Paris), distinctes de la date de saisie (cree_le, en UTC)
  try { await env.DB.prepare("ALTER TABLE crm_journal ADD COLUMN date_echange TEXT").run(); } catch (e) { /* colonne déjà présente */ }
  // propositions : événement concerné (un client peut en avoir plusieurs), date de l'événement, frais en plus du tarif
  for (const col of ["evenement", "date_evenement", "complement"]) {
    try { await env.DB.prepare("ALTER TABLE crm_offres ADD COLUMN " + col + " TEXT").run(); } catch (e) { /* colonne déjà présente */ }
  }
  ready = true;
}

// Date du jour (heure de Paris) + n jours, au format AAAA-MM-JJ : relance par défaut = J+7
const RELANCE_JOURS = 7;
function datePlus(n) {
  const base = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(new Date());
  const d = new Date(base + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// Programme la relance à J+7 pour un prospect qui n'en a pas (ou dont la relance est déjà passée)
async function relanceParDefaut(env, id) {
  await env.DB.prepare("UPDATE crm_contacts SET date_relance = ? WHERE id = ? AND statut = 'prospect' AND (date_relance IS NULL OR date_relance = '' OR date_relance < ?)").bind(datePlus(RELANCE_JOURS), id, datePlus(0)).run();
}

const clean = (v, max = 500) => (v == null ? null : String(v).trim().slice(0, max) || null);
const normEmail = (v) => { const e = clean(v, 200); return e ? e.toLowerCase() : null; };
const normTel = (v) => { const t = clean(v, 40); return t ? t.replace(/[^\d+]/g, "") || null : null; };

function sanitize(b, partial) {
  const o = {};
  const put = (k, v) => { if (!partial || b[k] !== undefined) o[k] = v; };
  put("statut", STATUTS.includes(b.statut) ? b.statut : "prospect");
  put("etape", ETAPES.includes(b.etape) ? b.etape : "nouveau");
  for (const k of ["organisation", "categorie", "prenom", "nom", "fonction", "ville", "source", "evenement", "budget", "prochaine_action", "perdu_raison"]) put(k, clean(b[k], 200));
  put("notes", clean(b.notes, 5000));
  put("email", normEmail(b.email));
  put("telephone", normTel(b.telephone));
  put("code_postal", clean(b.code_postal, 10));
  put("departement", clean(b.departement, 5) || (clean(b.code_postal, 10) ? clean(b.code_postal, 10).slice(0, clean(b.code_postal, 10).startsWith("97") ? 3 : 2) : null));
  put("date_evenement", clean(b.date_evenement, 10));
  put("date_relance", clean(b.date_relance, 10));
  put("priorite", b.priorite ? 1 : 0);
  put("no_mailing", b.no_mailing ? 1 : 0);
  if (partial) for (const k of Object.keys(o)) if (b[k] === undefined) delete o[k];
  return o;
}

async function contactDetail(env, id) {
  const c = await env.DB.prepare("SELECT * FROM crm_contacts WHERE id = ?").bind(id).first();
  if (!c) return null;
  const [j, d, o, f] = await Promise.all([
    env.DB.prepare("SELECT id, type, texte, cree_le, date_echange FROM crm_journal WHERE contact_id = ? ORDER BY id DESC LIMIT 200").bind(id).all(),
    env.DB.prepare("SELECT id, ref, objet, montant_ht, statut, date_envoi, cree_le FROM crm_devis WHERE contact_id = ? ORDER BY id DESC").bind(id).all(),
    env.DB.prepare("SELECT id, ref, objet, montant_ht, statut, date_envoi, cree_le, evenement, date_evenement, complement FROM crm_offres WHERE contact_id = ? ORDER BY id DESC").bind(id).all(),
    env.DB.prepare("SELECT id, kind, parent_id, nom, taille, cree_le FROM crm_fichiers WHERE contact_id = ? ORDER BY id").bind(id).all(),
  ]);
  return { contact: c, journal: j.results || [], devis: d.results || [], offres: o.results || [], fichiers: f.results || [] };
}

// Supprime les fichiers (stockage + lignes) d'un contact, ou d'un devis / d'une proposition.
async function removeFiles(env, where, ...params) {
  const rows = (await env.DB.prepare(`SELECT id, cle FROM crm_fichiers WHERE ${where}`).bind(...params).all()).results || [];
  for (const r of rows) { try { if (env.CRM_FILES) await env.CRM_FILES.delete(r.cle); } catch (e) { /* fichier déjà absent */ } }
  await env.DB.prepare(`DELETE FROM crm_fichiers WHERE ${where}`).bind(...params).run();
}

async function logEvent(env, id, type, texte, quand) {
  await env.DB.prepare("INSERT INTO crm_journal (contact_id, type, texte, date_echange) VALUES (?, ?, ?, ?)").bind(id, type, texte, quand || null).run();
}
const touch = (env, id) => env.DB.prepare("UPDATE crm_contacts SET maj_le = datetime('now') WHERE id = ?").bind(id).run();

async function insertContact(env, data) {
  const keys = Object.keys(data);
  const r = await env.DB.prepare(`INSERT INTO crm_contacts (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).bind(...keys.map((k) => data[k])).run();
  return r.meta.last_row_id;
}

const csvCell = (v) => { const s = v == null ? "" : String(v); return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
// Brevo attend le format international pour l'attribut SMS : on ne garde que les mobiles français (06/07).
function smsFr(tel) {
  if (!tel) return "";
  const t = tel.replace(/[^\d+]/g, "");
  if (/^0[67]\d{8}$/.test(t)) return "+33" + t.slice(1);
  if (/^\+33[67]\d{8}$/.test(t)) return t;
  return "";
}

// Verse une demande du formulaire du site dans le CRM (prospect « nouveau » à rappeler). Idempotent : une demande déjà
// versée n'est jamais recréée. Retourne "ajoute" | "existant" | "deja".
export async function crmIngestSiteRequest(env, r) {
  await ensureCrmSchema(env);
  const lie = await env.DB.prepare("SELECT id FROM crm_contacts WHERE site_request_id = ?").bind(r.id).first();
  if (lie) return "deja";
  const email = normEmail(r.email), tel = normTel(r.telephone);
  let ex = null;
  if (email) ex = await env.DB.prepare("SELECT id FROM crm_contacts WHERE email = ?").bind(email).first();
  if (!ex && tel) ex = await env.DB.prepare("SELECT id FROM crm_contacts WHERE telephone = ?").bind(tel).first();
  const note = [r.sujet, r.artiste_nom && `Artiste : ${r.artiste_nom}`, r.type_evenement, r.jauge && `Jauge : ${r.jauge}`, r.budget && `Budget : ${r.budget}`, r.message].filter(Boolean).join("\n");
  if (ex) {
    const marque = `Nouvelle demande via le site (${r.cree_le})`;
    const dejaNote = await env.DB.prepare("SELECT id FROM crm_journal WHERE contact_id = ? AND texte LIKE ?").bind(ex.id, marque + "%").first();
    if (!dejaNote) await logEvent(env, ex.id, "note", `${marque} :\n${note}`.slice(0, 2000));
    await env.DB.prepare("UPDATE crm_contacts SET site_request_id = COALESCE(site_request_id, ?) WHERE id = ?").bind(r.id, ex.id).run();
    await touch(env, ex.id);
    return "existant";
  }
  const id = await insertContact(env, {
    statut: "prospect", etape: "nouveau", nom: clean(r.nom, 200), organisation: clean(r.organisme, 200), email, telephone: tel,
    ville: clean(r.lieu, 200), source: "Site web", evenement: clean(r.type_evenement || r.sujet, 200), date_evenement: clean(r.date_event, 10),
    notes: note.slice(0, 5000) || null, site_request_id: r.id, priorite: 1, date_relance: new Date().toISOString().slice(0, 10),
    prochaine_action: "Rappeler / répondre à la demande du site",
  });
  await logEvent(env, id, "note", `Demande reçue via le site le ${r.cree_le}`);
  return "ajoute";
}

// Verse un visiteur du chat qui a laissé ses coordonnées (email ou téléphone) dans le CRM. Sans coordonnées exploitables,
// rien n'est créé. Retourne "ajoute" | "existant" | "ignore".
export async function crmIngestChat(env, t) {
  await ensureCrmSchema(env);
  const brut = String(t.contact || "");
  const mail = (brut.match(/[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}/) || [])[0];
  const telBrut = brut.replace(mail || "", " ").match(/\+?\d[\d .\-()]{5,}\d/);
  const email = normEmail(mail), tel = normTel(telBrut && telBrut[0]);
  if (!email && !(tel && tel.replace(/\D/g, "").length >= 6)) return "ignore";
  const marque = `Chat du site n°${t.id}`;
  const note = [t.page && `Page : ${t.page}`, t.text && `Message : ${t.text}`].filter(Boolean).join("\n");
  let ex = null;
  if (email) ex = await env.DB.prepare("SELECT id FROM crm_contacts WHERE email = ?").bind(email).first();
  if (!ex && tel) ex = await env.DB.prepare("SELECT id FROM crm_contacts WHERE telephone = ?").bind(tel).first();
  if (ex) {
    const deja = await env.DB.prepare("SELECT id FROM crm_journal WHERE contact_id = ? AND texte LIKE ?").bind(ex.id, marque + "%").first();
    if (!deja) await logEvent(env, ex.id, "note", `${marque} :\n${note}`.slice(0, 2000));
    await touch(env, ex.id);
    return "existant";
  }
  const id = await insertContact(env, {
    statut: "prospect", etape: "nouveau", nom: clean(t.name, 200), email, telephone: tel, ville: clean(t.city, 200), source: "Chat du site",
    notes: note.slice(0, 5000) || null, priorite: 1, date_relance: new Date().toISOString().slice(0, 10), prochaine_action: "Répondre au visiteur du chat",
  });
  await logEvent(env, id, "note", `${marque} : le visiteur a laissé ses coordonnées`);
  return "ajoute";
}

export async function handleCrm(request, env, url, origin, json, cors) {
  await ensureCrmSchema(env);
  const path = url.pathname.replace(/^\/api\/admin\/crm/, "") || "/";
  const method = request.method;
  const body = async () => { try { return await request.json(); } catch (e) { return {}; } };
  let m;

  // GET /contacts : liste complète (légère) + chiffres clés
  if (path === "/contacts" && method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT c.id, c.statut, c.etape, c.organisation, c.categorie, c.prenom, c.nom, c.fonction, c.email, c.telephone, c.ville, c.code_postal,
              c.departement, c.source, c.evenement, c.date_evenement, c.priorite, c.prochaine_action, c.date_relance, c.no_mailing, c.brevo_le,
              c.client_depuis, c.maj_le, c.cree_le,
              (SELECT COALESCE(SUM(montant_ht),0) FROM crm_devis d WHERE d.contact_id = c.id AND d.statut = 'accepte') AS ca_accepte,
              (SELECT COALESCE(SUM(montant_ht),0) FROM crm_devis d WHERE d.contact_id = c.id AND d.statut = 'envoye') AS devis_en_cours,
              (SELECT COALESCE(SUM(o.montant_ht),0) FROM crm_offres o WHERE o.contact_id = c.id AND o.statut = 'envoyee' AND o.id = (SELECT o2.id FROM crm_offres o2 WHERE o2.contact_id = o.contact_id AND o2.statut = 'envoyee' AND COALESCE(NULLIF(o2.evenement,''), 'id' || o2.id) = COALESCE(NULLIF(o.evenement,''), 'id' || o.id) ORDER BY COALESCE(o2.montant_ht,0) DESC, o2.id DESC LIMIT 1)) AS offres_en_cours,
              (SELECT json_group_array(json_object('e', o3.evenement, 'm', o3.montant_ht, 'c', o3.complement, 's', o3.statut)) FROM crm_offres o3 WHERE o3.contact_id = c.id AND o3.statut IN ('brouillon','envoyee','acceptee')) AS offres_json,
              (SELECT json_object('t', j.type, 'x', substr(COALESCE(j.texte,''), 1, 140), 'e', j.date_echange, 'c', j.cree_le) FROM crm_journal j WHERE j.contact_id = c.id AND j.type != 'note' ORDER BY COALESCE(j.date_echange, datetime(j.cree_le, '+1 hour')) DESC, j.id DESC LIMIT 1) AS dernier,
              (SELECT f.id FROM crm_fichiers f WHERE f.contact_id = c.id AND f.kind = 'offre' ORDER BY f.id DESC LIMIT 1) AS pdf_offre_id,
              (SELECT f.nom FROM crm_fichiers f WHERE f.contact_id = c.id AND f.kind = 'offre' ORDER BY f.id DESC LIMIT 1) AS pdf_offre_nom,
              (SELECT f.id FROM crm_fichiers f WHERE f.contact_id = c.id AND f.kind = 'devis' ORDER BY f.id DESC LIMIT 1) AS pdf_devis_id,
              (SELECT f.nom FROM crm_fichiers f WHERE f.contact_id = c.id AND f.kind = 'devis' ORDER BY f.id DESC LIMIT 1) AS pdf_devis_nom
       FROM crm_contacts c ORDER BY c.maj_le DESC LIMIT 5000`).all();
    return json({ contacts: results || [] }, 200, origin);
  }

  // POST /contacts : création (409 si l'email existe déjà)
  if (path === "/contacts" && method === "POST") {
    const b = await body();
    const data = sanitize(b, false);
    if (!data.organisation && !data.nom && !data.prenom && !data.email && !data.telephone) return json({ error: "Renseigne au moins un nom, une organisation, un email ou un téléphone" }, 400, origin);
    if (data.email) {
      const ex = await env.DB.prepare("SELECT id, organisation, nom FROM crm_contacts WHERE email = ?").bind(data.email).first();
      if (ex) return json({ error: "Cet email existe déjà dans la base", id: ex.id }, 409, origin);
    }
    if (data.statut === "client") data.client_depuis = new Date().toISOString().slice(0, 10);
    if (data.statut === "prospect" && !data.date_relance) data.date_relance = datePlus(RELANCE_JOURS);
    const id = await insertContact(env, data);
    return json({ id }, 201, origin);
  }

  // POST /import : { rows: [...] } import en masse (fichier CSV lu dans le navigateur) ; ignore les emails déjà présents
  if (path === "/import" && method === "POST") {
    const b = await body();
    const rows = Array.isArray(b.rows) ? b.rows.slice(0, 3000) : [];
    let ajoutes = 0, doublons = 0, vides = 0;
    for (const r of rows) {
      const data = sanitize({ ...r, statut: b.statut === "client" ? "client" : "prospect" }, false);
      if (!data.organisation && !data.nom && !data.prenom && !data.email && !data.telephone) { vides++; continue; }
      if (data.email && await env.DB.prepare("SELECT id FROM crm_contacts WHERE email = ?").bind(data.email).first()) { doublons++; continue; }
      if (!data.source) data.source = "Import";
      if (data.statut === "client") data.client_depuis = new Date().toISOString().slice(0, 10);
      await insertContact(env, data);
      ajoutes++;
    }
    return json({ ajoutes, doublons, vides }, 200, origin);
  }

  // POST /import-site : crée des prospects à partir des demandes reçues par le formulaire du site (une seule fois chacune)
  if (path === "/import-site" && method === "POST") {
    let rows = [];
    try { rows = (await env.DB.prepare("SELECT id, cree_le, nom, email, telephone, sujet, date_event, lieu, message, artiste_nom, organisme, type_evenement, jauge, budget FROM contact_requests WHERE site IN ('slp','bmb') OR site IS NULL ORDER BY id").all()).results || []; }
    catch (e) { rows = (await env.DB.prepare("SELECT id, cree_le, nom, email, telephone, sujet, date_event, lieu, message FROM contact_requests ORDER BY id").all()).results || []; }
    let ajoutes = 0, existants = 0;
    for (const r of rows) {
      const res = await crmIngestSiteRequest(env, r);
      if (res === "ajoute") ajoutes++; else if (res === "existant") existants++;
    }
    return json({ ajoutes, existants }, 200, origin);
  }

  // GET /export?statut=prospect|client|all&etape=&dept=&ids=1,2,3&mark=1 : CSV prêt à importer dans Brevo
  if (path === "/export" && method === "GET") {
    const where = ["email IS NOT NULL", "email != ''", "no_mailing = 0", "statut != 'perdu'"];
    const params = [];
    const st = url.searchParams.get("statut");
    if (st === "prospect" || st === "client") { where.push("statut = ?"); params.push(st); }
    const et = url.searchParams.get("etape");
    if (et && ETAPES.includes(et)) { where.push("etape = ?"); params.push(et); }
    const dept = url.searchParams.get("dept");
    if (dept) { where.push("departement = ?"); params.push(dept); }
    const cat = url.searchParams.get("categorie");
    if (cat) { where.push("categorie = ?"); params.push(cat); }
    const ids = (url.searchParams.get("ids") || "").split(",").map((x) => parseInt(x, 10)).filter((x) => x > 0).slice(0, 5000);
    if (ids.length) where.push(`id IN (${ids.join(",")})`);
    const { results } = await env.DB.prepare(`SELECT id, email, prenom, nom, organisation, categorie, departement, code_postal, ville, telephone, statut FROM crm_contacts WHERE ${where.join(" AND ")} ORDER BY id`).bind(...params).all();
    const head = ["EMAIL", "PRENOM", "NOM", "ORGANISATION", "CATEGORIE", "DEPARTEMENT", "CODE_POSTAL", "CITY", "SMS", "STATUT_CRM"];
    const lines = [head.join(",")].concat((results || []).map((r) => [r.email, r.prenom, r.nom, r.organisation, r.categorie, r.departement, r.code_postal, r.ville, smsFr(r.telephone), r.statut].map(csvCell).join(",")));
    if (url.searchParams.get("mark") === "1" && results && results.length) {
      for (let i = 0; i < results.length; i += 80) {
        const chunk = results.slice(i, i + 80).map((r) => r.id);
        await env.DB.prepare(`UPDATE crm_contacts SET brevo_le = datetime('now') WHERE id IN (${chunk.join(",")})`).run();
      }
    }
    const nom = `contacts-slp-${st || "tous"}-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response("﻿" + lines.join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${nom}"`, "X-Nb-Contacts": String((results || []).length), ...cors(origin) } });
  }

  // /contacts/:id[/journal|/devis|/statut]
  if ((m = path.match(/^\/contacts\/(\d+)$/))) {
    const id = +m[1];
    if (method === "GET") {
      const d = await contactDetail(env, id);
      return d ? json(d, 200, origin) : json({ error: "Introuvable" }, 404, origin);
    }
    if (method === "PUT") {
      const b = await body();
      const data = sanitize(b, true);
      const keys = Object.keys(data);
      if (!keys.length) return json({ ok: true }, 200, origin);
      if (data.email) {
        const ex = await env.DB.prepare("SELECT id FROM crm_contacts WHERE email = ? AND id != ?").bind(data.email, id).first();
        if (ex) return json({ error: "Cet email existe déjà sur une autre fiche", id: ex.id }, 409, origin);
      }
      await env.DB.prepare(`UPDATE crm_contacts SET ${keys.map((k) => `${k} = ?`).join(", ")}, maj_le = datetime('now') WHERE id = ?`).bind(...keys.map((k) => data[k]), id).run();
      return json({ ok: true }, 200, origin);
    }
    if (method === "DELETE") {
      await removeFiles(env, "contact_id = ?", id);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM crm_journal WHERE contact_id = ?").bind(id),
        env.DB.prepare("DELETE FROM crm_devis WHERE contact_id = ?").bind(id),
        env.DB.prepare("DELETE FROM crm_offres WHERE contact_id = ?").bind(id),
        env.DB.prepare("DELETE FROM crm_contacts WHERE id = ?").bind(id),
      ]);
      return json({ ok: true }, 200, origin);
    }
  }

  // POST /contacts/:id/statut { statut: 'client'|'prospect'|'perdu', raison? }
  if ((m = path.match(/^\/contacts\/(\d+)\/statut$/)) && method === "POST") {
    const id = +m[1];
    const b = await body();
    if (!STATUTS.includes(b.statut)) return json({ error: "Statut invalide" }, 400, origin);
    if (b.statut === "client") {
      await env.DB.prepare("UPDATE crm_contacts SET statut = 'client', etape = 'nouveau', client_depuis = COALESCE(client_depuis, date('now')), perdu_raison = NULL, maj_le = datetime('now') WHERE id = ?").bind(id).run();
      await logEvent(env, id, "statut", "Passé en client");
    } else if (b.statut === "perdu") {
      await env.DB.prepare("UPDATE crm_contacts SET statut = 'perdu', perdu_raison = ?, date_relance = NULL, maj_le = datetime('now') WHERE id = ?").bind(clean(b.raison, 200), id).run();
      await logEvent(env, id, "statut", "Classé perdu" + (b.raison ? ` : ${clean(b.raison, 200)}` : ""));
    } else {
      await env.DB.prepare("UPDATE crm_contacts SET statut = 'prospect', perdu_raison = NULL, maj_le = datetime('now') WHERE id = ?").bind(id).run();
      await logEvent(env, id, "statut", "Remis en prospect");
    }
    return json({ ok: true }, 200, origin);
  }

  // POST /contacts/:id/journal { type: appel|mail|rdv|note|whatsapp, texte, date_relance? }
  if ((m = path.match(/^\/contacts\/(\d+)\/journal$/)) && method === "POST") {
    const id = +m[1];
    const b = await body();
    const type = ["appel", "mail", "rdv", "note", "whatsapp"].includes(b.type) ? b.type : "note";
    const texte = clean(b.texte, 2000);
    if (!texte && type === "note") return json({ error: "Texte vide" }, 400, origin);
    const quand = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/.test(String(b.date_echange || "")) ? String(b.date_echange).replace("T", " ") : null;
    await logEvent(env, id, type, texte || "", quand);
    // un premier échange fait avancer un prospect « nouveau » vers « contacté »
    await env.DB.prepare("UPDATE crm_contacts SET etape = CASE WHEN statut = 'prospect' AND etape = 'nouveau' AND ? != 'note' THEN 'contacte' ELSE etape END, maj_le = datetime('now') WHERE id = ?").bind(type, id).run();
    if (b.date_relance) await env.DB.prepare("UPDATE crm_contacts SET date_relance = ? WHERE id = ?").bind(clean(b.date_relance, 10), id).run();
    else if (type !== "note") await relanceParDefaut(env, id);
    return json({ ok: true }, 201, origin);
  }
  if ((m = path.match(/^\/journal\/(\d+)$/)) && method === "DELETE") {
    await env.DB.prepare("DELETE FROM crm_journal WHERE id = ?").bind(+m[1]).run();
    return json({ ok: true }, 200, origin);
  }

  // Devis : POST /contacts/:id/devis, PUT|DELETE /devis/:id
  if ((m = path.match(/^\/contacts\/(\d+)\/devis$/)) && method === "POST") {
    const id = +m[1];
    const b = await body();
    const statut = DEVIS_STATUTS.includes(b.statut) ? b.statut : "brouillon";
    const montant = b.montant_ht === "" || b.montant_ht == null ? null : Number(String(b.montant_ht).replace(",", "."));
    const r = await env.DB.prepare("INSERT INTO crm_devis (contact_id, ref, objet, montant_ht, statut, date_envoi) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, clean(b.ref, 60), clean(b.objet, 200), Number.isFinite(montant) ? montant : null, statut, clean(b.date_envoi, 10) || (statut === "envoye" ? new Date().toISOString().slice(0, 10) : null)).run();
    await afterDevis(env, id, statut, clean(b.ref, 60));
    return json({ id: r.meta.last_row_id }, 201, origin);
  }
  if ((m = path.match(/^\/devis\/(\d+)$/))) {
    const did = +m[1];
    if (method === "DELETE") { await removeFiles(env, "kind = 'devis' AND parent_id = ?", did); await env.DB.prepare("DELETE FROM crm_devis WHERE id = ?").bind(did).run(); return json({ ok: true }, 200, origin); }
    if (method === "PUT") {
      const b = await body();
      const cur = await env.DB.prepare("SELECT contact_id, ref, statut FROM crm_devis WHERE id = ?").bind(did).first();
      if (!cur) return json({ error: "Introuvable" }, 404, origin);
      const statut = DEVIS_STATUTS.includes(b.statut) ? b.statut : cur.statut;
      const montant = b.montant_ht === undefined ? undefined : (b.montant_ht === "" || b.montant_ht == null ? null : Number(String(b.montant_ht).replace(",", ".")));
      await env.DB.prepare("UPDATE crm_devis SET ref = COALESCE(?, ref), objet = COALESCE(?, objet), statut = ?, montant_ht = CASE WHEN ? = 1 THEN ? ELSE montant_ht END, date_envoi = CASE WHEN ? = 'envoye' AND date_envoi IS NULL THEN date('now') ELSE date_envoi END WHERE id = ?")
        .bind(clean(b.ref, 60), clean(b.objet, 200), statut, montant === undefined ? 0 : 1, Number.isFinite(montant) ? montant : null, statut, did).run();
      if (statut !== cur.statut) await afterDevis(env, cur.contact_id, statut, cur.ref);
      return json({ ok: true }, 200, origin);
    }
  }

  // Propositions commerciales (envoyées avant le devis) : POST /contacts/:id/offres, PUT|DELETE /offres/:id
  if ((m = path.match(/^\/contacts\/(\d+)\/offres$/)) && method === "POST") {
    const id = +m[1];
    const b = await body();
    const statut = OFFRE_STATUTS.includes(b.statut) ? b.statut : "brouillon";
    const montant = b.montant_ht === "" || b.montant_ht == null ? null : Number(String(b.montant_ht).replace(",", "."));
    const r = await env.DB.prepare("INSERT INTO crm_offres (contact_id, ref, objet, montant_ht, statut, date_envoi, evenement, date_evenement, complement) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, clean(b.ref, 60), clean(b.objet, 200), Number.isFinite(montant) ? montant : null, statut, clean(b.date_envoi, 10) || (statut === "envoyee" ? new Date().toISOString().slice(0, 10) : null), clean(b.evenement, 120), clean(b.date_evenement, 10), clean(b.complement, 300)).run();
    await afterOffre(env, id, statut, clean(b.ref, 60));
    return json({ id: r.meta.last_row_id }, 201, origin);
  }
  if ((m = path.match(/^\/offres\/(\d+)$/))) {
    const oid = +m[1];
    if (method === "DELETE") { await removeFiles(env, "kind = 'offre' AND parent_id = ?", oid); await env.DB.prepare("DELETE FROM crm_offres WHERE id = ?").bind(oid).run(); return json({ ok: true }, 200, origin); }
    if (method === "PUT") {
      const b = await body();
      const cur = await env.DB.prepare("SELECT contact_id, ref, statut FROM crm_offres WHERE id = ?").bind(oid).first();
      if (!cur) return json({ error: "Introuvable" }, 404, origin);
      const statut = OFFRE_STATUTS.includes(b.statut) ? b.statut : cur.statut;
      const montant = b.montant_ht === undefined ? undefined : (b.montant_ht === "" || b.montant_ht == null ? null : Number(String(b.montant_ht).replace(",", ".")));
      await env.DB.prepare("UPDATE crm_offres SET ref = COALESCE(?, ref), objet = COALESCE(?, objet), statut = ?, montant_ht = CASE WHEN ? = 1 THEN ? ELSE montant_ht END, date_envoi = CASE WHEN ? = 'envoyee' AND date_envoi IS NULL THEN date('now') ELSE date_envoi END WHERE id = ?")
        .bind(clean(b.ref, 60), clean(b.objet, 200), statut, montant === undefined ? 0 : 1, Number.isFinite(montant) ? montant : null, statut, oid).run();
      for (const [k, max] of [["evenement", 120], ["date_evenement", 10], ["complement", 300]]) {
        if (b[k] !== undefined) await env.DB.prepare("UPDATE crm_offres SET " + k + " = ? WHERE id = ?").bind(clean(b[k], max), oid).run();
      }
      if (statut !== cur.statut) await afterOffre(env, cur.contact_id, statut, cur.ref);
      return json({ ok: true }, 200, origin);
    }
  }

  // Pièces jointes PDF d'un devis ou d'une proposition
  // POST /fichiers?kind=devis|offre&parent=ID&nom=fichier.pdf (corps = le PDF), GET /fichiers/:id (affiche le PDF), DELETE /fichiers/:id
  if (path === "/fichiers" && method === "POST") {
    if (!env.CRM_FILES) return json({ error: "Le stockage des pièces jointes n'est pas encore activé sur le serveur" }, 500, origin);
    const kind = url.searchParams.get("kind");
    const parent = parseInt(url.searchParams.get("parent"), 10);
    if (!["devis", "offre"].includes(kind) || !(parent > 0)) return json({ error: "Paramètres invalides" }, 400, origin);
    const row = await env.DB.prepare(`SELECT contact_id FROM ${kind === "devis" ? "crm_devis" : "crm_offres"} WHERE id = ?`).bind(parent).first();
    if (!row) return json({ error: "Devis ou proposition introuvable" }, 404, origin);
    const buf = await request.arrayBuffer();
    if (!buf.byteLength) return json({ error: "Fichier vide" }, 400, origin);
    if (buf.byteLength > MAX_FICHIER) return json({ error: "Fichier trop lourd (15 Mo maximum)" }, 413, origin);
    const head = new TextDecoder("latin1").decode(new Uint8Array(buf, 0, Math.min(1024, buf.byteLength)));
    if (!head.includes("%PDF-")) return json({ error: "Seuls les fichiers PDF sont acceptés" }, 400, origin);
    let nom = clean(url.searchParams.get("nom"), 120) || "document.pdf";
    nom = nom.replace(/[\\/:*?"<>|\r\n]+/g, "_");
    if (!/\.pdf$/i.test(nom)) nom += ".pdf";
    const cle = `crm/${row.contact_id}/${kind}-${parent}/${Date.now()}-${nom.replace(/[^A-Za-z0-9._-]+/g, "_")}`;
    await env.CRM_FILES.put(cle, buf, { httpMetadata: { contentType: "application/pdf" } });
    const r = await env.DB.prepare("INSERT INTO crm_fichiers (contact_id, kind, parent_id, nom, cle, taille) VALUES (?, ?, ?, ?, ?, ?)").bind(row.contact_id, kind, parent, nom, cle, buf.byteLength).run();
    await logEvent(env, row.contact_id, kind === "devis" ? "devis" : "note", `PDF joint (${kind === "devis" ? "devis" : "proposition"}) : ${nom}`);
    await touch(env, row.contact_id);
    return json({ id: r.meta.last_row_id, nom, taille: buf.byteLength }, 201, origin);
  }
  if ((m = path.match(/^\/fichiers\/(\d+)$/))) {
    const fid = +m[1];
    const f = await env.DB.prepare("SELECT id, nom, cle FROM crm_fichiers WHERE id = ?").bind(fid).first();
    if (!f) return json({ error: "Introuvable" }, 404, origin);
    if (method === "GET") {
      if (!env.CRM_FILES) return json({ error: "Stockage indisponible" }, 500, origin);
      const obj = await env.CRM_FILES.get(f.cle);
      if (!obj) return json({ error: "Fichier absent du stockage" }, 404, origin);
      return new Response(obj.body, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${encodeURIComponent(f.nom)}"`, "Cache-Control": "private, no-store", ...cors(origin) } });
    }
    if (method === "DELETE") {
      try { if (env.CRM_FILES) await env.CRM_FILES.delete(f.cle); } catch (e) { /* déjà absent */ }
      await env.DB.prepare("DELETE FROM crm_fichiers WHERE id = ?").bind(fid).run();
      return json({ ok: true }, 200, origin);
    }
  }

  return json({ error: "Route inconnue" }, 404, origin);
}

// Une proposition envoyée fait passer le prospect à l'étape « Proposition envoyée ».
async function afterOffre(env, contactId, statut, ref) {
  const label = ref ? `Proposition ${ref}` : "Proposition commerciale";
  if (statut === "envoyee") {
    await env.DB.prepare("UPDATE crm_contacts SET etape = CASE WHEN statut = 'prospect' AND etape IN ('nouveau','contacte','echange') THEN 'proposition' ELSE etape END, maj_le = datetime('now') WHERE id = ?").bind(contactId).run();
    await logEvent(env, contactId, "mail", `${label} envoyée`);
    await relanceParDefaut(env, contactId);
  } else if (statut === "acceptee") {
    await logEvent(env, contactId, "note", `${label} acceptée : prochaine étape, le devis`);
    await touch(env, contactId);
  } else if (statut === "refusee") {
    await logEvent(env, contactId, "note", `${label} refusée`);
    await touch(env, contactId);
  } else {
    await touch(env, contactId);
  }
}

// Un devis envoyé fait passer le prospect à l'étape « devis » ; un devis accepté le transforme en client.
async function afterDevis(env, contactId, statut, ref) {
  const label = ref ? `Devis ${ref}` : "Devis";
  if (statut === "envoye") {
    await env.DB.prepare("UPDATE crm_contacts SET etape = CASE WHEN statut = 'prospect' AND etape IN ('nouveau','contacte','echange','proposition') THEN 'devis' ELSE etape END, maj_le = datetime('now') WHERE id = ?").bind(contactId).run();
    await logEvent(env, contactId, "devis", `${label} envoyé`);
    await relanceParDefaut(env, contactId);
  } else if (statut === "accepte") {
    await env.DB.prepare("UPDATE crm_contacts SET statut = 'client', etape = 'nouveau', client_depuis = COALESCE(client_depuis, date('now')), date_relance = NULL, maj_le = datetime('now') WHERE id = ?").bind(contactId).run();
    await logEvent(env, contactId, "devis", `${label} accepté : passé en client`);
  } else if (statut === "refuse") {
    await logEvent(env, contactId, "devis", `${label} refusé`);
    await touch(env, contactId);
  } else {
    await touch(env, contactId);
  }
}

// Rappel quotidien : relances dues, devis à préparer, devis sans réponse depuis 7 jours. Uniquement des chiffres (aucun nom dans la notification).
export async function crmReminderMessage(env, today) {
  await ensureCrmSchema(env);
  const n = async (sql, ...p) => ((await env.DB.prepare(sql).bind(...p).first()) || {}).n || 0;
  const relances = await n("SELECT COUNT(*) AS n FROM crm_contacts WHERE statut != 'perdu' AND date_relance IS NOT NULL AND date_relance != '' AND date_relance <= ?", today);
  const aPreparer = await n("SELECT COUNT(*) AS n FROM crm_contacts c WHERE c.statut = 'prospect' AND c.etape = 'echange' AND NOT EXISTS (SELECT 1 FROM crm_devis d WHERE d.contact_id = c.id)");
  const sansReponse = await n("SELECT COUNT(DISTINCT c.id) AS n FROM crm_contacts c JOIN crm_devis d ON d.contact_id = c.id WHERE c.statut = 'prospect' AND d.statut = 'envoye' AND d.date_envoi IS NOT NULL AND d.date_envoi <= date(?, '-7 days')", today);
  const offresSansReponse = await n("SELECT COUNT(DISTINCT c.id) AS n FROM crm_contacts c JOIN crm_offres o ON o.contact_id = c.id WHERE c.statut = 'prospect' AND c.etape = 'proposition' AND o.statut = 'envoyee' AND o.date_envoi IS NOT NULL AND o.date_envoi <= date(?, '-7 days')", today);
  const parts = [];
  if (relances) parts.push(`${relances} relance${relances > 1 ? "s" : ""}`);
  if (aPreparer) parts.push(`${aPreparer} devis à préparer`);
  if (offresSansReponse) parts.push(`${offresSansReponse} proposition${offresSansReponse > 1 ? "s" : ""} sans réponse (7 j)`);
  if (sansReponse) parts.push(`${sansReponse} devis sans réponse (7 j)`);
  if (!parts.length) return null;
  return { title: "👥 SLP — à faire aujourd'hui", body: parts.join(" · "), url: "/admin-contacts.html#relance" };
}
