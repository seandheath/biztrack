/**
 * Google Sheets API v4 — high-level service layer for BizTrack.
 *
 * This module exposes only the operations needed by the sync engine
 * (services/sync.ts). Components must never import from here — they read
 * from Dexie via liveQuery and write via the sync engine's enqueue* API.
 *
 * Sheet structure: unchanged — per-business-per-year spreadsheets.
 *
 * Expense column order (A–J):
 *   A=date  B=vendor  C=description  D=amount  E=category
 *   F=paymentMethod  G=receiptDriveId  H=notes  I=submittedBy  J=id (UUID)
 *
 * Mileage column order (A–H):
 *   A=date  B=from  C=to  D=purpose  E=miles  F=irsRate  G=deduction  H=id (UUID)
 */

import { apiFetch } from '../auth.js';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

/** Column values as they appear in (or come from) the spreadsheet. */
export interface TransactionRow {
  id: string;             // UUID — Expenses col J, Mileage col H
  date: string;
  // Expense fields
  vendor?: string;
  description?: string;
  amount?: string;
  category?: string;
  paymentMethod?: string;
  receiptDriveId?: string;
  notes?: string;
  submittedBy?: string;
  // Mileage fields
  from?: string;
  to?: string;
  purpose?: string;
  miles?: string;
  irsRate?: string;
  deduction?: string;
}

type SheetName = 'Expenses' | 'Mileage';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function _throwSheetsError(response: Response, context: string): Promise<never> {
  let message = `Sheets ${context} failed (HTTP ${response.status})`;
  try {
    const body = await response.json();
    const err = body?.error;
    if (err?.message) message = `Sheets ${context}: ${err.message} (${response.status})`;
  } catch {
    // Body not JSON — use status-only message
  }
  throw new Error(message);
}

/** Converts a header string array to a Sheets API rowData values array. */
function _headerRowData(headers: string[]) {
  return headers.map((h) => ({ userEnteredValue: { stringValue: h } }));
}

/** Converts 1-based column index to letter (1→'A', 10→'J'). */
function _colLetter(n: number): string {
  return String.fromCharCode(64 + n);
}

/**
 * Module-level cache: "spreadsheetId::sheetName" → numeric sheetId.
 * Avoids re-fetching spreadsheet metadata on every delete.
 */
const _sheetTabIdCache = new Map<string, number>();

async function _getSheetTabId(spreadsheetId: string, sheetName: string): Promise<number> {
  const cacheKey = `${spreadsheetId}::${sheetName}`;
  if (_sheetTabIdCache.has(cacheKey)) return _sheetTabIdCache.get(cacheKey)!;

  const url = `${SHEETS_BASE}/${spreadsheetId}?fields=sheets.properties`;
  const response = await apiFetch(url);
  if (!response.ok) return _throwSheetsError(response, 'getSheetTabId');

  const data = await response.json();
  for (const sheet of data.sheets ?? []) {
    _sheetTabIdCache.set(
      `${spreadsheetId}::${sheet.properties.title}`,
      sheet.properties.sheetId,
    );
  }

  if (!_sheetTabIdCache.has(cacheKey)) {
    throw new Error(`Sheet tab "${sheetName}" not found in spreadsheet ${spreadsheetId}`);
  }
  return _sheetTabIdCache.get(cacheKey)!;
}

/** Serializes a TransactionRow to a flat cell-value array for the given tab. */
function _rowToValues(row: TransactionRow, sheetName: SheetName): (string | number)[] {
  if (sheetName === 'Expenses') {
    return [
      row.date         ?? '',
      row.vendor       ?? '',
      row.description  ?? '',
      row.amount       ?? '',
      row.category     ?? '',
      row.paymentMethod ?? '',
      row.receiptDriveId ?? '',
      row.notes        ?? '',
      row.submittedBy  ?? '',
      row.id,
    ];
  } else {
    // Mileage
    return [
      row.date       ?? '',
      row.from       ?? '',
      row.to         ?? '',
      row.purpose    ?? '',
      row.miles      ?? '',
      row.irsRate    ?? '',
      row.deduction  ?? '',
      row.id,
    ];
  }
}

