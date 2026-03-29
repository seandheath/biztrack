/**
 * BizTrack sync engine — bidirectional IndexedDB ↔ Google Sheets.
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
 *   → on 404: sheet was deleted — clears synced rows, resets pending, recreates sheet
 *
 * Pull path: pullTransactions()
 *   → fetches ALL rows from Sheets (no date filter — full reconciliation)
 *   → inserts/updates Dexie rows from Sheets
 *   → deletes Dexie 'synced'/'error' rows whose UUID is no longer in Sheets
 *   → on 404: sheet deleted — clears synced rows from Dexie
 *
 * Sync cycle: self-scheduling setTimeout, adaptive rate
 *   → base interval 10s, backs off to 30s/60s when approaching API quota
 *   → also fires on online event, visibilitychange, and SW Background Sync
 *
 * Lifecycle:
 *   startSyncEngine() — call after sign-in
 *   stopSyncEngine()  — call on sign-out
 */

import { get } from 'svelte/store';
import { db, type Transaction, type SyncQueueEntry } from '../db/dexie.js';
import { businesses, selectedBusiness } from '../store.js';
import { ensureYearFolder } from '../business.js';
import {
  pushTransactions,
  updateByUUID,
  deleteByUUID,
  pullTransactions as sheetsPull,
  type TransactionRow,
} from './sheets.js';

// ---------------------------------------------------------------------------
// Private state
// ---------------------------------------------------------------------------

let _syncTimer: ReturnType<typeof setTimeout> | null = null;
let _flushing = false;
let _onlineListener: (() => void) | null = null;
let _visibilityListener: (() => void) | null = null;
let _swMessageListener: ((e: MessageEvent) => void) | null = null;

// ---------------------------------------------------------------------------
// Adaptive rate limiting
// ---------------------------------------------------------------------------

// Sliding window of Sheets API call timestamps (last 60s).
const _apiCallTimestamps: number[] = [];

function _trackApiCall(): void {
  const now = Date.now();
  _apiCallTimestamps.push(now);
  const cutoff = now - 60_000;
  while (_apiCallTimestamps.length && _apiCallTimestamps[0] < cutoff) {
    _apiCallTimestamps.shift();
  }
}

function _currentRpm(): number {
  const cutoff = Date.now() - 60_000;
  return _apiCallTimestamps.filter((t) => t > cutoff).length;
}

/**
 * Returns the next sync cycle delay based on recent Sheets API call rate.
 * Quota: 300 req/min per user. Thresholds stay well under.
 *   < 60 RPM  (20%) → 10s   comfortable
 *   60–180 RPM (60%) → 30s  backing off
 *   > 180 RPM        → 60s  near ceiling
 */
