/* Onglet « Prospects & clients » de l'admin SLP : une seule base, deux statuts, suivi des échanges et des devis, export Brevo.
   Chargé par admin.html après le script principal (utilise la variable globale `token`). */
(function () {
  const ETAPES = [['nouveau', 'Nouveau'], ['contacte', 'Contacté'], ['echange', 'Échange en cours'], ['proposition', 'Proposition envoyée'], ['devis', 'Devis envoyé'], ['negociation', 'Négociation']];
  const ETAPE_LBL = Object.fromEntries(ETAPES);
  const CATEGORIES = ['Mairie', 'Comité des fêtes', 'Association', 'Centre culturel', 'Entreprise', 'Particulier', 'Camping / hôtel', 'Autre'];
  const TYPES_J = [['appel', '📞 Appel'], ['mail', '✉️ Mail'], ['whatsapp', '💬 WhatsApp'], ['rdv', '🤝 RDV'], ['note', '📝 Note']];
  const OFFRE_ST = [['brouillon', 'Brouillon'], ['envoyee', 'Envoyée'], ['acceptee', 'Acceptée'], ['refusee', 'Refusée']];
  const DEVIS_ST = [['brouillon', 'Brouillon'], ['envoye', 'Envoyé'], ['accepte', 'Accepté'], ['refuse', 'Refusé']];

  let all = [], vue = 'prospect', filtreEtape = '', q = '', ready = false, cur = null;
  const $ = (id) => document.getElementById(id);
  const ce = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => new Date().toISOString().slice(0, 10);
  const eur = (n) => (n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
  const fmtD = (d) => (d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : '');
  const fmtDT = (d) => (d ? fmtD(d.slice(0, 10)) + ' ' + d.slice(11, 16) : '');
  // heure de Paris au format « AAAA-MM-JJ HH:MM » ; les dates de saisie (cree_le) sont stockées en UTC
  const parisFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const nowParis = () => parisFmt.format(new Date());
  const quand = (j) => j.date_echange || (j.cree_le ? parisFmt.format(new Date(j.cree_le.replace(' ', 'T') + 'Z')) : '');
  const parDate = (list) => list.slice().sort((a, b) => quand(b).localeCompare(quand(a)) || b.id - a.id);
  const nomAff = (c) => c.organisation || [c.prenom, c.nom].filter(Boolean).join(' ') || c.email || c.telephone || 'Sans nom';
  const sousNom = (c) => (c.organisation ? [c.prenom, c.nom].filter(Boolean).join(' ') + (c.fonction ? ' (' + c.fonction + ')' : '') : '');

  async function api(path, opt) {
    opt = opt || {};
    const r = await fetch('/api/admin/crm' + path, { method: opt.method || 'GET', headers: Object.assign({ Authorization: 'Bearer ' + token }, opt.body ? { 'Content-Type': 'application/json' } : {}), body: opt.body ? JSON.stringify(opt.body) : undefined });
    if (opt.raw) return r;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || 'Erreur ' + r.status); e.status = r.status; e.data = j; throw e; }
    return j;
  }

  function injectStyle() {
    const s = document.createElement('style');
    s.textContent = `
    #tab-crm .crm-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:14px 0}
    #tab-crm .crm-kpi{background:var(--ink-2);border:1px solid var(--line);border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:4px}
    #tab-crm .crm-kpi b{font-family:'Space Grotesk',sans-serif;font-size:1.9rem;line-height:1.1;color:var(--paper)}
    #tab-crm .crm-kpi b small{font-size:.9rem;color:var(--amber)}
    #tab-crm .crm-kpi span{font-size:.95rem;color:var(--muted)}
    #tab-crm .crm-badge.money{font-size:.95rem;padding:4px 12px}
    #tab-crm .crm-seg{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}
    #tab-crm .crm-seg .period-btn.on,#tab-crm .crm-chip.on{background:var(--amber);color:#1b1300;border-color:var(--amber);font-weight:700}
    #tab-crm .crm-chip{background:var(--ink-2);border:1px solid var(--line);color:var(--muted);border-radius:100px;padding:5px 12px;font-size:.78rem;cursor:pointer}
    #tab-crm .crm-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}
    #tab-crm input,#tab-crm select,#tab-crm textarea,#crmModal input,#crmModal select,#crmModal textarea{background:var(--ink);border:1px solid var(--line);color:var(--paper);border-radius:10px;padding:10px 12px;font:inherit;font-size:16px;min-width:0}
    #tab-crm .crm-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:10px}
    #tab-crm .crm-card{background:var(--ink-2);border:1px solid var(--line);border-radius:14px;padding:12px 14px;cursor:pointer}
    #tab-crm .crm-card:active{transform:scale(.99)}
    #tab-crm .crm-card h4{margin:0 0 2px;font-size:1rem;font-family:'Space Grotesk',sans-serif}
    #tab-crm .crm-sub{color:var(--muted);font-size:.9rem}
    #tab-crm .crm-badge{display:inline-block;border-radius:100px;padding:3px 11px;font-size:.82rem;font-weight:700;background:rgba(139,92,246,.25);color:#d6c6ff;margin-right:4px}
    #tab-crm .crm-badge.client{background:rgba(47,155,255,.25);color:#b9dcff}
    #tab-crm .crm-badge.late{background:rgba(255,77,125,.3);color:#ffc2d3}
    #tab-crm .crm-badge.prio{background:rgba(255,178,56,.3);color:#ffe0a8}
    #tab-crm .crm-acts{display:flex;gap:6px;margin-top:8px}
    #tab-crm .crm-acts a{flex:1;text-align:center;background:var(--ink);border:1px solid var(--line);border-radius:10px;padding:8px 4px;color:var(--paper);text-decoration:none;font-size:.85rem}
    #crmModal{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:none;align-items:flex-start;justify-content:center;overflow:auto;padding:16px}
    #crmModal .crm-box{background:var(--ink-2);border:1px solid var(--line);border-radius:16px;width:100%;max-width:720px;padding:16px;margin:auto;color:var(--paper)}
    #crmModal .row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
    #crmModal .row.one{grid-template-columns:1fr}
    #crmModal label{font-size:.74rem;color:var(--muted);display:block;margin-bottom:2px}
    #crmModal input,#crmModal select,#crmModal textarea{width:100%}
    #crmModal .j{border-left:3px solid var(--violet);padding:4px 10px;margin:6px 0;font-size:.88rem;white-space:pre-wrap}
    #crmModal .j small{color:var(--muted);display:block}
    #crmModal .crm-sec{margin-top:16px;border-top:1px solid var(--line);padding-top:12px}
    #crmModal .crm-sticky{position:sticky;bottom:-16px;margin:16px -16px -16px;padding:10px 16px calc(10px + env(safe-area-inset-bottom));background:var(--ink-2);border-top:1px solid var(--line);border-radius:0 0 16px 16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
    #crmModal .crm-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}
    #crmModal .crm-sub{color:var(--muted);font-size:.8rem}
    #crmModal .crm-badge{display:inline-block;border-radius:100px;padding:2px 10px;font-size:.72rem;font-weight:700;background:rgba(139,92,246,.25);color:#d6c6ff;margin-right:4px}
    #crmModal .crm-badge.client{background:rgba(47,155,255,.25);color:#b9dcff}
    #crmModal .crm-files{margin:4px 0;display:flex;flex-direction:column;gap:3px}
    #crmModal .crm-file a{color:var(--blue);text-decoration:underline;padding:4px 0;display:inline-block}
    #crmViewer{position:fixed;inset:0;z-index:10000;background:#000;display:flex;flex-direction:column}
    #crmViewer .vbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:calc(8px + env(safe-area-inset-top)) 10px 8px;background:var(--ink-2);color:var(--paper);border-bottom:1px solid var(--line)}
    #crmViewer .vbar b{font-size:.85rem;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #crmViewer .vbar a.period-btn{text-decoration:none}
    #crmViewer iframe{flex:1;border:0;background:#fff;width:100%}
    @media(max-width:560px){#crmModal .row{grid-template-columns:1fr}#crmModal{padding:6px}}`;
    document.head.appendChild(s);
  }

  function build() {
    const t = $('tab-crm');
    t.innerHTML = `
      <h2>Prospects & clients</h2>
      <p class="vz-sub">Une seule base : tu suis chaque contact jusqu'au devis accepté, il devient alors client automatiquement. Export prêt à importer dans Brevo.</p>
      <div id="crmStats" class="crm-kpis"></div>
      <div class="crm-seg" id="crmSeg"></div>
      <div class="crm-bar">
        <input id="crmQ" type="search" placeholder="Rechercher (nom, ville, email, tel…)" style="flex:1 1 220px">
        <button class="period-btn" type="button" id="crmNew">＋ Nouveau</button>
        <button class="period-btn" type="button" id="crmImp">⬆ Importer</button>
        <button class="period-btn" type="button" id="crmExp">⬇ Export Brevo</button>
      </div>
      <div class="crm-seg" id="crmChips"></div>
      <div id="crmList" class="crm-list"></div>`;
    $('crmQ').addEventListener('input', (e) => { q = e.target.value.toLowerCase(); render(); });
    $('crmNew').onclick = () => openForm(null);
    $('crmImp').onclick = openImport;
    $('crmExp').onclick = openExport;
    const m = document.createElement('div');
    m.id = 'crmModal';
    m.addEventListener('mousedown', (e) => { if (e.target === m) closeModal(); });
    document.body.appendChild(m);
    injectStyle();
  }

  function filtered() {
    return all.filter((c) => {
      if (vue === 'relance') { if (c.statut === 'perdu' || !c.date_relance || c.date_relance > today()) return false; }
      else if (vue !== 'tous' && c.statut !== vue) return false;
      if (filtreEtape && c.etape !== filtreEtape) return false;
      if (q) {
        const hay = [c.organisation, c.prenom, c.nom, c.ville, c.email, c.telephone, c.code_postal, c.evenement, c.categorie, c.source].join(' ').toLowerCase();
        if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
      }
      return true;
    });
  }

  function render() {
    const n = (f) => all.filter(f).length;
    const nLate = n((c) => c.statut !== 'perdu' && c.date_relance && c.date_relance <= today());
    const ca = all.reduce((s, c) => s + (c.ca_accepte || 0), 0), enc = all.reduce((s, c) => s + (c.devis_en_cours || 0), 0);
    const offEnc = all.reduce((s, c) => s + (c.offres_en_cours || 0), 0);
    const kpi = (v, l) => `<div class="crm-kpi"><b>${v}</b><span>${l}</span></div>`;
    $('crmStats').innerHTML = kpi(n((c) => c.statut === 'prospect'), 'prospects') + kpi(n((c) => c.statut === 'client'), 'clients')
      + kpi(eur(offEnc) + ' <small>HT</small>', 'propositions en attente') + kpi(eur(enc) + ' <small>HT</small>', 'devis en attente') + kpi(eur(ca) + ' <small>HT</small>', 'devis acceptés');
    const segs = [['prospect', 'Prospects'], ['client', 'Clients'], ['relance', '⏰ À relancer (' + nLate + ')'], ['perdu', 'Perdus'], ['tous', 'Tous']];
    $('crmSeg').innerHTML = segs.map(([k, l]) => `<button type="button" class="period-btn${vue === k ? ' on' : ''}" data-v="${k}">${l}</button>`).join('');
    $('crmSeg').querySelectorAll('button').forEach((b) => (b.onclick = () => { vue = b.dataset.v; filtreEtape = ''; render(); }));
    $('crmChips').innerHTML = vue === 'prospect' ? `<span class="crm-chip${!filtreEtape ? ' on' : ''}" data-e="">Toutes étapes</span>` + ETAPES.map(([k, l]) => `<span class="crm-chip${filtreEtape === k ? ' on' : ''}" data-e="${k}">${l} (${n((c) => c.statut === 'prospect' && c.etape === k)})</span>`).join('') : '';
    $('crmChips').querySelectorAll('.crm-chip').forEach((b) => (b.onclick = () => { filtreEtape = b.dataset.e; render(); }));
    const rows = filtered().sort((a, b) => {
      if (vue === 'relance') return (a.date_relance || '').localeCompare(b.date_relance || '');
      return (b.priorite - a.priorite) || (b.maj_le || '').localeCompare(a.maj_le || '');
    });
    const html = rows.slice(0, 300).map((c) => {
      const late = c.statut !== 'perdu' && c.date_relance && c.date_relance <= today();
      const wa = c.telephone ? 'https://wa.me/' + c.telephone.replace(/^0/, '33').replace(/^\+/, '') : '';
      return `<div class="crm-card" data-id="${c.id}">
        <h4>${c.priorite ? '⭐ ' : ''}${ce(nomAff(c))}</h4>
        <div class="crm-sub">${ce(sousNom(c))}${sousNom(c) && c.ville ? ' · ' : ''}${ce(c.ville || '')}${c.categorie ? ' · ' + ce(c.categorie) : ''}</div>
        <div style="margin-top:6px">
          ${c.statut === 'client' ? '<span class="crm-badge client">Client</span>' : c.statut === 'perdu' ? '<span class="crm-badge">Perdu</span>' : `<span class="crm-badge">${ce(ETAPE_LBL[c.etape] || c.etape)}</span>`}
          ${late ? `<span class="crm-badge late">⏰ ${fmtD(c.date_relance)}</span>` : c.date_relance ? `<span class="crm-sub">relance ${fmtD(c.date_relance)}</span>` : ''}
          ${c.offres_en_cours ? `<span class="crm-badge prio money">Proposition ${eur(c.offres_en_cours)} HT</span>` : ''}${c.devis_en_cours ? `<span class="crm-badge prio money">Devis ${eur(c.devis_en_cours)} HT</span>` : ''}
        </div>
        ${c.prochaine_action ? `<div class="crm-sub" style="margin-top:4px">→ ${ce(c.prochaine_action)}</div>` : ''}
        ${(c.pdf_offre_id || c.pdf_devis_id) ? `<div class="crm-acts" onclick="event.stopPropagation()">
          ${c.pdf_offre_id ? `<a href="#" data-pdf="${c.pdf_offre_id}" data-nom="${ce(c.pdf_offre_nom)}" style="background:var(--blue);color:#06121f;font-weight:700;border-color:var(--blue)">👁 Proposition</a>` : ''}${c.pdf_devis_id ? `<a href="#" data-pdf="${c.pdf_devis_id}" data-nom="${ce(c.pdf_devis_nom)}" style="background:var(--amber);color:#1b1300;font-weight:700;border-color:var(--amber)">👁 Devis</a>` : ''}
        </div>` : ''}
        <div class="crm-acts" onclick="event.stopPropagation()">
          <a href="#" data-resume="${c.id}" style="background:var(--amber);color:#1b1300;font-weight:700;border-color:var(--amber)">📋 Résumé des échanges</a>
        </div>
        <div class="crm-acts" onclick="event.stopPropagation()">
          ${c.telephone ? `<a href="tel:${ce(c.telephone)}">📞 Appeler</a>` : ''}${wa ? `<a href="${ce(wa)}" target="_blank" rel="noopener">💬</a>` : ''}${c.email ? `<a href="mailto:${ce(c.email)}">✉️</a>` : ''}
        </div></div>`;
    }).join('');
    $('crmList').innerHTML = html || '<p class="vz-note">Aucun contact ici. Utilise « ＋ Nouveau » ou « ⬆ Importer ».</p>';
    $('crmList').querySelectorAll('.crm-card').forEach((el) => (el.onclick = () => openDetail(+el.dataset.id)));
    $('crmList').querySelectorAll('[data-resume]').forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); openResume(+a.dataset.resume); }));
    $('crmList').querySelectorAll('[data-pdf]').forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); viewFile(a.dataset.pdf, a.dataset.nom); }));
    if (rows.length > 300) $('crmList').insertAdjacentHTML('beforeend', `<p class="vz-note">300 premiers résultats sur ${rows.length} : affine la recherche.</p>`);
  }

  async function load() {
    try { all = (await api('/contacts')).contacts; render(); }
    catch (e) { $('crmList').innerHTML = `<p class="vz-note">Erreur : ${ce(e.message)}</p>`; }
  }

  function modal(html) { const m = $('crmModal'); m.innerHTML = `<div class="crm-box">${html}</div>`; m.style.display = 'flex'; m.scrollTop = 0; }
  function closeModal() { $('crmModal').style.display = 'none'; $('crmModal').innerHTML = ''; cur = null; }
  window.crmClose = closeModal;

  const opt = (list, v) => list.map((x) => { const [k, l] = Array.isArray(x) ? x : [x, x]; return `<option value="${ce(k)}"${k === v ? ' selected' : ''}>${ce(l)}</option>`; }).join('');
  const fld = (id, lab, v, type) => `<div><label>${lab}</label><input id="cf_${id}" type="${type || 'text'}" value="${ce(v)}"></div>`;

  function formHtml(c, quick) {
    c = c || { statut: 'prospect', etape: 'nouveau' };
    const adv = `
      <div class="row"><div><label>Catégorie</label><select id="cf_categorie"><option value=""></option>${opt(CATEGORIES, c.categorie)}</select></div>${fld('fonction', 'Fonction', c.fonction)}</div>
      <div class="row">${fld('ville', 'Ville', c.ville)}${fld('code_postal', 'Code postal', c.code_postal)}</div>
      <div class="row">${fld('date_evenement', "Date de l'événement", c.date_evenement, 'date')}${fld('budget', 'Budget annoncé', c.budget)}</div>
      <div class="row">${fld('source', 'Source', c.source)}${fld('prochaine_action', 'Prochaine action', c.prochaine_action)}</div>
      ${c.statut === 'prospect' || !c.id ? `<div class="row one"><div><label>Étape</label><select id="cf_etape">${opt(ETAPES, c.etape)}</select></div></div>` : ''}
      <label style="display:block;margin:4px 0"><input type="checkbox" id="cf_priorite" style="width:auto"${c.priorite ? ' checked' : ''}> ⭐ Prioritaire</label>
      <label style="display:block;margin:4px 0"><input type="checkbox" id="cf_no_mailing" style="width:auto"${c.no_mailing ? ' checked' : ''}> Ne pas inclure dans les mailings (désinscrit / refus)</label>`;
    return `
      <div class="row one"><div><label>Organisation / société</label><input id="cf_organisation" value="${ce(c.organisation)}" placeholder="Mairie de…, Comité des fêtes de…"></div></div>
      <div class="row">${fld('prenom', 'Prénom', c.prenom)}${fld('nom', 'Nom', c.nom)}</div>
      <div class="row">${fld('telephone', 'Téléphone', c.telephone, 'tel')}${fld('email', 'Email', c.email, 'email')}</div>
      <div class="row one">${fld('evenement', 'Événement / besoin', c.evenement)}</div>
      <div class="row">${fld('date_relance', 'Date de relance', c.date_relance, 'date')}<div></div></div>
      <div class="row one"><div><label>Notes</label><textarea id="cf_notes" rows="3">${ce(c.notes)}</textarea></div></div>
      ${quick ? `<details style="margin:6px 0"><summary class="vz-note" style="cursor:pointer;padding:6px 0">Plus de champs (ville, catégorie, budget…)</summary>${adv}</details>` : adv}`;
  }

  function readForm() {
    const g = (id) => { const el = $('cf_' + id); return el ? el.value : undefined; };
    const o = {};
    ['organisation', 'categorie', 'prenom', 'nom', 'fonction', 'telephone', 'email', 'ville', 'code_postal', 'evenement', 'date_evenement', 'budget', 'source', 'prochaine_action', 'date_relance', 'notes', 'etape'].forEach((k) => { const v = g(k); if (v !== undefined) o[k] = v; });
    o.priorite = $('cf_priorite').checked ? 1 : 0;
    o.no_mailing = $('cf_no_mailing').checked ? 1 : 0;
    return o;
  }

  function openForm(c) {
    modal(`<h3 style="margin-top:0">Nouveau contact</h3>${formHtml(null, true)}
      <div class="crm-bar"><button class="period-btn on" style="background:var(--amber);color:#1b1300" id="cfSave" type="button">Créer</button>
      <button class="period-btn" type="button" onclick="crmClose()">Annuler</button><span id="cfMsg" class="vz-note"></span></div>
      <label style="display:block;margin-top:8px"><input type="checkbox" id="cfClient" style="width:auto"> C'est déjà un client</label>`);
    $('cfSave').onclick = async () => {
      const b = readForm(); if ($('cfClient').checked) b.statut = 'client';
      try { await api('/contacts', { method: 'POST', body: b }); closeModal(); await load(); }
      catch (e) { $('cfMsg').textContent = e.message; if (e.status === 409 && e.data.id) { $('cfMsg').innerHTML = ce(e.message) + ' — <a href="#" id="cfOpen">ouvrir la fiche</a>'; $('cfOpen').onclick = (ev) => { ev.preventDefault(); openDetail(e.data.id); }; } }
    };
  }

  const ko = (n) => (n ? (n >= 1048576 ? (n / 1048576).toFixed(1) + ' Mo' : Math.max(1, Math.round(n / 1024)) + ' Ko') : '');

  // Bloc « Propositions commerciales » ou « Devis » : liste, statut, PDF joints (cliquables), ajout.
  function docSection(d, kind, titre, items, statuts, defSt, refPh, note) {
    const p = kind === 'offre' ? 'o' : 'v';
    const sing = kind === 'devis' ? 'le devis' : 'la proposition';
    const files = (pid) => (d.fichiers || []).filter((f) => f.kind === kind && f.parent_id === pid);
    const lines = items.map((v) => `<div class="j" style="border-color:var(--amber)"><b>${ce(v.ref || (kind === 'devis' ? 'Devis' : 'Proposition'))}</b> ${ce(v.objet || '')} — ${v.montant_ht != null ? eur(v.montant_ht) + ' HT' : 'montant ?'}${v.date_envoi ? ' · envoyé(e) le ' + fmtD(v.date_envoi) : ''}
        <div class="crm-files">${files(v.id).map((f) => `<span class="crm-file"><a href="#" data-fv="${f.id}" data-fn="${ce(f.nom)}">📄 ${ce(f.nom)}</a> <small>${ko(f.taille)}</small> <a href="#" data-fd="${f.id}" style="color:var(--pink)" title="Retirer ce PDF">✕</a></span>`).join('') || '<span class="vz-note">Aucun PDF joint</span>'}</div>
        <div class="crm-bar" style="margin:4px 0 0"><button class="period-btn" type="button" data-view="${kind}:${v.id}" style="padding:6px 14px;font-size:.85rem;background:var(--blue);color:#06121f;font-weight:700;border-color:var(--blue)">👁 Voir ${kind === 'devis' ? 'le devis' : 'la proposition'}</button>
          <select data-st="${kind}:${v.id}" style="padding:6px 8px;font-size:14px">${opt(statuts, v.statut)}</select>
          <button class="period-btn" type="button" data-up="${kind}:${v.id}" style="padding:5px 12px;font-size:.78rem">📎 Joindre un PDF</button>
          <a href="#" data-del="${kind}:${v.id}" style="color:var(--pink);font-size:.8rem">supprimer</a></div></div>`).join('');
    return `<div class="crm-sec"><h4 style="margin:0 0 8px">${titre}</h4>
        <div>${lines || `<p class="vz-note">Aucun${kind === 'devis' ? ' devis' : 'e proposition'}.</p>`}</div>
        <div class="row"><div><label>Réf.</label><input id="${p}Ref" placeholder="${refPh}"></div><div><label>Montant HT (€)</label><input id="${p}Mt" inputmode="decimal"></div></div>
        <div class="row"><div><label>Objet</label><input id="${p}Obj" placeholder="Soirée, mariage, fête du village…"></div><div><label>Statut</label><select id="${p}St">${opt(statuts, defSt)}</select></div></div>
        <div class="row one"><div><label>PDF à joindre (facultatif)</label><input id="${p}File" type="file" accept="application/pdf,.pdf"></div></div>
        <button class="period-btn" type="button" id="${p}Add">Ajouter ${sing}</button>
        <p class="vz-note">${note}</p></div>`;
  }

  async function upload(kind, parentId, file) {
    if (file.size > 15 * 1024 * 1024) throw new Error('Fichier trop lourd (15 Mo maximum)');
    const r = await fetch('/api/admin/crm/fichiers?kind=' + kind + '&parent=' + parentId + '&nom=' + encodeURIComponent(file.name), { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/pdf' }, body: file });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Erreur ' + r.status);
    return j;
  }

  // Lecteur de PDF : récupère le fichier avec le mot de passe admin puis l'affiche dans la page.
  async function viewFile(fid, nom) {
    let url;
    try {
      const r = await fetch('/api/admin/crm/fichiers/' + fid, { headers: { Authorization: 'Bearer ' + token } });
      if (!r.ok) throw new Error('Erreur ' + r.status);
      url = URL.createObjectURL(await r.blob());
    } catch (e) { alert("Impossible d'ouvrir ce PDF : " + e.message); return; }
    const v = document.createElement('div');
    v.id = 'crmViewer';
    v.innerHTML = `<div class="vbar"><b>${ce(nom)}</b><span style="flex:1"></span><a class="period-btn" href="${url}" target="_blank" rel="noopener">Ouvrir en grand</a><a class="period-btn" href="${url}" download="${ce(nom)}">Télécharger</a><button class="period-btn" type="button" id="vClose">✕ Fermer</button></div><iframe src="${url}" title="${ce(nom)}"></iframe>`;
    document.body.appendChild(v);
    $('vClose').onclick = () => { v.remove(); URL.revokeObjectURL(url); };
  }

  // Résumé des échanges d'un contact : reprend le suivi, du plus ancien au plus récent, prêt à lire ou à copier.
  async function openResume(id) {
    let d;
    try { d = await api('/contacts/' + id); } catch (e) { alert(e.message); return; }
    const c = d.contact, TL = (t) => (TYPES_J.find((x) => x[0] === t) || [0, t])[1].replace(/^\S+\s/, '');
    const echanges = parDate(d.journal).reverse();
    const docs = [].concat((d.offres || []).map((o) => ['Proposition', o]), (d.devis || []).map((o) => ['Devis', o]));
    const head = [nomAff(c) + (c.ville ? ' (' + c.ville + ')' : ''), c.evenement ? 'Besoin : ' + c.evenement : '',
      'Statut : ' + (c.statut === 'client' ? 'client' : c.statut === 'perdu' ? 'perdu' : (ETAPE_LBL[c.etape] || c.etape)),
      c.date_relance ? 'Prochaine relance : ' + fmtD(c.date_relance) : ''].filter(Boolean);
    const docLines = docs.map(([k, o]) => k + (o.ref ? ' ' + o.ref : '') + (o.montant_ht != null ? ' : ' + eur(o.montant_ht) + ' HT' : '') + ' (' + String(o.statut).toLowerCase() + ')');
    const lines = echanges.map((j) => fmtDT(quand(j)) + ' · ' + TL(j.type) + (j.texte ? ' : ' + j.texte : ''));
    const txt = head.join('\n') + (docLines.length ? '\n\n' + docLines.join('\n') : '') + '\n\nÉchanges :\n' + (lines.join('\n') || 'Aucun échange noté.');
    modal(`<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><h3 style="margin:0">Résumé des échanges</h3><button class="period-btn" type="button" onclick="crmClose()">✕</button></div>
      <p style="font-size:1.05rem;margin:10px 0 2px"><b>${ce(head[0])}</b></p>
      <p class="crm-sub" style="font-size:.95rem">${ce(head.slice(1).join(' · '))}</p>
      ${docLines.length ? `<div class="crm-sec" style="margin-top:10px;padding-top:8px">${docLines.map((l) => `<div style="font-size:1rem;margin:4px 0">${ce(l)}</div>`).join('')}</div>` : ''}
      <div class="crm-sec" style="margin-top:10px">${echanges.map((j) => `<div class="j" style="font-size:1rem"><small style="font-size:.85rem">${fmtDT(quand(j))} · ${ce(TL(j.type))}</small>${ce(j.texte)}</div>`).join('') || '<p class="vz-note">Aucun échange noté.</p>'}</div>
      <div class="crm-bar" style="margin-top:12px"><button class="period-btn" style="background:var(--amber);color:#1b1300;font-weight:700" id="rsCopy" type="button">Copier le résumé</button>
      <button class="period-btn" type="button" id="rsOpen">Ouvrir la fiche</button><span id="rsMsg" class="vz-note"></span></div>`);
    $('rsCopy').onclick = async () => { try { await navigator.clipboard.writeText(txt); $('rsMsg').textContent = 'Copié ✓'; } catch (e) { $('rsMsg').textContent = 'Copie impossible'; } };
    $('rsOpen').onclick = () => openDetail(id);
  }

  async function openDetail(id) {
    modal('<p class="vz-note">Chargement…</p>');
    let d;
    try { d = await api('/contacts/' + id); } catch (e) { modal(`<p>${ce(e.message)}</p><button class="period-btn" onclick="crmClose()">Fermer</button>`); return; }
    cur = d; const c = d.contact;
    const wa = c.telephone ? 'https://wa.me/' + c.telephone.replace(/^0/, '33').replace(/^\+/, '') : '';
    modal(`
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
        <div><h3 style="margin:0">${ce(nomAff(c))}</h3>
          <span class="crm-badge ${c.statut === 'client' ? 'client' : ''}">${c.statut === 'client' ? 'Client' + (c.client_depuis ? ' depuis ' + fmtD(c.client_depuis) : '') : c.statut === 'perdu' ? 'Perdu' + (c.perdu_raison ? ' : ' + ce(c.perdu_raison) : '') : ce(ETAPE_LBL[c.etape] || c.etape)}</span>
          ${c.brevo_le ? `<span class="crm-sub">exporté Brevo ${fmtD(c.brevo_le.slice(0, 10))}</span>` : ''}</div>
        <button class="period-btn" type="button" onclick="crmClose()">✕</button></div>
      <div class="crm-bar" style="margin-top:10px">
        ${c.statut !== 'client' ? '<button class="period-btn" type="button" id="dClient">✅ Passer en client</button>' : '<button class="period-btn" type="button" id="dProsp">↩ Remettre en prospect</button>'}
        ${c.statut !== 'perdu' ? '<button class="period-btn" type="button" id="dPerdu">✖ Perdu</button>' : '<button class="period-btn" type="button" id="dProsp">↩ Remettre en prospect</button>'}
        ${c.telephone ? `<a class="period-btn" style="text-decoration:none" href="tel:${ce(c.telephone)}">📞</a>` : ''}${wa ? `<a class="period-btn" style="text-decoration:none" href="${ce(wa)}" target="_blank" rel="noopener">💬</a>` : ''}${c.email ? `<a class="period-btn" style="text-decoration:none" href="mailto:${ce(c.email)}">✉️</a>` : ''}
      </div>
      <div class="crm-sec"><h4 style="margin:0 0 8px">Fiche</h4>${formHtml(c)}
        <div class="crm-bar"><button class="period-btn" style="background:var(--amber);color:#1b1300" id="dSave" type="button">Enregistrer</button><span id="dMsg" class="vz-note"></span></div></div>
      <div class="crm-sec"><h4 style="margin:0 0 8px">Suivi des échanges</h4>
        <div class="row"><div><label>Type d'échange</label><select id="jType">${opt(TYPES_J, 'appel')}</select></div><div><label>Date et heure de l'échange</label><input id="jWhen" type="datetime-local" value="${nowParis().replace(' ', 'T')}"></div></div>
        <div class="row one"><textarea id="jTxt" rows="2" placeholder="Ce qui s'est dit, ce qui est convenu…"></textarea></div>
        <div class="row"><div><label>Prochaine relance (facultatif)</label><input id="jRel" type="date"></div><div></div></div>
        <button class="period-btn" type="button" id="jAdd">Ajouter au suivi</button>
        <div id="jList">${parDate(d.journal).map((j) => `<div class="j"><small>${fmtDT(quand(j))} · ${ce((TYPES_J.find((t) => t[0] === j.type) || [0, j.type])[1])} <a href="#" data-jd="${j.id}" style="color:var(--pink)">suppr.</a></small>${ce(j.texte)}</div>`).join('') || '<p class="vz-note">Aucun échange noté.</p>'}</div></div>
      ${docSection(d, 'offre', 'Propositions commerciales', d.offres || [], OFFRE_ST, 'envoyee', 'ex. P-2026-007', "Proposition « Envoyée » → le prospect passe à l'étape Proposition envoyée.")}
      ${docSection(d, 'devis', 'Devis', d.devis, DEVIS_ST, 'envoye', 'ex. D-2026-014', "Devis « Envoyé » → le prospect passe à l'étape Devis. Devis « Accepté » → il devient client.")}
      <input type="file" id="fileIn" accept="application/pdf,.pdf" style="display:none">
      <div class="crm-sec"><button class="period-btn" type="button" id="dDel" style="color:var(--pink)">🗑 Supprimer ce contact</button></div>
      <div class="crm-sticky"><button class="period-btn" style="background:var(--amber);color:#1b1300;font-weight:700;flex:1" id="dSave2" type="button">💾 Enregistrer les infos de la fiche</button><span id="dMsg2" class="vz-note"></span></div>`);
    const refresh = async () => { const y = $('crmModal').scrollTop; await openDetail(id); $('crmModal').scrollTop = y; load(); };
    const saveFiche = async () => {
      const set = (t) => { $('dMsg').textContent = t; $('dMsg2').textContent = t; };
      try { await api('/contacts/' + id, { method: 'PUT', body: readForm() }); set('Enregistré ✓'); load(); }
      catch (e) { set(e.message); }
    };
    $('dSave').onclick = saveFiche;
    $('dSave2').onclick = saveFiche;
    const stat = (statut, raison) => api('/contacts/' + id + '/statut', { method: 'POST', body: { statut, raison } }).then(refresh);
    if ($('dClient')) $('dClient').onclick = () => stat('client');
    if ($('dProsp')) $('dProsp').onclick = () => stat('prospect');
    if ($('dPerdu')) $('dPerdu').onclick = () => { const r = prompt('Raison (facultatif) : prix, date prise, pas de réponse…', ''); if (r !== null) stat('perdu', r); };
    $('jAdd').onclick = async () => {
      const b = { type: $('jType').value, texte: $('jTxt').value }; if ($('jRel').value) b.date_relance = $('jRel').value; if ($('jWhen').value) b.date_echange = $('jWhen').value;
      try { await api('/contacts/' + id + '/journal', { method: 'POST', body: b }); refresh(); } catch (e) { alert(e.message); }
    };
    $('jList').querySelectorAll('[data-jd]').forEach((a) => (a.onclick = async (ev) => { ev.preventDefault(); if (confirm('Supprimer cette ligne du suivi ?')) { await api('/journal/' + a.dataset.jd, { method: 'DELETE' }); refresh(); } }));
    const BASE = { offre: 'offres', devis: 'devis' };
    ['offre', 'devis'].forEach((kind) => {
      const p = kind === 'offre' ? 'o' : 'v';
      $(p + 'Add').onclick = async () => {
        const btn = $(p + 'Add'); btn.disabled = true;
        try {
          const r = await api('/contacts/' + id + '/' + BASE[kind], { method: 'POST', body: { ref: $(p + 'Ref').value, objet: $(p + 'Obj').value, montant_ht: $(p + 'Mt').value, statut: $(p + 'St').value } });
          const f = $(p + 'File').files[0];
          if (f) await upload(kind, r.id, f);
          refresh();
        } catch (e) { alert(e.message); btn.disabled = false; }
      };
    });
    const root = $('crmModal');
    root.querySelectorAll('select[data-st]').forEach((sel) => (sel.onchange = async () => { const [k, pid] = sel.dataset.st.split(':'); await api('/' + BASE[k] + '/' + pid, { method: 'PUT', body: { statut: sel.value } }); refresh(); }));
    root.querySelectorAll('[data-del]').forEach((a) => (a.onclick = async (ev) => { ev.preventDefault(); const [k, pid] = a.dataset.del.split(':'); if (confirm('Supprimer ' + (k === 'devis' ? 'ce devis' : 'cette proposition') + ' et ses PDF ?')) { await api('/' + BASE[k] + '/' + pid, { method: 'DELETE' }); refresh(); } }));
    root.querySelectorAll('[data-fv]').forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); viewFile(a.dataset.fv, a.dataset.fn); }));
    root.querySelectorAll('[data-fd]').forEach((a) => (a.onclick = async (ev) => { ev.preventDefault(); if (confirm('Retirer ce PDF ?')) { await api('/fichiers/' + a.dataset.fd, { method: 'DELETE' }); refresh(); } }));
    let pend = null;
    // « Voir » : ouvre le PDF le plus récent de l'élément ; s'il n'y en a pas, propose d'en joindre un.
    root.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => {
      const [k, pid] = b.dataset.view.split(':');
      const fs = (d.fichiers || []).filter((f) => f.kind === k && String(f.parent_id) === pid);
      if (fs.length) { const f = fs[fs.length - 1]; viewFile(f.id, f.nom); return; }
      if (confirm('Aucun PDF n\'est joint à ' + (k === 'devis' ? 'ce devis' : 'cette proposition') + '. En joindre un maintenant ?')) { pend = { kind: k, id: +pid }; $('fileIn').value = ''; $('fileIn').click(); }
    }));
    root.querySelectorAll('[data-up]').forEach((b) => (b.onclick = () => { const [k, pid] = b.dataset.up.split(':'); pend = { kind: k, id: +pid }; $('fileIn').value = ''; $('fileIn').click(); }));
    $('fileIn').onchange = async () => {
      const f = $('fileIn').files[0]; if (!f || !pend) return;
      try { await upload(pend.kind, pend.id, f); refresh(); } catch (e) { alert(e.message); }
    };
    $('dDel').onclick = async () => { if (confirm('Supprimer définitivement ce contact, son suivi et ses devis ?')) { await api('/contacts/' + id, { method: 'DELETE' }); closeModal(); load(); } };
  }

  // ---- Import : demandes du site + fichier CSV ----
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/)[0] || '';
    const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : (first.includes('\t') ? '\t' : ',');
    const rows = []; let row = [], cell = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += ch; }
      else if (ch === '"') inQ = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim()));
  }
  const ALIAS = {
    organisation: ['organisation', 'société', 'societe', 'entreprise', 'structure', 'raison sociale', 'collectivité', 'mairie', 'nom de la structure'],
    prenom: ['prenom', 'prénom', 'firstname', 'first name'], nom: ['nom', 'lastname', 'last name', 'nom de famille'],
    email: ['email', 'e-mail', 'mail', 'courriel', 'adresse email'], telephone: ['telephone', 'téléphone', 'tel', 'tél', 'mobile', 'portable', 'sms', 'phone'],
    ville: ['ville', 'commune', 'city'], code_postal: ['code_postal', 'code postal', 'cp', 'codepostal', 'zip'], departement: ['departement', 'département', 'dept'],
    categorie: ['categorie', 'catégorie', 'type'], fonction: ['fonction', 'poste', 'job_title', 'titre'], notes: ['notes', 'note', 'commentaire', 'commentaires', 'remarques'],
    source: ['source'], evenement: ['evenement', 'événement', 'besoin'], budget: ['budget'],
  };
  function mapRows(rows) {
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const idx = {};
    Object.entries(ALIAS).forEach(([k, names]) => { const i = head.findIndex((h) => names.includes(h)); if (i >= 0) idx[k] = i; });
    return rows.slice(1).map((r) => { const o = {}; Object.entries(idx).forEach(([k, i]) => { o[k] = (r[i] || '').trim(); }); return o; });
  }

  function openImport() {
    modal(`<h3 style="margin-top:0">Importer des contacts</h3>
      <div class="vz-card"><b>Demandes reçues par le site</b>
        <p class="vz-note">Crée un prospect pour chaque demande du formulaire de contact (une seule fois chacune, sans doublon).</p>
        <button class="period-btn" type="button" id="iSite">Importer les demandes du site</button></div>
      <div class="vz-card"><b>Fichier CSV / Excel enregistré en CSV</b>
        <p class="vz-note">Colonnes reconnues : organisation, prénom, nom, email, téléphone, ville, code postal, catégorie, notes… Les emails déjà présents sont ignorés.</p>
        <select id="iStatut"><option value="prospect">Ce sont des prospects</option><option value="client">Ce sont des clients</option></select>
        <input type="file" id="iFile" accept=".csv,.txt,text/csv" style="margin-top:8px;width:100%">
        <div id="iPrev" class="vz-note" style="margin:8px 0"></div>
        <button class="period-btn" type="button" id="iGo" style="display:none">Lancer l'import</button></div>
      <div id="iMsg" class="vz-note"></div>
      <button class="period-btn" type="button" onclick="crmClose()">Fermer</button>`);
    let rows = [];
    $('iSite').onclick = async () => { $('iMsg').textContent = 'Import…'; try { const r = await api('/import-site', { method: 'POST', body: {} }); $('iMsg').textContent = `${r.ajoutes} nouveau(x) prospect(s), ${r.existants} demande(s) rattachée(s) à une fiche existante.`; load(); } catch (e) { $('iMsg').textContent = e.message; } };
    $('iFile').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      rows = mapRows(parseCsv(await f.text()));
      $('iPrev').textContent = rows.length ? `${rows.length} ligne(s) lues. Exemple : ${Object.values(rows[0]).filter(Boolean).slice(0, 4).join(' · ')}` : 'Aucune ligne reconnue (vérifie la ligne d\'en-tête).';
      $('iGo').style.display = rows.length ? '' : 'none';
    };
    $('iGo').onclick = async () => {
      $('iMsg').textContent = 'Import en cours…'; let tot = { ajoutes: 0, doublons: 0, vides: 0 };
      try { for (let i = 0; i < rows.length; i += 300) { const r = await api('/import', { method: 'POST', body: { rows: rows.slice(i, i + 300), statut: $('iStatut').value } }); tot.ajoutes += r.ajoutes; tot.doublons += r.doublons; tot.vides += r.vides; $('iMsg').textContent = `${i + 300 >= rows.length ? 'Terminé' : 'En cours'} : ${tot.ajoutes} ajoutés, ${tot.doublons} doublons ignorés.`; }
        load(); } catch (e) { $('iMsg').textContent = e.message; }
    };
  }

  // ---- Export CSV pour Brevo ----
  function openExport() {
    const depts = [...new Set(all.map((c) => c.departement).filter(Boolean))].sort();
    modal(`<h3 style="margin-top:0">Export pour Brevo</h3>
      <p class="vz-note">Génère un fichier CSV (EMAIL, PRENOM, NOM, ORGANISATION, CATEGORIE, DEPARTEMENT, CODE_POSTAL, CITY, SMS) à importer dans Brevo → Contacts → Importer, vers la liste de ton choix. Les contacts sans email, « perdus » ou marqués « ne pas inclure dans les mailings » sont exclus.</p>
      <div class="row"><div><label>Qui ?</label><select id="xSt"><option value="prospect">Prospects</option><option value="client">Clients</option><option value="all">Prospects + clients</option></select></div>
        <div><label>Étape (prospects)</label><select id="xEt"><option value="">Toutes</option>${opt(ETAPES, '')}</select></div></div>
      <div class="row"><div><label>Département</label><select id="xDp"><option value="">Tous</option>${opt(depts, '')}</select></div>
        <div><label>Catégorie</label><select id="xCt"><option value="">Toutes</option>${opt(CATEGORIES, '')}</select></div></div>
      <label style="display:block;margin:6px 0"><input type="checkbox" id="xMark" style="width:auto" checked> Marquer ces contacts comme « exportés vers Brevo » (affiché sur leur fiche)</label>
      <div class="crm-bar"><button class="period-btn" style="background:var(--amber);color:#1b1300" type="button" id="xGo">⬇ Télécharger le CSV</button><button class="period-btn" type="button" onclick="crmClose()">Annuler</button></div>
      <div id="xMsg" class="vz-note"></div>`);
    $('xGo').onclick = async () => {
      const p = new URLSearchParams(); p.set('statut', $('xSt').value);
      if ($('xEt').value) p.set('etape', $('xEt').value); if ($('xDp').value) p.set('dept', $('xDp').value); if ($('xCt').value) p.set('categorie', $('xCt').value);
      if ($('xMark').checked) p.set('mark', '1');
      try {
        const r = await api('/export?' + p.toString(), { raw: true }); if (!r.ok) throw new Error('Erreur ' + r.status);
        const n = r.headers.get('X-Nb-Contacts'); const blob = await r.blob();
        if (n === '0') { $('xMsg').textContent = 'Aucun contact avec email pour ce filtre.'; return; }
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'contacts-slp.csv';
        document.body.appendChild(a); a.click(); a.remove();
        $('xMsg').textContent = `${n} contact(s) exporté(s). Dans Brevo : Contacts → Importer → Fichier, puis choisis ta liste.`; load();
      } catch (e) { $('xMsg').textContent = e.message; }
    };
  }

  window.crmNew = function () { if (!ready) { build(); ready = true; } load(); openForm(null); };
  window.crmOpen = function () { if (!ready) { build(); ready = true; } return load(); };
  window.crmView = function (v) { vue = v; filtreEtape = ''; if (ready) render(); };
})();
