/* Holo's Arcade service worker (beta).
   Tiny and safe on purpose:
   - HTML is always network-first, so the hub never serves a stale page
     while online; the last fetched copy is kept only as an offline fallback.
   - Only icons, the manifest and the logo are cached (cache-first).
   - Everything else passes straight through to the network.
   Bump CACHE_VERSION whenever the cached asset list changes. */
var CACHE_VERSION = "holos-arcade-v2";
var STATIC_ASSETS = [
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
  "icons/favicon-16.png",
  "icons/favicon.ico",
  "assets/arcade-logo.webp"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.addAll(STATIC_ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_VERSION) return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

function isStaticAsset(url) {
  var path = url.pathname;
  return path.indexOf("/games-hub/icons/") !== -1 ||
    path.slice(-13) === "manifest.json" ||
    path.slice(-17) === "arcade-logo.webp";
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  var isHtml = req.mode === "navigate" ||
    (req.headers.get("accept") || "").indexOf("text/html") !== -1;

  if (isHtml) {
    /* Network-first for pages: fresh hub every time. A copy of
       each successfully fetched page is saved so the offline
       fallback below can actually hit (fixed 2026-11-23: HTML
       was never cached, so offline always failed). */
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE_VERSION).then(function (cache) {
            cache.put(req, copy);
          });
        }
        return res;
      }).catch(function () {
        return caches.match(req);
      })
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(CACHE_VERSION).then(function (cache) {
            cache.put(req, copy);
          });
          return res;
        });
      })
    );
  }
  /* All other requests: default network behaviour, untouched. */
});