function _nextSyncDelayMs(): number {
  const rpm = _currentRpm();
  if (rpm < 60)  return 10_000;
  if (rpm < 180) return 30_000;
  return 60_000;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Exponential backoff in ms: min(2^n * 1000 + jitter, 64000) */
function _backoffMs(retryCount: number): number {
  return Math.min(Math.pow(2, retryCount) * 1000 + Math.random() * 1000, 64_000);
}

/** Returns true if an error message indicates the resource was not found (404). */
function _isNotFound(err: Error): boolean {
  return err.message.includes('404') || err.message.toLowerCase().includes('not found');
}

/** Returns true if an error message indicates rate limiting (429). */
function _isRateLimited(err: Error): boolean {
  return err.message.includes('429') || err.message.toLowerCase().includes('rate limit') ||
    err.message.toLowerCase().includes('quota');
}

/**
 * Clears the cached sheetId and yearFolder for a given business+year in both
 * stores, so the next ensureYearFolder call goes through Drive re-discovery.
 */
function _clearCachedSheetIds(bizId: string, year: number): void {
  const clearIds = <T extends { id?: string; sheetIds?: Record<number, string>; yearFolders?: Record<number, string> } | null | undefined>(biz: T): T => {
    if (!biz || (biz as { id?: string }).id !== bizId) return biz;
    const sheetIds    = { ...(biz as { sheetIds?: Record<number, string> }).sheetIds };
    const yearFolders = { ...(biz as { yearFolders?: Record<number, string> }).yearFolders };
    delete sheetIds[year];
    delete yearFolders[year];
    return { ...biz, sheetIds, yearFolders };
  };
  businesses.update((list) => list.map(clearIds));
  selectedBusiness.update(clearIds);
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

type BizEntry = { id: string; sheetIds?: Record<number, string>; yearFolders?: Record<number, string>; [k: string]: unknown };

/**
 * Resolves a spreadsheetId for an entry, creating the year folder if needed.
 * Returns the updated biz entry and spreadsheetId, or null if it couldn't be resolved.
 */
async function _resolveSpreadsheetId(
  entry: SyncQueueEntry,
  biz: BizEntry,
): Promise<{ biz: BizEntry; spreadsheetId: string } | null> {
  let spreadsheetId = biz.sheetIds?.[entry.year];
  if (spreadsheetId) return { biz, spreadsheetId };

  // sheetId missing — try to find or create the year folder
  try {
    const updated = await ensureYearFolder(biz as Parameters<typeof ensureYearFolder>[0], entry.year);
    businesses.update((list) => list.map((b) => b.id === biz.id ? updated : b));
    selectedBusiness.update((b) => b?.id === biz.id ? updated : b);
    spreadsheetId = updated.sheetIds?.[entry.year];
    if (spreadsheetId) return { biz: updated as BizEntry, spreadsheetId };
  } catch (err) {
    console.warn('[sync] ensureYearFolder failed during flush:', (err as Error).message);
  }
  return null;
}

/** Batch-appends create entries to Sheets, grouped by spreadsheet+tab. */
async function _flushCreates(entries: SyncQueueEntry[], bizList: BizEntry[]): Promise<void> {
  const groups = new Map<string, { spreadsheetId: string; sheetName: 'Expenses' | 'Mileage'; entries: SyncQueueEntry[] }>();

  for (const entry of entries) {
    let biz = bizList.find((b) => b.id === entry.businessId);
    if (!biz) continue;

    const resolved = await _resolveSpreadsheetId(entry, biz);
    if (!resolved) continue;
    biz = resolved.biz;
    // Update bizList ref so subsequent entries in this batch use the recovered ID
    const idx = bizList.findIndex((b) => b.id === biz!.id);
    if (idx >= 0) bizList[idx] = biz;

    const tx = entry.data as Transaction;
    const sheetName: 'Expenses' | 'Mileage' = tx.type === 'mileage' ? 'Mileage' : 'Expenses';
    const key = `${resolved.spreadsheetId}::${sheetName}`;
    if (!groups.has(key)) groups.set(key, { spreadsheetId: resolved.spreadsheetId, sheetName, entries: [] });
    groups.get(key)!.entries.push(entry);
  }

  for (const { spreadsheetId, sheetName, entries: group } of groups.values()) {
    const rows: TransactionRow[] = group.map((e) => _txToRow(e.data as Transaction));
    try {
      _trackApiCall();
      await pushTransactions(spreadsheetId, sheetName, rows);
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
    let biz = bizList.find((b) => b.id === entry.businessId);
    if (!biz) continue;

    const resolved = await _resolveSpreadsheetId(entry, biz);
    if (!resolved) continue;
    biz = resolved.biz;
    const idx = bizList.findIndex((b) => b.id === biz!.id);
    if (idx >= 0) bizList[idx] = biz;

    const tx = entry.data as Transaction;
    const sheetName: 'Expenses' | 'Mileage' = tx.type === 'mileage' ? 'Mileage' : 'Expenses';
    try {
      _trackApiCall();
      await updateByUUID(resolved.spreadsheetId, sheetName, _txToRow(tx));
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
    let biz = bizList.find((b) => b.id === entry.businessId);
    if (!biz) continue;

    const resolved = await _resolveSpreadsheetId(entry, biz);
    if (!resolved) continue;
    biz = resolved.biz;
    const idx = bizList.findIndex((b) => b.id === biz!.id);
    if (idx >= 0) bizList[idx] = biz;

    const tx = await db.transactions.get(entry.entityId);
    const sheetName: 'Expenses' | 'Mileage' = tx?.type === 'mileage' ? 'Mileage' : 'Expenses';
    try {
      _trackApiCall();
      await deleteByUUID(resolved.spreadsheetId, sheetName, entry.entityId);
      await db.transaction('rw', [db.transactions, db.syncQueue], async () => {
        await db.transactions.delete(entry.entityId);
        if (entry.id != null) await db.syncQueue.delete(entry.id);
      });
    } catch (err) {
      await _handleFlushError([entry], err as Error);
    }
  }
}

/**
 * Handles a Sheets API error during a push operation.
 *
 * - 404 (sheet deleted): clears synced Dexie rows for that year, resets the
 *   failed entries to pending so they sync to the recreated sheet.
 * - 429 (rate limited): marks error, schedules retry after 60s.
 * - Other errors: marks error, exponential backoff.
 */
async function _handleFlushError(entries: SyncQueueEntry[], err: Error): Promise<void> {
  console.warn('[sync] flush error:', err.message);

  if (_isNotFound(err) && entries.length > 0) {
    const year  = entries[0].year;
    const bizId = entries[0].businessId;

    // Sheet was deleted — Drive is source of truth. Remove synced rows for this
    // year; the failed entries (never successfully pushed) are reset to pending
    // and will sync to the recreated sheet on the next flush.
    await db.transactions
      .where('[businessId+year]')
      .equals([bizId, year])
      .filter((t) => t.syncStatus === 'synced' || t.syncStatus === 'error')
      .delete();

    // Clear stale cached IDs so ensureYearFolder goes through Drive re-discovery
    _clearCachedSheetIds(bizId, year);

    // Reset failed entries to pending (they never made it to the sheet)
    for (const entry of entries) {
      if (entry.id == null) continue;
      await db.syncQueue.update(entry.id, { retryCount: 0, syncStatus: 'pending', lastError: null });
      await db.transactions.update(entry.entityId, { syncStatus: 'pending', syncError: undefined });
    }

    // Trigger a flush shortly — ensureYearFolder will run inside the next flush
    // to recreate the sheet before pushing the pending entries.
    setTimeout(() => flushQueue(), 2_000);
    return;
  }

  const retryDelay = _isRateLimited(err) ? 60_000 : undefined;

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
    const delay = retryDelay ?? _backoffMs(retryCount);
    setTimeout(() => flushQueue(), delay);
  }
}

// ---------------------------------------------------------------------------
// Pull path — Sheets → Dexie (full reconciliation)
// ---------------------------------------------------------------------------

/**
 * Pulls ALL rows for a business+year from Google Sheets and fully reconciles
 * with Dexie. Drive is the source of truth:
 *
 *   - Row in Sheets, not in Dexie               → insert as 'synced'
 *   - Row in Sheets, Dexie 'synced'/'error'      → overwrite with remote data
 *   - Row in Sheets, Dexie 'pending'             → mark as 'conflict'
 *   - Row in Sheets, Dexie 'conflict'            → leave for user to resolve
 *   - Row in Dexie 'synced'/'error', not Sheets  → delete (removed from Drive)
 *   - Row in Dexie 'pending'/'conflict', not Sheets → keep (unsaved local work)
 *
 * On 404 (sheet deleted): clears all 'synced'/'error' rows for the year and
 * resets the cached sheetId so the next flush recreates the sheet.
 */
export async function pullTransactions(businessId: string, year: number): Promise<void> {
  const bizList = get(businesses);
  const biz = bizList.find((b) => b.id === businessId) as BizEntry | undefined;
  if (!biz) return;

  const spreadsheetId = biz.sheetIds?.[year];
  if (!spreadsheetId) return;

  const now = Date.now();

  for (const sheetName of ['Expenses', 'Mileage'] as const) {
    const type = sheetName === 'Expenses' ? 'expense' : 'mileage';
    let rows: TransactionRow[];
    try {
      _trackApiCall();
      rows = await sheetsPull(spreadsheetId, sheetName);
    } catch (err) {
      const e = err as Error;
      if (_isNotFound(e)) {
        // Spreadsheet was deleted. Remove synced rows — Drive is truth.
        // Pending rows survive and will sync to the recreated sheet.
        await db.transactions
          .where('[businessId+type+year]')
          .equals([businessId, type, year])
          .filter((t) => t.syncStatus === 'synced' || t.syncStatus === 'error')
          .delete();
        _clearCachedSheetIds(businessId, year);
      } else {
        console.warn(`[sync] pull ${sheetName}:`, e.message);
      }
      continue;
    }

    // Build set of UUIDs present in Sheets for deletion detection
    const sheetUUIDs = new Set(rows.map((r) => r.id));

    // Process each row from Sheets
    for (const row of rows) {
      const existing = await db.transactions.get(row.id);

      if (!existing) {
        await db.transactions.add({
          ..._rowToTx(row, businessId, type),
          createdAt: now,
          updatedAt: now,
        });
        continue;
      }

      if (existing.syncStatus === 'pending') {
        await db.transactions.update(row.id, { syncStatus: 'conflict' });
        continue;
      }

      if (existing.syncStatus === 'conflict') {
        continue; // leave for user to resolve
      }

      // 'synced' or 'error' — safe to overwrite with Drive's version
      await db.transactions.put({
        ..._rowToTx(row, businessId, type),
        createdAt: existing.createdAt,
        updatedAt: now,
      });
    }

    // Delete Dexie rows no longer present in Sheets.
    // Only remove 'synced'/'error' rows — 'pending'/'conflict' are local work.
    const dexieRows = await db.transactions
      .where('[businessId+type+year]')
      .equals([businessId, type, year])
      .toArray();

    for (const row of dexieRows) {
      if (row.syncStatus === 'pending' || row.syncStatus === 'conflict') continue;
      if (!sheetUUIDs.has(row.id)) {
        await db.transactions.delete(row.id);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Lifecycle — adaptive sync cycle
// ---------------------------------------------------------------------------

/**
 * Runs one flush+pull cycle, then schedules the next one after an adaptive
 * delay based on the current Sheets API request rate.
 */
function _scheduleSyncCycle(): void {
  _syncTimer = setTimeout(async () => {
    await flushQueue().catch(console.warn);
    const biz = get(selectedBusiness);
    if (biz?.id) {
      await pullTransactions(biz.id, new Date().getFullYear()).catch(console.warn);
    }
    _scheduleSyncCycle();
  }, _nextSyncDelayMs());
}

/**
 * Starts the sync engine: adaptive flush+pull cycle, online listener,
 * visibilitychange listener, and SW Background Sync.
 *
 * Call once after the user authenticates. Returns a cleanup function.
 * Internally idempotent — stops any previously running engine first.
 */
export function startSyncEngine(): () => void {
  stopSyncEngine();

  // Run immediately on start (flush any queued entries, pull current state)
  flushQueue().catch(console.warn);
  const biz = get(selectedBusiness);
  if (biz?.id) {
    pullTransactions(biz.id, new Date().getFullYear()).catch(console.warn);
  }

  // Adaptive sync cycle: flush + pull, rescheduling based on API rate
  _scheduleSyncCycle();

  // Flush + pull immediately on reconnect
  _onlineListener = () => {
    flushQueue().catch(console.warn);
    const b = get(selectedBusiness);
    if (b?.id) pullTransactions(b.id, new Date().getFullYear()).catch(console.warn);
  };
  window.addEventListener('online', _onlineListener);

  // Pull immediately when the app comes back to the foreground
  _visibilityListener = () => {
    if (document.visibilityState !== 'visible') return;
    if (_syncTimer !== null) { clearTimeout(_syncTimer); _syncTimer = null; }
    _scheduleSyncCycle();
  };
  document.addEventListener('visibilitychange', _visibilityListener);

  // Background Sync message from service worker (Chrome only)
  if ('serviceWorker' in navigator) {
    _swMessageListener = (e: MessageEvent) => {
      if (e.data?.type === 'BG_SYNC') flushQueue().catch(console.warn);
    };
    navigator.serviceWorker.addEventListener('message', _swMessageListener);

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
  if (_syncTimer !== null) {
    clearTimeout(_syncTimer);
    _syncTimer = null;
  }
  if (_onlineListener) {
    window.removeEventListener('online', _onlineListener);
    _onlineListener = null;
  }
  if (_visibilityListener) {
    document.removeEventListener('visibilitychange', _visibilityListener);
    _visibilityListener = null;
  }
  if (_swMessageListener && 'serviceWorker' in navigator) {
    navigator.serviceWorker.removeEventListener('message', _swMessageListener);
    _swMessageListener = null;
  }
}
