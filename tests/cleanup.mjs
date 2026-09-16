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
  for (const kind of ['expense', 'mileage']) {
    const source = await readFile(new URL(`../src/routes/${kind}/+page.svelte`, import.meta.url), 'utf8');
    const script = parse(source).instance.content.body;
    const handler = kind === 'expense' ? 'submitExpense' : 'submitMileage';
    const validation = kind === 'expense' ? 'validateExpense' : 'validateMileage';
    const functions = [validation, handler].map(name => {
      const node = script.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
      return source.slice(node.start, node.end);
    }).join('\n');
    for (const mode of kind === 'expense' ? ['create', 'split', 'edit', 'offline', 'split-offline', 'failure'] : ['create', 'edit', 'offline', 'failure']) {
      const writes = [], queued = [], messages = [];
      const offline = mode.includes('offline');
      const write = async (...args) => {
        if (offline || mode === 'failure') throw new Error('write failed');
        writes.push(args);
      };
      const noop = () => {};
      const context = vm.createContext({
        crypto, console: { error: noop }, setTimeout: noop, navigator: { onLine: !offline },
        AuthError: class extends Error {}, ensureAuthorized: async () => {},
        $selectedBusiness: { sheetIds: { 2026: 'sheet' }, receiptFolderIds: {} }, $userEmail: 'owner',
        expDate: '2026-02-01', expVendor: ' Vendor ', expDesc: ' Description ', expAmount: '12.50', expCategory: 'Supplies', expPayment: 'Cash', expNotes: ' Notes ', expReceipt: null,
        shareMode: mode === 'edit', splitMode: mode.startsWith('split'), shareTxnId: 'existing', shareSheetId: 'sheet', shareSubmittedBy: 'original-owner', existingReceipt: 'receipt.pdf', returnTo: '/history', applyToAll: false,
        splits: [{ description: ' A ', amount: '10.00', category: 'Supplies' }, { description: ' B ', amount: '2.50', category: 'Meals' }, { description: '', amount: '', category: '' }],
        milDate: '2026-02-01', milFrom: ' From ', milTo: ' To ', milPurpose: ' Purpose ', milMiles: '5', milRoundTrip: true, milDriver: ' Driver ',
        editMode: mode === 'edit', editTxnId: 'existing', editSheetId: 'sheet', confirmDuplicate: false,
        getCachedTransactions: () => [], pushTransactions: write, updateByUUID: (sid, tab, row) => write(sid, tab, [row]),
        enqueue: entry => queued.push(entry), showToast: (...args) => messages.push(args), friendlyError: error => error.message,
        invalidatePull: noop, removeCachedTransaction: noop, updateCachedTransaction: noop, cacheTransactions: noop, goto: noop,
        syncStatus: { set: noop }, pullTransactions: async () => [],
        vendorCache: { update: noop }, paymentMethodCache: { update: noop }, destinationCache: { update: noop }, originCache: { update: noop }, driverCache: { update: noop },
      });
      if (kind === 'mileage') {
        const derived = script.flatMap(n => n.declarations ?? []).find(n => n.id.name === 'milEffectiveMiles').init.arguments[0];
        context.milEffectiveMiles = vm.runInContext(`(${source.slice(derived.start, derived.end)})()`, context);
      }
      await vm.runInContext(`${functions}\n${handler}();`, context);
      if (mode === 'failure') {
        assert.equal(queued.length, 0, 'an online failure must not enqueue an ambiguous write');
        assert.ok(messages.some(([message, type]) => message === 'write failed' && type === 'error'));
        assert.equal(kind === 'expense' ? context.expVendor : context.milFrom, kind === 'expense' ? ' Vendor ' : ' From ');
        continue;
      }
      const rows = offline ? queued.map(entry => entry.row) : writes[0]?.[2];
      assert.equal(rows?.length, mode.startsWith('split') ? 2 : 1);
      assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
      if (kind === 'expense') {
        assert.deepEqual(Array.from(rows, row => row.amount), mode.startsWith('split') ? ['10.00', '2.50'] : ['12.5']);
        assert.equal(rows[0].vendor, 'Vendor');
        assert.equal(rows[0].submittedBy, mode === 'edit' ? 'original-owner' : 'owner');
        assert.equal(rows[0].receipt, mode === 'edit' ? 'receipt.pdf' : '');
        if (mode !== 'edit') assert.equal(context.expVendor, '');
      } else {
        assert.equal(rows[0].miles, '10');
        assert.equal(rows[0].driver, 'Driver');
        assert.equal(context.milFrom, ' From ', 'mileage keeps its fields after saving');
      }
      if (mode === 'edit') assert.equal(rows[0].id, 'existing');
    }
  }
  console.log('Cleanup regression checks passed.');
} finally {
  await server.close();
}