/** Parses a flat cell-value array from the sheet into a TransactionRow. */
function _valuesToRow(values: string[], sheetName: SheetName): TransactionRow {
  const s = (v: string | undefined) => v ?? '';
  if (sheetName === 'Expenses') {
    return {
      date:           s(values[0]),
      vendor:         s(values[1]),
      description:    s(values[2]),
      amount:         s(values[3]),
      category:       s(values[4]),
      paymentMethod:  s(values[5]),
      receiptDriveId: s(values[6]),
      notes:          s(values[7]),
      submittedBy:    s(values[8]),
      id:             s(values[9]),
    };
  } else {
    // Mileage
    return {
      date:      s(values[0]),
      from:      s(values[1]),
      to:        s(values[2]),
      purpose:   s(values[3]),
      miles:     s(values[4]),
      irsRate:   s(values[5]),
      deduction: s(values[6]),
      id:        s(values[7]),
    };
  }
}

/** Reads all values from the UUID column (J for Expenses, H for Mileage). */
async function _readIdColumn(
  spreadsheetId: string,
  sheetName: SheetName,
): Promise<string[]> {
  const col = sheetName === 'Expenses' ? 'J' : 'H';
  const range = encodeURIComponent(`${sheetName}!${col}:${col}`);
  const url = `${SHEETS_BASE}/${spreadsheetId}/values/${range}`;
  const response = await apiFetch(url);
  if (!response.ok) return _throwSheetsError(response, 'readIdColumn');
  const data = await response.json();
  const rows: string[][] = data.values ?? [];
  // rows[0] is the header — skip it
  return rows.slice(1).map((r) => r[0] ?? '');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a new expense tracking spreadsheet with Expenses and Mileage tabs,
 * each with a bold/frozen header row.
 *
 * NOTE: Spreadsheet is created in Drive root. The caller is responsible for
 * calling moveFile() (from services/drive.ts) to relocate it.
 */
export async function initSpreadsheet(title: string): Promise<{
  spreadsheetId: string;
  expensesSheetId: number;
  mileageSheetId: number;
}> {
  const EXPENSE_HEADERS = ['Date','Vendor/Payee','Description','Amount','Category','Payment Method','Receipt','Notes','Submitted By','ID'];
  const MILEAGE_HEADERS = ['Date','From','To','Purpose/Description','Miles','IRS Standard Rate','Deduction Amount','ID'];

  const createResponse = await apiFetch(SHEETS_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: { title },
      sheets: [
        {
          properties: { title: 'Expenses' },
          data: [{ startRow: 0, startColumn: 0, rowData: [{ values: _headerRowData(EXPENSE_HEADERS) }] }],
        },
        {
          properties: { title: 'Mileage' },
          data: [{ startRow: 0, startColumn: 0, rowData: [{ values: _headerRowData(MILEAGE_HEADERS) }] }],
        },
      ],
    }),
  });

  if (!createResponse.ok) return _throwSheetsError(createResponse, 'initSpreadsheet');
  const created = await createResponse.json();

  const spreadsheetId  = created.spreadsheetId as string;
  const expensesSheetId = created.sheets[0].properties.sheetId as number;
  const mileageSheetId  = created.sheets[1].properties.sheetId as number;

  // Populate the tab ID cache immediately to avoid a redundant metadata fetch later
  _sheetTabIdCache.set(`${spreadsheetId}::Expenses`, expensesSheetId);
  _sheetTabIdCache.set(`${spreadsheetId}::Mileage`,  mileageSheetId);

  // Bold and freeze row 1 on both tabs
  const batchResponse = await apiFetch(`${SHEETS_BASE}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        _boldRowRequest(expensesSheetId, EXPENSE_HEADERS.length),
        _boldRowRequest(mileageSheetId,  MILEAGE_HEADERS.length),
        _freezeRowRequest(expensesSheetId),
        _freezeRowRequest(mileageSheetId),
      ],
    }),
  });

  if (!batchResponse.ok) return _throwSheetsError(batchResponse, 'initSpreadsheet (format)');

  return { spreadsheetId, expensesSheetId, mileageSheetId };
}

function _boldRowRequest(sheetId: number, columnCount: number) {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: columnCount },
      cell: { userEnteredFormat: { textFormat: { bold: true } } },
      fields: 'userEnteredFormat.textFormat.bold',
    },
  };
}

function _freezeRowRequest(sheetId: number) {
  return {
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
      fields: 'gridProperties.frozenRowCount',
    },
  };
}

/**
 * Appends multiple transaction rows to the sheet in a single API call.
 *
 * Uses USER_ENTERED + INSERT_ROWS. Batches all rows in one request to stay
 * within the 60 writes/min per-user Sheets API limit.
 */
export async function pushTransactions(
  spreadsheetId: string,
  sheetName: SheetName,
  rows: TransactionRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const range = encodeURIComponent(`${sheetName}!A1`);
  const url =
    `${SHEETS_BASE}/${spreadsheetId}/values/${range}:append` +
    `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const response = await apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: rows.map((r) => _rowToValues(r, sheetName)) }),
  });

  if (!response.ok) return _throwSheetsError(response, 'pushTransactions');
}

