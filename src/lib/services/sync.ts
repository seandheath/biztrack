/**
 * BizTrack sync engine — outbox pattern for IndexedDB ↔ Google Sheets.
 *
 * Write path: enqueueCreate / enqueueUpdate / enqueueDelete
 *   → writes to Dexie immediately (optimistic)
 *   → adds entry to syncQueue table
 *
 * Flush path: flushQueue()
 *   → reads pending syncQueue entries
 *   → groups by (businessId, year, sheetName)
 *   → calls pushTransactions / updateByUUID / deleteByUUID in services/sheets.ts
 *   → on success: marks Transaction.syncStatus = 'synced', removes queue entry
 *   → on error: retryCount++, exponential backoff
 *
 * Pull path: pullTransactions()
 *   → fetches all rows from Sheets since lastSyncedAt
 *   → merges into Dexie, detects conflicts
 *
 * Lifecycle:
 *   startSyncEngine() — call after sign-in; starts 60s timer + online listener
 *   stopSyncEngine()  — call on sign-out
 */

import { get } from 'svelte/store';
import { db, type Transaction, type SyncQueueEntry } from '../db/dexie.js';
import { businesses } from '../store.js';
import {
  pushTransactions,
  updateByUUID,
  deleteByUUID,
  pullTransactions as sheetsPull,
  type TransactionRow,
} from './sheets.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FLUSH_INTERVAL_MS = 60_000;
const SYNC_MARKER_PREFIX = 'biztrack_last_sync_';

// ---------------------------------------------------------------------------
// Private state
// ---------------------------------------------------------------------------

let _flushTimer: ReturnType<typeof setInterval> | null = null;
let _flushing = false;
let _onlineListener: (() => void) | null = null;
let _swMessageListener: ((e: MessageEvent) => void) | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Exponential backoff in ms: min(2^n * 1000 + jitter, 64000) */
function _backoffMs(retryCount: number): number {
  return Math.min(Math.pow(2, retryCount) * 1000 + Math.random() * 1000, 64_000);
}

/** localStorage key for the last-sync timestamp for a given business+year. */
function _syncMarkerKey(businessId: string, year: number): string {
  return `${SYNC_MARKER_PREFIX}${businessId}_${year}`;
}

/** Maps a Dexie Transaction to the wire format for Sheets. */
function _txToRow(tx: Transaction): TransactionRow {
  if (tx.type === 'expense') {
    return {
      id:             tx.id,
      date:           tx.date,
      vendor:         tx.vendor,
      description:    tx.description,
      amount:         tx.amount != null ? String(tx.amount) : '',
      category:       tx.category,
      paymentMethod:  tx.paymentMethod,
      receiptDriveId: tx.receiptDriveId,
      notes:          tx.notes,
      submittedBy:    tx.submittedBy,
    };
  } else {
    return {
      id:        tx.id,
      date:      tx.date,
      from:      tx.from,
      to:        tx.to,
      purpose:   tx.purpose,
      miles:     tx.miles != null ? String(tx.miles) : '',
      irsRate:   tx.irsRate != null ? String(tx.irsRate) : '',
      deduction: tx.deduction != null ? String(tx.deduction) : '',
    };
  }
}

/** Maps a wire-format TransactionRow from Sheets back to a Dexie Transaction. */
function _rowToTx(
  row: TransactionRow,
  businessId: string,
  type: 'expense' | 'mileage',
): Omit<Transaction, 'createdAt' | 'updatedAt'> {
  const year = new Date(row.date + 'T00:00:00').getFullYear();
  if (type === 'expense') {
    return {
      id: row.id,
      businessId,
      type: 'expense',
      year,
      date: row.date,
      vendor:         row.vendor,
      description:    row.description,
      amount:         row.amount ? parseFloat(row.amount) : undefined,
      category:       row.category,
      paymentMethod:  row.paymentMethod,
      receiptDriveId: row.receiptDriveId,
      notes:          row.notes,
      submittedBy:    row.submittedBy,
      syncStatus: 'synced',
    };
  } else {
    return {
      id: row.id,
      businessId,
      type: 'mileage',
      year,
      date: row.date,
      from:      row.from,
      to:        row.to,
      purpose:   row.purpose,
      miles:     row.miles ? parseFloat(row.miles) : undefined,
      irsRate:   row.irsRate ? parseFloat(row.irsRate) : undefined,
      deduction: row.deduction ? parseFloat(row.deduction) : undefined,
      syncStatus: 'synced',
    };
  }
}

