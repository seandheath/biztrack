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

const QUEUE_KEY = 'biztrack_offline_queue';

type SheetName = 'Expenses' | 'Mileage';

export interface QueuedWrite {
  spreadsheetId: string;
  sheetName: SheetName;
  operation: 'create' | 'update' | 'delete';
  row: TransactionRow;
  timestamp: number;
}

function getQueue(): QueuedWrite[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveQueue(q: QueuedWrite[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    // QuotaExceededError — non-fatal
  }
}

/** Add a failed write to the offline queue. */
export function enqueue(write: Omit<QueuedWrite, 'timestamp'>): void {
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
  try {
    localStorage.removeItem(QUEUE_KEY);
  } catch {}
}

/**
 * Replay all queued writes to Sheets.
 * Entries that still fail (e.g. network down) are kept for next attempt.
 * Entries that succeed or 404 (spreadsheet gone) are removed.
 */
export async function drainQueue(): Promise<{ drained: number; failed: number }> {
  const queue = getQueue();
  if (!queue.length) return { drained: 0, failed: 0 };

  const kept: QueuedWrite[] = [];
  let drained = 0;

  for (const entry of queue) {
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
      const msg = (err as Error).message ?? '';
      // 404 = spreadsheet gone — discard the entry, nowhere to write
      if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
        drained++;
      } else {
        kept.push(entry);
      }
    }
  }

  saveQueue(kept);
  return { drained, failed: kept.length };
}
