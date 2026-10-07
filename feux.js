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

  var c = { x: 0, y: 0 };
  function place() {
    var hr = hero.getBoundingClientRect(), dr = dot.getBoundingClientRect(), tr = h1.getBoundingClientRect();
    c.x = dr.left + dr.width / 2 - hr.left;
    c.y = dr.top + dr.height / 2 - hr.top;
    hero.style.setProperty('--fx', c.x + 'px');
    hero.style.setProperty('--fy', c.y + 'px');
    bt.style.setProperty('--fx', (c.x - (tr.left - hr.left)) + 'px');
    bt.style.setProperty('--fy', (c.y - (tr.top - hr.top)) + 'px');
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
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
