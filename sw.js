/* ============================================================
   SpendWise Service Worker v2.0
   Strategy: Cache-First for static assets, Network-First for HTML
   Fully offline capable — all data stored in localStorage
   ============================================================ */

const CACHE_NAME = 'spendwise-v2.0.0';
const OFFLINE_URL = './index.html';

// All assets to pre-cache on install
const PRECACHE_URLS = [
  './index.html',
  './manifest.json',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
];

// External CDN resources (cached on first use)
const CDN_URLS = [
  'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,600;9..144,700&family=DM+Sans:wght@300;400;500;600&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js',
];

/* ── INSTALL ─────────────────────────────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // Cache local assets first (critical)
        return cache.addAll(PRECACHE_URLS)
          .then(() => {
            // Then try to cache CDN assets (non-critical, don't fail install)
            return Promise.allSettled(
              CDN_URLS.map(url =>
                fetch(url, { mode: 'cors', credentials: 'omit' })
                  .then(res => {
                    if (res.ok) return cache.put(url, res);
                  })
                  .catch(() => { /* CDN unavailable, skip silently */ })
              )
            );
          });
      })
      .then(() => self.skipWaiting())
      .catch(err => console.error('[SW] Install failed:', err))
  );
});

/* ── ACTIVATE ────────────────────────────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(name => name !== CACHE_NAME)
            .map(name => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
      .catch(err => console.error('[SW] Activate failed:', err))
  );
});

/* ── FETCH ───────────────────────────────────────────────── */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension and other non-http requests
  if (!request.url.startsWith('http')) return;

  // Skip analytics/tracking (none in this app, but safety check)
  if (url.hostname.includes('google-analytics.com')) return;

  // Strategy: Stale-While-Revalidate for HTML (always fresh when online)
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(networkFirstWithFallback(request));
    return;
  }

  // Strategy: Cache-First for everything else (fonts, scripts, icons)
  event.respondWith(cacheFirstWithNetworkFallback(request));
});

/* ── CACHE STRATEGIES ────────────────────────────────────── */

// Network-First: try network, fall back to cache, then offline page
async function networkFirstWithFallback(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) return cachedResponse;
    // Last resort: serve the main app
    const fallback = await caches.match(OFFLINE_URL);
    return fallback || new Response(
      '<h1>SpendWise</h1><p>You are offline. Please reconnect.</p>',
      { headers: { 'Content-Type': 'text/html' } }
    );
  }
}

// Cache-First: serve from cache immediately, update in background
async function cacheFirstWithNetworkFallback(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    // Update cache in background (stale-while-revalidate)
    updateCacheInBackground(request);
    return cachedResponse;
  }
  // Not in cache, try network
  try {
    const networkResponse = await fetch(request, {
      mode: request.mode === 'no-cors' ? 'no-cors' : 'cors',
      credentials: 'omit',
    });
    if (networkResponse && (networkResponse.ok || networkResponse.type === 'opaque')) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    // Nothing we can do for this asset
    return new Response('', { status: 408, statusText: 'Offline' });
  }
}

// Silently update cached resource in background
function updateCacheInBackground(request) {
  fetch(request, { credentials: 'omit' })
    .then(response => {
      if (response && response.ok) {
        return caches.open(CACHE_NAME)
          .then(cache => cache.put(request, response));
      }
    })
    .catch(() => { /* offline, skip */ });
}

/* ── MESSAGE HANDLER ─────────────────────────────────────── */
// Allow the app to send messages to the SW (e.g. force update)
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});
