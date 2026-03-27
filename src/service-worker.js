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

// Remove precache entries from previous SW installs
cleanupOutdatedCaches();

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
// SPA navigation fallback — serve the precached app shell for all navigations
// ---------------------------------------------------------------------------

registerRoute(new NavigationRoute(createHandlerBoundToURL('/')));
