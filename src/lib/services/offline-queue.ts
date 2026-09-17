import { isDemo, storageKey } from '../version.js';
/**
 * Offline write queue — localStorage-backed.
 *
 * When a Sheets write fails because the app is offline, the write is
 * stored here. When connectivity returns, drainQueue() replays them.
 *
 * This is the entire "sync engine". ~80 lines.
 */

import {
  pushTransactions,
  updateByUUID,
  deleteByUUID,
  type TransactionRow,
} from './sheets.js';
import { AuthError, getEmail, getSessionVersion, isTokenValid } from '../auth.js';

const QUEUE_KEY = 'biztrack_offline_queue';
let draining: Promise<{ drained: number; failed: number }> | null = null;
let queueVersion = 0;

type SheetName = 'Expenses' | 'Mileage';

export interface QueuedWrite {
  spreadsheetId: string;
  sheetName: SheetName;
  operation: 'create' | 'update' | 'delete';
  row: TransactionRow;
  timestamp: number;
}

function getQueue(): QueuedWrite[] {
  if (isDemo) return [];
  try {
    return JSON.parse(localStorage.getItem(storageKey(QUEUE_KEY)) || '[]');
  } catch {
    return [];
  }
}

function saveQueue(q: QueuedWrite[]): void {
  // Queued writes are the only copy of unsynced data: storage failure is fatal.
  localStorage.setItem(storageKey(QUEUE_KEY), JSON.stringify(q));
}

/** Add a failed write to the offline queue. */
export function enqueue(write: Omit<QueuedWrite, 'timestamp'>): void {
  if (isDemo) throw new AuthError('Demo changes cannot be queued.');
  if (!getEmail()) throw new AuthError('Sign in before saving offline changes.');
  const q = getQueue();
  q.push({ ...write, timestamp: Date.now() });
  saveQueue(q);
}

/** Number of pending offline writes. */
export function queueLength(): number {
  return getQueue().length;
}

/** Clear the offline queue (called on sign-out). */
export function clearQueue(): void {
  if (isDemo) return;
  queueVersion++;
  try {
    localStorage.removeItem(storageKey(QUEUE_KEY));
  } catch {}
}

/**
 * Replay all queued writes to Sheets.
 * Entries that still fail (e.g. network down) are kept for next attempt.
 * Entries that succeed or 404 (spreadsheet gone) are removed.
 */
export function drainQueue(): Promise<{ drained: number; failed: number }> {
  if (draining) return draining;
  draining = drain().finally(() => { draining = null; });
  return draining;
}

async function drain(): Promise<{ drained: number; failed: number }> {
  if (!isTokenValid() || !navigator.onLine) return { drained: 0, failed: queueLength() };
  const version = queueVersion;
  const session = getSessionVersion();
  const queue = getQueue();
  if (!queue.length) return { drained: 0, failed: 0 };

  let drained = 0;

  for (const entry of queue) {
    if (version !== queueVersion || session !== getSessionVersion() || !isTokenValid()) break;
    try {
      if (entry.operation === 'create') {
        await pushTransactions(entry.spreadsheetId, entry.sheetName, [entry.row]);
      } else if (entry.operation === 'update') {
        await updateByUUID(entry.spreadsheetId, entry.sheetName, entry.row);
      } else {
        await deleteByUUID(entry.spreadsheetId, entry.sheetName, entry.row.id);
      }
      drained++;
    } catch (err) {
      if (err instanceof AuthError) break;
      const msg = (err as Error).message ?? '';
      // 404 = spreadsheet gone — discard the entry, nowhere to write
      if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
        drained++;
      } else {
        continue;
      }
    }
    // Remove completed entries from the live queue, preserving newly queued writes.
    if (version !== queueVersion || session !== getSessionVersion()) break;
    const current = getQueue();
    const index = current.findIndex(item => JSON.stringify(item) === JSON.stringify(entry));
    if (index !== -1) current.splice(index, 1);
    saveQueue(current);
  }

  return { drained, failed: queueLength() };
}
