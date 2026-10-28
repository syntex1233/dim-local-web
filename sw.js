// Service Worker: hält die App-Dateien für den Offline-Start bereit; immer zuerst aus dem Netz (Updates sofort)
const CACHE = 'dimweb-v5';
const SHELL = ['./', 'index.html', 'app.mjs', 'config.mjs', 'core.mjs', 'data.mjs', 'inventory.mjs', 'bungie.mjs', 'extra.mjs', 'cloud.mjs', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png'];

// Neue Version sofort aktiv; alte Caches weg
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); });
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return; // Bungie & Co. nie zwischenspeichern
  // no-cache: GitHub Pages schickt max-age=600, sonst käme bis zu 10 Minuten die alte Version
  e.respondWith(fetch(e.request, { cache: 'no-cache' })
    .then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
