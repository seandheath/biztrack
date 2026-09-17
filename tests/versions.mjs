// Run with npm test. Real account/queue modules in three isolated Vite module graphs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createServer } from 'vite';

const values = new Map();
globalThis.localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: key => values.delete(key),
};
globalThis.window = { location: { origin: 'https://biztrack.test' } };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
const cacheNames = new Set();
globalThis.caches = { delete: async name => cacheNames.delete(name) };
globalThis.fetch = async () => Response.json({ user: { emailAddress: 'owner@example.com' } });
const servers = [];
const apps = [];
try {
  for (const base of ['/beta', '/v/1.2.3', '/v/1.2.4']) {
    const server = await createServer({ configFile: false, cacheDir: 'node_modules/.vite-version-test',
      define: { __APP_BASE__: JSON.stringify(base) }, server: { middlewareMode: true, ws: false }, appType: 'custom' });
    servers.push(server);
    const version = await server.ssrLoadModule('/src/lib/version.ts');
    const key = version.storageKey;
    assert.equal(key('bt_at'), base === '/beta' ? 'bt_at' : `biztrack:${base}:bt_at`);
    const auth = await server.ssrLoadModule('/src/lib/auth.ts');
    const queue = await server.ssrLoadModule('/src/lib/services/offline-queue.ts');
    const storage = await server.ssrLoadModule('/src/lib/storage.ts');
    const util = await server.ssrLoadModule('/src/lib/util.ts');
    assert.equal(auth.getEmail(), null, 'new release must not adopt another build\'s account');
    assert.equal(queue.queueLength(), 0);
    storage.set('bt_cache_v2', { owner: base });
    assert.deepEqual(JSON.parse(values.get(key('bt_cache_v2'))), { owner: base });
    values.set(key('bt_email_hint'), 'owner@example.com');
    // Import a fresh auth module graph with a restored token, just as reopening the app does.
    values.set(key('bt_at'), 'token');
    values.set(key('bt_exp'), new Date(Date.now() + 3600_000).toISOString());
    const url = new URL(util.transactionUrl('/expense', 'biz & id', 2026, 'txn/id', '/history?year=2026'));
    assert.equal(url.pathname, `${base}/expense`);
    assert.equal(url.searchParams.get('txn'), 'txn/id');
    assert.equal(util.returnRoute(`${base}/history/?year=2026`), '/history?year=2026');
    assert.equal(util.returnRoute('/review'), '/review');
    for (const invalid of ['https://evil.test', '//evil.test', '/\\evil.test', '/v/other/history', '/beta/history',
      '/history/../../beta/', '/history/%2e%2e/', '/history\n//evil.test', '/expense']) {
      if (invalid === '/beta/history' && base === '/beta') continue;
      assert.equal(util.returnRoute(invalid), '', invalid);
    }
    cacheNames.add(version.shareCache);
    apps.push({ server, version, key, queue, storage });
  }
  // Reopen beta with legacy state: restore the account and retain the one original queue.
  values.set('biztrack_offline_queue_v2', JSON.stringify([{ spreadsheetId: 'sheet', sheetName: 'Expenses',
    operation: 'create', row: { id: 'legacy' }, timestamp: 1 }]));
  for (const { version, key, storage } of apps) {
    const server = await createServer({ configFile: false, cacheDir: 'node_modules/.vite-version-test',
      define: { __APP_BASE__: JSON.stringify(version.appBase) }, server: { middlewareMode: true, ws: false }, appType: 'custom' });
    servers.push(server);
    const auth = await server.ssrLoadModule('/src/lib/auth.ts');
    const queue = await server.ssrLoadModule('/src/lib/services/offline-queue.ts');
    await auth.restoreSession();
    assert.equal(auth.isTokenValid(), true);
    if (version.appBase === '/beta') {
      assert.equal(queue.queueLength(), 1);
      await assert.rejects(auth.signOut(), /pending changes/);
    } else {
      queue.enqueue({ spreadsheetId: 's', sheetName: 'Mileage', operation: 'create', row: { id: version.appBase } });
      await assert.rejects(auth.signOut(), /pending changes/);
      await auth.signOut(true);
      assert.equal(storage.get('bt_cache_v2'), null);
      assert.equal(values.has(key('bt_at')), false);
      assert.equal(cacheNames.has(version.shareCache), false);
      assert.equal(JSON.parse(values.get('biztrack_offline_queue_v2'))[0].row.id, 'legacy');
      assert.equal(values.get('bt_at'), 'token');
      assert.equal(cacheNames.has('biztrack-share'), true);
    }
  }
} finally { await Promise.all(servers.map(server => server.close())); }

// Exercise actual service worker handlers, including migration, without a browser.
for (const legacy of [true, false]) {
  const handlers = new Map();
  const saved = new Map();
  const scope = 'https://biztrack.test/v/1.2.3/';
  const context = {
    URL, Request, Response, File, console,
    self: { location: { origin: 'https://biztrack.test' }, registration: { scope },
      __WB_MANIFEST: [{ url: scope }], skipWaiting() {}, clients: { claim: async () => {} },
      addEventListener: (type, fn) => handlers.set(type, fn) },
    caches: { match: async () => new Response('legacy module'), open: async name => ({
      put: async (key, response) => saved.set(`${name}:${key}`, response),
    }) },
    fetch: () => { throw new Error('unexpected network request'); },
    isDemo: false, shareCache: 'release-share', receiptKey: '/pending-receipt', storageKey: key => `release:${key}`,
    cleanupOutdatedCaches() {}, precacheAndRoute() {}, registerRoute() {}, clientsClaim() {},
    createHandlerBoundToURL() {}, CacheFirst: class {}, NetworkOnly: class {}, ExpirationPlugin: class {},
  };
  const source = (await readFile(new URL(legacy ? '../site/service-worker.js' : '../src/service-worker.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '');
  vm.runInNewContext(source, context);
  const dispatch = request => {
    let result;
    handlers.get('fetch')({ request, respondWith: response => { result = response; } });
    return result;
  };
  assert.equal(dispatch(new Request('https://biztrack.test/v/other/')), undefined);
  if (legacy) assert.equal(await (await dispatch(new Request('https://biztrack.test/_app/old.js'))).text(), 'legacy module');
  const form = new FormData();
  form.append('receipt', new File(['receipt'], 'receipt.pdf', { type: 'application/pdf' }));
  const response = await dispatch(new Request(legacy ? 'https://biztrack.test/share' : `${scope}share/`, { method: 'POST', body: form }));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), legacy ? 'https://biztrack.test/beta/share/' : `${scope}share/`);
  const stored = saved.get(`${legacy ? 'biztrack-share' : 'release-share'}:/pending-receipt`);
  assert.equal(await stored.text(), 'receipt');
  assert.equal(stored.headers.get('x-filename'), 'receipt.pdf');
  context.caches.open = async () => { throw new Error('storage full'); };
  const failed = new FormData();
  failed.append('receipt', new File(['retry'], 'retry.pdf'));
  const failure = await dispatch(new Request(legacy ? 'https://biztrack.test/share' : `${scope}share/`, { method: 'POST', body: failed }));
  assert.equal(failure.status, 503);
  if (!legacy) {
    context.isDemo = true;
    const demoResponse = await dispatch(new Request(`${scope}share/`, { method: 'POST', body: 'receipt' }));
    assert.equal(demoResponse.status, 405, 'demo must reject receipt sharing without opening a cache');
  }
}
console.log('Version paths, account isolation, legacy queue, and receipt handoff checks passed.');
