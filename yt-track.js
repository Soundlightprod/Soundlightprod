// SLP — suivi des lectures des vidéos YouTube intégrées au site.
// Ajouté automatiquement en bas des pages par le worker (withVideoTracking).
// Envoie à /api/track-video : play (1re lecture), 25 / 50 / 75 (% regardé), fin.
// Anonyme : même identifiant de session que le suivi des visites, pas de cookie.
// Respecte l'opt-out (slp_notrack) et n'enregistre rien pour l'admin connecté.
(function () {
  try {
    if (localStorage.getItem("slp_admin_token") || localStorage.getItem("slp_notrack")) return;
  } catch (e) {}

  var frames = [].slice.call(document.querySelectorAll('iframe[src*="youtube.com/embed/"], iframe[src*="youtube-nocookie.com/embed/"]'));
  if (!frames.length) return;

  function sid() {
    try {
      var s = sessionStorage.getItem("slp_visit_sid");
      if (!s) { s = Date.now().toString(36) + Math.random().toString(36).slice(2); sessionStorage.setItem("slp_visit_sid", s); }
      return s;
    } catch (e) { return null; }
  }
  function ref() {
    try {
      var q = new URLSearchParams(location.search), s = q.get("utm_source") || (q.get("utm_medium") === "email" ? "email" : "");
      if (s) {
        var c = (q.get("utm_campaign") || "").toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
        return "https://emailing-" + s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") + (c ? "." + c : "") + "/";
      }
    } catch (e) {}
    return document.referrer;
  }
  var page = location.pathname.replace(/^\/+|\.html$/g, "") || "index";
  var sent = {};
  function send(videoId, ev) {
    var k = videoId + "|" + ev;
    if (sent[k]) return;
    sent[k] = 1;
    try {
      fetch("/api/track-video", {
        method: "POST", keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ video_id: videoId, event: ev, session_id: sid(), page: page, ref: ref() })
      }).catch(function () {});
    } catch (e) {}
  }

  // L'API YouTube n'écoute une vidéo que si son adresse contient enablejsapi=1
  frames.forEach(function (f) {
    var m = f.src.match(/\/embed\/([A-Za-z0-9_-]{6,20})/);
    if (!m) return;
    f.setAttribute("data-slp-video", m[1]);
    if (!/[?&]enablejsapi=1/.test(f.src)) {
      f.src = f.src + (f.src.indexOf("?") < 0 ? "?" : "&") + "enablejsapi=1&origin=" + encodeURIComponent(location.origin);
    }
  });

  function watch() {
    frames.forEach(function (f) {
      var id = f.getAttribute("data-slp-video");
      if (!id) return;
      var timer = null, player;
      function tick() {
        try {
          var d = player.getDuration(), t = player.getCurrentTime();
          if (!d) return;
          var p = t / d;
          if (p >= 0.25) send(id, "25");
          if (p >= 0.5) send(id, "50");
          if (p >= 0.75) send(id, "75");
        } catch (e) {}
      }
      player = new YT.Player(f, {
        events: {
          onStateChange: function (e) {
            if (e.data === YT.PlayerState.PLAYING) {
              send(id, "play");
              if (!timer) timer = setInterval(tick, 5000);
            } else {
              if (timer) { clearInterval(timer); timer = null; }
              tick();
              if (e.data === YT.PlayerState.ENDED) send(id, "fin");
            }
          }
        }
      });
    });
  }

  var prev = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = function () { if (prev) try { prev(); } catch (e) {} watch(); };
  if (window.YT && window.YT.Player) { watch(); return; }
  var s = document.createElement("script");
  s.src = "https://www.youtube.com/iframe_api";
  s.async = true;
  document.head.appendChild(s);
})();
