/* Offline support: keeps the app working without a connection after the first visit.
   Change CACHE when you upload a new version so phones pick up the update. */
const CACHE = "iplaystats-v0.5.1";
const CORE = ["./", "index.html", "config.js", "dict.js", "i18n.js", "privacy.html", "about.html", "manifest.webmanifest", "fonts.css",
  "fonts/bricolage-grotesque-latin-600-normal.woff2", "fonts/bricolage-grotesque-latin-800-normal.woff2", "fonts/ibm-plex-sans-greek-400-normal.woff2", "fonts/ibm-plex-sans-latin-400-normal.woff2", "fonts/ibm-plex-sans-greek-500-normal.woff2", "fonts/ibm-plex-sans-latin-500-normal.woff2", "fonts/ibm-plex-sans-greek-600-normal.woff2", "fonts/ibm-plex-sans-latin-600-normal.woff2", "fonts/ibm-plex-mono-latin-500-normal.woff2", "fonts/vazirmatn-arabic-400-normal.woff2", "fonts/vazirmatn-latin-400-normal.woff2", "fonts/vazirmatn-arabic-600-normal.woff2", "fonts/vazirmatn-latin-600-normal.woff2", "fonts/vazirmatn-arabic-800-normal.woff2", "fonts/vazirmatn-latin-800-normal.woff2",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  /* Network first for pages (fresh content when online), cache first for everything else. */
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return r; })
      .catch(() => caches.match(req).then(r => r || caches.match("index.html"))));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if (r.ok || r.type === "opaque") { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return r;
  })));
});
