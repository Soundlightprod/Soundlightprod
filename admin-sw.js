// Service worker minimal — sert uniquement à rendre l'admin "installable" (PWA)
// sur Android/Chrome. Ne met rien en cache : l'admin doit toujours charger les
// données fraîches depuis l'API, jamais une version périmée hors-ligne.
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { self.clients.claim(); });
self.addEventListener('fetch', () => {}); // pas d'interception : tout passe par le réseau
