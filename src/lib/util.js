/**
 * Shared utility functions for BizTrack pages.
 */

/**
 * Returns today's date as an ISO 8601 date string (YYYY-MM-DD).
 * @returns {string}
 */
export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Maps common API error codes to user-friendly messages.
 *
 * @param {Error|unknown} err
 * @returns {string}
 */
export function friendlyError(err) {
  const msg = err?.message ?? '';
  if (msg.includes('401')) return 'Session expired. Please sign in again.';
  if (msg.includes('403')) return 'Permission denied. Check Drive sharing.';
  return 'Network error. Try again.';
}
