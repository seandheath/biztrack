// Exercise copy/confirm/delete against the real Sheets service, with failures between requests.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
let respond;
globalThis.fetch = (url, options = {}) => respond(new URL(url), options);
const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
const server = await createServer({ configFile: false, cacheDir: 'node_modules/.vite-replacement-test',
  server: { middlewareMode: true, ws: false }, appType: 'custom', optimizeDeps: { noDiscovery: true },
  plugins: [{ name: 'mock-auth', transform(code, id) {
    if (id.endsWith('/src/lib/auth.ts')) return `export class AuthError extends Error {}
      export const apiFetch = (...args) => fetch(...args);
      export const getEmail = () => 'owner'; export const getSessionVersion = () => 0;
      export const isTokenValid = () => true;`;
  } }],
});
try {
  const sheets = await server.ssrLoadModule('/src/lib/services/sheets.ts');
  const queue = await server.ssrLoadModule('/src/lib/services/offline-queue.ts');
  const reopenedQueue = await server.ssrLoadModule('/src/lib/services/offline-queue.ts?reopened');
  for (const queued of [false, true]) {
  for (const kind of ['expense-move', 'mileage-move', 'split', 'split-move']) {
    const tab = kind === 'mileage-move' ? 'Mileage' : 'Expenses';
    const idColumn = tab === 'Expenses' ? 9 : 6;
    const numericColumn = tab === 'Expenses' ? 3 : 4;
    const dest = kind === 'split' ? 'source' : 'destination';
    const original = tab === 'Expenses'
      ? ['2025-01-01','Vendor','Original',12.5,'Supplies','Cash','','','owner','original']
      : ['2025-01-01','Office','Client','Meeting',12.5,'owner','original','Alex'];
    const rows = tab === 'Expenses'
      ? [{id:kind.startsWith('split')?'original-split-1':'original',date:'2026-01-01',vendor:'=literal text',description:'New',amount:'12.50',category:'Supplies',paymentMethod:'Cash',submittedBy:'owner'}]
      : [{id:'original',date:'2026-01-01',from:'Office',to:'Customer',purpose:'Visit',miles:'12.50',savedBy:'owner',driver:'Alex'}];
    if (kind.startsWith('split')) rows.push({...rows[0],id:'original-split-2',amount:'5.00',category:'Meals'});
    for (const failure of ['none','append-before','append-after','confirmation-read','confirmation-missing','confirmation-mismatch','confirmation-duplicate','delete-before','delete-after']) {
      sheets.clearTrashedCache();
      storage.clear();
      const tables = {source:[structuredClone(original)],destination:[]};
      let fault = failure, appended = false, appends = 0, deletions = 0;
      const events = [];
      const fail = stage => { if (fault === stage) {fault = '';throw new Error('Connection lost');} };
      respond = async (url, options) => {
        if (url.hostname === 'www.googleapis.com') return Response.json({trashed:false});
        const path = decodeURIComponent(url.pathname);
        const sid = path.split('/')[3].replace(':batchUpdate','');
        const table = tables[sid];
        if (path.endsWith(':append')) {
          fail('append-before');
          assert.equal(url.searchParams.get('valueInputOption'),'RAW');
          const values = JSON.parse(options.body).values;
          assert.ok(values.every(row=>typeof row[numericColumn] === 'number'));
          table.push(...values);appends++;appended=true;events.push('append');
          fail('append-after');return Response.json({});
        }
        if (path.endsWith(':batchUpdate')) {
          assert.ok(events.includes('confirm'), 'never delete before reading the replacement back');
          fail('delete-before');
          const range = JSON.parse(options.body).requests[0].deleteDimension.range;
          table.splice(range.startIndex-1,1);deletions++;events.push('delete');
          fail('delete-after');return Response.json({});
        }
        if (path.includes('/values/')) {
          if (path.endsWith('!J:J') || path.endsWith('!G:G')) return Response.json({values:[['ID'],...table.map(row=>[row[idColumn]])]});
          assert.equal(url.searchParams.get('valueRenderOption'),'UNFORMATTED_VALUE');
          let data = structuredClone(table);
          if (sid === dest && appended) {
            fail('confirmation-read');
            if (fault === 'confirmation-missing') {data=[];fault='';}
            if (fault === 'confirmation-mismatch') {data.find(row=>row[idColumn] === rows[0].id)[1]='Changed';fault='';}
            if (fault === 'confirmation-duplicate') {data.push(data.find(row=>row[idColumn] === rows[0].id));fault='';}
            events.push('confirm');
          }
          return Response.json({values:[[],...data]});
        }
        return Response.json({sheets:[{properties:{sheetId:0,title:tab}}]});
      };
      const operation = () => sheets.replaceTransaction('source',dest,tab,'original',rows);
      if (queued) {
        navigator.onLine = false;
        queue.enqueue({operation:'replace',sourceSpreadsheetId:'source',spreadsheetId:dest,sheetName:tab,originalId:'original',rows});
        assert.deepEqual(await queue.drainQueue(),{drained:0,failed:1});
        assert.equal(appends,0);
        assert.equal(deletions,0);
        assert.deepEqual(JSON.parse(storage.get('biztrack_offline_queue'))[0].rows,rows);
        navigator.onLine = true;
      }
      if (failure !== 'none') {
        if (queued) assert.deepEqual(await reopenedQueue.drainQueue(),{drained:0,failed:1});
        else await assert.rejects(operation(), sheets.ReplacementError);
        if (failure !== 'delete-after') assert.ok(tables.source.some(row=>row[idColumn] === 'original'), `${kind}: ${failure} lost the original`);
        else assert.equal(tables[dest].length,rows.length);
      }
      if (queued) assert.deepEqual(await reopenedQueue.drainQueue(),{drained:1,failed:0});
      else await operation();
      assert.deepEqual(tables[dest].map(row=>row[idColumn]),rows.map(row=>row.id));
      if (dest !== 'source') assert.equal(tables.source.length,0);
      assert.equal(appends,1, `${kind}: ${failure} duplicated a write`);
      assert.equal(deletions,1);
      await operation(); // Even a lost delete response can be retried safely.
      assert.equal(appends,1);
      assert.equal(deletions,1);
    }
  }
  }
  storage.clear();
  sheets.clearTrashedCache();
  let writes = 0;
  respond = async (url, options) => {
    if (options.method) writes++;
    return Response.json({error:{message:'Spreadsheet not found'}},{status:404});
  };
  queue.enqueue({operation:'replace',sourceSpreadsheetId:'missing-source',spreadsheetId:'missing-destination',
    sheetName:'Expenses',originalId:'original',rows:[{id:'original',date:'2026-01-01',amount:'5'}]});
  queue.enqueue({operation:'create',spreadsheetId:'another',sheetName:'Expenses',row:{id:'later',date:'2026-01-01'}});
  assert.deepEqual(await reopenedQueue.drainQueue(),{drained:0,failed:2});
  assert.equal(writes,0,'later writes must not overtake a failed replacement');
  console.log('Replacement ordering, verification, ambiguous failures, retries, and durable offline replay passed.');
} finally {await server.close();}