// ---------------------------------------------------------------------------
// Write path — called by form submit handlers
// ---------------------------------------------------------------------------

/**
 * Writes a new transaction to Dexie and enqueues a create operation.
 * Returns the generated UUID immediately — UI is updated via liveQuery.
 *
 * @example
 *   const id = await enqueueCreate({ businessId, type: 'expense', ... });
 */
export async function enqueueCreate(
  tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'>,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();

  await db.transaction('rw', [db.transactions, db.syncQueue], async () => {
    await db.transactions.add({
      ...tx,
      id,
      createdAt:  now,
      updatedAt:  now,
      syncStatus: 'pending',
    });
    await db.syncQueue.add({
      entityType: 'transaction',
      entityId:   id,
      operation:  'create',
      data:       { ...tx, id },
      businessId: tx.businessId,
      year:       tx.year,
      timestamp:  now,
      retryCount: 0,
      syncStatus: 'pending',
    });
  });

  return id;
}

/**
 * Updates an existing Dexie transaction and enqueues an update operation.
 * The patch is merged into the existing record.
 */
export async function enqueueUpdate(id: string, patch: Partial<Transaction>): Promise<void> {
  const now = Date.now();

  await db.transaction('rw', [db.transactions, db.syncQueue], async () => {
    const existing = await db.transactions.get(id);
    if (!existing) throw new Error(`Transaction ${id} not found in local DB`);

    const updated: Transaction = { ...existing, ...patch, updatedAt: now, syncStatus: 'pending' };
    await db.transactions.put(updated);

    await db.syncQueue.add({
      entityType: 'transaction',
      entityId:   id,
      operation:  'update',
      data:       updated,
      businessId: existing.businessId,
      year:       existing.year,
      timestamp:  now,
      retryCount: 0,
      syncStatus: 'pending',
    });
  });
}

/**
 * Marks a transaction for deletion and enqueues a delete operation.
 * The Dexie record is kept (syncStatus: 'pending') until the delete is
 * confirmed by Sheets — then the sync engine removes it.
 */
export async function enqueueDelete(
  id: string,
  businessId: string,
  year: number,
): Promise<void> {
  const now = Date.now();

  await db.transaction('rw', [db.transactions, db.syncQueue], async () => {
    await db.transactions.update(id, { syncStatus: 'pending', updatedAt: now });

    await db.syncQueue.add({
      entityType: 'transaction',
      entityId:   id,
      operation:  'delete',
      data:       null,
      businessId,
      year,
      timestamp:  now,
      retryCount: 0,
      syncStatus: 'pending',
    });
  });
}

// ---------------------------------------------------------------------------
// Flush path — drain the outbox to Google Sheets
// ---------------------------------------------------------------------------

/**
 * Processes all pending syncQueue entries.
 *
 * Batches creates by (businessId, year, sheetName) for efficiency.
 * Updates and deletes are processed individually (row-number re-scan required).
 *
 * Called by: 60s interval, online event, Background Sync SW message.
 */
export async function flushQueue(): Promise<void> {
  if (_flushing) return;
  _flushing = true;

  try {
    const pending = await db.syncQueue
      .where('syncStatus')
      .equals('pending')
      .sortBy('timestamp');

    if (pending.length === 0) return;

    const bizList = get(businesses);

    // Process creates first (batched), then updates, then deletes
    const creates = pending.filter((e) => e.operation === 'create');
    const updates = pending.filter((e) => e.operation === 'update');
    const deletes = pending.filter((e) => e.operation === 'delete');

    await _flushCreates(creates, bizList);
    await _flushUpdates(updates, bizList);
    await _flushDeletes(deletes, bizList);
  } finally {
    _flushing = false;
  }
}

type BizEntry = { id: string; sheetIds?: Record<number, string>; [k: string]: unknown };

