// AuditReady AI — service worker
//
// Scope: app shell only. This is a SPA where every non-API route is
// rewritten to /index.html (see vercel.json), so "the shell" is just
// that one document plus the icons/manifest it references.
//
// Deliberately NOT cached: /api/* (session, score, billing — always
// live data) and any cross-origin request (Stripe.js, Google Fonts,
// canvas-confetti CDN) — those are left to the network/browser cache
// untouched so we never risk serving a stale payment library.
//
// Bump CACHE_VERSION on any shell change to invalidate old caches.
const CACHE_VERSION = 'auditready-shell-v1';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/site.webmanifest',
  '/favicon.svg',
  '/favicon-32.png',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin GETs. Everything else (API calls, POSTs,
  // cross-origin CDNs) passes straight through untouched.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Navigations (SPA routes): try the network first so users always get
  // the latest app; fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Static shell assets: cache-first, refresh in the background.
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req)
        .then(res => {
          if (res.ok) caches.open(CACHE_VERSION).then(cache => cache.put(req, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
