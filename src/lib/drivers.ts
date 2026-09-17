import type { TransactionRow } from './services/sheets.js';
import type { QueuedWrite } from './services/offline-queue.js';

export type Driver = { name: string; count: number };
const clean = (name: string) => name.trim().replace(/\s+/g, ' ');
const key = (name: string) => clean(name).toLocaleLowerCase();

/** Overlay durable pending edits by ID; retries and cross-year moves count once. */
export function rankDrivers(history: Record<string, TransactionRow[]>, pending: QueuedWrite[]): Driver[] {
  const tables = new Map(Object.entries(history).map(([id, rows]) => [id, new Map(rows.map(row => [row.id, row]))]));
  for (const entry of pending) {
    if (entry.sheetName !== 'Mileage') continue;
    const table = tables.get(entry.spreadsheetId);
    if (!table) continue;
    if (entry.operation === 'replace') {
      tables.get(entry.sourceSpreadsheetId)?.delete(entry.originalId);
      for (const row of entry.rows) table.set(row.id, row);
    } else if (entry.operation === 'delete') table.delete(entry.row.id);
    else table.set(entry.row.id, entry.row);
  }
  const drivers = new Map<string, Driver & { date: string }>();
  for (const rows of tables.values()) for (const row of rows.values()) {
    const name = clean(row.driver ?? '');
    if (!name) continue;
    const k = key(name), existing = drivers.get(k);
    if (existing) {
      existing.count++;
      if (row.date > existing.date) { existing.name = name; existing.date = row.date; }
    } else drivers.set(k, { name, count: 1, date: row.date });
  }
  return [...drivers.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function matchRank(name: string, query: string): number {
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  let index = 0;
  for (const char of name) if (char === query[index]) index++;
  return index === query.length ? 3 : Infinity;
}

export function suggestDrivers(drivers: Driver[], query: string): Driver[] {
  const q = key(query);
  if (!q) return drivers;
  return drivers.map(driver => ({ driver, rank: matchRank(key(driver.name), q) }))
    .filter(item => Number.isFinite(item.rank))
    .sort((a, b) => a.rank - b.rank || b.driver.count - a.driver.count || a.driver.name.localeCompare(b.driver.name))
    .map(item => item.driver);
}

export function validMiles(value: string): boolean {
  return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()) && Number.isFinite(Number(value)) && Number(value) > 0;
}
