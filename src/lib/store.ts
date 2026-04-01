/**
 * Svelte stores for BizTrack application state.
 *
 * Auth stores bridge auth.js module state into the Svelte reactive system via
 * callbacks registered in +layout.svelte (token lives in memory only, §4.2).
 *
 * Business/config stores are populated from Drive on each session start
 * (see initFromDrive in +layout.svelte). Nothing is cached in localStorage
 * except UX preferences (selected business name, email hint, iOS prompt flag).
 */

import { writable, derived } from 'svelte/store';
import type { Writable, Readable } from 'svelte/store';
import * as storage from './storage.js';
import type { Business, BusinessConfig, MileageFavorite } from './types.js';

// ---------------------------------------------------------------------------
// localStorage keys
// ---------------------------------------------------------------------------

const KEY_SELECTED_NAME  = 'biztrack_selected_name';

// ---------------------------------------------------------------------------
// Auth stores
// ---------------------------------------------------------------------------

export const authToken: Writable<string | null> = writable(null);

export const userEmail: Writable<string | null> = writable(null);

/**
 * True when a valid access token is held in memory.
 * All protected content and API calls gate on this.
 */
export const isAuthenticated: Readable<boolean> = derived(authToken, ($t) => !!$t);

// ---------------------------------------------------------------------------
// Business stores
// ---------------------------------------------------------------------------

/**
 * List of all configured businesses.
 * Populated from Drive on each session start — NOT cached in localStorage.
 */
export const businesses: Writable<Business[]> = writable([]);

/**
 * The currently selected business object, or null if none selected.
 * Set by initFromDrive after Drive discovery completes.
 * Only the name is persisted to localStorage as a UX preference.
 */
export const selectedBusiness: Writable<Business | null> = writable(null);

/**
 * Per-business config loaded from Drive config.json.
 * NOT persisted to localStorage — loaded fresh each session.
 */
export const businessConfig: Writable<BusinessConfig | null> = writable(null);

/**
 * Vendor name strings for autocomplete, synced from the current year's Expenses sheet.
 * NOT cached in localStorage — populated from Sheets on each page load.
 */
export const vendorCache: Writable<string[]> = writable([]);

/** A destination paired with the "from" value from the most recent trip to it. */
export interface DestinationEntry { to: string; lastFrom: string; }

/**
 * Mileage destination entries for autocomplete — deduplicated by destination,
 * each carrying the most recent origin for that destination.
 * NOT cached in localStorage — populated from Sheets on each page load.
 */
export const destinationCache: Writable<DestinationEntry[]> = writable([]);

/**
 * Mileage origin strings for autocomplete — unique "from" values.
 * NOT cached in localStorage — populated from Sheets on each page load.
 */
export const originCache: Writable<string[]> = writable([]);

/**
 * Mileage driver strings for autocomplete — unique driver names.
 * NOT cached in localStorage — populated from Sheets on each page load.
 */
export const driverCache: Writable<string[]> = writable([]);

/**
 * User-owned mileage favorites, keyed by business folderId.
 * Populated from profile.json at session start — NOT derived from config.json.
 * Each user has their own favorites per business, independent of other users.
 */
export const mileageFavorites: Writable<Record<string, MileageFavorite[]>> = writable({});

/**
 * A receipt File shared via the Android Web Share Target.
 * Set by the /share route on mount; cleared by the expense form after attaching.
 * NOT persisted — the file blob is held in the SW cache until consumed.
 */
export const pendingReceipt: Writable<File | null> = writable(null);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Atomically updates a business object in both the businesses list and
 * selectedBusiness stores. Replaces the 2-line pattern that was previously
 * copy-pasted 8+ times across pages.
 */
export function updateBusiness(updated: Business): void {
  businesses.update((list) => list.map((b) => b.name === updated.name ? updated : b));
  selectedBusiness.update((current) => current?.name === updated.name ? updated : current);
}

// ---------------------------------------------------------------------------
// Persistence subscriptions — UX preferences only
// ---------------------------------------------------------------------------

// Persist the selected business NAME so initFromDrive can restore the selection
// on next session start.
selectedBusiness.subscribe((v) => {
  if (v?.name) storage.set(KEY_SELECTED_NAME, v.name);
});
