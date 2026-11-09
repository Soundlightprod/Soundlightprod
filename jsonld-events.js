/* Données structurées JSON-LD (schema.org) des spectacles SLP.
   Chargé sur toutes les pages par le worker. Ne fait quelque chose que sur :
   - les fiches artistes / spectacles (FR, en, es, it) : spectacle, artiste, organisateur,
     et une représentation par date publique et validée ;
   - la page Agenda : une représentation par concert à venir.
   Les dates, lieux, billetterie et tarifs viennent de l'agenda public (même source que l'affichage).
   Rien n'est inventé : un événement sans lieu est ignoré, et l'offre (billetterie / tarif)
   n'est publiée que si elle a été renseignée dans l'admin. */
(function () {
  'use strict';
  var API = 'https://slp-api.raspy-silence-d4c7.workers.dev';
  var FR = 'https://soundlightprod.fr';

  var m = location.pathname.replace(/\/+$/, '').match(/^(?:\/(en|es|it))?\/([^\/]+?)(?:\.html)?$/);
  if (!m) return;
  var lang = m[1] || 'fr';
  var page = m[2].toLowerCase();

  // page du site -> identifiant artiste dans l'agenda
  var SLUG = {
    'alchimie': 'alchimie', 'cache-candy': 'cache-candy', 'the-fine-allies': 'the-fine-allies',
    'noon-coverband': 'noon-coverband', 'panache': 'panache', 'bim-bam-boom': 'bim-bam-boom',
    'clement-blouin': 'clement-blouin', 'voice-of-freedom': 'voice-of-freedom',
    'tribute-abba': 'the-best-abba-tribute', 'tribute-calogero': 'calo2-0',
    'tribute-matmatah': 'tribute-matmatah', 'tribute-celine-dion': 'tribute-celine-dion',
    'tribute-kool-and-the-gang': 'tribute-kool-and-the-gang', 'tribute-bee-gees': 'tribute-bee-gees',
    'tribute-phil-collins': 'tribute-phil-collins', 'tribute-balavoine': 'tribute-balavoine',
    'tribute-barry-white': 'tribute-barry-white'
  };
  var LABEL = {
    'alchimie': 'Alchimie', 'cache-candy': 'Cache Candy', 'the-fine-allies': 'The Fine Allies',
    'noon-coverband': 'NooN Coverband', 'panache': 'Panache', 'bim-bam-boom': 'Bim Bam Boom',
    'clement-blouin': 'Clément Blouin', 'voice-of-freedom': 'Voice of Freedom',
    'the-best-abba-tribute': 'Tribute ABBA', 'calo2-0': 'Tribute Calogero', 'tribute-matmatah': 'Tribute Matmatah',
    'tribute-celine-dion': 'Tribute Céline Dion', 'tribute-kool-and-the-gang': 'Tribute Kool & the Gang',
    'tribute-bee-gees': 'Tribute Bee Gees', 'tribute-phil-collins': 'Tribute Phil Collins',
    'tribute-balavoine': 'Tribute Balavoine', 'tribute-barry-white': 'Tribute Barry White'
  };
  var SLUG_TO_PAGE = {};
  Object.keys(SLUG).forEach(function (p) { SLUG_TO_PAGE[SLUG[p]] = p; });

  var isAgenda = page === 'agenda';
  var artistSlug = SLUG[page];
  if (!isAgenda && !artistSlug) return;

  // Versions en/es/it : soundlightprod.com ; français : soundlightprod.fr
  function pageUrl(p, l) { return (l && l !== 'fr' ? 'https://soundlightprod.com/' + l + '/' : FR + '/') + p; }

  var ORG = { '@type': 'Organization', '@id': FR + '/#org', name: 'SLP Sound Light Prod', url: FR + '/' };

  // « 21h », « 21h30 », « 21:00 » -> [h, mn] ; sinon null
  function parseTime(t) {
    var r = String(t || '').match(/(\d{1,2})\s*(?:h|:)\s*(\d{2})?/i);
    if (!r) return null;
    var h = +r[1], mn = r[2] ? +r[2] : 0;
    return h < 24 && mn < 60 ? [h, mn] : null;
  }
  function two(n) { return (n < 10 ? '0' : '') + n; }
  // Décalage Europe/Paris à cette date (+01:00 ou +02:00)
  function parisOffset(dateStr) {
    try {
      var d = new Date(dateStr + 'T12:00:00Z');
      var part = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Paris', timeZoneName: 'longOffset' })
        .formatToParts(d).filter(function (x) { return x.type === 'timeZoneName'; })[0];
      var o = part && part.value.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
      return o ? o[1] + two(+o[2]) + ':' + (o[3] || '00') : '';
    } catch (e) { return ''; }
  }
  function isoDate(s) { var r = String(s || '').match(/^\d{4}-\d{2}-\d{2}/); return r ? r[0] : null; }

  function eventType(t) {
    if (t === 'concert' || t === 'dj') return 'MusicEvent';
    if (t === 'cabaret') return 'TheaterEvent';
    return 'Event';
  }

  // Tarif : nombre -> prix ; « gratuit / entrée libre » -> 0 ; sinon pas de prix chiffré
  function priceOf(raw) {
    var t = String(raw || '').trim();
    if (!t) return null;
    if (/gratuit|libre|free|gratis|gratuito|ingresso libero/i.test(t)) return '0';
    var n = t.replace(',', '.').match(/\d+(?:\.\d{1,2})?/);
    return n ? n[0] : null;
  }

  function offerOf(e) {
    var url = /^https?:\/\//i.test(e.ticket_url || '') ? e.ticket_url : null;
    var price = priceOf(e.ticket_price);
    if (!url && price === null) return null;
    var o = { '@type': 'Offer', availability: 'https://schema.org/InStock' };
    if (url) o.url = url;
    if (price !== null) { o.price = price; o.priceCurrency = 'EUR'; }
    return o;
  }

  function buildGraph(items) {
    var graph = [];
    var bySlug = {};
    items.forEach(function (e) {
      var date = isoDate(e.event_date);
      if (!date) return;
      if (!e.venue_name && !e.venue_city) return; // lieu obligatoire pour un événement valide
      var slug = e.artist_slug;
      var p = SLUG_TO_PAGE[slug];
      var name = e.guest_name || LABEL[slug];
      if (!name) return;
      var artistUrl = p ? pageUrl(p, lang) : null;
      var artistId = artistUrl ? artistUrl + '#artist' : null;
      var showId = artistUrl ? artistUrl + '#spectacle' : null;

      var t = parseTime(e.event_time);
      var off = parisOffset(date);
      var start = t ? date + 'T' + two(t[0]) + ':' + two(t[1]) + ':00' + off : date;
      var end = isoDate(e.event_end_date);
      var ev = {
        '@type': eventType(e.type),
        name: name + (e.venue_city ? ' · ' + e.venue_city : ''),
        startDate: start,
        eventStatus: 'https://schema.org/EventScheduled',
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        location: {
          '@type': 'Place',
          name: e.venue_name || e.venue_city,
          address: { '@type': 'PostalAddress', addressLocality: e.venue_city || undefined, addressCountry: 'FR' }
        },
        performer: artistId ? { '@id': artistId } : { '@type': 'PerformingGroup', name: name },
        organizer: { '@id': ORG['@id'] }
      };
      if (end && end !== date) ev.endDate = end;
      if (e.text) ev.description = String(e.text).slice(0, 300);
      if (e.photo_url && /^https?:\/\//i.test(e.photo_url)) ev.image = e.photo_url;
      if (artistUrl) ev.url = artistUrl;
      if (showId) ev.superEvent = { '@id': showId };
      var offer = offerOf(e);
      if (offer) { if (!offer.url && artistUrl) offer.url = artistUrl; ev.offers = offer; }
      if (!bySlug[slug]) bySlug[slug] = { name: name, p: p, events: [] };
      bySlug[slug].events.push(ev);
    });

    // Fiche artiste : l'artiste, le spectacle et l'organisateur sont publiés même sans date à venir.
    if (!isAgenda && !bySlug[artistSlug] && LABEL[artistSlug]) {
      var h1 = document.querySelector('h1');
      bySlug[artistSlug] = { name: (h1 && h1.textContent.trim().split(/\s+[—–-]\s+/)[0]) || LABEL[artistSlug], p: SLUG_TO_PAGE[artistSlug], events: [] };
    }
    var slugs = Object.keys(bySlug);
    if (!slugs.length) return null;
    graph.push(ORG);
    slugs.forEach(function (slug) {
      var b = bySlug[slug];
      if (b.p) {
        var u = pageUrl(b.p, lang);
        graph.push({ '@type': 'MusicGroup', '@id': u + '#artist', name: b.name, url: u });
        graph.push({
          '@type': 'EventSeries', '@id': u + '#spectacle', name: b.name, url: u,
          performer: { '@id': u + '#artist' }, organizer: { '@id': ORG['@id'] }
        });
      }
      b.events.forEach(function (ev) { graph.push(ev); });
    });
    return { '@context': 'https://schema.org', '@graph': graph };
  }

  function inject(data) {
    if (!data) return;
    var s = document.createElement('script');
    s.type = 'application/ld+json';
    s.id = 'slp-events-jsonld';
    // Pas de </script> possible dans le contenu : on échappe « < ».
    s.text = JSON.stringify(data).replace(/</g, '\\u003c');
    document.head.appendChild(s);
  }

  var endpoint = isAgenda ? '/api/agenda-public' : '/api/actualites?artist=' + encodeURIComponent(artistSlug);
  fetch(API + endpoint)
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (items) {
      if (!Array.isArray(items)) return;
      items = items.filter(function (e) { return !e.type || /^(concert|cabaret|dj|animation|karaoke)$/.test(e.type); });
      items.forEach(function (e) { if (!e.artist_slug) e.artist_slug = artistSlug; });
      inject(buildGraph(items));
    })
    .catch(function () { /* données structurées facultatives */ });
})();
