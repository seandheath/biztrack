/**
 * Sync state manager.
 *
 * Provides a reactive syncStatus store and functions to trigger/track syncs.
 * Caches hydrated business data AND transaction rows in localStorage so the
 * app can render immediately on return visits while a background sync
 * refreshes from Drive.
 *
 * Cache key: bt_cache — single JSON blob containing businesses, configs,
 * transaction rows, and a last-sync timestamp.
 */

import { writable, get } from 'svelte/store';
import type { Writable } from 'svelte/store';
import * as storage from './storage.js';
import { businesses, selectedBusiness, mileageFavorites, defaultDrivers, businessConfig } from './store.js';
import type { Business, SyncCache, SyncStatus } from './types.js';
import type { TransactionRow } from './services/sheets.js';

type SheetName = 'Expenses' | 'Mileage';

// ---------------------------------------------------------------------------
// Pull gate — controls when network pulls are allowed
// ---------------------------------------------------------------------------
// Module-level state: resets on full page reload (modules reinitialize),
// persists across client-side navigations (SvelteKit keeps modules alive).

const PULL_COOLDOWN_MS = 60_000;
const _lastPull = new Map<string, number>();
const _pullInFlight = new Set<string>();

/**
 * Returns true when a network pull should be initiated for this spreadsheet.
 * False when a pull is already in-flight or the cooldown hasn't expired.
 */
export function shouldPull(spreadsheetId: string): boolean {
  if (_pullInFlight.has(spreadsheetId)) return false;
  const ts = _lastPull.get(spreadsheetId);
  return !ts || (Date.now() - ts >= PULL_COOLDOWN_MS);
}

/** Mark a pull as started — prevents duplicate pulls for the same spreadsheet. */
export function markPullStarted(spreadsheetId: string): void {
  _pullInFlight.add(spreadsheetId);
}

/** Mark a pull as successfully completed — starts the cooldown timer. */
export function markPullComplete(spreadsheetId: string): void {
  _pullInFlight.delete(spreadsheetId);
  _lastPull.set(spreadsheetId, Date.now());
}

/** Mark a pull as failed — clears in-flight without starting cooldown (allows retry). */
export function markPullFailed(spreadsheetId: string): void {
  _pullInFlight.delete(spreadsheetId);
}

/**
 * Invalidates the pull cooldown for a spreadsheet (or all if none specified).
 * Call after writes so the next navigation triggers a fresh pull.
 */
export function invalidatePull(spreadsheetId?: string): void {
  if (spreadsheetId) _lastPull.delete(spreadsheetId);
  else _lastPull.clear();
}

const CACHE_KEY = 'bt_cache';

// ---------------------------------------------------------------------------
// Sync status store
// ---------------------------------------------------------------------------

/**
 * Reactive sync status.
 *
 * Values:
 *   'green'   — last sync succeeded, data is fresh
 *   'yellow'  — sync in progress
 *   'red'     — last sync failed (cached data may be stale)
 */
export const syncStatus: Writable<SyncStatus> = writable('yellow');

// ---------------------------------------------------------------------------
// Cache operations
// ---------------------------------------------------------------------------

/** Returns the raw cache object, or null. */
function _readCache(): SyncCache | null {
  return storage.get<SyncCache | null>(CACHE_KEY, null);
}

/** Writes the full cache object. */
function _writeCache(data: SyncCache): void {
  storage.set(CACHE_KEY, data);
}

/**
 * Returns cached business objects from localStorage.
 * Used by initFromDrive() to fall back to cached data when hydration fails.
 */
export function getCachedBusinesses(): Business[] {
  return _readCache()?.businesses ?? [];
}

/**
 * Reads cached business data from localStorage and populates stores.
 * Returns true if cache was found and loaded, false otherwise.
 *
 * Called ONCE on app load, before initFromDrive() starts.
 */
export function loadCache(): boolean {
  const cached = _readCache();
  if (!cached?.businesses?.length) return false;

  businesses.set(cached.businesses);
  mileageFavorites.set(cached.mileageFavorites ?? {});
  defaultDrivers.set(cached.defaultDrivers ?? {});

  // Restore selected business
  const savedName = storage.get<string | null>('biztrack_selected_name', null);
  const toSelect = (savedName && cached.businesses.find(b => b.name === savedName))
                   ?? cached.businesses[0] ?? null;
  if (toSelect) selectedBusiness.set(toSelect);

  // Restore businessConfig for the selected business
  if (toSelect && cached.businessConfigs?.[toSelect.folderId]) {
    businessConfig.set(cached.businessConfigs[toSelect.folderId]);
  }

  return true;
}

