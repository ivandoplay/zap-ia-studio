const CACHE_NAME = 'zapia-studio-shell-v6';
const SHELL_ASSETS = ['/', '/styles.css', '/app.js', '/manifest.json', '/icon.svg'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Nunca intercepta API, WebSocket, mídias dinâmicas (/uploads/) ou requisições parciais de áudio/vídeo (Range / 206)
  if (
    req.method !== 'GET' ||
    req.headers.get('range') ||
    req.url.includes('/api/') ||
    req.url.includes('/uploads/') ||
    req.url.includes('supabase.co') ||
    req.url.includes('/ws')
  ) {
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
