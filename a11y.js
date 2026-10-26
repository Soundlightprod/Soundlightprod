/* SLP — accessibilité commune (injecté sur les pages publiques par le Worker, avec les autres scripts communs) :
   - lien d'évitement « Aller au contenu » ;
   - focus clavier visible et identique partout ;
   - menu mobile : Échap le ferme et rend le focus au bouton ; aria-expanded toujours synchronisé. */
(function () {
  if (window.__slpA11y) return; window.__slpA11y = true;
  if (/^\/(admin|mon-agenda)/.test(location.pathname)) return;
  var lang = (document.documentElement.getAttribute('lang') || 'fr').slice(0, 2);
  var T = { fr: 'Aller au contenu', en: 'Skip to content', es: 'Ir al contenido', it: 'Vai al contenuto' }[lang] || 'Aller au contenu';
  var st = document.createElement('style');
  st.textContent = '.slp-skip{position:absolute;left:12px;top:-100px;z-index:1000;background:#f7f5f0;color:#0c0a14;padding:12px 18px;border-radius:100px;font:700 .95rem "Instrument Sans",sans-serif;text-decoration:none}.slp-skip:focus{top:10px;outline:3px solid #fbc608;outline-offset:2px}' +
    'a:focus-visible,button:focus-visible,summary:focus-visible,select:focus-visible,input:focus-visible,textarea:focus-visible,[tabindex]:focus-visible{outline:3px solid #fbc608;outline-offset:3px}';
  document.head.appendChild(st);
  var header = document.querySelector('header');
  var first = header && header.nextElementSibling;
  if (header && first) {
    if (!first.id) first.id = 'contenu';
    var a = document.createElement('a'); a.className = 'slp-skip'; a.href = '#' + first.id; a.textContent = T;
    document.body.insertBefore(a, document.body.firstChild);
  }
  /* Clavier logiciel ouvert (viewport bas) : le bandeau de consentement ne doit pas couvrir le champ en cours de saisie. */
  var cb = function () { return document.getElementById('slp-consent'); };
  document.addEventListener('focusin', function (e) {
    var c = cb(); if (!c || !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if ((window.visualViewport ? visualViewport.height : innerHeight) < 620) c.style.visibility = 'hidden';
  });
  document.addEventListener('focusout', function () { var c = cb(); if (c) c.style.visibility = ''; });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var h = document.querySelector('header.menu-open'); if (!h) return;
    h.classList.remove('menu-open');
    var b = h.querySelector('.burger'); if (b) { b.setAttribute('aria-expanded', 'false'); b.focus(); }
  });
})();
