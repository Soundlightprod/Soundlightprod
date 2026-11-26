/* SLP — Assistant de chat (FR / EN / ES / IT)
   Sans IA externe : réponses validées + collecte guidée de la demande de devis,
   envoyée par /api/contact (même circuit que le formulaire : D1 + mail Resend).
   Aucune dépendance, aucun cookie, rien n'est stocké hors sessionStorage. */
(function () {
  if (window.__slpChat) return; window.__slpChat = 1;
  var path = location.pathname;
  if (/^\/(admin|mon-agenda|boutique|cgv-boutique|produits|galerie-produits|_)/.test(path) || /(^|\.)(slpstore\.fr|slpstore\.fr)$/.test(location.hostname)) return;

  // Anti-spam : délai depuis le chargement + jeton Turnstile (antispam.js, chargé ici si la page ne l'a pas déjà)
  var T0 = Date.now();
  function asDt() { return window.slpAS ? window.slpAS.dt() : Date.now() - T0; }
  function asTok() { return window.slpAS ? window.slpAS.token() : ''; }
  if (!window.slpAS) { try { var asS = document.createElement('script'); asS.src = '/antispam.js'; asS.async = true; asS.onload = function () { if (box && box.classList.contains('on') && window.slpAS && window.slpAS.need) window.slpAS.need(); }; document.head.appendChild(asS); } catch (e) {} }

  var L = (path.match(/^\/(en|es|it)(\/|$)/) || [, 'fr'])[1];
  var T = {
    fr: {
      open: 'Ouvrir le chat', close: 'Fermer', title: 'SLP', sub: 'Réponse sous 24 h', teaser: 'Une question ? On vous répond.', call: 'Appeler', wa: 'WhatsApp', mail: 'Écrire un mail', sending: 'Envoi en cours…', done: 'Merci ! Votre demande est bien partie. On vous répond sous 24 h, souvent par téléphone.', fail: 'L’envoi n’a pas fonctionné. Appelez-nous au 06 31 94 96 53 ou écrivez à contact@soundlightprod.fr.', sujet: 'Devis via le chat',
      hello: 'Bonjour ! Je suis l’assistant de SLP. Écrivez-nous ci-dessous, ou choisissez :',
      menu: ['Demander un devis / une date', 'Voir les spectacles', 'Appeler / WhatsApp / mail'],
      again: 'Revenir au menu',
      fastest: 'Le plus rapide :',
      q: { place: 'La date (ou la période) et la commune ?', name: 'Votre nom (et organisation) ?', tel: 'Votre numéro de téléphone ? (obligatoire)', mail: 'Votre adresse email ? (obligatoire)', ph: 'Votre réponse…', send: 'Envoyer' },
      badTel: 'Ce numéro semble incomplet. Pouvez-vous le vérifier ?',
      badMail: 'Cette adresse email semble incomplète. Pouvez-vous la vérifier ?',
      need: 'Pour que l’équipe SLP puisse vous répondre, il nous faut votre téléphone et votre email.',
      live: { online: 'Votre message est bien arrivé, on vous répond ici dans quelques instants.', offline: 'Votre message est bien arrivé. Nous ne sommes pas en ligne à cet instant, nous vous recontactons rapidement.', ph: 'Écrivez votre message…', err: 'Message non envoyé. Réessayez ou appelez-nous au 06 31 94 96 53.' }
    },
    en: {
      open: 'Open chat', close: 'Close', title: 'SLP', sub: 'Reply within 24 h', teaser: 'Any question? We’ll get back to you.', call: 'Call', wa: 'WhatsApp', mail: 'Send an email', sending: 'Sending…', done: 'Thank you! Your request has been sent. We’ll reply within 24 h.', fail: 'Sending failed. Please call +33 6 31 94 96 53 or email contact@soundlightprod.fr.', sujet: 'Quote via chat',
      hello: 'Hello! I’m the SLP assistant. Write to us below, or choose:',
      menu: ['Request a quote / a date', 'See the shows', 'Call / WhatsApp / email'],
      again: 'Back to menu',
      fastest: 'Fastest way:',
      q: { place: 'The date (or period) and the town?', name: 'Your name (and organisation)?', tel: 'Your phone number? (required)', mail: 'Your email address? (required)', ph: 'Your answer…', send: 'Send' },
      badTel: 'This number looks incomplete. Could you check it?',
      badMail: 'This email address looks incomplete. Could you check it?',
      need: 'So that the SLP team can reply, we need your phone number and your email.',
      live: { online: 'Your message has arrived, we’ll reply here shortly.', offline: 'Your message has arrived. We’re not online right now, we’ll get back to you quickly.', ph: 'Write your message…', err: 'Message not sent. Try again or call +33 6 31 94 96 53.' }
    },
    es: {
      open: 'Abrir el chat', close: 'Cerrar', title: 'SLP', sub: 'Respuesta en 24 h', teaser: '¿Alguna pregunta? Le respondemos.', call: 'Llamar', wa: 'WhatsApp', mail: 'Escribir un correo', sending: 'Enviando…', done: '¡Gracias! Su solicitud ha sido enviada. Le respondemos en 24 h.', fail: 'No se pudo enviar. Llame al +33 6 31 94 96 53 o escriba a contact@soundlightprod.fr.', sujet: 'Presupuesto vía chat',
      hello: '¡Hola! Soy el asistente de SLP. Escríbanos abajo o elija:',
      menu: ['Pedir presupuesto / una fecha', 'Ver los espectáculos', 'Llamar / WhatsApp / correo'],
      again: 'Volver al menú',
      fastest: 'Lo más rápido:',
      q: { place: '¿La fecha (o el periodo) y la localidad?', name: '¿Su nombre (y organización)?', tel: '¿Su número de teléfono? (obligatorio)', mail: '¿Su correo electrónico? (obligatorio)', ph: 'Su respuesta…', send: 'Enviar' },
      badTel: 'Este número parece incompleto. ¿Puede revisarlo?',
      badMail: 'Este correo parece incompleto. ¿Puede revisarlo?',
      need: 'Para que el equipo de SLP pueda responderle, necesitamos su teléfono y su correo.',
      live: { online: 'Su mensaje ha llegado, le respondemos aquí en unos instantes.', offline: 'Su mensaje ha llegado. Ahora mismo no estamos en línea, le contactamos pronto.', ph: 'Escriba su mensaje…', err: 'Mensaje no enviado. Inténtelo de nuevo o llame al +33 6 31 94 96 53.' }
    },
    it: {
      open: 'Apri la chat', close: 'Chiudi', title: 'SLP', sub: 'Risposta entro 24 h', teaser: 'Una domanda? Le rispondiamo.', call: 'Chiama', wa: 'WhatsApp', mail: 'Scrivi una mail', sending: 'Invio in corso…', done: 'Grazie! La sua richiesta è stata inviata. Le rispondiamo entro 24 h.', fail: 'Invio non riuscito. Chiami il +33 6 31 94 96 53 o scriva a contact@soundlightprod.fr.', sujet: 'Preventivo via chat',
      hello: 'Buongiorno! Sono l’assistente di SLP. Ci scriva qui sotto, oppure scelga:',
      menu: ['Preventivo / una data', 'Vedere gli spettacoli', 'Chiama / WhatsApp / mail'],
      again: 'Torna al menu',
      fastest: 'Il modo più rapido:',
      q: { place: 'La data (o il periodo) e la località?', name: 'Il suo nome (e organizzazione)?', tel: 'Il suo numero di telefono? (obbligatorio)', mail: 'Il suo indirizzo email? (obbligatorio)', ph: 'La sua risposta…', send: 'Invia' },
      badTel: 'Questo numero sembra incompleto. Può controllarlo?',
      badMail: 'Questo indirizzo email sembra incompleto. Può controllarlo?',
      need: 'Perché il team SLP possa risponderle, ci servono telefono ed email.',
      live: { online: 'Il suo messaggio è arrivato, le rispondiamo qui a breve.', offline: 'Il suo messaggio è arrivato. Al momento non siamo online, la ricontatteremo presto.', ph: 'Scriva il suo messaggio…', err: 'Messaggio non inviato. Riprovi o chiami il +33 6 31 94 96 53.' }
    }
  };
  var t = T[L];
  var PHONE = '+33631949653';
  var sid = ''; try { sid = sessionStorage.getItem('slp_visit_sid') || ''; } catch (e) {}
  var noTrack = false; try { noTrack = !!(localStorage.getItem('slp_notrack') || localStorage.getItem('slp_admin_token')); } catch (e) {}
  var from = path.replace(/^\/(en|es|it)\//, '/').replace(/^\/+|\.html$|\/$/g, '') || 'index';

  function track(action, pg) {
    if (noTrack) return;
    var d = JSON.stringify({ action: action, page: pg || ('chat:' + from), session_id: sid });
    try { if (navigator.sendBeacon && navigator.sendBeacon('/api/contact-event', new Blob([d], { type: 'application/json' }))) return; } catch (e) {}
    fetch('/api/contact-event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: d, keepalive: true }).catch(function () {});
  }

  var css = '' +
    '#slpc-btn{position:fixed;right:18px;bottom:18px;z-index:99990;width:58px;height:58px;border-radius:50%;border:0;cursor:pointer;background:linear-gradient(90deg,#FF0953,#FC8024 55%,#FBC608);box-shadow:0 8px 28px rgba(255,9,83,.38);display:flex;align-items:center;justify-content:center;transition:transform .18s}' +
    '#slpc-btn:hover{transform:scale(1.07)}#slpc-btn svg{width:26px;height:26px;fill:#0C0A14}' +
    '#slpc-tip{position:fixed;right:84px;bottom:30px;z-index:99990;background:#F7F5F0;color:#0C0A14;font:600 .85rem "Instrument Sans",system-ui,sans-serif;padding:10px 14px;border-radius:14px;box-shadow:0 6px 22px rgba(0,0,0,.35);display:none;max-width:210px}' +
    '#slpc{position:fixed;right:18px;bottom:88px;z-index:99991;width:370px;max-width:calc(100vw - 24px);height:560px;max-height:calc(100vh - 110px);background:#17142A;color:#F7F5F0;border-radius:20px;box-shadow:0 18px 60px rgba(0,0,0,.55);display:none;flex-direction:column;overflow:hidden;font:400 .92rem/1.45 "Instrument Sans",system-ui,sans-serif;border:1px solid rgba(247,245,240,.12)}' +
    '#slpc.on{display:flex}' +
    '#slpc-h{padding:14px 16px;background:#0C0A14;position:relative;display:flex;align-items:center;gap:10px}' +
    '#slpc-h::after{content:"";position:absolute;left:0;right:0;bottom:0;height:2px;background:linear-gradient(90deg,#3259BE,#8C3290,#FF0953,#FC8024,#FBC608)}' +
    '#slpc-h b{font:900 1.15rem "League Spartan",system-ui,sans-serif;letter-spacing:.02em}#slpc-h small{display:block;color:#A9A4BC;font-size:.74rem}' +
    '#slpc-x{margin-left:auto;background:none;border:0;color:#F7F5F0;font-size:1.5rem;line-height:1;cursor:pointer;padding:4px 8px}' +
    '#slpc-m{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;scroll-behavior:smooth}' +
    '.slpc-b{max-width:86%;padding:10px 13px;border-radius:16px;white-space:pre-wrap;word-wrap:break-word}' +
    '.slpc-bot{background:#26213F;border-bottom-left-radius:4px;align-self:flex-start}' +
    '.slpc-me{background:#F7F5F0;color:#0C0A14;border-bottom-right-radius:4px;align-self:flex-end}' +
    '.slpc-ch{display:flex;flex-wrap:wrap;gap:7px;margin:2px 0 4px}' +
    '.slpc-ch button,.slpc-ch a{font:600 .84rem "Instrument Sans",system-ui,sans-serif;color:#F7F5F0;background:transparent;border:1.5px solid rgba(247,245,240,.5);border-radius:100px;padding:8px 14px;cursor:pointer;text-decoration:none;display:inline-block}' +
    '.slpc-ch button:hover,.slpc-ch a:hover{border-color:#FBC608;color:#FBC608}' +
    '#slpc-f{display:none;padding:10px;gap:8px;border-top:1px solid rgba(247,245,240,.1);background:#0C0A14}#slpc-f.on{display:flex}' +
    '#slpc-i{flex:1;min-width:0;background:#17142A;color:#F7F5F0;border:1.5px solid rgba(247,245,240,.25);border-radius:100px;padding:10px 14px;font:400 16px "Instrument Sans",system-ui,sans-serif;outline:none}' +
    '#slpc-i:focus{border-color:#FBC608}' +
    '#slpc-s{border:0;border-radius:100px;padding:0 18px;font:700 .85rem "Instrument Sans",system-ui,sans-serif;color:#0C0A14;background:linear-gradient(90deg,#FF0953,#FC8024 55%,#FBC608);cursor:pointer}' +
    '#slpc-hp{position:absolute;left:-9999px;opacity:0}' +
    '@media(max-width:480px){#slpc{right:8px;left:8px;bottom:82px;width:auto;max-width:none;height:calc(100vh - 100px)}}' +
    // Téléphone : la barre de contact (.ctabar, ≤ 760 px) occupe le bas de l'écran → la bulle remonte au-dessus quand elle est affichée
    '#slpc-btn,#slpc-tip,#slpc{transition:bottom .3s ease,transform .18s}' +
    '@media(max-width:760px){body:has(.ctabar.on) #slpc-btn{bottom:92px}body:has(.ctabar.on) #slpc-tip{bottom:104px}body:has(.ctabar.on) #slpc{bottom:160px;max-height:calc(100vh - 180px)}}' +
    // Ordinateur : bouton avec texte, plus visible qu'une simple icône (la bulle d'accueil devient inutile)
    '#slpc-btn .slpc-l{display:none}' +
    '@media(min-width:761px){#slpc-btn{width:auto;padding:0 22px 0 18px;gap:9px;border-radius:999px;font:700 .95rem "Instrument Sans",system-ui,sans-serif;color:#0C0A14}#slpc-btn .slpc-l{display:inline}#slpc-btn:hover{transform:translateY(-2px)}#slpc-tip{display:none!important}}' +
    '@media(prefers-reduced-motion:reduce){#slpc-btn,#slpc-tip,#slpc{transition:none}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var btn = document.createElement('button'); btn.id = 'slpc-btn'; btn.type = 'button'; btn.setAttribute('aria-label', t.open);
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/></svg><span class="slpc-l">' + ({ fr: 'Une question ?', en: 'Any question?', es: '¿Una pregunta?', it: 'Una domanda?' })[L] + '</span>';
  var tip = document.createElement('div'); tip.id = 'slpc-tip'; tip.textContent = t.teaser;
  var box = document.createElement('div'); box.id = 'slpc'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'SLP');
  box.innerHTML = '<div id="slpc-h"><div><b>' + t.title + '</b><small>' + t.sub + '</small></div><button id="slpc-x" type="button" aria-label="' + t.close + '">×</button></div><div id="slpc-m" aria-live="polite"></div>' +
    '<form id="slpc-f" autocomplete="off"><input id="slpc-hp" tabindex="-1" aria-hidden="true" autocomplete="off"><input id="slpc-i" type="text" maxlength="400"><button id="slpc-s" type="submit">' + t.q.send + '</button></form>';
  document.body.append(btn, tip, box);
  var msgs = box.querySelector('#slpc-m'), form = box.querySelector('#slpc-f'), inp = box.querySelector('#slpc-i'), hp = box.querySelector('#slpc-hp');

  function scroll() { msgs.scrollTop = msgs.scrollHeight; }
  function say(txt, me) { var d = document.createElement('div'); d.className = 'slpc-b ' + (me ? 'slpc-me' : 'slpc-bot'); d.textContent = txt; msgs.appendChild(d); scroll(); return d; }
  function clearChoices() { Array.prototype.forEach.call(msgs.querySelectorAll('.slpc-ch'), function (w) { w.remove(); }); }
  function choices(list, cb, links) {
    var w = document.createElement('div'); w.className = 'slpc-ch';
    list.forEach(function (c, i) { var b = document.createElement('button'); b.type = 'button'; b.textContent = c; b.addEventListener('click', function () { w.remove(); say(c, 1); cb(c, i); }); w.appendChild(b); });
    (links || []).forEach(function (l) { var a = document.createElement('a'); a.href = l.href; a.textContent = l.label; if (l.ext) { a.target = '_blank'; a.rel = 'noopener'; } a.addEventListener('click', function () { track(l.ev, l.pg); }); w.appendChild(a); });
    msgs.appendChild(w); scroll();
  }
  function step(name) { track('chat_menu', 'chatmenu:' + name); } // étape franchie : seul son nom est compté, jamais la réponse
  function backBtn() { choices([t.again], function () { home(); }); }
  function field(ph, mode, cb) {
    form.classList.add('on'); inp.value = ''; inp.placeholder = ph; inp.setAttribute('inputmode', mode || 'text');
    form.onsubmit = function (e) {
      e.preventDefault(); var v = inp.value.trim(); if (!v) return;
      clearChoices(); say(v, 1); inp.value = ''; cb(v);
    };
  }
  function ask(label, mode, cb) { clearChoices(); say(label); backBtn(); field(t.q.ph, mode, cb); inp.focus(); }
  function askTel(prefix, cb) {
    ask(t.q.tel, 'tel', function again(v) {
      if (!/^\+?\d{8,15}$/.test(v.replace(/[\s.\-()\/]/g, ''))) { say(t.badTel); backBtn(); return; }
      step(prefix + '-tel'); cb(v);
    });
  }
  function askMail(prefix, cb) {
    ask(t.q.mail, 'email', function (v) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v)) { say(t.badMail); backBtn(); return; }
      step(prefix + '-email'); cb(v);
    });
  }
  var started = false;
  function resetToken() { if (window.slpAS && window.slpAS.reset) window.slpAS.reset(); } // un jeton Turnstile ne sert qu'une fois

  // Accueil : 3 choix + champ de message toujours visible
  function home(first) {
    clearChoices(); if (first) say(t.hello);
    var w = document.createElement('div'); w.className = 'slpc-ch';
    function btnChoice(label, fn) { var b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', function () { clearChoices(); say(label, 1); fn(); }); w.appendChild(b); }
    btnChoice(t.menu[0], function () { step('devis'); quote(); });
    var a = document.createElement('a'); a.textContent = t.menu[1]; a.href = (L === 'fr' ? '' : '/' + L) + '/artistes.html'; a.addEventListener('click', function () { step('voir'); }); w.appendChild(a);
    btnChoice(t.menu[2], function () { step('contact'); say(t.fastest); choices([t.again], function () { home(); }, [
      { label: t.call, href: 'tel:' + PHONE, ev: 'appel' },
      { label: t.wa, href: 'https://wa.me/' + PHONE.replace('+', ''), ev: 'whatsapp', ext: 1 },
      { label: t.mail, href: 'mailto:contact@soundlightprod.fr', ev: 'mail' }]); });
    msgs.appendChild(w); scroll();
    field(t.live.ph, 'text', message);
  }

  function quote() {
    if (!started) { started = true; track('devis'); }
    var d = {};
    ask(t.q.place, 'text', function (v) { d.place = v; step('devis-date');
      ask(t.q.name, 'text', function (v2) { d.name = v2; step('devis-nom');
        askTel('devis', function (v3) { d.tel = v3;
          askMail('devis', function (v4) { d.email = v4; send(d); });
        });
      });
    });
  }

  function send(d) {
    clearChoices(); form.classList.remove('on');
    var wait = say(t.sending);
    var lines = ['[Chat ' + L.toUpperCase() + ']', 'Date et commune : ' + d.place];
    fetch('/api/contact', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ form: 'devis', nom: d.name, telephone: d.tel, email: d.email, sujet: t.sujet, lieu: d.place, message: lines.join('\n'), lang: L, site_web: hp.value, page: 'chat:' + from, session_id: sid, dt: asDt(), cf_token: asTok() })
    }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
      .then(function (j) { if (!j.ok) throw new Error(j.error || ''); step('devis-envoye'); wait.textContent = t.done; backBtn(); resetToken(); field(t.live.ph, 'text', message); })
      .catch(function (e) { wait.textContent = t.fail; choices([t.again], function () { home(); }, [{ label: t.call, href: 'tel:' + PHONE, ev: 'appel' }]); resetToken(); field(t.live.ph, 'text', message); });
  }

  /* ---- Mode direct : conversation avec l'équipe SLP via /api/chat/* ---- */
  var tok = '', lastId = 0, pollT = null, firstSent = false;
  try { tok = localStorage.getItem('slpc_tok') || ''; lastId = parseInt(localStorage.getItem('slpc_last') || '0', 10) || 0; } catch (e) {}
  function api(path, body) {
    return fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
      .then(function (r) { return r.json().catch(function () { return { ok: false }; }); });
  }
  function poll() {
    if (!tok) return;
    api('/api/chat/poll?token=' + encodeURIComponent(tok) + '&after=' + lastId).then(function (j) {
      if (!j || !j.ok) { if (j && j.gone) { tok = ''; lastId = 0; try { localStorage.removeItem('slpc_tok'); localStorage.removeItem('slpc_last'); } catch (e) {} } return; }
      (j.messages || []).forEach(function (m) {
        lastId = Math.max(lastId, m.id); say(m.body); 
        if (!box.classList.contains('on')) { tip.textContent = m.body.slice(0, 80); tip.style.display = 'block'; }
      });
      try { localStorage.setItem('slpc_last', String(lastId)); } catch (e) {}
      pollNext();
    }).catch(pollNext);
  }
  function pollNext() { clearTimeout(pollT); pollT = setTimeout(poll, box.classList.contains('on') ? 4000 : 60000); }
  // Message libre : à la première prise de contact, téléphone ET email sont demandés avant l'envoi
  var coords = '';
  function message(v) {
    if (tok || coords) return post(v);
    step('message-ecrit'); say(t.need);
    askTel('message', function (tel) {
      askMail('message', function (mail) { coords = tel + ' · ' + mail; post(v); });
    });
  }
  function post(v) {
    clearChoices(); field(t.live.ph, 'text', message);
    api('/api/chat/send', { token: tok, body: v, contact: tok ? '' : coords, page: 'chat:' + from, lang: L, site_web: hp.value, dt: asDt(), cf_token: asTok() }).then(function (j) {
      if (!j.ok) { say(j.error || t.live.err); resetToken(); return; }
      tok = j.token; try { localStorage.setItem('slpc_tok', tok); } catch (e) {}
      if (!firstSent) { firstSent = true; step('message-envoye'); track('formulaire');
        api('/api/chat/poll?token=' + encodeURIComponent(tok) + '&after=' + lastId).then(function (p) { say(p && p.online ? t.live.online : t.live.offline); }); }
      pollNext();
    }).catch(function () { say(t.live.err); });
  }

  function setSub(online) { var sm = box.querySelector('#slpc-h small'); if (sm) sm.textContent = online ? '🟢 ' + ({ fr: 'En ligne', en: 'Online', es: 'En línea', it: 'Online' })[L] : t.sub; }
  function refreshStatus() { api('/api/chat/status').then(function (j) { if (j && j.ok) setSub(j.online); }).catch(function () {}); }
  var opened = false;
  function toggle(on) {
    box.classList.toggle('on', on); tip.style.display = 'none';
    if (on) refreshStatus();
    if (on && window.slpAS && window.slpAS.need) window.slpAS.need();
    if (on && !opened) { opened = true; track('chat'); home(true); }
    if (on && tok) { tip.textContent = t.teaser; poll(); }
    btn.setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  btn.addEventListener('click', function () { toggle(!box.classList.contains('on')); });
  box.querySelector('#slpc-x').addEventListener('click', function () { toggle(false); btn.focus(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && box.classList.contains('on')) { toggle(false); btn.focus(); } });
  if (tok) pollNext();
  var seen = false; try { seen = sessionStorage.getItem('slpc_tip'); } catch (e) {}
  if (!seen) setTimeout(function () { if (!box.classList.contains('on')) { tip.style.display = 'block'; try { sessionStorage.setItem('slpc_tip', '1'); } catch (e) {} setTimeout(function () { tip.style.display = 'none'; }, 10000); } }, 5000);
})();
