// Service Worker: hält die App-Dateien für den Offline-Start bereit; immer zuerst aus dem Netz (Updates sofort)
const CACHE = 'dimweb-v2';
const SHELL = ['./', 'index.html', 'app.mjs', 'config.mjs', 'core.mjs', 'data.mjs', 'inventory.mjs', 'bungie.mjs', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png'];

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return; // Bungie & Co. nie zwischenspeichern
  e.respondWith(fetch(e.request)
    .then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
