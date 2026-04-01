/**
 * localStorage wrapper for BizTrack convenience cache.
 *
 * All three functions guard against missing localStorage (SSR pre-render
 * passes, private browsing modes that block storage). Data loss from
 * QuotaExceededError is acceptable — localStorage is a cache only.
 * All real data lives in Google Drive.
 */

const _available: boolean = typeof localStorage !== 'undefined';

/**
 * Reads and JSON-parses a value from localStorage.
 * Returns fallback on missing key, invalid JSON, or unavailable storage.
 *
 */
export function get<T = null>(key: string, fallback: T = null as T): T {
  if (!_available) return fallback;
  try {
    const raw = localStorage.getItem(key);
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
  if (!_available) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // QuotaExceededError or SecurityError — cache write failure is non-fatal
  }
}

/**
 * Removes a key from localStorage.
 *
 */
export function remove(key: string): void {
  if (!_available) return;
  try {
    localStorage.removeItem(key);
  } catch {
    // SecurityError in some locked-down environments
  }
}
