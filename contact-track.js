/* SLP — suivi des clics de contact (appel, WhatsApp, mail, devis) sur les pages qui n'ont pas leur propre suivi :
   boutique et fiches produit, agenda, mentions légales, CGV…
   Ajouté par le worker (withVideoTracking). Ne fait rien si la page contient déjà son suivi en ligne
   (évite de compter deux fois) ni pour les visites de l'admin ou « notrack ».
   Les clics sont comptés dans contact_events via /api/contact-event. */
(function () {
  try {
    var dejaSuivie = Array.prototype.some.call(document.scripts, function (s) {
      return !s.src && s.textContent.indexOf('/api/contact-event') > -1;
    });
    if (dejaSuivie) return;
  } catch (e) {}
  var skip = false;
  try { skip = !!(localStorage.getItem('slp_notrack') || localStorage.getItem('slp_admin_token')); } catch (e) {}
  if (skip) return;
  var slug = location.pathname.replace(/^\/(en|es|it)\//, '/').replace(/^\/+|\.html$|\/$/g, '') || 'index';
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var h = a.getAttribute('href') || '';
    var action = /^tel:/i.test(h) ? 'appel'
      : /wa\.me|api\.whatsapp\.com/i.test(h) ? 'whatsapp'
      : /^mailto:/i.test(h) ? 'mail'
      : /^(https?:\/\/(www\.)?soundlightprod\.(fr|com))?\/?contact(\.html)?\?/i.test(h) ? 'devis'
      : null;
    if (!action) return;
    var sid = ''; try { sid = sessionStorage.getItem('slp_visit_sid') || ''; } catch (err) {}
    var data = JSON.stringify({ action: action, page: slug, session_id: sid });
    try { if (navigator.sendBeacon && navigator.sendBeacon('/api/contact-event', new Blob([data], { type: 'application/json' }))) return; } catch (err) {}
    fetch('/api/contact-event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: data, keepalive: true }).catch(function () {});
  });
})();
