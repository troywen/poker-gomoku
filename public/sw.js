const CACHE = 'pg-v1';
const ASSETS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // WebSocket / socket.io / API requests go to network (never cache)
  if (event.request.url.includes('/socket.io/') || event.request.url.includes('/api')) return;
  event.respondWith(
    caches.match(event.request).then((res) => res || fetch(event.request))
  );
});
