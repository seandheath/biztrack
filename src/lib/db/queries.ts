/**
 * Typed query helpers and liveQuery wrappers for BizTrack IndexedDB.
 *
 * All component data access goes through these helpers — never raw db.* calls.
 *
 * liveQuery usage pattern in Svelte 5 components:
 *
 *   let rows = $state<Transaction[]>([]);
 *   $effect(() => {
 *     const sub = liveTransactions(businessId, year).subscribe({
 *       next: (r) => { rows = r; },
 *       error: console.error,
 *     });
 *     return () => sub.unsubscribe();
 *   });
 *
 * The $effect re-runs when businessId or year change (reactive dependencies),
 * cleaning up the old subscription and starting a new one automatically.
 */

import { liveQuery } from 'dexie';
import { db, type Transaction } from './dexie.js';

// ---------------------------------------------------------------------------
// One-shot queries (Promise-based)
// ---------------------------------------------------------------------------

/**
 * Returns all transactions for a business+year, optionally filtered by type.
 * Sorted by date descending.
 */
export async function queryTransactions(
  businessId: string,
  year: number,
  type?: 'expense' | 'mileage',
): Promise<Transaction[]> {
  const index = type ? '[businessId+type+year]' : '[businessId+year]';
  const key   = type ? [businessId, type, year] : [businessId, year];
  const rows  = await db.transactions.where(index).equals(key).toArray();
  // Sort descending by date (string comparison works for yyyy-mm-dd)
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Fetches a single transaction by UUID.
 */
export function getTransaction(id: string): Promise<Transaction | undefined> {
  return db.transactions.get(id);
}

/**
 * Returns the count of transactions with syncStatus === 'pending'.
 * Used to drive the sync badge in the UI.
 */
export function getPendingSyncCount(): Promise<number> {
  return db.transactions.where('syncStatus').equals('pending').count();
}

/**
 * Returns the count of transactions with syncStatus === 'conflict'.
 * Used to show a conflict resolution badge in settings.
 */
export function getConflictCount(): Promise<number> {
  return db.transactions.where('syncStatus').equals('conflict').count();
}

// ---------------------------------------------------------------------------
// liveQuery wrappers (Observable-based — reactive)
// ---------------------------------------------------------------------------

/**
 * Live-reactive query for transactions. Emits a new array whenever the
 * matching Dexie records change. Use inside a Svelte 5 $effect.
 */
export function liveTransactions(
  businessId: string,
  year: number,
  type?: 'expense' | 'mileage',
) {
  return liveQuery(async () => {
    const index = type ? '[businessId+type+year]' : '[businessId+year]';
    const key   = type ? [businessId, type, year] : [businessId, year];
    const rows  = await db.transactions.where(index).equals(key).toArray();
    return rows.sort((a, b) => b.date.localeCompare(a.date));
  });
}

/**
 * Live-reactive count of pending sync items. Emits on every write to syncQueue.
 * Suitable for a persistent header badge.
 */
export function livePendingCount() {
  return liveQuery(() =>
    db.transactions.where('syncStatus').equals('pending').count(),
  );
}

/**
 * Live-reactive count of conflicted transactions.
 */
export function liveConflictCount() {
  return liveQuery(() =>
    db.transactions.where('syncStatus').equals('conflict').count(),
  );
}

/**
 * Returns the most recent category used for a given vendor within a business.
 * Searches current year first, then walks back up to 5 years.
 * Returns undefined if no prior expense transaction exists for this vendor.
 */
export async function getLastCategoryByVendor(
  businessId: string,
  vendor: string,
): Promise<string | undefined> {
  const currentYear = new Date().getFullYear();
  for (let year = currentYear; year >= currentYear - 5; year--) {
    const rows = await db.transactions
      .where('[businessId+year]')
      .equals([businessId, year])
      .toArray();
    const match = rows
      .filter((r) => r.type === 'expense' && r.vendor === vendor && r.category)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (match?.category) return match.category;
  }
  return undefined;
}
