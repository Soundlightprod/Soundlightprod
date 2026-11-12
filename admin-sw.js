// Service worker minimal — sert uniquement à rendre l'admin "installable" (PWA)
// sur Android/Chrome. Ne met rien en cache : l'admin doit toujours charger les
// données fraîches depuis l'API, jamais une version périmée hors-ligne.
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { self.clients.claim(); });
self.addEventListener('fetch', () => {}); // pas d'interception : tout passe par le réseau

// Notifications : le serveur envoie un push vide. Le service worker demande alors le texte en attente pour cet appareil
// (rappels CRM : relances, devis) ; sans texte en attente, c'est l'alerte du chat.
async function pendingMessage() {
  try {
    const sub = await self.registration.pushManager.getSubscription();
    if (!sub) return null;
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sub.endpoint));
    const h = [...new Uint8Array(d)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
    const r = await fetch('/api/push/pending?h=' + h, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.title ? j : null;
  } catch (e) { return null; }
}
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    const m = await pendingMessage();
    if (m) {
      await self.registration.showNotification(m.title, { body: m.body, tag: 'slp-crm', renotify: true, icon: 'admin-icon-192.png', badge: 'admin-icon-192.png', data: { url: m.url || '/admin-contacts.html' } });
    } else {
      await self.registration.showNotification('💬 Chat SLP', { body: 'Un visiteur vous écrit sur le site.', tag: 'slp-chat', renotify: true, icon: 'admin-icon-192.png', badge: 'admin-icon-192.png', data: { url: '/admin.html#chat' } });
    }
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/admin.html#chat';
  const page = target.split('#')[0];
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.includes(page)) { c.navigate(target).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(target);
  }));
});