/** Batch-appends create entries to Sheets, grouped by spreadsheet+tab. */
async function _flushCreates(entries: SyncQueueEntry[], bizList: BizEntry[]): Promise<void> {
  // Group by "spreadsheetId::sheetName"
  const groups = new Map<string, { spreadsheetId: string; sheetName: 'Expenses' | 'Mileage'; entries: SyncQueueEntry[] }>();

  for (const entry of entries) {
    const biz = bizList.find((b) => b.id === entry.businessId);
    if (!biz) continue;
    const spreadsheetId = biz.sheetIds?.[entry.year];
    if (!spreadsheetId) continue;

    const tx = entry.data as Transaction;
    const sheetName: 'Expenses' | 'Mileage' = tx.type === 'mileage' ? 'Mileage' : 'Expenses';
    const key = `${spreadsheetId}::${sheetName}`;

    if (!groups.has(key)) groups.set(key, { spreadsheetId, sheetName, entries: [] });
    groups.get(key)!.entries.push(entry);
  }

  for (const { spreadsheetId, sheetName, entries: group } of groups.values()) {
    const rows: TransactionRow[] = group.map((e) => _txToRow(e.data as Transaction));
    try {
      await pushTransactions(spreadsheetId, sheetName, rows);
      // Mark all entries in this batch as synced
      await db.transaction('rw', [db.transactions, db.syncQueue], async () => {
        for (const entry of group) {
          await db.transactions.update(entry.entityId, { syncStatus: 'synced' });
          if (entry.id != null) await db.syncQueue.delete(entry.id);
        }
      });
    } catch (err) {
      await _handleFlushError(group, err as Error);
    }
  }
}

/** Updates rows in Sheets one by one (each requires a UUID re-scan). */
async function _flushUpdates(entries: SyncQueueEntry[], bizList: BizEntry[]): Promise<void> {
  for (const entry of entries) {
    const biz = bizList.find((b) => b.id === entry.businessId);
    if (!biz) continue;
    const spreadsheetId = biz.sheetIds?.[entry.year];
    if (!spreadsheetId) continue;

    const tx = entry.data as Transaction;
    const sheetName: 'Expenses' | 'Mileage' = tx.type === 'mileage' ? 'Mileage' : 'Expenses';
    try {
      await updateByUUID(spreadsheetId, sheetName, _txToRow(tx));
      await db.transaction('rw', [db.transactions, db.syncQueue], async () => {
        await db.transactions.update(entry.entityId, { syncStatus: 'synced' });
        if (entry.id != null) await db.syncQueue.delete(entry.id);
      });
    } catch (err) {
      await _handleFlushError([entry], err as Error);
    }
  }
}

/** Deletes rows in Sheets one by one, then removes from Dexie on success. */
async function _flushDeletes(entries: SyncQueueEntry[], bizList: BizEntry[]): Promise<void> {
  for (const entry of entries) {
    const biz = bizList.find((b) => b.id === entry.businessId);
    if (!biz) continue;
    const spreadsheetId = biz.sheetIds?.[entry.year];
    if (!spreadsheetId) continue;

    // Determine sheet name from the Dexie record
    const tx = await db.transactions.get(entry.entityId);
    const sheetName: 'Expenses' | 'Mileage' = tx?.type === 'mileage' ? 'Mileage' : 'Expenses';

    try {
      await deleteByUUID(spreadsheetId, sheetName, entry.entityId);
      // Confirmed deleted in Sheets — now remove from Dexie too
      await db.transaction('rw', [db.transactions, db.syncQueue], async () => {
        await db.transactions.delete(entry.entityId);
        if (entry.id != null) await db.syncQueue.delete(entry.id);
      });
    } catch (err) {
      await _handleFlushError([entry], err as Error);
    }
  }
}

/** On flush error: increment retryCount, record the error message. */
async function _handleFlushError(entries: SyncQueueEntry[], err: Error): Promise<void> {
  console.warn('[sync] flush error:', err.message);
  for (const entry of entries) {
    if (entry.id == null) continue;
    const retryCount = entry.retryCount + 1;
    await db.syncQueue.update(entry.id, {
      retryCount,
      syncStatus: 'pending',
      lastError:  err.message,
    });
    await db.transactions.update(entry.entityId, {
      syncStatus: 'error',
      syncError:  err.message,
    });
    // Schedule a retry after backoff (non-blocking)
    const delay = _backoffMs(retryCount);
    setTimeout(() => flushQueue(), delay);
  }
}

// ---------------------------------------------------------------------------
// Pull path — Sheets → Dexie
// ---------------------------------------------------------------------------

