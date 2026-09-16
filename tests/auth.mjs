// Run with npm test. Uses the existing Vite loader; no test framework required.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'svelte/compiler';
import { createServer } from 'vite';

const values = new Map([
  ['bt_at', 'restored'], ['bt_exp', new Date(Date.now() + 3600_000).toISOString()],
  ['bt_email_hint', 'owner@example.com'],
]);
globalThis.localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: key => values.delete(key),
};
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
const popups = [];
const requests = [];
let revocations = 0;
let revokeSuccess = true;
globalThis.window = { google: { accounts: { oauth2: {
  initTokenClient(config) {
    popups.push(config);
    return { requestAccessToken(options) { requests.push(options); } };
  },
  revoke(token, callback) { revocations++; callback({ successful: revokeSuccess }); },
} } } };
let googleEmail = 'owner@example.com';
let apiCalls = [];
let respond = () => new Response('{}');
let aboutResponse = null;
globalThis.fetch = async (url, options = {}) => {
  if (url.includes('/about?')) {
    assert.equal(options.cache, 'no-store');
    return aboutResponse ? aboutResponse() : Response.json({ user: { emailAddress: googleEmail } });
  }
  apiCalls.push({ url, options });
  return respond(url, options);
};
const server = await createServer({ configFile: false, cacheDir: 'node_modules/.vite-auth-test', server: { middlewareMode: true }, appType: 'custom' });
try {
  const auth = await server.ssrLoadModule('/src/lib/auth.ts');
  const queue = await server.ssrLoadModule('/src/lib/services/offline-queue.ts');
  const stores = await server.ssrLoadModule('/src/lib/store.ts');
  const { get } = await import('svelte/store');
  // Execute the layout's actual startup function as JavaScript. TypeScript checks
  // don't cover plain-JS Svelte scripts (a stray generic became runtime operators).
  const layout = await readFile(new URL('../src/routes/+layout.svelte', import.meta.url), 'utf8');
  const init = parse(layout).instance.content.body.find(node =>
    node.type === 'FunctionDeclaration' && node.id.name === 'initFromDrive');
  const startupDeps = {
    ensureBizTrackFolder: async () => 'root',
    loadProfile: async () => ({ businesses: [
      { name: 'First', folderId: 'first' }, { name: 'Saved', folderId: 'saved' },
    ] }),
    getCachedBusinesses: () => [],
    findFile: async () => null,
    discoverYearFolders: async business => business,
    ensureYearFolder: async business => business,
    getSessionVersion: () => 0,
    businesses: stores.businesses,
    selectedBusiness: stores.selectedBusiness,
    mileageFavorites: stores.mileageFavorites,
    defaultDrivers: stores.defaultDrivers,
    AuthError: auth.AuthError,
    storage: { get: () => 'Saved' },
  };
  const initFromDrive = new Function(...Object.keys(startupDeps),
    `return (${layout.slice(init.start, init.end)});`)(...Object.values(startupDeps));
  assert.equal(await initFromDrive(0), false);
  assert.equal(get(stores.selectedBusiness)?.folderId, 'saved');
  startupDeps.storage.get = () => null;
  await initFromDrive(0);
  assert.equal(get(stores.selectedBusiness)?.folderId, 'first');
  stores.resetAccountStores();
  let lastUpdate;
  let needsReconnect = false;
  auth.onTokenUpdate(update => { lastUpdate = update; });
  auth.onAuthRequired(pending => { needsReconnect = pending; });
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const until = async condition => {
    for (let i = 0; i < 50 && !condition(); i++) await tick();
    assert.ok(condition(), 'expected async state transition');
  };
  const grant = async (accessToken = 'renewed', config = popups.at(-1)) => {
    await config.callback({ access_token: accessToken, expires_in: 3600, scope: auth.DRIVE_SCOPE });
  };
  const url = 'https://www.googleapis.com/drive/v3/files';

  assert.equal(auth.isTokenValid(), false, 'restored identity must be verified first');
  await auth.restoreSession();
  assert.equal(auth.isTokenValid(), true);
  await auth.ensureAuthorized();
  assert.equal(popups.length, 0, 'valid tokens require no popup');
  assert.equal(lastUpdate.email, googleEmail);

  // Script load failures can be retried without requiring a page reload.
  const google = window.google;
  delete window.google;
  let scriptFails = true;
  globalThis.document = {
    createElement: () => ({ remove() {} }),
    head: { appendChild(script) { setImmediate(() => {
      if (scriptFails) script.onerror();
      else { window.google = google; script.onload(); }
    }); } },
  };
  await assert.rejects(auth.loadGisScript(), /Could not load Google sign-in/);
  scriptFails = false;
  await auth.loadGisScript();

  // A receipt upload succeeds; only the rejected ledger request is retried.
  let uploads = 0;
  let writes = 0;
  respond = target => target.includes('upload')
    ? (uploads++, Response.json({ id: 'receipt' }))
    : (++writes === 1 ? new Response('', { status: 401 }) : new Response('{}'));
  const save = (async () => {
    await auth.apiFetch('https://www.googleapis.com/upload/drive/v3/files', { method: 'POST', body: 'receipt' });
    return auth.apiFetch('https://sheets.googleapis.com/v4/spreadsheets/s/values/a:append', { method: 'POST', body: 'row' });
  })();
  await until(() => needsReconnect);
  const sibling = auth.ensureAuthorized();
  assert.equal(sibling, auth.ensureAuthorized(), 'all requests share one reconnect');
  const popup = auth.requestToken();
  assert.equal(popup, auth.requestToken(), 'double clicks share one popup');
  assert.deepEqual(requests.at(-1), { prompt: '', login_hint: googleEmail });
  await grant();
  await Promise.all([save, sibling, popup]);
  assert.equal(uploads, 1);
  assert.equal(writes, 2);
  assert.equal(needsReconnect, false);

  // Cancellation releases every waiting call; an old popup cannot revive it.
  auth.expireToken();
  const cancelled = auth.apiFetch(url);
  const cancelledCheck = assert.rejects(cancelled, /cancelled/);
  await until(() => needsReconnect);
  const cancelledPopup = auth.requestToken();
  const popupCheck = assert.rejects(cancelledPopup, /cancelled/);
  const oldConfig = popups.at(-1);
  auth.cancelReconnection();
  await Promise.all([cancelledCheck, popupCheck]);
  await grant('late', oldConfig);
  assert.equal(auth.isTokenValid(), false);

  // A login hint is not proof of identity. Never resume using another account.
  const wrong = auth.requestToken();
  const wrongCheck = assert.rejects(wrong, /Reconnect as owner@example.com/);
  googleEmail = 'other@example.com';
  await grant('wrong');
  await wrongCheck;
  assert.equal(auth.getEmail(), 'owner@example.com');
  assert.equal(auth.isTokenValid(), false);
  googleEmail = 'owner@example.com';
  const denied = auth.requestToken();
  const deniedCheck = assert.rejects(denied, /Drive access is required/);
  await popups.at(-1).callback({ access_token: 'narrow', expires_in: 3600, scope: 'openid' });
  await deniedCheck;

  // Popup blocking is recoverable; no unresolved operation is left behind.
  const blocked = auth.requestToken();
  const blockedCheck = assert.rejects(blocked, /Allow popups/);
  popups.at(-1).error_callback({ type: 'popup_failed_to_open' });
  await blockedCheck;
  const retry = auth.requestToken();
  await grant('retry');
  await retry;

  // A renewed token rejected again stops after one replay.
  apiCalls = [];
  respond = () => new Response('', { status: 401 });
  const twice = auth.apiFetch(url);
  const twiceCheck = assert.rejects(twice, /rejected the renewed access/);
  await until(() => needsReconnect);
  const renewal = auth.requestToken();
  await grant('rejected-renewal');
  await renewal;
  await twiceCheck;
  assert.equal(apiCalls.length, 2);

  const reconnect = auth.requestToken();
  await grant('network-test');
  await reconnect;
  apiCalls = [];
  respond = () => { throw new TypeError('network failure'); };
  await assert.rejects(auth.apiFetch(url, { method: 'POST', body: 'row' }), /network failure/);
  assert.equal(apiCalls.length, 1, 'never retry an ambiguous write failure');
  await assert.rejects(auth.apiFetch('https://example.com/steal'), /Unsupported/);

  // Refuse to discard unsynced changes without an explicit decision.
  queue.enqueue({ spreadsheetId: 's', sheetName: 'Mileage', operation: 'create', row: { id: 'pending' } });
  await assert.rejects(auth.signOut(), /pending changes/);
  assert.equal(queue.queueLength(), 1);
  assert.equal(auth.isTokenValid(), true);
  queue.clearQueue();

  // Sign-out during identity verification rejects both the popup and blocked save.
  auth.expireToken();
  const waiting = auth.ensureAuthorized();
  const waitingCheck = assert.rejects(waiting, /Signed out/);
  const signingIn = auth.requestToken();
  const signingInCheck = assert.rejects(signingIn, /Signed out/);
  let finishAbout;
  aboutResponse = () => new Promise(resolve => { finishAbout = resolve; });
  const lateIdentity = grant('after-signout');
  await until(() => !!finishAbout);
  values.set('bt_cache', '{"old":true}');
  stores.businesses.set([{ name: 'Old account' }]);
  await auth.signOut();
  finishAbout(Response.json({ user: { emailAddress: googleEmail } }));
  await Promise.all([waitingCheck, signingInCheck, lateIdentity]);
  aboutResponse = null;
  assert.equal(auth.isTokenValid(), false);
  assert.equal(auth.getEmail(), null);
  assert.equal(values.has('bt_cache'), false);
  assert.equal(values.has('bt_at'), false);
  assert.equal(values.has('bt_email_hint'), false);
  assert.equal(lastUpdate.email, null);
  assert.deepEqual(get(stores.businesses), []);
  assert.equal(revocations, 0, 'normal sign-out must not revoke');

  // New account is allowed only after clearing the prior session.
  googleEmail = 'other@example.com';
  const fresh = auth.requestToken();
  assert.deepEqual(requests.at(-1), { prompt: 'select_account' });
  await grant('other');
  await fresh;
  assert.equal(auth.getEmail(), googleEmail);

  // A reconnect and online event can both start sync. Deduplicate, and preserve
  // entries enqueued while an earlier write is in flight.
  queue.enqueue({ spreadsheetId: 's', sheetName: 'Mileage', operation: 'create', row: { id: 'first' } });
  let finishWrite;
  respond = target => target.includes(':append')
    ? new Promise(resolve => { finishWrite = resolve; }) : Response.json({ trashed: false });
  const drain = queue.drainQueue();
  assert.equal(drain, queue.drainQueue());
  await until(() => !!finishWrite);
  queue.enqueue({ spreadsheetId: 's', sheetName: 'Mileage', operation: 'create', row: { id: 'second' } });
  finishWrite(Response.json({}));
  assert.deepEqual(await drain, { drained: 1, failed: 1 });
  assert.equal(JSON.parse(values.get('biztrack_offline_queue'))[0].row.id, 'second');
  respond = () => Response.json({ trashed: false });
  assert.deepEqual(await queue.drainQueue(), { drained: 1, failed: 0 });

  // Clearing pending changes during sign-out must not let an old drain resurrect them.
  queue.enqueue({ spreadsheetId: 's', sheetName: 'Mileage', operation: 'create', row: { id: 'discarded' } });
  finishWrite = null;
  respond = target => target.includes(':append')
    ? new Promise(resolve => { finishWrite = resolve; }) : Response.json({ trashed: false });
  const staleDrain = queue.drainQueue();
  await until(() => !!finishWrite);
  await auth.signOut(true);
  finishWrite(Response.json({}));
  await staleDrain;
  assert.equal(queue.queueLength(), 0);
  assert.equal(auth.getEmail(), null);
  const finalLogin = auth.requestToken();
  await grant('disconnect-test');
  await finalLogin;
  revokeSuccess = false;
  await assert.rejects(auth.revokeToken(), /did not confirm/);
  assert.equal(auth.isTokenValid(), true, 'failed revocation must not claim disconnection');
  revokeSuccess = true;
  await auth.revokeToken();
  assert.equal(revocations, 2);
  assert.equal(auth.getEmail(), null);
  assert.equal(auth.hasPendingOperations(), false);
  console.log('Auth regression checks passed.');
} finally {
  await server.close();
}
