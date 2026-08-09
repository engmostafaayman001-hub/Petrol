// Minimal service worker stub to avoid 404 during development
self.addEventListener('install', (event) => {
  // activate immediately
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // pass-through
});
