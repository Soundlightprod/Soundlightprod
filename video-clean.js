/* SLP — vidéos YouTube « propres » : pas de menu YouTube (titre, barre, « plus de vidéos »),
   un seul gros bouton lecture/pause posé par-dessus, et un bouton plein écran.
   S'applique à toutes les vidéos YouTube du site, y compris celles créées après le chargement (onglets, galerie).
   Ignore la vidéo de l'accueil (#heroVideo), qui a son propre bouton son. */
(function () {
  var SEL = 'iframe[src*="youtube.com/embed/"],iframe[src*="youtube-nocookie.com/embed/"]';
  var PARAMS = { controls: '0', disablekb: '1', fs: '0', iv_load_policy: '3', cc_load_policy: '0', rel: '0', modestbranding: '1', playsinline: '1', enablejsapi: '1' };
  var reg = [];

  var st = document.createElement('style');
  st.textContent =
    '.vc-ov{position:absolute;inset:0;z-index:3;border:0;margin:0;padding:0;background:transparent;cursor:pointer;display:block;width:100%;height:100%;font:inherit;}' +
    '.vc-ov.vc-poster{background-color:#0c0a14;background-size:cover;background-position:center;}' +
    '.vc-ov:focus-visible{outline:3px solid #ffb238;outline-offset:-3px;}' +
    '.vc-play{position:absolute;left:50%;top:50%;width:76px;height:76px;margin:-38px 0 0 -38px;border-radius:50%;background:rgba(12,10,20,.82);color:#f1ece2;display:flex;align-items:center;justify-content:center;font-size:30px;padding-left:5px;box-shadow:0 8px 30px rgba(0,0,0,.5);transition:transform .15s ease,opacity .2s ease;}' +
    '.vc-ov:hover .vc-play{transform:scale(1.08);}' +
    '.vc-ov.vc-on .vc-play{opacity:0;transform:scale(.8);}' +
    '.vc-fs{position:absolute;right:10px;bottom:10px;z-index:4;width:36px;height:36px;border:0;border-radius:50%;background:rgba(12,10,20,.78);color:#f1ece2;font-size:16px;cursor:pointer;line-height:1;}' +
    '.vc-host iframe{pointer-events:none !important;}';
  document.head.appendChild(st);

  function skip(f) { return f.id === 'heroVideo' || f.hasAttribute('data-notrack') || (f.closest && f.closest('#heroVideo')); }

  function cleanSrc(f) {
    var u; try { u = new URL(f.src); } catch (e) { return; }
    var ch = false;
    for (var k in PARAMS) if (u.searchParams.get(k) !== PARAMS[k]) { u.searchParams.set(k, PARAMS[k]); ch = true; }
    if (!u.searchParams.has('origin')) { u.searchParams.set('origin', location.origin); ch = true; }
    if (ch) f.src = u.toString();
  }

  function cmd(f, fn) { try { f.contentWindow.postMessage(JSON.stringify({ event: 'command', func: fn, args: [] }), '*'); } catch (e) {} }
  function listen(f) { try { f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*'); } catch (e) {} }

  function setup(f) {
    if (f._vc || skip(f)) return;
    f._vc = true;
    cleanSrc(f);
    var host = f.parentNode;
    if (!host) return;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.classList.add('vc-host');
    var playing = /[?&]autoplay=1/.test(f.src);
    var ov = document.createElement('button');
    ov.type = 'button'; ov.className = 'vc-ov'; ov.setAttribute('aria-label', 'Lecture / pause de la vidéo');
    ov.innerHTML = '<span class="vc-play" aria-hidden="true">▶</span>';
    // Avant la première lecture : affiche de la vidéo par-dessus, pour masquer l'écran d'accueil de YouTube (titre, « Regarder sur YouTube »)
    var vid = (f.src.match(/\/embed\/([A-Za-z0-9_-]{6,20})/) || [])[1], poster = !playing && !!vid;
    function dropPoster() { poster = false; ov.classList.remove('vc-poster'); ov.style.backgroundImage = ''; }
    if (poster) {
      var im = new Image();
      im.onload = function () { if (poster) { ov.style.backgroundImage = 'url(' + im.src + ')'; ov.classList.add('vc-poster'); } };
      im.onerror = function () { var h = new Image(); h.onload = function () { if (poster) { ov.style.backgroundImage = 'url(' + h.src + ')'; ov.classList.add('vc-poster'); } }; h.src = 'https://i.ytimg.com/vi/' + vid + '/hqdefault.jpg'; };
      im.src = 'https://i.ytimg.com/vi/' + vid + '/maxresdefault.jpg';
    }
    function paint() { ov.classList.toggle('vc-on', playing); if (playing && poster) dropPoster(); }
    ov.addEventListener('click', function () { playing = !playing; cmd(f, playing ? 'playVideo' : 'pauseVideo'); paint(); });
    host.appendChild(ov);
    var host2 = host;
    if (host.requestFullscreen || host.webkitRequestFullscreen) {
      var fs = document.createElement('button');
      fs.type = 'button'; fs.className = 'vc-fs'; fs.setAttribute('aria-label', 'Plein écran'); fs.textContent = '⛶';
      fs.addEventListener('click', function (e) {
        e.stopPropagation();
        var fn = host2.requestFullscreen || host2.webkitRequestFullscreen;
        if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        else fn.call(host2);
      });
      host.appendChild(fs);
    }
    var rec = { f: f, set: function (s) { playing = (s === 1 || s === 3); paint(); } };
    reg.push(rec);
    f.addEventListener('load', function () { listen(f); setTimeout(function () { listen(f); }, 600); setTimeout(function () { listen(f); }, 2000); });
    paint();
  }

  window.addEventListener('message', function (e) {
    if (!/youtube(-nocookie)?\.com$/.test((e.origin || '').replace(/^https?:\/\//, ''))) return;
    var d = e.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (x) { return; } }
    if (!d || !d.info || typeof d.info.playerState === 'undefined') return;
    for (var i = 0; i < reg.length; i++) if (reg[i].f.contentWindow === e.source) reg[i].set(d.info.playerState);
  });

  function scan(root) { [].slice.call((root || document).querySelectorAll(SEL)).forEach(setup); }
  scan();
  new MutationObserver(function (ms) {
    ms.forEach(function (m) {
      if (m.type === 'attributes' && m.target.matches && m.target.matches(SEL) && m.target._vc) { cleanSrc(m.target); if (/[?&]autoplay=1/.test(m.target.src)) for (var i = 0; i < reg.length; i++) if (reg[i].f === m.target) reg[i].set(1); }
      (m.addedNodes || []).forEach(function (n) { if (n.nodeType === 1) { if (n.matches && n.matches(SEL)) setup(n); else if (n.querySelectorAll) scan(n); } });
    });
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
})();
