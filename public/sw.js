/* RaelInfo static-app service worker. Serve over HTTPS or localhost. */
'use strict';
const CACHE_NAME = 'raelinfo-node-shell-v6';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/privacy.html', '/terms.html', '/icons/raelinfo.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/style.css', '/app.js', '/charts.js', '/crypto.js', '/fx.js', '/news.js', '/filings.js', '/portfolio.js', '/login.html', '/404.html'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response && response.ok && (event.request.mode === 'navigate' || APP_SHELL.includes(url.pathname))) {
      const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => caches.match(event.request).then(cached => cached || caches.match('/index.html'))));
});
