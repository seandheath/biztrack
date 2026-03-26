/**
 * localStorage wrapper for BizTrack convenience cache.
 *
 * All three functions guard against missing localStorage (SSR pre-render
 * passes, private browsing modes that block storage). Data loss from
 * QuotaExceededError is acceptable — localStorage is a cache only.
 * All real data lives in Google Drive.
 */

const _available = typeof localStorage !== 'undefined';

/**
 * Reads and JSON-parses a value from localStorage.
 * Returns fallback on missing key, invalid JSON, or unavailable storage.
 *
 * @template T
 * @param {string} key
 * @param {T} [fallback=null]
 * @returns {T}
 */
export function get(key, fallback = null) {
  if (!_available) return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * JSON-serializes and writes a value to localStorage.
 * Silently swallows QuotaExceededError.
 *
 * @param {string} key
 * @param {unknown} value
 */
export function set(key, value) {
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
 * @param {string} key
 */
export function remove(key) {
  if (!_available) return;
  try {
    localStorage.removeItem(key);
  } catch {
    // SecurityError in some locked-down environments
  }
}