/**
 * Writes current store state to localStorage cache.
 * Preserves existing cached transactions — only updates business/config data.
 * Called after every successful initFromDrive() or config change.
 */
export function writeCache(): void {
  const existing = _readCache();

  // Guard: don't overwrite a cached business that has populated sheetIds
  // with a store version that has empty sheetIds (broken skeleton from
  // a failed hydration).
  const cachedByFolder = new Map(
    (existing?.businesses ?? []).map((b) => [b.folderId, b]),
  );
  const safeBiz = get(businesses).map((b) => {
    if (Object.keys(b.sheetIds ?? {}).length === 0) {
      const cached = cachedByFolder.get(b.folderId);
      if (cached && Object.keys(cached.sheetIds ?? {}).length > 0) return cached;
    }
    return b;
  });

  const data: SyncCache = {
    businesses: safeBiz,
    mileageFavorites: get(mileageFavorites),
    defaultDrivers: get(defaultDrivers),
    businessConfigs: existing?.businessConfigs ?? {},
    transactions: existing?.transactions ?? {},
    lastSyncTimestamp: Date.now(),
    lastSyncError: null,
  };

  // Cache the current businessConfig keyed by folderId
  const biz = get(selectedBusiness);
  const cfg = get(businessConfig);
  if (biz && cfg) {
    data.businessConfigs[biz.folderId] = cfg;
  }

  _writeCache(data);
}

/**
 * Returns cached transaction rows for a given spreadsheet + sheet tab.
 * Returns null if no cache exists for this key.
 */
export function getCachedTransactions(spreadsheetId: string, sheetName: SheetName): TransactionRow[] | null {
  const cached = _readCache();
  const key = `${spreadsheetId}::${sheetName}`;
  return cached?.transactions?.[key] ?? null;
}

/**
 * Writes transaction rows for a given spreadsheet + sheet tab to cache.
 * Merges into the existing cache without disturbing other keys.
 */
export function cacheTransactions(spreadsheetId: string, sheetName: SheetName, rows: TransactionRow[]): void {
  const existing = _readCache() ?? {
    businesses: get(businesses),
    mileageFavorites: get(mileageFavorites),
    defaultDrivers: get(defaultDrivers),
    businessConfigs: {},
    transactions: {},
    lastSyncTimestamp: Date.now(),
    lastSyncError: null,
  };
  const key = `${spreadsheetId}::${sheetName}`;
  existing.transactions = { ...existing.transactions, [key]: rows };
  existing.lastSyncTimestamp = Date.now();
  _writeCache(existing);
}

/**
 * Remove a single cached transaction row by UUID.
 * Used after deletes so the destination page doesn't flash the deleted entry.
 */
export function removeCachedTransaction(spreadsheetId: string, sheetName: SheetName, uuid: string): void {
  const existing = _readCache();
  if (!existing) return;
  const key = `${spreadsheetId}::${sheetName}`;
  const rows = existing.transactions?.[key];
  if (!rows) return;
  existing.transactions = { ...existing.transactions, [key]: rows.filter(r => r.id !== uuid) };
  existing.lastSyncTimestamp = Date.now();
  _writeCache(existing);
}

/**
 * Update a single cached transaction row in-place by UUID, or append if not found.
 * Used after edits so the destination page renders the updated values immediately.
 */
export function updateCachedTransaction(spreadsheetId: string, sheetName: SheetName, row: TransactionRow): void {
  const existing = _readCache();
  if (!existing) return;
  const key = `${spreadsheetId}::${sheetName}`;
  const rows = existing.transactions?.[key];
  if (!rows) return;
  const idx = rows.findIndex(r => r.id === row.id);
  if (idx >= 0) {
    rows[idx] = row;
  } else {
    rows.push(row);
  }
  existing.transactions = { ...existing.transactions, [key]: rows };
  existing.lastSyncTimestamp = Date.now();
  _writeCache(existing);
}

/**
 * Clears the sync cache. Called on sign-out.
 */
export function clearCache(): void {
  storage.remove(CACHE_KEY);
  syncStatus.set('yellow');
}
