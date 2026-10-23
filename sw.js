const CACHE = "satsky-pro-v2";
const ASSETS = ["./","./index.html","./styles.css","./app.js","./data.js","./satellite.min.js","./manifest.json",
  "./icon-180.png","./icon-192.png","./icon-512.png","./icon-167.png","./icon-152.png","./icon-120.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (u.hostname.includes("celestrak.org")) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(c => c || fetch(e.request).catch(() => {
    if (e.request.mode === "navigate") return caches.match("./index.html");
  })));
});
