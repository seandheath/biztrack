/**
 * Shared utility functions for BizTrack pages.
 */
import { AuthError } from './auth.js';
import { appBase } from './version.js';

/** Only the app's existing return destinations are accepted from shared links. */
export function returnRoute(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f]/.test(value)) return '';
  const url = new URL(value, 'https://biztrack.invalid');
  if (url.origin !== 'https://biztrack.invalid') return '';
  let path = url.pathname;
  if (appBase && path.startsWith(`${appBase}/`)) path = path.slice(appBase.length);
  path = path.replace(/\/$/, '') || '/';
  if (!['/', '/history', '/review'].includes(path)) return '';
  // Reject encoded path traversal rather than normalizing it into another build.
  if (value.split('?')[0].includes('..') || value.split('?')[0].includes('%')) return '';
  return path + url.search;
}

/**
 * Returns today's date as an ISO 8601 date string (YYYY-MM-DD).
 */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Shared transaction links retain the same parameters for editing and sharing. */
export function transactionUrl(
  route: '/expense' | '/mileage', businessId: string, year: string | number,
  transactionId: string, returnTo?: string,
): string {
  const url = new URL(`${appBase}${route}`, window.location.origin);
  url.search = new URLSearchParams({ biz: businessId, year: String(year), txn: transactionId }).toString();
  if (returnTo) url.searchParams.set('returnTo', returnTo);
  return url.toString();
}

/**
 * Maps common API error codes to user-friendly messages.
 */
export function friendlyError(err: unknown): string {
  if (err instanceof AuthError) return err.message;
  const msg = (err as Error)?.message ?? '';
  if (msg.includes('401')) return 'Session expired. Please sign in again.';
  if (msg.includes('403')) return 'Permission denied. Check Drive sharing.';
  return 'Network error. Try again.';
}
