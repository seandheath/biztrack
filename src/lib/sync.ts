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
import { businesses, selectedBusiness, mileageFavorites, businessConfig } from './store.js';
import type { SyncCache, SyncStatus } from './types.js';
import type { TransactionRow } from './services/sheets.js';

type SheetName = 'Expenses' | 'Mileage';

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

  // Restore selected business
  const savedName = localStorage.getItem('biztrack_selected_name');
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
  const data: SyncCache = {
    businesses: get(businesses),
    mileageFavorites: get(mileageFavorites),
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
 * Clears the sync cache. Called on sign-out.
 */
export function clearCache(): void {
  storage.remove(CACHE_KEY);
  syncStatus.set('yellow');
}
