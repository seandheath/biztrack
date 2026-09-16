/**
 * BizTrack service worker (injectManifest strategy).
 *
 * Workbox handles precaching and SPA navigation fallback.
 * Custom fetch handler manages the Web Share Target (Android only).
 *
 * Web Share Target flow:
 *   1. Android system POST /share with multipart/form-data receipt file
 *   2. SW caches the file blob in 'biztrack-share' under key '/pending-receipt'
 *   3. SW redirects to / (GET)
 *   4. Main page reads the cached file on mount and pre-attaches to receipt picker
 */

import { cleanupOutdatedCaches, precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkOnly } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { clientsClaim } from 'workbox-core';

// Take immediate control of all open clients when a new SW activates.
// Without this, existing tabs keep using the old SW until they're reloaded.
clientsClaim();

// The Vite PWA plugin (registerType: 'autoUpdate') sends a SKIP_WAITING
// message when a new SW finishes installing. Without this handler the new
// SW stays in 'waiting' state indefinitely — users never see updates.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// Remove precache entries from previous SW installs
cleanupOutdatedCaches();
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.delete('api-responses'));
});

// Precache all app-shell assets (list injected by Vite PWA plugin at build time)
// eslint-disable-next-line no-undef
precacheAndRoute(self.__WB_MANIFEST);

// ---------------------------------------------------------------------------
// Web Share Target — intercept POST /share from Android share sheet
// This must be registered before Workbox's NavigationRoute to claim
// event.respondWith() for POST requests to /share.
// ---------------------------------------------------------------------------

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname !== '/share' || event.request.method !== 'POST') return;

  event.respondWith(
    (async () => {
      try {
        const formData = await event.request.formData();
        // 'receipt' matches the params.files[].name in the manifest share_target
        const file = formData.get('receipt');

        if (file instanceof File && file.size > 0) {
          // Store in a dedicated cache — main page reads and clears on next mount
          const cache = await caches.open('biztrack-share');
          await cache.put(
            '/pending-receipt',
            new Response(file, {
              headers: {
                'Content-Type': file.type || 'application/octet-stream',
                'X-Filename': file.name,
              },
            })
          );
        }
      } catch (err) {
        // Non-fatal — receipt just won't be pre-attached if this fails
        console.error('[sw] share target handler error:', err);
      }

      // Always redirect to main screen — GET request handled by precache
      return Response.redirect('/?shared=1', 303);
    })()
  );
});

// ---------------------------------------------------------------------------
// Google requests are never cached. Account data uses the app's explicit cache.
// Register before the script rule so Google's sign-in script is network-only too.
registerRoute(
  ({ url }) => ['www.googleapis.com', 'sheets.googleapis.com', 'accounts.google.com', 'oauth2.googleapis.com'].includes(url.hostname),
  new NetworkOnly()
);

// Static assets — cache-first, 30-day expiration
// Cache JS/CSS/images/fonts that are already fingerprinted by Vite.
// ---------------------------------------------------------------------------

registerRoute(
  ({ request }) =>
    request.destination === 'image' ||
    request.destination === 'font'  ||
    request.destination === 'style' ||
    request.destination === 'script',
  new CacheFirst({
    cacheName: 'static-assets',
    plugins: [
      new ExpirationPlugin({ maxAgeSeconds: 30 * 24 * 60 * 60 }),
    ],
  })
);

// ---------------------------------------------------------------------------
// SPA navigation fallback — serve the precached app shell for all navigations
// ---------------------------------------------------------------------------

registerRoute(new NavigationRoute(createHandlerBoundToURL('/')));
