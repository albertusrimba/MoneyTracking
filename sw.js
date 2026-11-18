const CACHE_PREFIX = 'catatan-pengeluaran-';
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const APP_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/charts.js',
  './js/pwa.js',
  './js/utils/date.js',
  './js/utils/format.js',
  './js/utils/image.js',
  './lib/dexie.min.mjs',
  './lib/chart.umd.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

async function notifyClients(type, message = '') {
  const appClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const appClient of appClients) {
    appClient.postMessage({ type, message });
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      const assetUrls = APP_ASSETS.map((asset) => new URL(asset, self.registration.scope).href);
      await cache.addAll(assetUrls);
      await self.skipWaiting();
    } catch (error) {
      await notifyClients('offline-install-failed', error.message);
      throw error;
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
    await notifyClients('offline-ready');
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  const scopeUrl = new URL(self.registration.scope);
  if (requestUrl.origin !== scopeUrl.origin || !requestUrl.pathname.startsWith(scopeUrl.pathname)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);
    if (cachedResponse) return cachedResponse;

    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch (error) {
      if (request.mode === 'navigate') {
        const appPage = new URL('./index.html', scopeUrl).href;
        const offlinePage = await cache.match(appPage);
        if (offlinePage) return offlinePage;
      }
      throw error;
    }
  })());
});
