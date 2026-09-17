import assert from 'node:assert/strict';
import { createServer } from 'vite';
const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, ws: false }, appType: 'custom' });
try {
  const { rankDrivers, suggestDrivers, validMiles } = await server.ssrLoadModule('/src/lib/drivers.ts');
  const row = (id, driver, date = '2025-01-01') => ({ id, driver, date });
  const history = {
    old: [row('1', 'Alex Morgan'), row('2', ' Sam  Rivera '), row('3', 'sam rivera', '2026-01-01'), row('4', '')],
    current: [row('5', 'Alex Morgan'), row('6', 'Blair Jones')],
  };
  assert.deepEqual(rankDrivers(history, []).map(d => [d.name, d.count]), [['Alex Morgan', 2], ['sam rivera', 2], ['Blair Jones', 1]]);
  const replacement = { operation: 'replace', sheetName: 'Mileage', sourceSpreadsheetId: 'old', spreadsheetId: 'current', originalId: '1', rows: [row('1', 'Blair Jones')] };
  const pending = [replacement, replacement,
    { operation: 'update', sheetName: 'Mileage', spreadsheetId: 'old', row: row('2', 'Blair Jones') },
    { operation: 'delete', sheetName: 'Mileage', spreadsheetId: 'old', row: row('3', 'sam rivera') },
    { operation: 'create', sheetName: 'Mileage', spreadsheetId: 'other-business', row: row('7', 'Wrong business') },
  ];
  assert.deepEqual(rankDrivers(history, pending).map(d => [d.name, d.count]), [['Blair Jones', 3], ['Alex Morgan', 1]]);
  const drivers = rankDrivers(history, []);
  assert.equal(suggestDrivers(drivers, '').length, 3);
  assert.deepEqual(suggestDrivers(drivers, 'amg').map(d => d.name), ['Alex Morgan']);
  assert.deepEqual(suggestDrivers(drivers, ' SAM ').map(d => d.name), ['sam rivera']);
  assert.deepEqual(suggestDrivers(drivers, 'new driver'), []);
  assert.deepEqual(suggestDrivers([{ name: 'Alan', count: 1 }, { name: 'Sally', count: 50 }], 'al').map(d => d.name), ['Alan', 'Sally']);
  assert.equal(suggestDrivers(Array.from({ length: 12 }, (_, i) => ({ name: `Driver ${i}`, count: 1 })), '').length, 12);
  for (const value of ['1', '14.8', '.5', ' 20.0 ']) assert.equal(validMiles(value), true, value);
  for (const value of ['', ' ', '0', '-1', 'Infinity', '1abc', '0x10', '1e3', 'NaN']) assert.equal(validMiles(value), false, value);
  console.log('Driver counts, pending-write overlay, fuzzy ranking, and manual distance validation passed.');
} finally { await server.close(); }
