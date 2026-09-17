// Real upgrade/Drive modules against an in-memory Google API. No live writes.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
let files, sheets, values, fault, counter, originalSheets;
const clone = structuredClone;
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
globalThis.upgradeSession = 0;
globalThis.localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem(key, value) { fail(key === 'biztrack_offline_queue_v2' ? 'queue-storage' : 'storage'); values.set(key, String(value)); },
  removeItem: key => values.delete(key),
};
const fail = stage => { if (fault === stage) { fault = ''; throw new Error(`Injected ${stage}`); } };
const oldHeader = ['Date','From','To','Purpose/Description','Miles','Saved By','ID','Driver'];
const expenseHeader = ['Date','Vendor/Payee','Description','Amount','Category','Payment Method','Receipt','Notes','Submitted By','ID'];
function addFile(name, parent, data, mimeType = 'application/json', id = `file-${++counter}`) {
  files.set(id, { id, name, parents: [parent], mimeType, data: clone(data) }); return id;
}
function seed() {
  counter = 0; fault = ''; values = new Map(); files = new Map(); sheets = new Map();
  globalThis.upgradeSession = 0;
  addFile('profile.json', 'root', { businesses: [{ name: 'Studio', folderId: 'biz' }, { name: 'Garden', folderId: 'garden' }],
    mileage_favorites: { biz: [{ name: 'Supplier', from: 'Studio', to: 'Store', purpose: 'Supplies', miles: 7.4, driver: 'Alex', roundTrip: true }] }, default_drivers: { biz: 'Alex' } }, undefined, 'profile');
  for (const [folder, name] of [['biz', 'Studio'], ['garden', 'Garden']]) {
    addFile('config.json', folder, { id: folder, name, categories: ['Supplies'], mileage_favorites: [] });
    for (const year of [2025, 2026]) {
      const parent = `${folder}-${year}`, sid = `${parent}-sheet`;
      addFile(String(year), folder, null, 'application/vnd.google-apps.folder', parent);
      addFile(`${year}_${name}_expenses`, parent, null, 'application/vnd.google-apps.spreadsheet', sid);
      sheets.set(sid, ['Expenses', 'Mileage', 'Extra'].map((title, i) => ({ properties: { sheetId: i, title, gridProperties: { columnCount: 26 } },
        values: title === 'Expenses' ? [[...expenseHeader], [`${year}-01-01`, '=literal', 'Supplies', 12.5, 'Supplies', 'Cash', 'receipt.pdf', '', 'owner', `expense-${year}`]]
          : title === 'Mileage' ? [[...oldHeader], [`${year}-01-01`, 'Studio', 'Store', 'Supplies', 14.8, 'owner', `trip-${year}`, 'Alex']]
          : [['Custom notes'], ['Preserved']] })));
    }
  }
  originalSheets = clone(sheets);
  values.set('biztrack_offline_queue', JSON.stringify([
    { spreadsheetId: 'biz-2026-sheet', sheetName: 'Mileage', operation: 'create', row: { id: 'pending', date: '2026-02-01', from: 'Home', to: 'Office', purpose: 'Meeting', miles: '12', driver: 'Alex' }, timestamp: 1 },
    { spreadsheetId: 'biz-2025-sheet', sheetName: 'Mileage', operation: 'replace', sourceSpreadsheetId: 'biz-2026-sheet', originalId: 'trip-2026', rows: [{ id: 'trip-2026', date: '2025-12-31', from: 'A', to: 'B', miles: '14.8', driver: 'Alex' }], timestamp: 2 },
  ]));
}
function match(query, file) {
  const parent = query.match(/'([^']+)' in parents/)?.[1];
  const name = query.match(/(?:^| and )name='([^']+)'/)?.[1];
  const mime = query.match(/mimeType='([^']+)'/)?.[1];
  return (!parent || file.parents.includes(parent)) && (!name || file.name === name) && (!mime || file.mimeType === mime)
    && [...query.matchAll(/properties has \{ key='([^']+)' and value='([^']+)' \}/g)].every(([,key,value]) => file.properties?.[key] === value);
}
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input), path = decodeURIComponent(url.pathname), method = options.method ?? 'GET';
  fail('permission');
  if (url.hostname === 'sheets.googleapis.com') {
    const id = path.split('/')[3].replace(':batchUpdate', ''), tabs = sheets.get(id);
    assert.ok(tabs, id);
    if (path.endsWith(':batchUpdate')) {
      assert.ok(!originalSheets.has(id), 'never write an original spreadsheet');
      fail('transform-before');
      const requests = JSON.parse(options.body).requests;
      const update = requests.find(r => r.updateCells).updateCells;
      const tab = tabs.find(t => t.properties.sheetId === update.range.sheetId);
      tab.values = update.rows.map(row => row.values.map(cell => Object.values(cell.userEnteredValue)[0]));
      tab.properties.gridProperties.columnCount = 6;
      fail('transform-after');
      return Response.json({});
    }
    if (path.endsWith('/values:batchGet')) {
      let result = clone(tabs.map(tab => ({ values: tab.values })));
      if (!originalSheets.has(id) && tabs[1].values[0].length === 6) {
        fail('verify-network');
        if (fault === 'verify-mismatch') { fault = ''; result[1].values[1][1] = 'WRONG'; }
        if (fault === 'source-change') { fault = ''; sheets.get(files.get(id).properties.biztrackSource)[1].values[1][3] = 'Changed externally'; }
        if (fault === 'account-change') { fault = ''; globalThis.upgradeSession++; }
      }
      return Response.json({ valueRanges: result });
    }
    return Response.json({ sheets: tabs.map(tab => ({ properties: tab.properties })) });
  }
  if (path.startsWith('/upload/')) {
    let data, name, parent, id;
    if (method === 'PATCH') {
      id = path.split('/').at(-1); data = JSON.parse(options.body); name = files.get(id).name;
    } else {
      const meta = JSON.parse(await options.body.get('metadata').text());
      data = JSON.parse(await options.body.get('file').text()); name = meta.name; parent = meta.parents[0];
    }
    if (name === 'profile-v2.json') fail('profile-before');
    if (name === 'upgrade-v1-v2.json') fail('journal-before');
    if (id) files.get(id).data = data; else id = addFile(name, parent, data);
    if (name === 'profile-v2.json') fail('profile-after');
    if (name === 'upgrade-v1-v2.json') fail('journal-after');
    return Response.json({ id, name });
  }
  if (path.endsWith('/copy')) {
    fail('copy-before');
    const source = path.split('/').at(-2), body = JSON.parse(options.body);
    const id = addFile(body.name, body.parents[0], null, 'application/vnd.google-apps.spreadsheet');
    files.get(id).properties = body.properties;
    sheets.set(id, clone(sheets.get(source)));
    fail('copy-after');
    return Response.json({ id, name: body.name });
  }
  if (path.endsWith('/files')) return Response.json({ files: [...files.values()].filter(f => match(url.searchParams.get('q'), f)).map(({id,name}) => ({id,name})) });
  const id = path.split('/').at(-1), file = files.get(id);
  assert.ok(file, id);
  return Response.json(url.searchParams.get('alt') === 'media' ? file.data : file);
};
const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, ws: false }, appType: 'custom',
  plugins: [{ name: 'mock-auth', transform(code, id) { if (id.endsWith('/src/lib/auth.ts')) return `
    export class AuthError extends Error {}
    export const apiFetch = (...args) => fetch(...args);
    export const getEmail = () => 'owner';
    export const getSessionVersion = () => globalThis.upgradeSession;
  `; } }],
});
try {
  const upgrade = await server.ssrLoadModule('/src/lib/upgrade.ts');
  for (const failure of ['none', 'storage', 'copy-before', 'copy-after', 'journal-before', 'journal-after', 'transform-before', 'transform-after', 'verify-network', 'verify-mismatch', 'profile-before', 'profile-after', 'queue-storage']) {
    seed();
    const before = clone(files), raw = values.get('biztrack_offline_queue');
    let plan = await upgrade.inspectUpgrade('root');
    assert.ok(plan); assert.deepEqual(files, before, 'inspection must not mutate Drive');
    fault = failure;
    if (failure !== 'none') {
      await assert.rejects(upgrade.runUpgrade(plan));
      assert.equal(values.get('biztrack_offline_queue'), raw, `${failure}: preserve old queue`);
      for (const [id, original] of originalSheets) assert.deepEqual(sheets.get(id), original);
      fault = '';
      plan = await upgrade.inspectUpgrade('root');
    }
    await upgrade.runUpgrade(plan);
    assert.equal(values.has('biztrack_offline_queue'), false);
    assert.equal(await upgrade.inspectUpgrade('root'), null);
    for (const [id, original] of originalSheets) assert.deepEqual(sheets.get(id), original);
    const copies = [...files.values()].filter(f => f.properties?.biztrackUpgrade);
    assert.equal(copies.length, 4, `${failure}: reuse copies after lost responses`);
    for (const copy of copies) {
      const tabs = sheets.get(copy.id);
      assert.equal(tabs[1].values[0].length, 6);
      assert.equal(tabs[1].values[1][1], 'Studio → Store — Supplies');
      assert.equal(tabs[1].values[1][2], 14.8);
      assert.deepEqual(tabs[0].values, originalSheets.get(copy.properties.biztrackSource)[0].values);
    }
    const profile = [...files.values()].find(f => f.name === 'profile-v2.json').data;
    assert.deepEqual(profile.mileage_favorites.biz[0], { name: 'Supplier', description: 'Studio → Store — Supplies', miles: 14.8, driver: 'Alex' });
    const queue = JSON.parse(values.get('biztrack_offline_queue_v2'));
    assert.equal(queue[0].row.description, 'Home → Office — Meeting');
    assert.equal(queue[0].row.miles, '12');
    assert.equal(queue[1].rows[0].miles, '14.8');
    assert.notEqual(queue[1].sourceSpreadsheetId, 'biz-2026-sheet');
    assert.equal(JSON.parse(values.get('biztrack_upgrade_1_2')).rawQueue, raw);
    // A second user's upgrade reuses shared sheets, preserving changes made in v2.
    sheets.get(copies[0].id)[1].values[1][1] = 'Edited in version 2';
    files.delete([...files.values()].find(f => f.name === 'profile-v2.json').id);
    values.clear();
    await upgrade.runUpgrade(await upgrade.inspectUpgrade('root'));
    assert.equal(sheets.get(copies[0].id)[1].values[1][1], 'Edited in version 2');
    assert.equal([...files.values()].filter(f => f.properties?.biztrackUpgrade).length, 4);
  }
  for (const failure of ['source-change', 'account-change', 'permission']) {
    seed(); const plan = await upgrade.inspectUpgrade('root'); fault = failure;
    await assert.rejects(upgrade.runUpgrade(plan));
    assert.ok(values.get('biztrack_offline_queue'));
    assert.ok(![...files.values()].some(f => f.name === 'profile-v2.json'));
  }
  seed(); files.get('profile').data.dataVersion = 99;
  await assert.rejects(upgrade.inspectUpgrade('root'), /Unsupported/);
  seed(); sheets.get('biz-2025-sheet')[1].values[0][1] = 'Unknown';
  await assert.rejects(upgrade.runUpgrade(await upgrade.inspectUpgrade('root')), /Unrecognized/);
  seed(); values.set('biztrack_offline_queue', '[{"spreadsheetId":"missing","sheetName":"Mileage","operation":"delete","row":{"id":"x"}}]');
  await assert.rejects(upgrade.runUpgrade(await upgrade.inspectUpgrade('root')), /unavailable spreadsheet/);
  assert.ok(values.get('biztrack_offline_queue'));
  assert.equal(upgrade.legacyDescription({ to: 'Store', purpose: 'Supplies' }), 'Store — Supplies');
  assert.equal(upgrade.legacyDescription({}), '');
  console.log('Upgrade copies, verification, interrupted retries, shared businesses, queue preservation, and version guards passed.');
} finally { await server.close(); }
