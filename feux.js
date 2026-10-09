/* SLP — « Plein feux » : le point lumineux suit la souris, le faisceau révèle la photo dans le titre. */
(function () {
  var hero = document.querySelector('.feux');
  if (!hero) return;
  var dot = hero.querySelector('.feux-dot');
  var h1 = hero.querySelector('h1');
  if (!dot || !h1) return;
  var bt = document.createElement('span');
  bt.className = 'beamtxt';
  bt.setAttribute('aria-hidden', 'true');
  bt.innerHTML = h1.innerHTML;
  h1.appendChild(bt);

  var c = { x: 0, y: 0 }, off = { x: 0, y: 0 }, fd = 0;
  function place() {
    var hr = hero.getBoundingClientRect(), dr = dot.getBoundingClientRect(), tr = h1.getBoundingClientRect();
    c.x = dr.left + dr.width / 2 - hr.left;
    c.y = dr.top + dr.height / 2 - hr.top;
    hero.style.setProperty('--fx', c.x + 'px');
    hero.style.setProperty('--fy', c.y + 'px');
    bt.style.setProperty('--fx', (c.x - (tr.left - hr.left)) + 'px');
    bt.style.setProperty('--fy', (c.y - (tr.top - hr.top)) + 'px');
    off.x = tr.left - hr.left; off.y = tr.top - hr.top;
    // Le faisceau part d'un sommet placé derrière le cercle, pour qu'il ait la largeur du cercle à sa sortie
    fd = (dr.width / 2) / Math.sin(15 * Math.PI / 180);
    hero.style.setProperty('--fd', fd + 'px'); bt.style.setProperty('--fd', fd + 'px');
  }
  function apex(deg) {
    var r = deg * Math.PI / 180, ax = c.x - fd * Math.sin(r), ay = c.y + fd * Math.cos(r);
    hero.style.setProperty('--ax', ax + 'px'); hero.style.setProperty('--ay', ay + 'px');
    bt.style.setProperty('--ax', (ax - off.x) + 'px'); bt.style.setProperty('--ay', (ay - off.y) + 'px');
  }
  place();
  window.addEventListener('resize', place);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
  setTimeout(place, 1500);

  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var target = null, cur = 238, t0 = performance.now();
  hero.addEventListener('pointermove', function (e) {
    var hr = hero.getBoundingClientRect();
    var a = Math.atan2(e.clientY - hr.top - c.y, e.clientX - hr.left - c.x) * 180 / Math.PI + 90;
    target = ((a % 360) + 360) % 360;
  });
  hero.addEventListener('pointerleave', function () { target = null; });
  function tick(now) {
    var goal = target !== null ? target : (reduce ? 238 : 238 + 9 * Math.sin((now - t0) / 1150));
    var d = ((goal - cur + 540) % 360) - 180;
    cur += d * 0.12;
    hero.style.setProperty('--fa', cur.toFixed(2) + 'deg');
    apex(cur);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // Phrases du titre qui s'enchaînent (titre + copie éclairée en même temps)
  if (h1.classList.contains('rot') && !reduce) {
    var n = h1.querySelectorAll(':scope > .ph').length, i = 0;
    setInterval(function () {
      var prev = i; i = (i + 1) % n;
      [h1, bt].forEach(function (root) {
        var ph = root.querySelectorAll(':scope > .ph');
        ph[prev].classList.remove('on'); ph[prev].classList.add('out');
        ph[i].classList.remove('out'); ph[i].classList.add('on');
        setTimeout(function () { ph[prev].classList.remove('out'); }, 650);
      });
    }, 5000);
  }
})();
