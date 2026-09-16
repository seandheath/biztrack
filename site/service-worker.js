// Migration for existing root installs only. New installs register their own scoped workers.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Keep lazy-loaded modules available to old tabs without reloading an open form.
  if (event.request.method === 'GET' && url.pathname.startsWith('/_app/')) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
  }
  if (event.request.method === 'POST' && ['/share', '/share/'].includes(url.pathname)) {
    event.respondWith((async () => {
      try {
        const form = await event.request.formData();
        const file = form.get('receipt');
        if (file instanceof File && file.size > 0) {
          const cache = await caches.open('biztrack-share');
          await cache.put('/pending-receipt', new Response(file, {
            headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': file.name },
          }));
        }
        return Response.redirect(`${url.origin}/beta/share/`, 303);
      } catch {
        return new Response('Could not save the shared receipt. Please retry.', { status: 503 });
      }
    })());
  }
});
