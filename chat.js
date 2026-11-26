/* SLP — Assistant de chat (FR / EN / ES / IT)
   Un seul écran (nom, téléphone, email, besoin) : conversation directe si l'équipe est disponible,
   sinon la demande part par /api/contact (même circuit que le formulaire : D1 + mail Resend).
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
      open: 'Ouvrir le chat', close: 'Fermer', title: 'SLP', sub: 'Réponse sous 24 h', teaser: 'Une question ? Nous sommes à votre écoute.', call: 'Appeler', wa: 'WhatsApp', sending: 'Envoi en cours…', fail: 'Votre demande n’a pas pu être envoyée. Merci de réessayer, ou de nous appeler au 06 31 94 96 53.', badTel: 'Merci de vérifier votre numéro de téléphone, qui semble incomplet.', badMail: 'Merci de vérifier votre adresse email, qui semble incomplète.',
      hello: 'Bonjour et bienvenue chez Sound Light Prod. Afin de vous répondre au mieux, merci de nous indiquer vos coordonnées et votre demande.',
      f: ['Votre nom (et organisation)', 'Votre numéro de téléphone', 'Votre adresse email', 'Votre demande (date, commune, spectacle…)'],
      submit: 'Envoyer ma demande',
      required: 'Merci de renseigner les quatre champs.',
      orElse: 'Vous pouvez aussi nous contacter directement :',
      received: 'Nous vous remercions, votre demande a bien été reçue. Nous reviendrons vers vous sous 24 h.',
      later: 'Merci de votre patience. Vous pouvez quitter la conversation : nous vous recontacterons par téléphone ou par email dans les meilleurs délais.',
      back: 'Bonjour, vous pouvez poursuivre notre échange ci-dessous.',
      sujet: 'Demande via le chat',
      m: 'Mail',
      live: { send: 'Envoyer', online: 'Merci, votre message nous est bien parvenu. Nous vous répondons ici dans quelques instants. Si vous quittez la conversation avant notre réponse, nous vous recontacterons par téléphone ou par email.', ph: 'Écrivez votre message…', err: 'Votre message n’a pas pu être envoyé. Merci de réessayer, ou de nous appeler au 06 31 94 96 53.' }
    },
    en: {
      open: 'Open chat', close: 'Close', title: 'SLP', sub: 'Reply within 24 h', teaser: 'Any question? We are happy to help.', call: 'Call', wa: 'WhatsApp', sending: 'Sending…', fail: 'Your request could not be sent. Please try again, or call us on +33 6 31 94 96 53.', badTel: 'Please check your phone number, which appears to be incomplete.', badMail: 'Please check your email address, which appears to be incomplete.',
      hello: 'Hello and welcome to Sound Light Prod. So that we can best assist you, please share your contact details and your request.',
      f: ['Your name (and organisation)', 'Your phone number', 'Your email address', 'Your request (date, town, show…)'],
      submit: 'Send my request',
      required: 'Please fill in all four fields.',
      orElse: 'You can also contact us directly:',
      received: 'Thank you, we have received your request. We will get back to you within 24 h.',
      later: 'Thank you for your patience. You are welcome to leave the conversation: we will contact you by phone or email as soon as possible.',
      back: 'Hello, you are welcome to continue our conversation below.',
      sujet: 'Request via chat',
      m: 'Email',
      live: { auto: 'Messages are translated automatically.', send: 'Send', online: 'Thank you, we have received your message. We will reply here in a few moments. If you leave the conversation before we reply, we will contact you by phone or email.', ph: 'Write your message…', err: 'Your message could not be sent. Please try again, or call us on +33 6 31 94 96 53.' }
    },
    es: {
      open: 'Abrir el chat', close: 'Cerrar', title: 'SLP', sub: 'Respuesta en 24 h', teaser: '¿Alguna pregunta? Estamos a su disposición.', call: 'Llamar', wa: 'WhatsApp', sending: 'Enviando…', fail: 'No se ha podido enviar su solicitud. Inténtelo de nuevo o llámenos al +33 6 31 94 96 53.', badTel: 'Le rogamos que revise su número de teléfono, que parece incompleto.', badMail: 'Le rogamos que revise su correo electrónico, que parece incompleto.',
      hello: 'Hola y bienvenido a Sound Light Prod. Para atenderle mejor, le rogamos que nos indique sus datos de contacto y su solicitud.',
      f: ['Su nombre (y organización)', 'Su número de teléfono', 'Su correo electrónico', 'Su solicitud (fecha, localidad, espectáculo…)'],
      submit: 'Enviar mi solicitud',
      required: 'Le rogamos que complete los cuatro campos.',
      orElse: 'También puede contactarnos directamente:',
      received: 'Muchas gracias, hemos recibido su solicitud. Le responderemos en un plazo de 24 h.',
      later: 'Gracias por su paciencia. Puede salir de la conversación: le contactaremos por teléfono o por correo electrónico lo antes posible.',
      back: 'Hola, puede continuar nuestra conversación a continuación.',
      sujet: 'Solicitud vía chat',
      m: 'Correo',
      live: { auto: 'Los mensajes se traducen automáticamente.', send: 'Enviar', online: 'Gracias, hemos recibido su mensaje. Le respondemos aquí en unos instantes. Si abandona la conversación antes de nuestra respuesta, le contactaremos por teléfono o por correo electrónico.', ph: 'Escriba su mensaje…', err: 'No se ha podido enviar su mensaje. Inténtelo de nuevo o llámenos al +33 6 31 94 96 53.' }
    },
    it: {
      open: 'Apri la chat', close: 'Chiudi', title: 'SLP', sub: 'Risposta entro 24 h', teaser: 'Ha una domanda? Siamo a sua disposizione.', call: 'Chiama', wa: 'WhatsApp', sending: 'Invio in corso…', fail: 'Non è stato possibile inviare la richiesta. Riprovi o ci chiami al +33 6 31 94 96 53.', badTel: 'La preghiamo di controllare il numero di telefono, che sembra incompleto.', badMail: 'La preghiamo di controllare l’indirizzo email, che sembra incompleto.',
      hello: 'Buongiorno e benvenuto in Sound Light Prod. Per risponderle al meglio, la preghiamo di indicarci i suoi recapiti e la sua richiesta.',
      f: ['Il suo nome (e organizzazione)', 'Il suo numero di telefono', 'Il suo indirizzo email', 'La sua richiesta (data, località, spettacolo…)'],
      submit: 'Invia la richiesta',
      required: 'La preghiamo di compilare tutti e quattro i campi.',
      orElse: 'Può anche contattarci direttamente:',
      received: 'La ringraziamo, abbiamo ricevuto la sua richiesta. Le risponderemo entro 24 h.',
      later: 'Grazie per la pazienza. Può lasciare la conversazione: la ricontatteremo per telefono o via email al più presto.',
      back: 'Buongiorno, può proseguire la nostra conversazione qui sotto.',
      sujet: 'Richiesta via chat',
      m: 'Mail',
      live: { auto: 'I messaggi vengono tradotti automaticamente.', send: 'Invia', online: 'Grazie, abbiamo ricevuto il suo messaggio. Le rispondiamo qui tra pochi istanti. Se lascia la conversazione prima della nostra risposta, la ricontatteremo per telefono o via email.', ph: 'Scriva il suo messaggio…', err: 'Non è stato possibile inviare il messaggio. Riprovi o ci chiami al +33 6 31 94 96 53.' }
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
    '.slpc-fo{display:flex;flex-direction:column;gap:8px;flex-shrink:0}' +
    '.slpc-fo input,.slpc-fo textarea{box-sizing:border-box;width:100%;background:#0C0A14;color:#F7F5F0;border:1.5px solid rgba(247,245,240,.25);border-radius:12px;padding:10px 13px;font:400 16px/1.35 "Instrument Sans",system-ui,sans-serif;outline:none;resize:none}' +
    '.slpc-fo input:focus,.slpc-fo textarea:focus{border-color:#FBC608}.slpc-fo .ko{border-color:#FF0953}' +
    '.slpc-fo button{border:0;border-radius:100px;padding:12px;font:700 .95rem "Instrument Sans",system-ui,sans-serif;color:#0C0A14;background:linear-gradient(90deg,#FF0953,#FC8024 55%,#FBC608);cursor:pointer}.slpc-fo button:disabled{opacity:.6}' +
    '.slpc-note{margin:0;align-self:center;text-align:center;color:#A9A4BC;font-size:.76rem;flex-shrink:0}' +
    '.slpc-err{margin:0;color:#FF8FAE;font-size:.82rem}.slpc-err:empty{display:none}.slpc-bot,.slpc-ch{flex-shrink:0}' +
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
    '<form id="slpc-f" autocomplete="off"><input id="slpc-hp" tabindex="-1" aria-hidden="true" autocomplete="off"><input id="slpc-i" type="text" maxlength="400"><button id="slpc-s" type="submit">' + t.live.send + '</button></form>';
  document.body.append(btn, tip, box);
  var msgs = box.querySelector('#slpc-m'), form = box.querySelector('#slpc-f'), inp = box.querySelector('#slpc-i'), hp = box.querySelector('#slpc-hp');

  function scroll() { msgs.scrollTop = msgs.scrollHeight; }
  function say(txt, me) { var d = document.createElement('div'); d.className = 'slpc-b ' + (me ? 'slpc-me' : 'slpc-bot'); d.textContent = txt; msgs.appendChild(d); scroll(); return d; }
  function clearChoices() { Array.prototype.forEach.call(msgs.querySelectorAll('.slpc-ch'), function (w) { w.remove(); }); }
  var counted = {};
  function step(name) { if (counted[name]) return; counted[name] = 1; track('chat_menu', 'chatmenu:' + name); } // seul le nom de l'étape est compté, jamais la réponse
  function resetToken() { if (window.slpAS && window.slpAS.reset) window.slpAS.reset(); } // un jeton Turnstile ne sert qu'une fois
  function directLinks() {
    say(t.orElse);
    var w = document.createElement('div'); w.className = 'slpc-ch';
    [{ label: t.call, href: 'tel:' + PHONE, ev: 'appel' },
     { label: t.wa, href: 'https://wa.me/' + PHONE.replace('+', ''), ev: 'whatsapp', ext: 1 },
     { label: t.m, href: 'mailto:contact@soundlightprod.fr', ev: 'mail' }].forEach(function (l) {
      var a = document.createElement('a'); a.href = l.href; a.textContent = l.label; if (l.ext) { a.target = '_blank'; a.rel = 'noopener'; } a.addEventListener('click', function () { track(l.ev); }); w.appendChild(a); });
    msgs.appendChild(w); scroll();
  }

  // Écran unique : nom, téléphone, email et besoin, tous obligatoires
  function showForm() {
    form.classList.remove('on'); say(t.hello);
    var fo = document.createElement('form'); fo.className = 'slpc-fo'; fo.noValidate = true;
    var defs = [['nom', 'input', 'text', 'name', 120], ['tel', 'input', 'tel', 'tel', 40], ['email', 'input', 'email', 'email', 160], ['besoin', 'textarea', '', 'off', 600]];
    var el = {};
    defs.forEach(function (d, i) {
      var x = document.createElement(d[1]); if (d[2]) x.type = d[2]; else x.rows = 3;
      x.name = d[0]; x.autocomplete = d[3]; x.maxLength = d[4]; x.placeholder = t.f[i] + ' *'; x.setAttribute('aria-label', t.f[i]); x.required = true;
      x.addEventListener('input', function () { if (!counted.debut) { counted.debut = 1; track('formulaire'); step('form-commence'); } x.classList.remove('ko'); });
      x.addEventListener('change', function () { if (x.value.trim()) step('form-' + d[0]); });
      el[d[0]] = x; fo.appendChild(x);
    });
    var err = document.createElement('p'); err.className = 'slpc-err'; err.setAttribute('role', 'alert'); fo.appendChild(err);
    var ok = document.createElement('button'); ok.type = 'submit'; ok.textContent = t.submit; fo.appendChild(ok);
    fo.addEventListener('submit', function (e) {
      e.preventDefault(); err.textContent = '';
      var v = {}, bad = [];
      defs.forEach(function (d) { v[d[0]] = el[d[0]].value.trim(); if (!v[d[0]]) bad.push([d[0], t.required]); });
      if (v.tel && !/^\+?\d{8,15}$/.test(v.tel.replace(/[\s.\-()\/]/g, ''))) bad.push(['tel', t.badTel]);
      if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v.email)) bad.push(['email', t.badMail]);
      if (bad.length) { bad.forEach(function (x) { el[x[0]].classList.add('ko'); }); err.textContent = bad[0][1]; el[bad[0][0]].focus(); return; }
      ok.disabled = true; ok.textContent = t.sending;
      function failed(msg) { ok.disabled = false; ok.textContent = t.submit; err.textContent = msg || t.fail; resetToken(); scroll(); }
      api('/api/chat/status').then(function (j) { return !!(j && j.ok && j.online); }, function () { return false; }).then(function (online) {
        return online ? startLive(v, fo, failed) : leaveRequest(v, fo, failed);
      }).catch(function () { failed(); });
    });
    msgs.appendChild(fo);
    directLinks(); msgs.scrollTop = 0;
  }
  function closeForm(fo) { fo.remove(); clearChoices(); msgs.textContent = ''; }

  // Absent : la demande part dans les demandes de contact (mail, alerte, CRM)
  function leaveRequest(v, fo, failed) {
    return fetch('/api/contact', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nom: v.nom, telephone: v.tel, email: v.email, sujet: t.sujet, message: '[Chat ' + L.toUpperCase() + ']\nBesoin : ' + v.besoin, lang: L, site_web: hp.value, page: 'chat:' + from, session_id: sid, dt: asDt(), cf_token: asTok() })
    }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); }).then(function (j) {
      if (!j.ok) return failed(j.error);
      step('form-envoye-absent'); closeForm(fo); say(v.besoin, 1); say(t.received); resetToken();
    });
  }

  // Disponible : la conversation s'ouvre, le besoin en est le premier message
  function startLive(v, fo, failed) {
    return api('/api/chat/send', { token: '', body: v.besoin, name: v.nom, contact: v.tel + ' · ' + v.email, page: 'chat:' + from, lang: L, site_web: hp.value, dt: asDt(), cf_token: asTok() }).then(function (j) {
      if (!j.ok) return failed(j.error);
      tok = j.token; lastId = 0; answered = false; try { localStorage.setItem('slpc_tok', tok); localStorage.setItem('slpc_last', '0'); } catch (e) {}
      step('form-envoye-direct'); closeForm(fo); say(v.besoin, 1); say(t.live.online); live(); resetToken();
      clearTimeout(waitT); waitT = setTimeout(function () { if (!answered) say(t.later); }, WAIT_MS);
    });
  }

  /* ---- Mode direct : conversation avec l'équipe SLP via /api/chat/* ---- */
  var tok = '', lastId = 0, pollT = null, waitT = null, answered = false, WAIT_MS = 120000;
  try { tok = localStorage.getItem('slpc_tok') || ''; lastId = parseInt(localStorage.getItem('slpc_last') || '0', 10) || 0; } catch (e) {}
  function api(path, body) {
    return fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
      .then(function (r) { return r.json().catch(function () { return { ok: false }; }); });
  }
  function poll() {
    if (!tok) return;
    api('/api/chat/poll?token=' + encodeURIComponent(tok) + '&after=' + lastId).then(function (j) {
      if (!j || !j.ok) { if (j && j.gone) { tok = ''; lastId = 0; try { localStorage.removeItem('slpc_tok'); localStorage.removeItem('slpc_last'); } catch (e) {} if (opened) { form.classList.remove('on'); msgs.textContent = ''; showForm(); } } return; }
      (j.messages || []).forEach(function (m) {
        answered = true; clearTimeout(waitT); lastId = Math.max(lastId, m.id); say(m.body);
        if (!box.classList.contains('on')) { tip.textContent = m.body.slice(0, 80); tip.style.display = 'block'; }
      });
      try { localStorage.setItem('slpc_last', String(lastId)); } catch (e) {}
      pollNext();
    }).catch(pollNext);
  }
  function pollNext() { clearTimeout(pollT); pollT = setTimeout(poll, box.classList.contains('on') ? 4000 : 60000); }
  // Conversation ouverte : champ de message
  var noted = false;
  function live() {
    // Versions EN / ES / IT : le visiteur est prévenu que la conversation est traduite
    if (t.live.auto && !noted) { noted = true; var n = document.createElement('p'); n.className = 'slpc-note'; n.textContent = t.live.auto; msgs.appendChild(n); scroll(); }
    form.classList.add('on'); inp.value = ''; inp.placeholder = t.live.ph;
    form.onsubmit = function (e) {
      e.preventDefault(); var v = inp.value.trim(); if (!v) return;
      say(v, 1); inp.value = '';
      api('/api/chat/send', { token: tok, body: v, page: 'chat:' + from, lang: L, site_web: hp.value, dt: asDt(), cf_token: asTok() }).then(function (j) {
        if (!j.ok) { say(j.error || t.live.err); resetToken(); return; }
        tok = j.token; try { localStorage.setItem('slpc_tok', tok); } catch (e) {}
        pollNext();
      }).catch(function () { say(t.live.err); });
    };
    pollNext();
  }

  function setSub(online) { var sm = box.querySelector('#slpc-h small'); if (sm) sm.textContent = online ? '🟢 ' + ({ fr: 'En ligne', en: 'Online', es: 'En línea', it: 'Online' })[L] : t.sub; }
  function refreshStatus() { api('/api/chat/status').then(function (j) { if (j && j.ok) setSub(j.online); }).catch(function () {}); }
  var opened = false;
  function toggle(on) {
    box.classList.toggle('on', on); tip.style.display = 'none';
    if (on) refreshStatus();
    if (on && window.slpAS && window.slpAS.need) window.slpAS.need();
    if (on && !opened) { opened = true; track('chat'); if (tok) { say(t.back); live(); } else showForm(); }
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
