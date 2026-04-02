/**
 * Local storage backend for device-only mode.
 *
 * Mirrors the sheets.ts + drive.ts API surface using localStorage as the
 * sole persistence layer. All functions are async for interface compatibility
 * with the Google-backed equivalents, even though reads/writes are synchronous.
 *
 * localStorage key scheme:
 *   bt_local_businesses                          — Business[]
 *   bt_local_config_{bizId}                      — BusinessConfig
 *   bt_local_txn_{bizId}_{year}_{Expenses|Mileage} — TransactionRow[]
 *   bt_local_receipt_names_{bizId}_{year}        — string[]
 *   bt_local_receipts_{bizId}_{year}             — Record<filename, dataURL>
 *   bt_local_profile                             — ProfileData
 */

import * as storage from '../storage.js';
import { DEFAULT_CATEGORIES } from '../constants.js';
import type { Business, BusinessConfig, MileageFavorite, ProfileData } from '../types.js';
import type { TransactionRow } from './sheets.js';

type SheetName = 'Expenses' | 'Mileage';

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

function txnKey(bizId: string, year: number, sheet: SheetName): string {
  return `bt_local_txn_${bizId}_${year}_${sheet}`;
}

function configKey(bizId: string): string {
  return `bt_local_config_${bizId}`;
}

function receiptNamesKey(bizId: string, year: number): string {
  return `bt_local_receipt_names_${bizId}_${year}`;
}

function receiptsKey(bizId: string, year: number): string {
  return `bt_local_receipts_${bizId}_${year}`;
}

const BUSINESSES_KEY = 'bt_local_businesses';
const PROFILE_KEY = 'bt_local_profile';

// ---------------------------------------------------------------------------
// Transaction CRUD
// ---------------------------------------------------------------------------

/** Appends transaction rows to the local store. */
export async function localPushTransactions(
  bizId: string,
  year: number,
  sheetName: SheetName,
  rows: TransactionRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const key = txnKey(bizId, year, sheetName);
  const existing = storage.get<TransactionRow[]>(key, []);
  storage.set(key, [...existing, ...rows]);
}

/** Reads all transaction rows from the local store. */
export async function localPullTransactions(
  bizId: string,
  year: number,
  sheetName: SheetName,
): Promise<TransactionRow[]> {
  return storage.get<TransactionRow[]>(txnKey(bizId, year, sheetName), []);
}

/** Updates a single row by UUID. Throws if not found. */
export async function localUpdateByUUID(
  bizId: string,
  year: number,
  sheetName: SheetName,
  row: TransactionRow,
): Promise<void> {
  const key = txnKey(bizId, year, sheetName);
  const rows = storage.get<TransactionRow[]>(key, []);
  const idx = rows.findIndex((r) => r.id === row.id);
  if (idx === -1) throw new Error(`Row with UUID ${row.id} not found in local ${sheetName}`);
  rows[idx] = row;
  storage.set(key, rows);
}

/** Deletes a row by UUID. No-op if not found (idempotent). */
export async function localDeleteByUUID(
  bizId: string,
  year: number,
  sheetName: SheetName,
  uuid: string,
): Promise<void> {
  const key = txnKey(bizId, year, sheetName);
  const rows = storage.get<TransactionRow[]>(key, []);
  storage.set(key, rows.filter((r) => r.id !== uuid));
}

/** Sets the category column for multiple expense rows by UUID. */
export async function localBatchSetCategory(
  bizId: string,
  year: number,
  uuids: string[],
  category: string,
): Promise<void> {
  if (uuids.length === 0) return;
  const key = txnKey(bizId, year, 'Expenses');
  const rows = storage.get<TransactionRow[]>(key, []);
  const uuidSet = new Set(uuids);
  for (const row of rows) {
    if (uuidSet.has(row.id)) row.category = category;
  }
  storage.set(key, rows);
}

// ---------------------------------------------------------------------------
// Receipt operations
// ---------------------------------------------------------------------------

/**
 * Stores a receipt blob as a base64 data URL in localStorage.
 * Returns the filename for reference in the transaction row.
 */