/**
 * Updates a single row identified by UUID in-place.
 *
 * Re-scans the UUID column immediately before writing to guard against
 * concurrent row shifts (another client inserted above this row).
 */
export async function updateByUUID(
  spreadsheetId: string,
  sheetName: SheetName,
  row: TransactionRow,
): Promise<void> {
  const ids = await _readIdColumn(spreadsheetId, sheetName);
  const idx = ids.findIndex((v) => v === row.id);
  if (idx === -1) throw new Error(`Row with UUID ${row.id} not found in ${sheetName}`);
  const rowNum = idx + 2; // row 1 is header; data index 0 → sheet row 2

  const values = _rowToValues(row, sheetName);
  const endCol = _colLetter(values.length);
  const range  = encodeURIComponent(`${sheetName}!A${rowNum}:${endCol}${rowNum}`);
  const url    = `${SHEETS_BASE}/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`;

  const response = await apiFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [values] }),
  });

  if (!response.ok) return _throwSheetsError(response, 'updateByUUID');
}

/**
 * Hard-deletes a row identified by UUID.
 *
 * Re-scans the UUID column immediately before issuing the deleteDimension
 * request to avoid deleting the wrong row if rows have shifted since the
 * transaction was first queued.
 */
export async function deleteByUUID(
  spreadsheetId: string,
  sheetName: SheetName,
  uuid: string,
): Promise<void> {
  // Re-scan to get current row number — atomic within this function call
  const ids = await _readIdColumn(spreadsheetId, sheetName);
  const idx = ids.findIndex((v) => v === uuid);
  if (idx === -1) {
    // Row already gone — treat as success (idempotent)
    return;
  }
  const rowNum    = idx + 2;
  const sheetId   = await _getSheetTabId(spreadsheetId, sheetName);
  const startIndex = rowNum - 1; // 0-based

  const response = await apiFetch(`${SHEETS_BASE}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        deleteDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex, endIndex: startIndex + 1 },
        },
      }],
    }),
  });

  if (!response.ok) return _throwSheetsError(response, 'deleteByUUID');
}

/**
 * Reads all data rows from a sheet tab, optionally filtered by a cutoff date.
 *
 * Returns rows with a non-empty UUID field only. The `since` parameter filters
 * by the row's date column (A) — useful for delta pulls. Pass null for a full
 * pull on first launch.
 *
 * NOTE: Sheets has no server-side timestamp filtering; all rows are always
 * fetched and filtered client-side. For typical usage (hundreds of rows/year)
 * this is fast enough. Row dates are yyyy-mm-dd strings — lexicographic
 * comparison works correctly.
 */
export async function pullTransactions(
  spreadsheetId: string,
  sheetName: SheetName,
  since: Date | null,
): Promise<TransactionRow[]> {
  const range    = encodeURIComponent(`${sheetName}!A:Z`);
  const url      = `${SHEETS_BASE}/${spreadsheetId}/values/${range}`;
  const response = await apiFetch(url);
  if (!response.ok) return _throwSheetsError(response, 'pullTransactions');

  const data    = await response.json();
  const allRows: string[][] = data.values ?? [];
  const dataRows = allRows.slice(1); // skip header

  const sinceStr = since ? since.toISOString().slice(0, 10) : null;

  return dataRows
    .map((cells) => {
      const padded = Array.from({ length: 10 }, (_, i) => String(cells[i] ?? ''));
      return _valuesToRow(padded, sheetName);
    })
    .filter((row) => {
      if (!row.id) return false; // skip rows without UUID
      if (sinceStr && row.date < sinceStr) return false;
      return true;
    });
}
