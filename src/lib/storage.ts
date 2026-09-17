/**
 * Convenience cache: localStorage for the app, memory only for the demo.
 *
 * All three functions guard against missing localStorage (SSR pre-render
 * passes, private browsing modes that block storage). Data loss from
 * QuotaExceededError is acceptable — localStorage is a cache only.
 * All real data lives in Google Drive.
 */

import { isDemo, storageKey } from './version.js';

const demoCache = new Map<string, unknown>();

const _available: boolean = typeof localStorage !== 'undefined';

/**
 * Reads and JSON-parses a value from localStorage.
 * Returns fallback on missing key, invalid JSON, or unavailable storage.
 *
 */
export function get<T = null>(key: string, fallback: T = null as T): T {
  if (isDemo) return structuredClone((demoCache.has(key) ? demoCache.get(key) : fallback) as T);
  if (!_available) return fallback;
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * JSON-serializes and writes a value to localStorage.
 * Silently swallows QuotaExceededError.
 *
 */
export function set(key: string, value: unknown): void {
  if (isDemo) { demoCache.set(key, structuredClone(value)); return; }
  if (!_available) return;
  try {
    localStorage.setItem(storageKey(key), JSON.stringify(value));
  } catch {
    // QuotaExceededError or SecurityError — cache write failure is non-fatal
  }
}

/**
 * Removes a key from localStorage.
 *
 */
export function remove(key: string): void {
  if (isDemo) { demoCache.delete(key); return; }
  if (!_available) return;
  try {
    localStorage.removeItem(storageKey(key));
  } catch {
    // SecurityError in some locked-down environments
  }
}
