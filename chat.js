/* SLP — Assistant de chat (FR / EN / ES / IT)
   Sans IA externe : réponses validées + collecte guidée de la demande de devis,
   envoyée par /api/contact (même circuit que le formulaire : D1 + mail Resend).
   Aucune dépendance, aucun cookie, rien n'est stocké hors sessionStorage. */
(function () {
  if (window.__slpChat) return; window.__slpChat = 1;
  var path = location.pathname;
  if (/^\/(admin|mon-agenda|boutique|cgv-boutique|produits|galerie-produits|_)/.test(path) || /soundlightprod\.store$/.test(location.hostname)) return;

  var L = (path.match(/^\/(en|es|it)(\/|$)/) || [, 'fr'])[1];
  var T = {
    fr: {
      talk: 'Parler à un membre de SLP',
      open: 'Ouvrir le chat', close: 'Fermer', title: 'SLP', sub: 'Réponse sous 24 h', teaser: 'Une question ? On vous répond.',
      hello: 'Bonjour ! Je suis l’assistant de SLP. Spectacles, tributes, DJ, son & lumière : que cherchez-vous ?',
      menu: ['Demander un devis', 'Programmer un spectacle', 'DJ / animation', 'Son & lumière', 'Tarifs', 'Zone d’intervention', 'Parler à un membre de SLP', 'Appeler / WhatsApp / mail'],
      back: 'Autre question', again: 'Revenir au menu',
      a: {
        spectacle: 'Nous proposons des tributes 100 % live, des spectacles cabaret, des groupes de reprises et des artistes jazz / soul / funk, pour mairies, comités des fêtes, galas, mariages et soirées privées. Parcourez la page Artistes, ou je prends votre demande tout de suite.',
        dj: 'Un DJ peut animer votre soirée (mariage, association, fête de village), avec sonorisation et lumière si besoin. Dites-moi la date et le lieu, on vous fait une proposition.',
        tech: 'Sonorisation, éclairage et régie technique pour concerts, fêtes et événements. On dimensionne le matériel selon votre salle et le public attendu : donnez-moi la date et le lieu, on vous envoie un devis.',
        tarifs: 'Chaque tarif dépend de la formule, de la date, de la distance et du matériel. Nous préparons donc un devis sur mesure, gratuit, sous 24 h. Je peux le lancer maintenant en 1 minute.',
        zone: 'Nous intervenons partout en France, et en Europe sur demande. Les frais de déplacement sont indiqués clairement dans le devis.',
        contact: 'Le plus rapide :'
      },
      call: 'Appeler', wa: 'WhatsApp', mail: 'Écrire un mail',
      q: {
        type: 'Quel type d’événement ?', types: ['Fête de village / mairie', 'Comité des fêtes / association', 'Mariage / soirée privée', 'Entreprise / gala', 'Autre'],
        what: 'Que souhaitez-vous ?', whats: ['Un spectacle / tribute', 'Un groupe de reprises', 'Un DJ', 'Son & lumière', 'Je ne sais pas encore'],
        date: 'Quelle est la date (ou la période) ?', place: 'Dans quelle commune ?', name: 'Votre nom (et organisation) ?',
        contact: 'Un numéro de téléphone ou un email pour vous répondre ?', note: 'Un détail à ajouter ? (budget, nombre de personnes…) ou tapez « non ».',
        ph: 'Votre réponse…', send: 'Envoyer', skip: 'Passer'
      },
      sending: 'Envoi en cours…', done: 'Merci ! Votre demande est bien partie. On vous répond sous 24 h, souvent par téléphone.',
      fail: 'L’envoi n’a pas fonctionné. Appelez-nous au 06 31 94 96 53 ou écrivez à contact@soundlightprod.fr.',
      badc: 'Il me faut un téléphone ou un email valide pour pouvoir vous répondre.', live: { intro: 'Vous pouvez écrire ici, l’équipe SLP vous répond directement quand elle est en ligne.', online: 'Votre message est bien arrivé, on vous répond ici dans quelques instants.', offline: 'Nous ne sommes pas en ligne à cet instant. Laissez un téléphone ou un email dans un message, on vous recontacte rapidement.', ph: 'Écrivez votre message…', err: 'Message non envoyé. Appelez-nous au 06 31 94 96 53.' }, sujet: 'Devis via le chat', no: /^(non|no|rien|nop)$/i
    },
    en: {
      talk: 'Talk to an SLP team member',
      open: 'Open chat', close: 'Close', title: 'SLP', sub: 'Reply within 24 h', teaser: 'Any question? We’ll get back to you.',
      hello: 'Hello! I’m the SLP assistant. Live shows, tribute acts, DJs, sound & lighting: what are you looking for?',
      menu: ['Request a quote', 'Book a show', 'DJ / entertainment', 'Sound & lighting', 'Pricing', 'Where we work', 'Talk to an SLP team member', 'Call / WhatsApp / email'],
      back: 'Another question', again: 'Back to menu',
      a: {
        spectacle: 'We offer 100% live tribute acts, cabaret shows, cover bands and jazz / soul / funk artists for town events, festivals, galas, weddings and private parties. Browse the Artists page, or I can take your request right now.',
        dj: 'A DJ can run your evening (wedding, association, village fête), with sound and lighting if needed. Tell me the date and place and we’ll make a proposal.',
        tech: 'Sound, lighting and technical crew for concerts, parties and events. We size the equipment to your venue and audience: give me the date and place and we’ll send a quote.',
        tarifs: 'Pricing depends on the format, date, distance and equipment, so we prepare a free tailor-made quote within 24 h. I can start it now in a minute.',
        zone: 'We work all over France, and across Europe on request. Travel costs are shown clearly in the quote.',
        contact: 'Fastest way:'
      },
      call: 'Call', wa: 'WhatsApp', mail: 'Send an email',
      q: {
        type: 'What kind of event?', types: ['Town / village event', 'Association / festival committee', 'Wedding / private party', 'Company / gala', 'Other'],
        what: 'What do you need?', whats: ['A show / tribute act', 'A cover band', 'A DJ', 'Sound & lighting', 'Not sure yet'],
        date: 'What is the date (or period)?', place: 'Which town?', name: 'Your name (and organisation)?',
        contact: 'A phone number or email so we can reply?', note: 'Anything to add? (budget, audience size…) or type “no”.',
        ph: 'Your answer…', send: 'Send', skip: 'Skip'
      },
      sending: 'Sending…', done: 'Thank you! Your request has been sent. We’ll reply within 24 h.',
      fail: 'Sending failed. Please call +33 6 31 94 96 53 or email contact@soundlightprod.fr.',
      badc: 'I need a valid phone number or email to be able to reply.', live: { intro: 'Write here: the SLP team replies directly when online.', online: 'Your message has arrived, we’ll reply here shortly.', offline: 'We’re not online right now. Please leave a phone number or email in a message and we’ll get back to you quickly.', ph: 'Write your message…', err: 'Message not sent. Please call +33 6 31 94 96 53.' }, sujet: 'Quote via chat', no: /^(no|non|nothing|nope)$/i
    },
    es: {
      talk: 'Hablar con un miembro de SLP',
      open: 'Abrir el chat', close: 'Cerrar', title: 'SLP', sub: 'Respuesta en 24 h', teaser: '¿Alguna pregunta? Le respondemos.',
      hello: '¡Hola! Soy el asistente de SLP. Espectáculos, tributos, DJ, sonido e iluminación: ¿qué busca?',
      menu: ['Pedir presupuesto', 'Contratar un espectáculo', 'DJ / animación', 'Sonido e iluminación', 'Tarifas', 'Zona de actuación', 'Hablar con un miembro de SLP', 'Llamar / WhatsApp / correo'],
      back: 'Otra pregunta', again: 'Volver al menú',
      a: {
        spectacle: 'Ofrecemos tributos 100 % en directo, espectáculos de cabaret, grupos de versiones y artistas de jazz / soul / funk para ayuntamientos, fiestas, galas, bodas y eventos privados. Consulte la página de Artistas, o tomo su solicitud ahora mismo.',
        dj: 'Un DJ puede animar su evento (boda, asociación, fiesta local), con sonido e iluminación si hace falta. Dígame la fecha y el lugar y le haremos una propuesta.',
        tech: 'Sonido, iluminación y régie técnica para conciertos y eventos. Dimensionamos el equipo según la sala y el público: dígame fecha y lugar y le enviamos un presupuesto.',
        tarifs: 'El precio depende de la fórmula, la fecha, la distancia y el material, por eso preparamos un presupuesto gratuito a medida en 24 h. Puedo iniciarlo ahora en un minuto.',
        zone: 'Actuamos en toda Francia y en Europa bajo petición. Los gastos de desplazamiento figuran claramente en el presupuesto.',
        contact: 'Lo más rápido:'
      },
      call: 'Llamar', wa: 'WhatsApp', mail: 'Escribir un correo',
      q: {
        type: '¿Qué tipo de evento?', types: ['Fiesta local / ayuntamiento', 'Asociación / comité de fiestas', 'Boda / evento privado', 'Empresa / gala', 'Otro'],
        what: '¿Qué necesita?', whats: ['Un espectáculo / tributo', 'Un grupo de versiones', 'Un DJ', 'Sonido e iluminación', 'Aún no lo sé'],
        date: '¿Cuál es la fecha (o el periodo)?', place: '¿En qué localidad?', name: '¿Su nombre (y organización)?',
        contact: '¿Un teléfono o un correo para responderle?', note: '¿Algo más? (presupuesto, nº de personas…) o escriba «no».',
        ph: 'Su respuesta…', send: 'Enviar', skip: 'Saltar'
      },
      sending: 'Enviando…', done: '¡Gracias! Su solicitud ha sido enviada. Le respondemos en 24 h.',
      fail: 'No se pudo enviar. Llame al +33 6 31 94 96 53 o escriba a contact@soundlightprod.fr.',
      badc: 'Necesito un teléfono o un correo válido para poder responderle.', live: { intro: 'Escriba aquí: el equipo de SLP le responde directamente cuando está en línea.', online: 'Su mensaje ha llegado, le respondemos aquí en unos instantes.', offline: 'Ahora mismo no estamos en línea. Deje un teléfono o un correo en un mensaje y le contactamos pronto.', ph: 'Escriba su mensaje…', err: 'Mensaje no enviado. Llame al +33 6 31 94 96 53.' }, sujet: 'Presupuesto vía chat', no: /^(no|nada)$/i
    },
    it: {
      talk: 'Parlare con un membro di SLP',
      open: 'Apri la chat', close: 'Chiudi', title: 'SLP', sub: 'Risposta entro 24 h', teaser: 'Una domanda? Le rispondiamo.',
      hello: 'Buongiorno! Sono l’assistente di SLP. Spettacoli, tribute, DJ, audio e luci: cosa cerca?',
      menu: ['Richiedere un preventivo', 'Prenotare uno spettacolo', 'DJ / animazione', 'Audio e luci', 'Tariffe', 'Zona d’intervento', 'Parlare con un membro di SLP', 'Chiama / WhatsApp / mail'],
      back: 'Un’altra domanda', again: 'Torna al menu',
      a: {
        spectacle: 'Proponiamo tribute 100 % live, spettacoli cabaret, cover band e artisti jazz / soul / funk per comuni, feste, gala, matrimoni ed eventi privati. Consulti la pagina Artisti, oppure raccolgo subito la sua richiesta.',
        dj: 'Un DJ può animare la sua serata (matrimonio, associazione, festa di paese), con audio e luci se necessario. Mi dica data e luogo e le faremo una proposta.',
        tech: 'Audio, illuminazione e regia tecnica per concerti ed eventi. Dimensioniamo l’attrezzatura in base alla sala e al pubblico: mi dica data e luogo e le inviamo un preventivo.',
        tarifs: 'Il prezzo dipende dalla formula, dalla data, dalla distanza e dall’attrezzatura: prepariamo quindi un preventivo gratuito su misura entro 24 h. Posso avviarlo ora in un minuto.',
        zone: 'Interveniamo in tutta la Francia e in Europa su richiesta. Le spese di trasferta sono indicate chiaramente nel preventivo.',
        contact: 'Il modo più rapido:'
      },
      call: 'Chiama', wa: 'WhatsApp', mail: 'Scrivi una mail',
      q: {
        type: 'Che tipo di evento?', types: ['Festa di paese / comune', 'Associazione / comitato feste', 'Matrimonio / evento privato', 'Azienda / gala', 'Altro'],
        what: 'Di cosa ha bisogno?', whats: ['Uno spettacolo / tribute', 'Una cover band', 'Un DJ', 'Audio e luci', 'Non lo so ancora'],
        date: 'Qual è la data (o il periodo)?', place: 'In quale località?', name: 'Il suo nome (e organizzazione)?',
        contact: 'Un numero di telefono o una mail per risponderle?', note: 'Altro da aggiungere? (budget, numero di persone…) oppure scriva «no».',
        ph: 'La sua risposta…', send: 'Invia', skip: 'Salta'
      },
      sending: 'Invio in corso…', done: 'Grazie! La sua richiesta è stata inviata. Le rispondiamo entro 24 h.',
      fail: 'Invio non riuscito. Chiami il +33 6 31 94 96 53 o scriva a contact@soundlightprod.fr.',
      badc: 'Mi serve un telefono o una mail valida per poterle rispondere.', live: { intro: 'Scriva qui: il team SLP risponde direttamente quando è online.', online: 'Il suo messaggio è arrivato, le rispondiamo qui a breve.', offline: 'Al momento non siamo online. Lasci un telefono o una mail in un messaggio e la ricontatteremo presto.', ph: 'Scriva il suo messaggio…', err: 'Messaggio non inviato. Chiami il +33 6 31 94 96 53.' }, sujet: 'Preventivo via chat', no: /^(no|niente)$/i
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
  function talkBtn(w) { var b = document.createElement('button'); b.type = 'button'; b.textContent = t.talk; b.style.borderColor = '#FBC608'; b.addEventListener('click', function () { var r = w.parentNode; track('chat_menu', 'chatmenu:equipe'); w.remove(); say(t.talk, 1); live(); }); w.appendChild(b); }
  function choices(list, cb, links, nolive) {
    var w = document.createElement('div'); w.className = 'slpc-ch';
    (links || []).forEach(function (l) { var a = document.createElement('a'); a.href = l.href; a.textContent = l.label; if (l.ext) { a.target = '_blank'; a.rel = 'noopener'; } a.addEventListener('click', function () { track(l.ev); }); w.appendChild(a); });
    list.forEach(function (c, i) { var b = document.createElement('button'); b.type = 'button'; b.textContent = c; b.addEventListener('click', function () { w.remove(); say(c, 1); cb(c, i); }); w.appendChild(b); });
    if (!nolive && list.indexOf(t.talk) < 0) talkBtn(w);
    msgs.appendChild(w); scroll();
  }
  function ask(label, cb, opt) {
    say(label); (function () { var w = document.createElement('div'); w.className = 'slpc-ch'; talkBtn(w); msgs.appendChild(w); scroll(); })(); form.classList.add('on'); inp.value = ''; inp.placeholder = t.q.ph; inp.focus();
    form.onsubmit = function (e) {
      e.preventDefault(); var v = inp.value.trim();
      if (!v) { if (opt) v = ''; else return; }
      if (v) say(v, 1);
      form.classList.remove('on'); cb(v);
    };
  }
  var started = false;

  function menu(first) {
    if (first) say(t.hello);
    choices(t.menu, function (c, i) {
      track('chat_menu', 'chatmenu:' + ['devis', 'spectacle', 'dj', 'tech', 'tarifs', 'zone', 'equipe', 'contact'][i]);
      if (i === 0) return quote();
      if (i === 6) { return live(); }
      if (i === 7) { say(t.a.contact); return choices([t.again], menu, [
        { label: t.call, href: 'tel:' + PHONE, ev: 'appel' },
        { label: t.wa, href: 'https://wa.me/' + PHONE.replace('+', ''), ev: 'whatsapp', ext: 1 },
        { label: t.mail, href: 'mailto:contact@soundlightprod.fr', ev: 'mail' }]); }
      var key = ['', 'spectacle', 'dj', 'tech', 'tarifs', 'zone'][i];
      say(t.a[key]);
      var extra = [];
      if (i === 1) extra.push({ label: L === 'fr' ? 'Artistes' : (L === 'en' ? 'Artists' : (L === 'es' ? 'Artistas' : 'Artisti')), href: (L === 'fr' ? '' : '/' + L) + '/artistes.html' });
      choices([t.menu[0], t.back], function (c2, j) { if (j === 0) quote(); else menu(); }, extra);
    });
  }

  function quote() {
    if (!started) { started = true; track('devis'); }
    var d = {};
    say(t.q.type);
    choices(t.q.types, function (c) {
      d.type = c;
      say(t.q.what);
      choices(t.q.whats, function (c2) {
        d.what = c2;
        ask(t.q.date, function (v) { d.date = v;
          ask(t.q.place, function (v2) { d.place = v2;
            ask(t.q.name, function (v3) { d.name = v3;
              (function getContact() {
                ask(t.q.contact, function (v4) {
                  var em = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v4), ph = v4.replace(/[\s.\-()]/g, '').match(/^\+?\d{8,15}$/);
                  if (!em && !ph) { say(t.badc); return getContact(); }
                  d.email = em ? v4 : ''; d.tel = ph ? v4 : '';
                  ask(t.q.note, function (v5) { d.note = t.no.test(v5) ? '' : v5; send(d); }, true);
                });
              })();
            });
          });
        });
      });
    });
  }

  function send(d) {
    var wait = say(t.sending);
    var lines = ['[Chat ' + L.toUpperCase() + ']', 'Événement : ' + d.type, 'Besoin : ' + d.what];
    if (d.note) lines.push('Précisions : ' + d.note);
    fetch('/api/contact', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nom: d.name, telephone: d.tel, email: d.email, sujet: t.sujet, date_event: d.date, lieu: d.place, message: lines.join('\n'), site_web: hp.value, page: 'chat:' + from, session_id: sid })
    }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
      .then(function (j) { if (!j.ok) throw new Error(j.error || ''); wait.textContent = t.done; choices([t.again], menu); })
      .catch(function (e) { wait.textContent = t.fail; choices([t.again], menu, [{ label: t.call, href: 'tel:' + PHONE, ev: 'appel' }]); });
  }

  /* ---- Mode direct : conversation avec l'équipe SLP via /api/chat/* ---- */
  var tok = '', lastId = 0, liveOn = false, pollT = null, firstSent = false, hasContact = false;
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
  function pollNext() { clearTimeout(pollT); pollT = setTimeout(poll, box.classList.contains('on') ? 4000 : 20000); }
  function live(resume) {
    liveOn = true; form.classList.add('on'); inp.placeholder = t.live.ph; if (!resume) { say(t.live.intro); choices([t.again], function () { stopLive(); menu(); }, [
      { label: t.call, href: 'tel:' + PHONE, ev: 'appel' }, { label: t.wa, href: 'https://wa.me/' + PHONE.replace('+', ''), ev: 'whatsapp', ext: 1 }], true); }
    inp.focus();
    form.onsubmit = function (e) {
      e.preventDefault(); var v = inp.value.trim(); if (!v) return;
      say(v, 1); inp.value = '';
      var em = v.match(/[^@\s]+@[^@\s]+\.[^@\s]+/), ph = v.replace(/[\s.\-()]/g, '').match(/\+?\d{9,15}/);
      var c = em ? em[0] : (ph ? ph[0] : '');
      if (c) hasContact = true;
      api('/api/chat/send', { token: tok, body: v, contact: c, page: 'chat:' + from, lang: L, site_web: hp.value }).then(function (j) {
        if (!j.ok) { say(j.error || t.live.err); return; }
        tok = j.token; try { localStorage.setItem('slpc_tok', tok); } catch (e) {}
        if (!firstSent) { firstSent = true; track('formulaire');
          api('/api/chat/poll?token=' + encodeURIComponent(tok) + '&after=' + lastId).then(function (p) { say(p && p.online ? t.live.online : t.live.offline); }); }
        pollNext();
      }).catch(function () { say(t.live.err); });
    };
    pollNext();
  }
  function stopLive() { liveOn = false; form.classList.remove('on'); }

  function setSub(online) { var sm = box.querySelector('#slpc-h small'); if (sm) sm.textContent = online ? '🟢 ' + ({ fr: 'En ligne', en: 'Online', es: 'En línea', it: 'Online' })[L] : t.sub; }
  function refreshStatus() { api('/api/chat/status').then(function (j) { if (j && j.ok) setSub(j.online); }).catch(function () {}); }
  var opened = false;
  function toggle(on) {
    box.classList.toggle('on', on); tip.style.display = 'none';
    if (on) refreshStatus();
    if (on && !opened) { opened = true; track('chat'); if (tok) { say(t.hello); live(true); } else menu(true); }
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
