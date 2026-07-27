// Service worker di Seriality: app shell sempre disponibile offline,
// poster/immagini in cache aggressiva (non cambiano mai), API sempre dalla rete.

// v2: bump per scartare le shell v1 (servivano build vecchie, vedi sotto).
const SHELL = 'seriality-shell-v2';
const IMAGES = 'seriality-img-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, IMAGES].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  if (url.origin === location.origin) {
    // Navigazioni (l'HTML): prima la rete, cache solo come fallback offline.
    // Con stale-while-revalidate ogni visita serviva la build precedente e
    // un deploy diventava visibile solo alla seconda ricarica.
    if (e.request.mode === 'navigate') {
      e.respondWith(
        caches.open(SHELL).then(async (cache) => {
          try {
            const res = await fetch(e.request);
            if (res.ok) cache.put(e.request, res.clone());
            return res;
          } catch {
            return (await cache.match(e.request)) ?? Response.error();
          }
        }),
      );
      return;
    }
    // Asset buildati: il nome contiene l'hash del contenuto → cache-first è sicuro.
    if (url.pathname.includes('/assets/')) {
      e.respondWith(
        caches.open(SHELL).then(async (cache) => {
          const cached = await cache.match(e.request);
          if (cached) return cached;
          const res = await fetch(e.request);
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        }),
      );
      return;
    }
    // Altro (manifest, icone): stale-while-revalidate.
    e.respondWith(
      caches.open(SHELL).then(async (cache) => {
        const cached = await cache.match(e.request);
        const fresh = fetch(e.request)
          .then((res) => {
            if (res.ok) cache.put(e.request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || fresh;
      }),
    );
    return;
  }

  // poster e immagini: cache-first (immutabili)
  if (/image\.tmdb\.org|artworks\.thetvdb\.com|static\.tvmaze\.com|cloudfront\.net|i\.ytimg\.com/.test(url.host)) {
    e.respondWith(
      caches.open(IMAGES).then(async (cache) => {
        const cached = await cache.match(e.request);
        if (cached) return cached;
        try {
          const res = await fetch(e.request);
          if (res.ok || res.type === 'opaque') cache.put(e.request, res.clone());
          return res;
        } catch {
          return Response.error();
        }
      }),
    );
  }
  // API (tvmaze/tmdb dati): rete diretta, nessuna cache
});
