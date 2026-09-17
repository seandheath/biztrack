// Exercise the real service boundaries with storage and network access forbidden.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const forbidden = () => { throw new Error('Demo accessed persistent storage or the network'); };
globalThis.localStorage = { getItem: forbidden, setItem: forbidden, removeItem: forbidden };
globalThis.fetch = forbidden;
Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
const server = await createServer({ configFile: false, cacheDir: 'node_modules/.vite-demo-test',
  define: { __APP_BASE__: '"/demo"' }, server: { middlewareMode: true, ws: false }, appType: 'custom' });
try {
  const demo = await server.ssrLoadModule('/src/lib/demo.ts');
  const sheets = await server.ssrLoadModule('/src/lib/services/sheets.ts');
  const business = await server.ssrLoadModule('/src/lib/business.ts');
  const auth = await server.ssrLoadModule('/src/lib/auth.ts');
  const queue = await server.ssrLoadModule('/src/lib/services/offline-queue.ts');
  const storage = await server.ssrLoadModule('/src/lib/storage.ts');
  const sync = await server.ssrLoadModule('/src/lib/sync.ts');
  const now = new Date('2026-01-01T12:00:00Z');
  const seed = demo.seedDemo(now);
  assert.equal(seed.businesses.length, 2);
  const [first, second] = seed.businesses;
  for (const company of seed.businesses) {
    const current = await sheets.pullTransactions(company.sheetIds[2026], 'Expenses');
    const past = await sheets.pullTransactions(company.sheetIds[2025], 'Expenses');
    assert.ok(past.every(row => !current.some(entry => entry.vendor === row.vendor || entry.amount === row.amount)),
      'Past-year expenses must visibly differ from current entries');
    const [currentTrip] = await sheets.pullTransactions(company.sheetIds[2026], 'Mileage');
    const [pastTrip] = await sheets.pullTransactions(company.sheetIds[2025], 'Mileage');
    assert.notEqual(pastTrip.description, currentTrip.description);
    assert.notEqual(pastTrip.miles, currentTrip.miles);
  }
  const id = first.sheetIds[2026];
  storage.set('bt_cache_v2', seed);
  assert.equal(sync.loadCache(), true);
  assert.equal((await business.loadConfig(first)).name, first.name);
  await auth.ensureAuthorized(); // Local saves also work without a connection.
  const initial = await sheets.pullTransactions(id, 'Expenses');
  assert.equal(initial.length, 3);
  initial[0].vendor = 'must not mutate the datastore';
  assert.equal((await sheets.pullTransactions(id, 'Expenses'))[0].vendor, 'Paper & Pine');

  const split = [{id:'split-a',date:'2026-01-01',vendor:'Demo Vendor',amount:'12.00',category:'Supplies'},
    {id:'split-b',date:'2026-01-01',vendor:'Demo Vendor',amount:'8.00',category:'Meals'}];
  await sheets.pushTransactions(id, 'Expenses', split);
  split[0].amount = '999';
  const rowNum = await sheets.findRowByTxnId(id, 'split-a');
  assert.equal((await sheets.readRow(id, 'Expenses', rowNum)).amount, '12.00');
  await sheets.updateByUUID(id, 'Expenses', {...split[0], amount:'15.00'});
  assert.equal((await sheets.readRow(id, 'Expenses', rowNum)).amount, '15.00');
  await sheets.batchSetCategory(id, ['split-a','split-b'], 'Office Expenses');
  assert.equal((await sheets.readRow(id, 'Expenses', rowNum)).category, 'Office Expenses');
  await sheets.deleteByUUID(id, 'Expenses', 'split-b');
  assert.equal(await sheets.findRowByTxnId(id, 'split-b'), null);
  assert.equal((await sheets.pullTransactions(second.sheetIds[2026], 'Expenses')).length, 3);
  assert.equal((await sheets.pullTransactions(first.sheetIds[2025], 'Expenses')).length, 3);
  const trip = {id:'trip', date:'2024-02-03',description:'Studio → Client',miles:'14.8',driver:'Alex'};
  const expanded = await business.ensureYearFolder(first, 2024);
  await sheets.pushTransactions(expanded.sheetIds[2024], 'Mileage', [trip]);
  const tripNum = await sheets.findRowByTxnId(expanded.sheetIds[2024], 'trip', 'Mileage');
  assert.equal((await sheets.readRow(expanded.sheetIds[2024], 'Mileage', tripNum)).miles, '14.8');
  await sheets.updateByUUID(expanded.sheetIds[2024], 'Mileage', {...trip,miles:'20'});
  await sheets.deleteByUUID(expanded.sheetIds[2024], 'Mileage', 'trip');
  assert.deepEqual(await sheets.pullTransactions(expanded.sheetIds[2024], 'Mileage'), []);

  await assert.rejects(sheets.pullTransactions('unknown', 'Expenses'), /not found/);
  await assert.rejects(sheets.updateByUUID(id, 'Expenses', {id:'unknown',date:'2026-01-01'}), /not found/);
  await sheets.deleteByUUID(id, 'Expenses', 'unknown'); // Already deleted is a successful retry.
  await assert.rejects(sheets.readRow(id, 'Expenses', 1), /not found/);
  await assert.rejects(business.ensureYearFolder({...first,id:'unknown'}, 2026), /not found/);
  await assert.rejects(sheets.pushTransactions(id, 'Expenses', [{id:'split-a',date:'2026-01-01'}]), /Duplicate/);
  for (const operation of [auth.loadGisScript, auth.requestToken, auth.restoreSession, auth.signOut, auth.revokeToken,
    () => auth.apiFetch('https://www.googleapis.com/drive/v3/about')]) {
    await assert.rejects(operation(), /unavailable in the demo/);
  }
  assert.equal(queue.queueLength(), 0);
  assert.throws(() => queue.enqueue({spreadsheetId:id,sheetName:'Expenses',operation:'create',row:split[0]}), /cannot be queued/);
  assert.deepEqual(await queue.drainQueue(), {drained:0,failed:0});
  queue.clearQueue();
  storage.set('preference', {choice:1});
  const preference = storage.get('preference');preference.choice=2;
  assert.deepEqual(storage.get('preference'), {choice:1});
  storage.remove('preference');assert.equal(storage.get('preference'), null);
  const fresh = demo.seedDemo(now);
  assert.deepEqual(fresh, seed);
  assert.equal((await sheets.pullTransactions(id, 'Expenses')).length, 3);
  assert.throws(() => demo.table(expanded.sheetIds[2024], 'Mileage'), /not found/);
  console.log('Demo CRUD, split rows, years, reset, and storage/network isolation passed.');
} finally { await server.close(); }
