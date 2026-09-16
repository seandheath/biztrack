import { cleanupOutdatedCaches, precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkOnly } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { clientsClaim } from 'workbox-core';
import { shareCache, receiptKey, storageKey } from './lib/version.js';

const scope = new URL(self.registration.scope);
clientsClaim();
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
cleanupOutdatedCaches();

const manifest = self.__WB_MANIFEST;
precacheAndRoute(manifest);
const pages = new Set(manifest.map(entry => new URL(typeof entry === 'string' ? entry : entry.url, scope).pathname)
  .filter(path => path.endsWith('/')));

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== scope.origin || url.pathname !== `${scope.pathname}share/` || event.request.method !== 'POST') return;
  event.respondWith((async () => {
    try {
      const form = await event.request.formData();
      const file = form.get('receipt');
      if (file instanceof File && file.size > 0) {
        const cache = await caches.open(shareCache);
        await cache.put(receiptKey, new Response(file, {
          headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': file.name },
        }));
      }
      return Response.redirect(`${scope.href}share/`, 303);
    } catch {
      return new Response('Could not save the shared receipt. Please retry.', { status: 503 });
    }
  })());
});

registerRoute(
  ({ url }) => ['www.googleapis.com', 'sheets.googleapis.com', 'accounts.google.com', 'oauth2.googleapis.com'].includes(url.hostname),
  new NetworkOnly(),
);
registerRoute(
  ({ request, url }) => url.origin === scope.origin && url.pathname.startsWith(scope.pathname)
    && ['image', 'font', 'style', 'script'].includes(request.destination),
  new CacheFirst({ cacheName: storageKey('static-assets'), plugins: [new ExpirationPlugin({ maxAgeSeconds: 30 * 24 * 60 * 60 })] }),
);
registerRoute(
  ({ request, url }) => request.mode === 'navigate' && url.origin === scope.origin && pages.has(url.pathname),
  createHandlerBoundToURL(scope.pathname),
);