export async function localUploadReceipt(
  bizId: string,
  year: number,
  filename: string,
  blob: Blob,
): Promise<string> {
  // Convert blob to data URL
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read receipt blob'));
    reader.readAsDataURL(blob);
  });

  // Store the data URL
  const rKey = receiptsKey(bizId, year);
  const existing = storage.get<Record<string, string>>(rKey, {});
  existing[filename] = dataUrl;
  storage.set(rKey, existing);

  // Update the names list
  const nKey = receiptNamesKey(bizId, year);
  const names = storage.get<string[]>(nKey, []);
  if (!names.includes(filename)) {
    names.push(filename);
    storage.set(nKey, names);
  }

  return filename;
}

/** Returns all receipt filenames for a business+year. */
export async function localListReceiptNames(
  bizId: string,
  year: number,
): Promise<string[]> {
  return storage.get<string[]>(receiptNamesKey(bizId, year), []);
}

/** Returns the data URL for a receipt, or null if not found. */
export function localGetReceiptUrl(
  bizId: string,
  year: number,
  filename: string,
): string | null {
  const data = storage.get<Record<string, string>>(receiptsKey(bizId, year), {});
  return data[filename] ?? null;
}

// ---------------------------------------------------------------------------
// Business / config operations
// ---------------------------------------------------------------------------

/** Creates a new local-only business with default config. */
export async function localSetupBusiness(
  name: string,
): Promise<{ business: Business; config: BusinessConfig }> {
  const id = crypto.randomUUID();

  const config: BusinessConfig = {
    id,
    name,
    mileage_favorites: [],
    categories: [...DEFAULT_CATEGORIES],
  };

  const business: Business = {
    id,
    name,
    folderId: `local_${id}`,
    configFileId: `local_config_${id}`,
    yearFolders: {},
    sheetIds: {},
    receiptFolderIds: {},
  };

  // Persist config
  storage.set(configKey(id), config);

  // Add to businesses list
  const businesses = storage.get<Business[]>(BUSINESSES_KEY, []);
  businesses.push(business);
  storage.set(BUSINESSES_KEY, businesses);

  return { business, config };
}

/**
 * Ensures the year structure exists for a local business.
 * Adds synthetic IDs for the year's sheet and receipts folder.
 * Returns the business unchanged if the year already exists.
 */
export async function localEnsureYearFolder(
  business: Business,
  year: number,
): Promise<Business> {
  if (year < 1000 || year > 9999) return business;
  if (business.yearFolders[year] && business.sheetIds[year]) return business;

  const updated: Business = {
    ...business,
    yearFolders:      { ...business.yearFolders,      [year]: `local_year_${year}` },
    sheetIds:         { ...business.sheetIds,         [year]: `local_sheet_${business.id}_${year}` },
    receiptFolderIds: { ...business.receiptFolderIds, [year]: `local_receipts_${business.id}_${year}` },
  };

  // Persist the updated business in the local businesses list
  _updateLocalBusiness(updated);

  return updated;
}

/** Loads a business config from localStorage. */
export async function localLoadConfig(bizId: string): Promise<BusinessConfig | null> {
  return storage.get<BusinessConfig | null>(configKey(bizId), null);
}

/** Saves a business config to localStorage. */
export async function localSaveConfig(bizId: string, config: BusinessConfig): Promise<void> {
  storage.set(configKey(bizId), config);
}

// ---------------------------------------------------------------------------
// Profile operations
// ---------------------------------------------------------------------------

/** Loads the local profile (businesses list + favorites + drivers). */
export async function localLoadProfile(): Promise<ProfileData | null> {
  return storage.get<ProfileData | null>(PROFILE_KEY, null);
}

/** Saves the local profile. */
export async function localSaveProfile(
  businesses: Business[],
  mileageFavs: Record<string, MileageFavorite[]>,
  defDrivers: Record<string, string>,
): Promise<void> {
  const profile: ProfileData = {
    businesses: businesses.map((b) => ({ name: b.name, folderId: b.folderId })),
    mileage_favorites: mileageFavs,
    default_drivers: defDrivers,
  };
  storage.set(PROFILE_KEY, profile);
  // Also persist full business objects
  storage.set(BUSINESSES_KEY, businesses);
}

