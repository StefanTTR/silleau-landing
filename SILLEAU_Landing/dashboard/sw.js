/**
 * SILLEAU Dashboard — Service Worker (offline shell, online data).
 *
 * Strategii:
 *  - Shell (HTML, CSS, JS, manifest, icons): cache-first, fallback network.
 *  - API calls (funcții edge, Supabase REST/Auth): network-only — niciodată cache.
 *  - Fonts Google: stale-while-revalidate.
 *
 * Bump `CACHE_VERSION` la fiecare deploy pentru a invalida vechiul shell.
 */

const CACHE_VERSION = 'silleau-dash-v1';
const SHELL_ASSETS = [
  '/dashboard/',
  '/dashboard/index.html',
  '/dashboard/styles.css',
  '/dashboard/app.js',
  '/dashboard/config.js',
  '/dashboard/manifest.webmanifest',
  '/dashboard/icon.svg',
  '/dashboard/icon-192.png',
  '/dashboard/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll(SHELL_ASSETS).catch(() => {
        // Dacă un asset lipsește (ex. icon-uri opționale), continuăm install-ul.
      })
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache API calls — datele trebuie să fie mereu proaspete.
  if (
    url.hostname.endsWith('.supabase.co') ||
    url.pathname.includes('/functions/v1/') ||
    url.pathname.includes('/rest/v1/') ||
    url.pathname.includes('/auth/v1/') ||
    url.pathname.includes('/realtime/')
  ) {
    return; // fallback la comportamentul default (network).
  }

  // Fonts: stale-while-revalidate.
  if (url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(req);
        const fetched = fetch(req).then((res) => {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        }).catch(() => cached);
        return cached || fetched;
      })
    );
    return;
  }

  // Shell assets (same-origin, calea /dashboard/): cache-first.
  if (url.origin === self.location.origin && url.pathname.startsWith('/dashboard/')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        }).catch(() => caches.match('/dashboard/index.html'));
      })
    );
  }
});
