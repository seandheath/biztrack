/**
 * Svelte stores for BizTrack application state.
 *
 * Auth stores (this phase). Phase 6 adds:
 *   businesses, selectedBusiness, businessConfig, vendorCache
 *
 * Token state itself lives in auth.js module variables (memory only, per spec §4.2).
 * These stores reflect that state into the Svelte reactive system via callbacks
 * registered in +layout.svelte.
 */

import { writable, derived } from 'svelte/store';

/** @type {import('svelte/store').Writable<string|null>} */
export const authToken = writable(null);

/** @type {import('svelte/store').Writable<string|null>} */
export const userEmail = writable(null);

/**
 * True when a valid access token is held in memory.
 * All protected content and API calls gate on this.
 *
 * @type {import('svelte/store').Readable<boolean>}
 */
export const isAuthenticated = derived(authToken, ($t) => !!$t);
