/* Maine Hunt Map service worker: offline app shell + map tiles. */
const VERSION = 'hm-1.0.0';
const SHELL = 'hm-shell-' + VERSION;
const TILES = 'hm-tiles-v1';        // tiles saved on purpose (Offline maps)
const AUTO = 'hm-tiles-auto-v1';    // tiles cached while browsing (capped)
const AUTO_MAX = 4000;
const SHELL_FILES = ['./', './index.html', './app.js', './geo.js', './data.js', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'];
const TILE_HOSTS = ['server.arcgisonline.com', 'basemap.nationalmap.gov', 'tile.opentopomap.org'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => Promise.all(SHELL_FILES.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('hm-shell-') && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

let autoCount = 0;
async function trimAuto() {
  const c = await caches.open(AUTO); const keys = await c.keys();
  if (keys.length > AUTO_MAX) await Promise.all(keys.slice(0, keys.length - AUTO_MAX).map(k => c.delete(k)));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Map tiles: saved → auto cache → network (then auto-cache)
  if (TILE_HOSTS.some(h => url.hostname.endsWith(h)) && /\/tile\/|\.png$/.test(url.pathname)) {
    e.respondWith((async () => {
      const hit = (await caches.match(req.url, { cacheName: TILES, ignoreVary: true })) || (await caches.match(req.url, { cacheName: AUTO, ignoreVary: true }));
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(AUTO).then(c => c.put(req.url, copy)).then(() => { if (++autoCount % 200 === 0) trimAuto(); }).catch(() => { });
        }
        return res;
      } catch (err) {
        return new Response('', { status: 504 });
      }
    })());
    return;
  }

  // Leaflet from CDN: cache first
  if (url.hostname === 'cdnjs.cloudflare.com') {
    e.respondWith(caches.match(req.url).then(hit => hit || fetch(req).then(res => { const c = res.clone(); caches.open(SHELL).then(s => s.put(req.url, c)); return res; })));
    return;
  }

  // App files: network first (so updates arrive), fall back to cache offline
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const c = res.clone(); caches.open(SHELL).then(s => s.put(req, c)); }
      return res;
    }).catch(async () => (await caches.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())));
  }
  // Everything else (ArcGIS data, weather) is handled by the page.
});
