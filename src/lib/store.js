/**
 * Svelte stores for BizTrack application state.
 *
 * Auth stores bridge auth.js module state into the Svelte reactive system via
 * callbacks registered in +layout.svelte (token lives in memory only, §4.2).
 *
 * Business/config stores are populated from Drive on each session start
 * (see initFromDrive in +layout.svelte). Nothing is cached in localStorage
 * except UX preferences (selected business name, email hint, iOS prompt flag).
 *
 * Business object shape:
 *   { id, name, folderId, configFileId, yearFolders: {}, sheetIds: {}, receiptFolderIds: {} }
 *
 * businessConfig shape (from Drive config.json):
 *   { payment_accounts: string[], mileage_favorites: Array, categories: string[] }
 */

import { writable, derived } from 'svelte/store';
import * as storage from './storage.js';

// ---------------------------------------------------------------------------
// localStorage keys
// ---------------------------------------------------------------------------

const KEY_SELECTED_NAME  = 'biztrack_selected_name';

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
 * Populated from Drive on each session start — NOT cached in localStorage.
 * @type {import('svelte/store').Writable<Array<{id:string,name:string,folderId:string,configFileId:string,yearFolders:Object,sheetIds:Object,receiptFolderIds:Object}>>}
 */
export const businesses = writable([]);

/**
 * The currently selected business object, or null if none selected.
 * Set by initFromDrive after Drive discovery completes.
 * Only the name is persisted to localStorage as a UX preference.
 * @type {import('svelte/store').Writable<Object|null>}
 */
export const selectedBusiness = writable(null);

/**
 * Per-business config loaded from Drive config.json.
 * Shape: { payment_accounts: string[], mileage_favorites: Array, categories: string[] }
 * NOT persisted to localStorage — loaded fresh each session.
 * @type {import('svelte/store').Writable<{payment_accounts:string[],mileage_favorites:Array,categories:string[]}|null>}
 */
export const businessConfig = writable(null);

/**
 * Vendor name strings for autocomplete, synced from the current year's Expenses sheet.
 * NOT cached in localStorage — populated from Sheets on each page load.
 * @type {import('svelte/store').Writable<string[]>}
 */
export const vendorCache = writable([]);

/**
 * User-owned mileage favorites, keyed by business folderId.
 * Populated from profile.json at session start — NOT derived from config.json.
 * Each user has their own favorites per business, independent of other users.
 * @type {import('svelte/store').Writable<Record<string, Array<{name:string,from:string,to:string,miles:number,purpose:string,roundTrip?:boolean}>>>}
 */
export const mileageFavorites = writable({});

/**
 * A receipt File shared via the Android Web Share Target.
 * Set by the /share route on mount; cleared by the expense form after attaching.
 * NOT persisted — the file blob is held in the SW cache until consumed.
 * @type {import('svelte/store').Writable<File|null>}
 */
export const pendingReceipt = writable(null);

// ---------------------------------------------------------------------------
// Persistence subscriptions — UX preferences only
// ---------------------------------------------------------------------------

// Persist the selected business NAME so initFromDrive can restore the selection
// on next session start.
selectedBusiness.subscribe((v) => {
  if (v?.name) storage.set(KEY_SELECTED_NAME, v.name);
});
