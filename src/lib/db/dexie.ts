/**
 * BizTrack IndexedDB schema via Dexie.js.
 *
 * Architecture: IndexedDB is the single source of truth for all transaction
 * data on the client. The sync engine (services/sync.ts) drains the outbox
 * queue to Google Sheets asynchronously. Components subscribe to liveQuery
 * observables and never call Sheets/Drive APIs directly.
 *
 * Versioning notes:
 *   v1 — transactions + syncQueue (current)
 *   v2 (stub) — trips, categories, entities (not yet implemented)
 */

import Dexie, { type Table } from 'dexie';

// ---------------------------------------------------------------------------
// Sync status
// ---------------------------------------------------------------------------

export type SyncStatus = 'pending' | 'synced' | 'conflict' | 'error';

// ---------------------------------------------------------------------------
// Table row types
// ---------------------------------------------------------------------------

/**
 * A single expense or mileage record. Maps to one row in the Google Sheet.
 * The `id` field is the UUID stored in column J (Expenses) or column H (Mileage).
 */
export interface Transaction {
  id: string;               // crypto.randomUUID() — the sheet row UUID
  businessId: string;       // matches business.id in the store
  type: 'expense' | 'mileage';
  year: number;             // denormalized from date — enables compound index queries

  date: string;             // ISO date string yyyy-mm-dd

  // Expense-specific fields (undefined for mileage rows)
  vendor?: string;
  description?: string;
  amount?: number;
  category?: string;
  paymentMethod?: string;
  receiptDriveId?: string;  // Google Drive file ID (not filename)
  notes?: string;
  submittedBy?: string;

  // Mileage-specific fields (undefined for expense rows)
  from?: string;
  to?: string;
  miles?: number;
  irsRate?: number;
  deduction?: number;
  purpose?: string;

  // Sync envelope — managed by sync engine, never set by UI code directly
  createdAt: number;        // Date.now() at local creation
  updatedAt: number;        // Date.now() at last local write
  syncStatus: SyncStatus;
  syncError?: string;       // last error message when syncStatus === 'error'
}

/**
 * Outbox entry. One entry per create/update/delete operation that has not
 * yet been flushed to Google Sheets. Consumed and removed by flushQueue().
 */
export interface SyncQueueEntry {
  id?: number;              // auto-increment primary key
  entityType: 'transaction';
  entityId: string;         // Transaction.id
  operation: 'create' | 'update' | 'delete';
  data: Partial<Transaction> | null;  // null for delete ops
  businessId: string;
  year: number;
  timestamp: number;        // Date.now() when enqueued
  retryCount: number;
  syncStatus: SyncStatus;
  lastError?: string;
}

// ---------------------------------------------------------------------------
// Database class
// ---------------------------------------------------------------------------

export class BizTrackDB extends Dexie {
  transactions!: Table<Transaction, string>;
  syncQueue!: Table<SyncQueueEntry, number>;

  constructor() {
    super('biztrack');

    this.version(1).stores({
      // Compound indexes support the most common query shapes:
      //   [businessId+year]        → home page, history page
      //   [businessId+type+year]   → filtered history (expenses-only, mileage-only)
      transactions: 'id, businessId, [businessId+year], [businessId+type+year], date, syncStatus',
      syncQueue:    '++id, entityId, syncStatus, timestamp, businessId',
    });

    // v2 stub — trips, categories, entities deferred until data model is defined
    // this.version(2).stores({
    //   transactions: '...',  // include prior indexes
    //   syncQueue: '++id, ...',
    //   trips: 'id, businessId, syncStatus',
    //   categories: 'id, businessId',
    //   entities: 'id, businessId',
    // });
  }
}

export const db = new BizTrackDB();