/** Returns all locally stored businesses. */
export function localGetBusinesses(): Business[] {
  return storage.get<Business[]>(BUSINESSES_KEY, []);
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

/** Column headers matching the Google Sheets layout. */
const EXPENSE_HEADERS = ['Date', 'Vendor/Payee', 'Description', 'Amount', 'Category', 'Payment Method', 'Receipt', 'Notes', 'Submitted By', 'ID'];
const MILEAGE_HEADERS = ['Date', 'From', 'To', 'Purpose/Description', 'Miles', 'Saved By', 'ID', 'Driver'];

/** Escapes a CSV field value per RFC 4180. */
function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Serializes a TransactionRow to a CSV row string. */
function rowToCSV(row: TransactionRow, sheetName: SheetName): string {
  const fields = sheetName === 'Expenses'
    ? [row.date, row.vendor, row.description, row.amount, row.category, row.paymentMethod, row.receipt, row.notes, row.submittedBy, row.id]
    : [row.date, row.from, row.to, row.purpose, row.miles, row.savedBy, row.id, row.driver];
  return fields.map((f) => csvEscape(f ?? '')).join(',');
}

/**
 * Generates a CSV string for all transactions of a given type.
 * Includes a header row matching the Google Sheets column layout.
 */
export async function exportTransactionsCSV(
  bizId: string,
  year: number,
  sheetName: SheetName,
): Promise<string> {
  const rows = await localPullTransactions(bizId, year, sheetName);
  const headers = sheetName === 'Expenses' ? EXPENSE_HEADERS : MILEAGE_HEADERS;
  const lines = [
    headers.map(csvEscape).join(','),
    ...rows.map((r) => rowToCSV(r, sheetName)),
  ];
  return lines.join('\n');
}

/**
 * Triggers a browser download of a Blob.
 * Creates a temporary <a> element to initiate the download.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Convenience wrapper for CSV string downloads. */
export function downloadCSV(csv: string, filename: string): void {
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), filename);
}

/**
 * Exports all data for a business+year as a ZIP containing:
 *   - Expenses.csv
 *   - Mileage.csv
 *   - Receipts/ (folder with receipt images/PDFs)
 *
 * Uses fflate for ZIP creation (~8KB gzipped).
 */
export async function exportZip(
  bizId: string,
  year: number,
  businessName: string,
): Promise<void> {
  const { zipSync, strToU8 } = await import('fflate');

  const files: Record<string, Uint8Array> = {};

  // Add CSV files
  const expCSV = await exportTransactionsCSV(bizId, year, 'Expenses');
  files['Expenses.csv'] = strToU8(expCSV);

  const milCSV = await exportTransactionsCSV(bizId, year, 'Mileage');
  files['Mileage.csv'] = strToU8(milCSV);

  // Add receipt files — convert data URLs back to binary
  const receiptData = storage.get<Record<string, string>>(receiptsKey(bizId, year), {});
  for (const [filename, dataUrl] of Object.entries(receiptData)) {
    try {
      const resp = await fetch(dataUrl);
      const buf = await resp.arrayBuffer();
      files[`Receipts/${filename}`] = new Uint8Array(buf);
    } catch {
      // Skip unreadable receipts
    }
  }

  const zipped = zipSync(files);
  const safeName = businessName.replace(/[^a-zA-Z0-9_-]/g, '_');
  downloadBlob(new Blob([zipped as unknown as BlobPart], { type: 'application/zip' }), `${year}_${safeName}.zip`);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Updates a business in the local businesses list by ID. */
function _updateLocalBusiness(updated: Business): void {
  const list = storage.get<Business[]>(BUSINESSES_KEY, []);
  const idx = list.findIndex((b) => b.id === updated.id);
  if (idx >= 0) {
    list[idx] = updated;
  } else {
    list.push(updated);
  }
  storage.set(BUSINESSES_KEY, list);
}
