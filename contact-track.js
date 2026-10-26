/* SLP — suivi unique des clics de contact (appel, WhatsApp, mail, devis, chat, début de formulaire).
   Injecté sur toutes les pages publiques par le Worker (withVideoTracking). C'est le SEUL système de
   comptage des clics de contact : les anciens extraits en ligne dans les pages ont été retirés.
   Règle : un clic = un événement.
   - Un élément portant data-contact="devis|appel|whatsapp|mail|chat|chat_menu|formulaire" est compté
     avec cette valeur, quelle que soit la forme de son href.
   - Sinon, repli sur la forme du lien : tel:, wa.me, mailto:, et tout lien vers la page contact
     (« contact », « contact?artiste=… », « /contact.html#… ») hors en-tête de navigation et pied de page.
   Pas de suivi pour les navigateurs de l'admin ou « notrack ». window.slpTrack(action) sert aux scripts
   qui comptent un événement sans clic (début de saisie du formulaire). */
(function () {
  if (window.__slpContactTrack) return; window.__slpContactTrack = true;
  var skip = false;
  try { skip = !!(localStorage.getItem('slp_notrack') || localStorage.getItem('slp_admin_token')); } catch (e) {}
  if (skip) { window.slpTrack = function () {}; return; }
  var OK = { appel: 1, whatsapp: 1, mail: 1, devis: 1, formulaire: 1, chat: 1, chat_menu: 1 };
  var slug = location.pathname.replace(/^\/(en|es|it)\//, '/').replace(/^\/+|\.html$|\/$/g, '') || 'index';
  var last = { k: '', t: 0 };
  function send(action, page) {
    if (!OK[action]) return;
    var now = Date.now(), key = action + '|' + (page || slug);
    if (last.k === key && now - last.t < 600) return; // double déclenchement du même clic
    last = { k: key, t: now };
    var sid = ''; try { sid = sessionStorage.getItem('slp_visit_sid') || ''; } catch (e) {}
    var data = JSON.stringify({ action: action, page: page || slug, session_id: sid });
    try { if (navigator.sendBeacon && navigator.sendBeacon('/api/contact-event', new Blob([data], { type: 'application/json' }))) return; } catch (e) {}
    try { fetch('/api/contact-event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: data, keepalive: true }).catch(function () {}); } catch (e) {}
  }
  window.slpTrack = send;
  var CONTACT = /^(https?:\/\/(www\.)?soundlightprod\.(fr|com))?(\/(en|es|it))?\/?\.?\/?contact(\.html)?([?#].*)?$/i;
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('[data-contact], a[href]');
    if (!el) return;
    var explicit = el.getAttribute('data-contact');
    if (explicit) { send(explicit); return; }
    var h = el.getAttribute('href') || '';
    var action = /^tel:/i.test(h) ? 'appel'
      : /wa\.me|api\.whatsapp\.com/i.test(h) ? 'whatsapp'
      : /^mailto:/i.test(h) ? 'mail'
      : CONTACT.test(h) && !el.closest('header nav, footer') ? 'devis'
      : null;
    if (action) send(action);
  });
})();
