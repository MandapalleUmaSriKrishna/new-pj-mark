/* Krishna Digital Certificate - service worker (hand written).
 *
 * Why not next-pwa / workbox: they lag behind Next.js 16's App Router output and
 * pull a build step this repo does not need. This worker does three jobs and
 * nothing more:
 *
 *   1. App shell      - navigations are network-first with a cached fallback, so
 *                       the installed PWA opens offline and shows the real
 *                       /offline page instead of a browser error.
 *   2. Static assets  - /_next/static/* is content-hashed, so cache-first is
 *                       safe and makes repeat loads instant.
 *   3. Never the API  - /api/* is always network-only. Certificate data is
 *                       private and must never end up in a shared cache.
 *
 * Updates: bump CACHE_VERSION to force every client onto fresh caches.
 */

const CACHE_VERSION = 'kdc-v1';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const NAV_CACHE = `${CACHE_VERSION}-nav`;

const SHELL_URLS = [
  '/',
  '/offline',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

const NAVIGATION_LIMIT = 24;
const STATIC_LIMIT = 200;
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Best effort: a missing precache entry must not fail the install.
      await Promise.allSettled(
        SHELL_URLS.map((url) => cache.add(new Request(url, { cache: 'reload' }))),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => !key.startsWith(CACHE_VERSION)).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      })(),
    );
  }
});

/** True for same-origin GET requests that are safe to cache. */
function cacheable(request) {
  return request.method === 'GET' && new URL(request.url).origin === self.location.origin;
}

function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
}

async function trimCache(name, limit) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  // FIFO: the oldest entries are at the front of the key list.
  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)));
}

async function networkFirst(request, cacheName, fallbackUrls) {
  const cache = await caches.open(cacheName);
  try {
    const networkPromise = fetch(request);
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS),
    );
    const response = await Promise.race([networkPromise, timeout]);
    if (response && response.ok && cacheable(request)) {
      await cache.put(request, response.clone());
      await trimCache(cacheName, NAVIGATION_LIMIT);
    }
    if (response) return response;
    throw new Error('no response');
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    for (const fallback of fallbackUrls) {
      const shell = (await cache.match(fallback)) ?? (await caches.match(fallback));
      if (shell) return shell;
    }
    return new Response(
      '<h1>Offline</h1><p>Krishna Digital Certificate could not reach the network.</p>',
      {
        status: 503,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      },
    );
  }
}

async function cacheFirst(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok && cacheable(request)) {
      await cache.put(request, response.clone());
      await trimCache(cacheName, limit);
    }
    return response;
  } catch {
    return new Response('', { status: 504, statusText: 'Gateway Timeout' });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Private data and authenticated calls are never cached by the worker.
  if (isApiRequest(url)) return;

  // The worker script itself must always be revalidated by the browser.
  if (url.pathname === '/sw.js') return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, NAV_CACHE, ['/offline', '/']));
    return;
  }

  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.webmanifest'
  ) {
    event.respondWith(cacheFirst(request, STATIC_CACHE, STATIC_LIMIT));
    return;
  }

  // Everything else (page HTML fetched as a resource, fonts, images): revalidate.
  event.respondWith(networkFirst(request, STATIC_CACHE, []));
});
