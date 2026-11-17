/* Nuvvo service worker: keeps the app shell available offline. Network first, so updates always win. */
var CACHE = 'nuvvo-v33';
var SHELL = ['./', 'index.html', 'style.css', 'app.js', 'api.js', 'en.js', 'lang-id.js', 'lang-tr.js', 'lang-fr.js', 'lang-es.js', 'lang-de.js', 'i18n.js', 'calc.js', 'config.js', 'pwa.js', 'logo.png', 'icon-192.png', 'manifest.webmanifest', 'offline.html'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  // Same-origin files only. Everything cross-origin (Supabase, fonts, the supabase-js CDN script, Turnstile) goes straight
  // to the network: a service worker's own fetches are limited by connect-src in the CSP, which would block the CDN script.
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) { return hit || (req.mode === 'navigate' ? (caches.match('index.html').then(function (h) { return h || caches.match('offline.html'); })) : Response.error()); });
    })
  );
});

// Web Push: the Edge Function sends {title, body, url}
self.addEventListener('push', function (e) {
  var d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(String(d.title || 'Nuvvo').slice(0, 80), { body: String(d.body || '').slice(0, 200), icon: 'icon-192.png', badge: 'icon-192.png', data: { url: d.url || './' } }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(function (cs) {
    for (var i = 0; i < cs.length; i++) if ('focus' in cs[i]) return cs[i].focus();
    return self.clients.openWindow(e.notification.data.url || './');
  }));
});
