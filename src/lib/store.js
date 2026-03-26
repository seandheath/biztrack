/**
 * Svelte stores for BizTrack application state.
 *
 * Auth stores bridge auth.js module state into the Svelte reactive system via
 * callbacks registered in +layout.svelte (token lives in memory only, §4.2).
 *
 * Business/config stores are initialized from localStorage cache on module
 * load and subscribed to persist changes back. businessConfig is NOT cached —
 * it is loaded fresh from Drive config.json each session.
 *
 * Business object shape:
 *   { name, folderId, yearFolders: {}, sheetIds: {}, receiptFolderIds: {} }
 *
 * businessConfig shape (from Drive config.json):
 *   { payment_accounts: string[], mileage_favorites: [{name,from,to,miles,purpose}] }
 */

import { writable, derived } from 'svelte/store';
import * as storage from './storage.js';

// ---------------------------------------------------------------------------
// localStorage keys
// ---------------------------------------------------------------------------

const KEY_BUSINESSES     = 'biztrack_businesses';
const KEY_SELECTED_NAME  = 'biztrack_selected_name';
const KEY_VENDOR_CACHE   = 'biztrack_vendor_cache';

// ---------------------------------------------------------------------------
// Auth stores
// ---------------------------------------------------------------------------

/** @type {import('svelte/store').Writable<string|null>} */
export const authToken = writable(null);

/** @type {import('svelte/store').Writable<string|null>} */
export const userEmail = writable(null);

/**
 * True when a valid access token is held in memory.
 * All protected content and API calls gate on this.
 * @type {import('svelte/store').Readable<boolean>}
 */
export const isAuthenticated = derived(authToken, ($t) => !!$t);

// ---------------------------------------------------------------------------
// Business stores
// ---------------------------------------------------------------------------

/**
 * List of all configured businesses.
 * Persisted to localStorage as a convenience cache.
 * @type {import('svelte/store').Writable<Array<{name:string,folderId:string,yearFolders:Object,sheetIds:Object,receiptFolderIds:Object}>>}
 */
export const businesses = writable(storage.get(KEY_BUSINESSES, []));

/**
 * The currently selected business object, or null if none selected.
 * Rehydrated from localStorage by name lookup on module load (below).
 * Only the name is persisted — the full object is rehydrated from the
 * businesses array so stale object shapes aren't preserved.
 * @type {import('svelte/store').Writable<Object|null>}
 */
export const selectedBusiness = writable(null);

/**
 * Per-business config loaded from Drive config.json.
 * Shape: { payment_accounts: string[], mileage_favorites: Array }
 * NOT persisted to localStorage — loaded fresh each session.
 * @type {import('svelte/store').Writable<{payment_accounts:string[],mileage_favorites:Array}|null>}
 */
export const businessConfig = writable(null);

/**
 * Vendor name strings for autocomplete, synced from column B of the current
 * year's Expenses sheet. Persisted to localStorage as a cache.
 * @type {import('svelte/store').Writable<string[]>}
 */
export const vendorCache = writable(storage.get(KEY_VENDOR_CACHE, []));

// ---------------------------------------------------------------------------
// Persistence subscriptions
// ---------------------------------------------------------------------------

businesses.subscribe((v) => storage.set(KEY_BUSINESSES, v));
vendorCache.subscribe((v) => storage.set(KEY_VENDOR_CACHE, v));
selectedBusiness.subscribe((v) => {
  if (v?.name) storage.set(KEY_SELECTED_NAME, v.name);
});

// ---------------------------------------------------------------------------
// Rehydrate selectedBusiness from saved name
// ---------------------------------------------------------------------------

// Run once on module load: look up the last-used business by name in the
// cached businesses array. If found, set it as the selected business.
// This ensures selectedBusiness holds a full object, not a stale serialized copy.
(function rehydrateSelected() {
  const savedName = storage.get(KEY_SELECTED_NAME, null);
  if (!savedName) return;
  const list = storage.get(KEY_BUSINESSES, []);
  const found = list.find((b) => b.name === savedName);
  if (found) selectedBusiness.set(found);
})();
