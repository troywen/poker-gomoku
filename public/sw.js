const CACHE = 'pg-v2';
const ASSETS = ['/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

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
  // API / socket.io requests go to network
  if (event.request.url.includes('/api') || event.request.url.includes('/socket.io')) return;
  // Network-first for HTML/JS (real-time game needs fresh code)
  event.respondWith(
    fetch(event.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((cache) => {
        if (res.status === 200) cache.put(event.request, copy);
      });
      return res;
    }).catch(() => caches.match(event.request))
  );
});
