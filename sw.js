// מטמון לקבצי האפליקציה כדי שתיפתח גם בלי אינטרנט. הנתונים עצמם נשמרים ב-localStorage.
var VERSION = 'fb-v1';
var ASSETS = [
  './',
  'index.html',
  'styles.css',
  'core.js',
  'app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'vendor/xlsx.full.min.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// מהמטמון מיד, ובמקביל מעדכנים מהרשת לפעם הבאה. בקשות ל-Google (ה-API) לא נוגעים בהן.
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(VERSION).then(function (cache) {
    return cache.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(function () { return hit || cache.match('index.html'); });
      return hit || net;
    });
  }));
});
