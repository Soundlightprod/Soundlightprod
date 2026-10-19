// Service worker minimal — sert uniquement à rendre l'admin "installable" (PWA)
// sur Android/Chrome. Ne met rien en cache : l'admin doit toujours charger les
// données fraîches depuis l'API, jamais une version périmée hors-ligne.
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { self.clients.claim(); });
self.addEventListener('fetch', () => {}); // pas d'interception : tout passe par le réseau

// Notifications du chat : le serveur envoie un push vide, on affiche le message d'alerte.
self.addEventListener('push', (e) => {
  e.waitUntil(self.registration.showNotification('💬 Chat SLP', {
    body: 'Un visiteur vous écrit sur le site.', tag: 'slp-chat', renotify: true,
    icon: 'admin-icon-192.png', badge: 'admin-icon-192.png', data: { url: '/admin.html#chat' }
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.includes('/admin')) { c.navigate('/admin.html#chat').catch(() => {}); return c.focus(); } }
    return self.clients.openWindow('/admin.html#chat');
  }));
});