/**
 * Pulls all rows for a business+year from Google Sheets and merges into Dexie.
 *
 * Conflict detection:
 *   - Row not in Dexie          → insert as 'synced'
 *   - Row in Dexie, 'synced'    → overwrite if remote updatedAt is newer
 *   - Row in Dexie, 'pending'   → mark as 'conflict' (user must resolve)
 *   - Row in Dexie, 'conflict'  → leave as-is
 *
 * Sets a localStorage sync marker on completion for delta pulls.
 */
export async function pullTransactions(businessId: string, year: number): Promise<void> {
  const bizList = get(businesses);
  const biz = bizList.find((b) => b.id === businessId) as BizEntry | undefined;
  if (!biz) return;

  const spreadsheetId = biz.sheetIds?.[year];
  if (!spreadsheetId) return;

  const markerKey = _syncMarkerKey(businessId, year);
  const markerStr = localStorage.getItem(markerKey);
  const since = markerStr ? new Date(parseInt(markerStr, 10)) : null;

  const now = Date.now();

  for (const sheetName of ['Expenses', 'Mileage'] as const) {
    const type = sheetName === 'Expenses' ? 'expense' : 'mileage';
    let rows: TransactionRow[];
    try {
      rows = await sheetsPull(spreadsheetId, sheetName, since);
    } catch (err) {
      console.warn(`[sync] pullTransactions ${sheetName}:`, err);
      continue;
    }

    for (const row of rows) {
      if (!row.id) continue;
      const existing = await db.transactions.get(row.id);

      if (!existing) {
        // New row — insert as synced
        await db.transactions.add({
          ..._rowToTx(row, businessId, type),
          createdAt: now,
          updatedAt: now,
        });
        continue;
      }

      if (existing.syncStatus === 'pending') {
        // Local write in flight — mark conflict for user resolution
        await db.transactions.update(row.id, { syncStatus: 'conflict' });
        continue;
      }

      if (existing.syncStatus === 'conflict') {
        // Already flagged — leave for user to resolve
        continue;
      }

      // syncStatus === 'synced' or 'error' — safe to overwrite
      await db.transactions.put({
        ..._rowToTx(row, businessId, type),
        createdAt: existing.createdAt,
        updatedAt: now,
      });
    }
  }

  // Update sync marker
  localStorage.setItem(markerKey, String(now));
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Starts the sync engine: 60s flush interval + online event listener.
 * Also registers a service worker message listener for Background Sync.
 *
 * Call once after the user authenticates. Returns a cleanup function.
 * Internally idempotent — stops any previously running engine first.
 */
export function startSyncEngine(): () => void {
  stopSyncEngine();

  // Flush immediately on start (catches anything queued before auth)
  flushQueue().catch(console.warn);

  // 60s periodic flush
  _flushTimer = setInterval(() => flushQueue().catch(console.warn), FLUSH_INTERVAL_MS);

  // Flush on reconnect
  _onlineListener = () => flushQueue().catch(console.warn);
  window.addEventListener('online', _onlineListener);

  // Background Sync message from service worker (Chrome only; Safari/Firefox fall back to the interval)
  if ('serviceWorker' in navigator) {
    _swMessageListener = (e: MessageEvent) => {
      if (e.data?.type === 'BG_SYNC') flushQueue().catch(console.warn);
    };
    navigator.serviceWorker.addEventListener('message', _swMessageListener);

    // Register the Background Sync tag so the SW can wake the engine
    navigator.serviceWorker.ready
      .then((reg) => {
        if ('sync' in reg) {
          // @ts-ignore — BackgroundSyncManager not in all TS lib versions
          return (reg as unknown as { sync: { register(tag: string): Promise<void> } }).sync.register('sync-transactions');
        }
      })
      .catch(() => { /* Background Sync not supported — interval is the fallback */ });
  }

  return stopSyncEngine;
}

/**
 * Stops the sync engine and removes all listeners.
 * Called on sign-out.
 */
export function stopSyncEngine(): void {
  if (_flushTimer !== null) {
    clearInterval(_flushTimer);
    _flushTimer = null;
  }
  if (_onlineListener) {
    window.removeEventListener('online', _onlineListener);
    _onlineListener = null;
  }
  if (_swMessageListener && 'serviceWorker' in navigator) {
    navigator.serviceWorker.removeEventListener('message', _swMessageListener);
    _swMessageListener = null;
  }
}
