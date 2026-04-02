/**
 * Device-only mode management.
 *
 * When active, BizTrack stores all data in localStorage instead of Google Drive.
 * No Google auth required — the app shell renders without sign-in.
 *
 * Primary use case: testing environment that doesn't depend on Google APIs.
 * Secondary: fully offline usage with no cloud dependency.
 */

import { writable } from 'svelte/store';
import * as storage from './storage.js';
import {
  businesses,
  selectedBusiness,
  businessConfig,
  mileageFavorites,
  defaultDrivers,
  authToken,
  userEmail,
} from './store.js';

const DEVICE_MODE_KEY = 'bt_device_mode';

/**
 * Reactive flag — true when the app is running in device-only mode.
 * Re-exported from store.ts for convenience.
 */
export const deviceMode = writable<boolean>(false);

/** Returns true if device mode was previously activated (reads localStorage). */
export function isDeviceModeActive(): boolean {
  return storage.get<boolean>(DEVICE_MODE_KEY, false);
}

/**
 * Activates device-only mode.
 * Sets the persistent flag and the reactive store.
 * Caller is responsible for calling initFromLocal() afterward to populate stores.
 */
export function enterDeviceMode(): void {
  storage.set(DEVICE_MODE_KEY, true);
  deviceMode.set(true);
}

/**
 * Deactivates device-only mode and resets app state to the sign-in screen.
 * Local data remains in localStorage but is no longer displayed.
 */
export function exitDeviceMode(): void {
  storage.remove(DEVICE_MODE_KEY);
  deviceMode.set(false);

  // Reset all app stores so the sign-in screen shows clean
  businesses.set([]);
  selectedBusiness.set(null);
  businessConfig.set(null);
  mileageFavorites.set({});
  defaultDrivers.set({});
  authToken.set(null);
  userEmail.set(null);
}
