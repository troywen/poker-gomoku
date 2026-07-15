const CACHE = 'pg-v3';
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
  // Force all clients to reload with fresh code
  self.clients.matchAll().then((clients) => {
    clients.forEach((client) => client.navigate(client.url));
  });
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Never cache: API, socket.io, HTML pages (always fetch fresh)
  if (url.pathname === '/' || url.pathname.endsWith('.html') ||
      url.pathname.includes('/api') || url.pathname.includes('/socket.io')) {
    return;
  }
  // Cache static assets (icons, manifest) with cache-first
  event.respondWith(
    caches.match(event.request).then((res) => res || fetch(event.request))
  );
});
