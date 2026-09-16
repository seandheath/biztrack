// Run with npm test. Exercise the real modules and form handlers without Google writes.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parse } from 'svelte/compiler';
import { createServer } from 'vite';

const values = new Map();
globalThis.localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: key => values.delete(key),
};
globalThis.window = { location: { origin: 'https://biztrack.test' } };
globalThis.cleanupSession = 0;
let respond;
globalThis.fetch = async (url, options = {}) => respond(new URL(url), options);
const server = await createServer({
  configFile: false, cacheDir: 'node_modules/.vite-cleanup-test',
  server: { middlewareMode: true }, appType: 'custom',
  plugins: [{ name: 'mock-auth-boundary', transform(code, id) {
    if (id.endsWith('/src/lib/auth.ts')) return `
      export class AuthError extends Error {}
      export const apiFetch = (...args) => fetch(...args);
      export const getSessionVersion = () => globalThis.cleanupSession;
    `;
  } }],
});
try {
  const drive = await server.ssrLoadModule('/src/lib/drive.ts');
  const business = await server.ssrLoadModule('/src/lib/business.ts');
  const sync = await server.ssrLoadModule('/src/lib/sync.ts');
  const { transactionUrl } = await server.ssrLoadModule('/src/lib/util.ts');
  const { get } = await import('svelte/store');

  // Every listing follows all pages and retains its query and Shared Drive flags.
  for (const [list, query] of [
    [() => drive.listFolders('parent'), "'parent' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"],
    [() => drive.listFileNames('parent'), "'parent' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false"],
    [() => drive.listSharedFolders(), "sharedWithMe=true and mimeType='application/vnd.google-apps.folder' and trashed=false"],
  ]) {
    let calls = 0;
    respond = url => {
      calls++;
      assert.equal(url.searchParams.get('q'), query);
      assert.equal(url.searchParams.get('supportsAllDrives'), 'true');
      assert.equal(url.searchParams.get('includeItemsFromAllDrives'), 'true');
      if (calls === 1) return Response.json({ files: [{ id: '1', name: 'first' }], nextPageToken: 'next + /' });
      assert.equal(url.searchParams.get('pageToken'), 'next + /');
      return Response.json({ files: [{ id: '2', name: 'second' }] });
    };
    assert.deepEqual(await list(), query.includes("mimeType!=") ? ['first', 'second'] : [
      { id: '1', name: 'first' }, { id: '2', name: 'second' },
    ]);
    assert.equal(calls, 2);
  }
  respond = () => Response.json({ error: { message: 'Denied' } }, { status: 403 });
  await assert.rejects(drive.listFolders('parent'), /Drive listFolders: Denied \(403\)/);

  // Folder recovery and creation keep the same names, cache fallbacks and deduplication.
  const base = { id: 'biz', name: 'A/cme', folderId: 'business', configFileId: 'config', yearFolders: {}, sheetIds: {}, receiptFolderIds: {} };
  for (const scenario of ['existing', 'new', 'missing', 'cached']) {
    const writes = [];
    const found = scenario === 'new' ? {} : { '2027': 'year' };
    if (scenario === 'existing') Object.assign(found, { '2027_Acme_expenses': 'sheet', '2027_Acme_Receipts': 'receipts' });
    respond = (url, options) => {
      const body = options.body ? JSON.parse(options.body) : null;
      if (!options.method) {
        const name = url.searchParams.get('q').match(/^name='([^']+)'/)[1];
        return Response.json({ files: found[name] ? [{ id: found[name] }] : [] });
      }
      writes.push({ url, body });
      if (url.hostname === 'sheets.googleapis.com' && !url.pathname.endsWith(':batchUpdate')) {
        return Response.json({ spreadsheetId: 'sheet', sheets: [{ properties: { sheetId: 0 } }, { properties: { sheetId: 1 } }] });
      }
      return Response.json({ id: body?.name === '2027' ? 'year' : 'receipts' });
    };
    const input = scenario === 'cached' ? { ...base, sheetIds: { 2027: 'cached-sheet' }, receiptFolderIds: { 2027: 'cached-receipts' } } : base;
    const [first, second] = await Promise.all([business.ensureYearFolder(input, 2027), business.ensureYearFolder(input, 2027)]);
    assert.equal(first, second);
    assert.equal(first.yearFolders[2027], 'year');
    assert.equal(first.sheetIds[2027], scenario === 'cached' ? 'cached-sheet' : 'sheet');
    assert.equal(first.receiptFolderIds[2027], scenario === 'cached' ? 'cached-receipts' : 'receipts');
    assert.equal(writes.length, scenario === 'new' ? 5 : scenario === 'missing' ? 4 : 0);
    if (writes.length) {
      assert.equal(writes.find(w => w.body?.properties)?.body.properties.title, '2027_Acme_expenses');
      assert.ok(writes.some(w => w.url.searchParams.get('addParents') === 'year'));
      assert.ok(writes.some(w => w.body?.name === '2027_Acme_Receipts'));
    }
    respond = () => { throw new Error('Cached year must not make network calls'); };
    assert.equal(await business.ensureYearFolder(first, 2027), first);
    assert.equal(await business.ensureYearFolder(first, 27), first);
  }

  // Pending refreshes belong to sync, so leaving A for B cannot strand A.
  let pending = [];
  let reads = 0;
  respond = url => {
    if (url.hostname === 'www.googleapis.com') return Response.json({ trashed: false });
    reads++;
    return new Promise(resolve => pending.push(resolve));
  };
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const finish = () => { const batch = pending; pending = []; batch.forEach(resolve => resolve(Response.json({ values: [] }))); };
  const a = sync.refreshYearTransactions('a');
  assert.equal(a, sync.refreshYearTransactions('a'));
  const b = sync.refreshYearTransactions('b');
  await tick();
  finish();
  await Promise.all([a, b]);
  assert.deepEqual(sync.getCachedTransactions('a', 'Expenses'), []);
  await sync.refreshYearTransactions('a');
  assert.equal(reads, 4, 'empty cached tabs still honor the cooldown');
  sync.invalidatePull('a');
  const again = sync.refreshYearTransactions('a');
  await tick(); finish(); await again;
  assert.equal(reads, 6, 'invalidation starts a new request');

  sync.invalidatePull('a');
  respond = () => { throw new Error('network failure'); };
  await assert.rejects(sync.refreshYearTransactions('a'), /network failure/);
  assert.equal(get(sync.syncStatus), 'red');
  respond = () => Response.json({ values: [] });
  await sync.refreshYearTransactions('a');
  assert.equal(get(sync.syncStatus), 'green', 'failed requests release their marker for retry');

  sync.invalidatePull('a');
  respond = () => new Promise(resolve => pending.push(resolve));
  const old = sync.refreshYearTransactions('a');
  const oldCheck = assert.rejects(old, /session changed/);
  await tick();
  const oldResponses = pending; pending = [];
  globalThis.cleanupSession++;
  sync.clearCache();
  const current = sync.refreshYearTransactions('a');
  await tick();
  oldResponses.forEach(resolve => resolve(Response.json({ values: [] })));
  await oldCheck;
  assert.equal(sync.getCachedTransactions('a', 'Expenses'), null);
  assert.equal(sync.refreshYearTransactions('a'), current, 'old completion cannot clear the new session request');
  finish(); await current;

  const expenses = [{ id: 'expense', date: '2026-01-01', amount: '2' }];
  const mileage = [{ id: 'mileage', date: '2026-02-01', miles: '4' }];
  assert.deepEqual(sync.mergeTransactions(expenses, mileage).map(r => [r.id, r._type]), [['mileage', 'mileage'], ['expense', 'expense']]);
  assert.equal(expenses[0]._type, undefined, 'merging must not mutate cached rows');
  for (const route of ['/expense', '/mileage']) {
    const url = new URL(transactionUrl(route, 'biz & id', 2026, 'txn/id', '/history?year=2026'));
    assert.equal(url.pathname, route);
    assert.deepEqual(Object.fromEntries(url.searchParams), { biz: 'biz & id', year: '2026', txn: 'txn/id', returnTo: '/history?year=2026' });
    assert.equal(new URL(transactionUrl(route, 'biz', 2026, 'txn')).searchParams.has('returnTo'), false);
  }

  // Execute the actual form handlers, as the auth test does for layout startup.
  const homeSource = await readFile(new URL('../src/routes/+page.svelte', import.meta.url), 'utf8');
  const homeEffect = parse(homeSource).instance.content.body.find(n => n.expression?.callee?.name === '$effect');
  for (const kind of ['expense', 'mileage']) {
    const source = await readFile(new URL(`../src/routes/${kind}/+page.svelte`, import.meta.url), 'utf8');
    const script = parse(source).instance.content.body;
    const handler = kind === 'expense' ? 'submitExpense' : 'submitMileage';
    const validation = kind === 'expense' ? 'validateExpense' : 'validateMileage';
    const functions = [validation, handler].map(name => {
      const node = script.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
      return source.slice(node.start, node.end);
    }).join('\n');
    const modes = ['create', 'edit', 'offline', 'edit-offline', 'failure', 'invalid', 'auth-failure', 'offline-auth-failure', 'offline-queue-failure'];
    modes.push(...(kind === 'expense' ? ['split', 'split-offline', 'split-edit', 'split-edit-offline', 'split-edit-offline-queue-failure'] : ['duplicate']));
    for (const mode of modes) for (const returnTo of mode.includes('edit') ? ['', '/history?year=2025', '/review'] : ['']) {
      const writes = [], queued = [], messages = [], navigations = [], events = [];
      const offline = mode.includes('offline');
      const editing = mode.includes('edit');
      const split = mode.startsWith('split');
      const year = new Date().getFullYear();
      const date = `${year}-02-01`;
      class AuthError extends Error {}
      const write = async (...args) => {
        await Promise.resolve();
        if (mode === 'offline-auth-failure') throw new AuthError('authorization failed');
        if (offline || mode === 'failure') throw new Error('write failed');
        writes.push(args);
        events.push('write');
      };
      const noop = () => {};
      const context = vm.createContext({
        crypto, console: { error: noop }, setTimeout: noop, navigator: { onLine: !offline },
        AuthError, ensureAuthorized: async () => { if (mode === 'auth-failure') throw new AuthError('authorization failed'); },
        $selectedBusiness: { sheetIds: { [year]: 'sheet' }, receiptFolderIds: {} }, $userEmail: 'owner',
        expDate: mode === 'invalid' ? '' : date, expVendor: ' Vendor ', expDesc: ' Description ', expAmount: '12.50', expCategory: 'Supplies', expPayment: 'Cash', expNotes: ' Notes ', expReceipt: null,
        shareMode: editing, splitMode: split, shareTxnId: 'existing', shareSheetId: 'sheet', shareSubmittedBy: 'original-owner', existingReceipt: 'receipt.pdf', returnTo, applyToAll: returnTo === '/review',
        splits: [{ description: ' A ', amount: '10.00', category: 'Supplies' }, { description: ' B ', amount: '2.50', category: 'Meals' }, { description: '', amount: '', category: '' }],
        milDate: mode === 'invalid' ? '' : date, milFrom: ' From ', milTo: ' To ', milPurpose: ' Purpose ', milMiles: '5', milRoundTrip: true, milDriver: ' Driver ',
        editMode: editing, editTxnId: 'existing', editSheetId: 'sheet', confirmDuplicate: false,
        getCachedTransactions: () => mode === 'duplicate' ? [{ date, from: 'From', to: 'To', miles: '10', driver: 'Driver' }] : [],
        pushTransactions: write, updateByUUID: (sid, tab, row) => write(sid, tab, [row]), deleteByUUID: write,
        enqueue: entry => {
          if (mode.endsWith('queue-failure')) throw new Error('storage full');
          queued.push(entry);
          events.push('queue');
        },
        showToast: (...args) => messages.push(args), friendlyError: error => error.message,
        invalidatePull: () => events.push('invalidate'), removeCachedTransaction: noop, updateCachedTransaction: noop, cacheTransactions: noop,
        goto: destination => { navigations.push(destination); events.push('navigate'); },
        resolve: destination => destination,
        syncStatus: { set: noop }, pullTransactions: async () => [{ id: 'other', vendor: ' Vendor ', category: 'Uncategorized' }],
        batchSetCategory: async (sid, ids, category) => {
          await Promise.resolve();
          assert.equal(sid, 'sheet');
          assert.deepEqual(Array.from(ids), ['other']);
          assert.equal(category, 'Supplies');
          events.push('categorize');
        },
        vendorCache: { update: noop }, paymentMethodCache: { update: noop }, destinationCache: { update: noop }, originCache: { update: noop }, driverCache: { update: noop },
      });
      if (kind === 'mileage') {
        const derived = script.flatMap(n => n.declarations ?? []).find(n => n.id.name === 'milEffectiveMiles').init.arguments[0];
        context.milEffectiveMiles = vm.runInContext(`(${source.slice(derived.start, derived.end)})()`, context);
      }
      await vm.runInContext(`${functions}\n${handler}();`, context);
      if (mode === 'duplicate') {
        assert.deepEqual(navigations, [], 'duplicate confirmation must stay on the form');
        assert.equal(writes.length, 0);
        assert.equal(context.confirmDuplicate, true);
        await vm.runInContext(`${handler}();`, context);
      }
      if (mode.endsWith('failure') || mode === 'invalid') {
        assert.deepEqual(navigations, [], `${kind} ${mode} must stay on the form`);
        assert.equal(writes.length, 0);
        assert.equal(queued.length, 0);
        if (mode !== 'invalid') {
          const error = mode.endsWith('queue-failure') ? 'storage full' : mode.endsWith('auth-failure') ? 'authorization failed' : 'write failed';
          assert.ok(messages.some(([message, type]) => message === error && type === 'error'));
        }
        assert.equal(kind === 'expense' ? context.expVendor : context.milFrom, kind === 'expense' ? ' Vendor ' : ' From ');
        continue;
      }
      assert.deepEqual(navigations, ['/'], `${kind} ${mode} from ${returnTo} must return home once`);
      assert.ok(events.indexOf('navigate') > events.lastIndexOf(offline ? 'queue' : 'write'));
      if (!offline) {
        assert.ok(events.includes('invalidate'));
        assert.ok(events.indexOf('invalidate') < events.indexOf('navigate'), 'refresh must be invalidated before returning home');
      }
      if (kind === 'expense' && editing && !split && !offline && returnTo === '/review') {
        assert.ok(events.includes('categorize'));
        assert.ok(events.indexOf('categorize') < events.indexOf('navigate'), 'bulk categorization must finish before returning home');
      }
      if (offline) assert.match(messages.at(-1)[0], /Saved offline/);
      const rows = offline ? queued.filter(entry => entry.operation !== 'delete').map(entry => entry.row) : writes.at(-1)?.[2];
      assert.equal(rows?.length, split ? 2 : 1);
      assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
      if (kind === 'expense') {
        assert.deepEqual(Array.from(rows, row => row.amount), split ? ['10.00', '2.50'] : ['12.5']);
        assert.equal(rows[0].vendor, 'Vendor');
        assert.equal(rows[0].submittedBy, editing ? 'original-owner' : 'owner');
        assert.equal(rows[0].receipt, editing ? 'receipt.pdf' : '');
      } else {
        assert.equal(rows[0].miles, '10');
        assert.equal(rows[0].driver, 'Driver');
        assert.equal(context.milFrom, ' From ', 'mileage keeps its fields after saving');
      }
      if (editing && !split) assert.equal(rows[0].id, 'existing');
      if (mode === 'create') {
        context.$effect = effect => effect();
        context.mergeTransactions = sync.mergeTransactions;
        context.refreshYearTransactions = async sid => {
          assert.equal(sid, 'sheet');
          return { expenses: kind === 'expense' ? rows : [], mileage: kind === 'mileage' ? rows : [] };
        };
        vm.runInContext(homeSource.slice(homeEffect.start, homeEffect.end), context);
        await tick();
        assert.deepEqual(Array.from(context.rows, row => [row.id, row._type]), [[rows[0].id, kind]], 'home refresh must display the saved current-year entry');
      }
    }
  }
  console.log('Cleanup regression checks passed.');
} finally {
  await server.close();
}
