/* SLP — bandeau « Suivez-nous » ajouté juste avant le pied de page de chaque page publique.
   Ajouté par le worker (withVideoTracking) ; ne fait rien s'il n'y a pas de <footer>.
   Les clics sont comptés dans contact_events (action « suivre », page = réseau:page). */
(function () {
  var footer = document.querySelector('footer');
  if (!footer || document.getElementById('slp-suivez')) return;
  var path = location.pathname;
  var L = (path.match(/^\/(en|es|it)(\/|$)/) || [])[1] || 'fr';
  var T = {
    fr: { k: 'Suivez SLP', t: 'Les dates près de chez vous, les coulisses et les nouveaux artistes', s: 'Extraits live, montages son et lumière, dates à réserver : on poste trois fois par semaine.' },
    en: { k: 'Follow SLP', t: 'Upcoming shows, behind the scenes and new artists', s: 'Live clips, sound and light setups, dates to book: three posts a week.' },
    es: { k: 'Sigue a SLP', t: 'Fechas, entre bastidores y nuevos artistas', s: 'Fragmentos en directo, montajes de sonido y luz, fechas para reservar: tres publicaciones por semana.' },
    it: { k: 'Segui SLP', t: 'Date, dietro le quinte e nuovi artisti', s: 'Estratti dal vivo, montaggi luci e audio, date da prenotare: tre post a settimana.' }
  }[L];
  var NETS = [
    { id: 'facebook', name: 'Facebook', url: 'https://www.facebook.com/SoundlightP',
      svg: '<path d="M13.8 8.6h1.9V5.9h-2.2c-2.3 0-3.7 1.5-3.7 3.8v1.6H7.6v2.8h2.2V21h3v-6.9h2.4l.4-2.8h-2.8V9.9c0-.8.3-1.3 1-1.3z"/>' },
    { id: 'instagram', name: 'Instagram', url: 'https://www.instagram.com/slp_france/',
      svg: '<rect x="3" y="3" width="18" height="18" rx="5.5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none"/>' },
    { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com/@SOUNDLIGHTPROD',
      svg: '<rect x="2" y="6" width="20" height="12" rx="4"/><polygon points="10 9.2 15.8 12 10 14.8" fill="currentColor" stroke="none"/>' }
  ];
  var sid = ''; try { sid = sessionStorage.getItem('slp_visit_sid') || ''; } catch (e) {}
  var noTrack = false; try { noTrack = !!(localStorage.getItem('slp_notrack') || localStorage.getItem('slp_admin_token')); } catch (e) {}
  var from = path.replace(/^\/(en|es|it)\//, '/').replace(/^\/+|\.html$|\/$/g, '') || 'index';
  function track(net) {
    if (noTrack) return;
    var d = JSON.stringify({ action: 'suivre', page: net + ':' + from, session_id: sid });
    try { if (navigator.sendBeacon && navigator.sendBeacon('/api/contact-event', new Blob([d], { type: 'application/json' }))) return; } catch (e) {}
    fetch('/api/contact-event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: d, keepalive: true }).catch(function () {});
  }
  var css = '' +
    '#slp-suivez{border-top:1px solid rgba(255,255,255,.1);padding:44px 24px;background:linear-gradient(180deg,rgba(140,50,144,.14),rgba(12,10,20,0))}' +
    '#slp-suivez .sv-in{max-width:1220px;margin:0 auto;display:flex;flex-wrap:wrap;gap:22px 40px;align-items:center;justify-content:space-between}' +
    '#slp-suivez .sv-txt{flex:1 1 360px;min-width:0}' +
    '#slp-suivez .sv-k{font-family:"DM Mono",monospace;font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;color:#fc8024;margin-bottom:8px}' +
    '#slp-suivez h2{font-family:"League Spartan",sans-serif;font-weight:800;font-size:clamp(1.3rem,2.6vw,1.8rem);line-height:1.1;color:#f7f5f0;margin:0 0 8px;text-wrap:balance}' +
    '#slp-suivez p{color:#a9a4bc;font-size:.92rem;margin:0}' +
    '#slp-suivez .sv-btns{display:flex;flex-wrap:wrap;gap:10px}' +
    '#slp-suivez a{display:inline-flex;align-items:center;gap:9px;padding:11px 18px;border-radius:999px;background:rgba(255,255,255,.07);color:#f7f5f0;text-decoration:none;font-weight:700;font-size:.9rem;transition:background .2s ease,color .2s ease,transform .2s ease}' +
    '#slp-suivez a svg{width:19px;height:19px;flex:none}' +
    '#slp-suivez a:hover,#slp-suivez a:focus-visible{background:#fbc608;color:#0c0a14;transform:translateY(-2px);outline:none}' +
    '@media (prefers-reduced-motion: reduce){#slp-suivez a{transition:none}#slp-suivez a:hover{transform:none}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  var sec = document.createElement('section');
  sec.id = 'slp-suivez';
  sec.setAttribute('aria-label', T.k);
  var btns = NETS.map(function (n) {
    return '<a href="' + n.url + '" target="_blank" rel="noopener" data-net="' + n.id + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + n.svg + '</svg>' + n.name + '</a>';
  }).join('');
  sec.innerHTML = '<div class="sv-in"><div class="sv-txt"><div class="sv-k">' + T.k + '</div><h2>' + T.t + '</h2><p>' + T.s + '</p></div><div class="sv-btns">' + btns + '</div></div>';
  sec.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-net]');
    if (a) track(a.getAttribute('data-net'));
  });
  footer.parentNode.insertBefore(sec, footer);
})();
