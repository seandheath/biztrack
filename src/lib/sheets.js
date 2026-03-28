/**
 * Google Sheets API v4 service layer.
 *
 * All functions use apiFetch() from auth.js — Bearer header injection and
 * 401/network error handling are handled there.
 *
 * The drive.file scope covers all Sheets operations on app-created spreadsheets.
 * Spreadsheets are created in Drive root — callers must call moveFile() from
 * drive.js to place them in the correct year folder.
 */

import { apiFetch } from './auth.js';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

// Column headers for each tab — order must match appendRow() call sites.
const EXPENSE_HEADERS = [
  'Date',
  'Vendor/Payee',
  'Description',
  'Amount',
  'Category',
  'Payment Method',
  'Receipt',
  'Notes',
  'Submitted By',
];

const MILEAGE_HEADERS = [
  'Date',
  'From',
  'To',
  'Purpose/Description',
  'Miles',
  'IRS Standard Rate',
  'Deduction Amount',
];

/**
 * Throws a descriptive error from a non-ok Sheets API response.
 * @param {Response} response
 * @param {string} context
 */
async function _throwSheetsError(response, context) {
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

/**
 * Converts a header string array into a Sheets API rowData values array.
 * @param {string[]} headers
 * @returns {Object[]}
 */
function _headerRowData(headers) {
  return headers.map((h) => ({ userEnteredValue: { stringValue: h } }));
}

// ---------------------------------------------------------------------------
// Step 4.1 — Create spreadsheet
// ---------------------------------------------------------------------------

/**
 * Creates a new expense tracking spreadsheet with two tabs:
 * "Expenses" and "Mileage", each with a header row.
 * Row 1 is bolded and frozen on both tabs via a follow-up batchUpdate.
 *
 * NOTE: The spreadsheet is created in Drive root. The caller is responsible
 * for calling moveFile() (from drive.js) to relocate it to the year folder.
 *
 * @param {string} title - Spreadsheet title, e.g. "MyBiz 2026"
 * @returns {Promise<{spreadsheetId: string}>}
 */
export async function createExpenseSheet(title) {
  // Step 1: Create spreadsheet with both sheets and header rows in one request.
  const createResponse = await apiFetch(SHEETS_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: { title },
      sheets: [
        {
          properties: { title: 'Expenses' },
          data: [
            {
              startRow: 0,
              startColumn: 0,
              rowData: [{ values: _headerRowData(EXPENSE_HEADERS) }],
            },
          ],
        },
        {
          properties: { title: 'Mileage' },
          data: [
            {
              startRow: 0,
              startColumn: 0,
              rowData: [{ values: _headerRowData(MILEAGE_HEADERS) }],
            },
          ],
        },
      ],
    }),
  });

  if (!createResponse.ok) await _throwSheetsError(createResponse, 'createExpenseSheet');
  const created = await createResponse.json();

  const spreadsheetId = created.spreadsheetId;
  // Sheets API returns the sheet objects with their assigned numeric IDs
  const expensesSheetId = created.sheets[0].properties.sheetId;
  const mileageSheetId = created.sheets[1].properties.sheetId;

  // Step 2: Bold and freeze row 1 on both sheets.
  const batchResponse = await apiFetch(`${SHEETS_BASE}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        // Bold header row on Expenses tab
        _boldRowRequest(expensesSheetId, EXPENSE_HEADERS.length),
        // Bold header row on Mileage tab
        _boldRowRequest(mileageSheetId, MILEAGE_HEADERS.length),
        // Freeze row 1 on Expenses tab
        _freezeRowRequest(expensesSheetId),
        // Freeze row 1 on Mileage tab
        _freezeRowRequest(mileageSheetId),
      ],
    }),
  });

  if (!batchResponse.ok) await _throwSheetsError(batchResponse, 'createExpenseSheet (format)');

  return { spreadsheetId };
}

/**
 * Builds a repeatCell request to bold all cells in row 0 of a sheet.
 * @param {number} sheetId
 * @param {number} columnCount - Number of header columns to cover
 * @returns {Object} Sheets API request object
 */
function _boldRowRequest(sheetId, columnCount) {
  return {
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: 0,
        endColumnIndex: columnCount,
      },
      cell: {
        userEnteredFormat: {
          textFormat: { bold: true },
        },
      },
      fields: 'userEnteredFormat.textFormat.bold',
    },
  };
}

/**
 * Builds an updateSheetProperties request to freeze row 1 of a sheet.
 * @param {number} sheetId
 * @returns {Object} Sheets API request object
 */
function _freezeRowRequest(sheetId) {
  return {
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: { frozenRowCount: 1 },
      },
      fields: 'gridProperties.frozenRowCount',
    },
  };
}

// ---------------------------------------------------------------------------
// Step 4.2 — Append row and read column
// ---------------------------------------------------------------------------

/**
 * Appends a row of values to the specified sheet tab.
 *
 * Uses USER_ENTERED so Sheets interprets dates and numbers correctly.
 * Uses INSERT_ROWS to append after the last existing row.
 *
 * @param {string} spreadsheetId
 * @param {string} sheetName - "Expenses" or "Mileage"
 * @param {Array<string|number>} values - Flat array matching the tab's column order
 * @returns {Promise<void>}
 */
export async function appendRow(spreadsheetId, sheetName, values) {
  // Encode sheet name for use in the range notation (handles spaces, special chars)
  const range = encodeURIComponent(`${sheetName}!A1`);
  const url =
    `${SHEETS_BASE}/${spreadsheetId}/values/${range}:append` +
    `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const response = await apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [values] }),
  });

  if (!response.ok) await _throwSheetsError(response, 'appendRow');
}

/**
 * Reads all non-empty values from a single column in the specified sheet.
 * Skips the header row (index 0).
 *
 * Used to build the vendor autocomplete cache (column B of Expenses).
 *
 * @param {string} spreadsheetId
 * @param {string} sheetName - "Expenses" or "Mileage"
 * @param {string} column - Single letter column, e.g. "B"
 * @returns {Promise<string[]>} Flat array of non-empty string values
 */
export async function readColumn(spreadsheetId, sheetName, column) {
  const range = encodeURIComponent(`${sheetName}!${column}:${column}`);
  const url = `${SHEETS_BASE}/${spreadsheetId}/values/${range}`;

  const response = await apiFetch(url);
  if (!response.ok) await _throwSheetsError(response, 'readColumn');

  const data = await response.json();
  const rows = data.values ?? [];

  // rows[0] is the header — skip it. Each row is a single-element array.
  return rows
    .slice(1)
    .map((row) => row[0])
    .filter((v) => v !== undefined && v !== '');
}

// ---------------------------------------------------------------------------
// History: readRows, updateRow, deleteRow
// ---------------------------------------------------------------------------

/**
 * Converts a 1-based column index to a column letter (1→'A', 8→'H').
 * @param {number} n
 * @returns {string}
 */
function _colLetter(n) {
  return String.fromCharCode(64 + n);
}

/**
 * Module-level cache: "spreadsheetId::sheetName" → numeric sheetId.
 * Avoids re-fetching spreadsheet metadata on every delete.
 * @type {Map<string, number>}
 */
const _sheetTabIdCache = new Map();

/**
 * Returns the numeric Sheets tab ID for a named tab within a spreadsheet.
 * Required by the deleteDimension batchUpdate request.
 * Results are cached for the lifetime of the page session.
 *
 * @param {string} spreadsheetId
 * @param {string} sheetName
 * @returns {Promise<number>}
 */
async function _getSheetTabId(spreadsheetId, sheetName) {
  const cacheKey = `${spreadsheetId}::${sheetName}`;
  if (_sheetTabIdCache.has(cacheKey)) return _sheetTabIdCache.get(cacheKey);

  const url = `${SHEETS_BASE}/${spreadsheetId}?fields=sheets.properties`;
  const response = await apiFetch(url);
  if (!response.ok) await _throwSheetsError(response, 'getSheetTabId');

  const data = await response.json();
  for (const sheet of data.sheets ?? []) {
    const key = `${spreadsheetId}::${sheet.properties.title}`;
    _sheetTabIdCache.set(key, sheet.properties.sheetId);
  }

  if (!_sheetTabIdCache.has(cacheKey)) {
    throw new Error(`Sheet tab "${sheetName}" not found in spreadsheet ${spreadsheetId}`);
  }
  return _sheetTabIdCache.get(cacheKey);
}

/**
 * Reads all data rows from the specified sheet tab, skipping the header.
 *
 * @param {string} spreadsheetId
 * @param {string} sheetName - "Expenses" or "Mileage"
 * @returns {Promise<{ rows: string[][], rowNums: number[] }>}
 *   rows[i] is a flat string array of cell values for data row i.
 *   rowNums[i] is the 1-based sheet row number (i + 2, since row 1 is the header).
 *   Short rows are padded with empty strings to match the expected column count.
 */
export async function readRows(spreadsheetId, sheetName) {
  const range = encodeURIComponent(`${sheetName}!A:Z`);
  const url = `${SHEETS_BASE}/${spreadsheetId}/values/${range}`;

  const response = await apiFetch(url);
  if (!response.ok) await _throwSheetsError(response, 'readRows');

  const data = await response.json();
  const all = data.values ?? [];

  // Row 0 is the header — skip it. Data starts at index 1.
  const dataRows = all.slice(1);
  const rows = dataRows.map((row) => row.map((cell) => String(cell ?? '')));
  // rowNum is 1-based; data row i corresponds to sheet row i + 2
  const rowNums = dataRows.map((_, i) => i + 2);

  return { rows, rowNums };
}

/**
 * Overwrites a single data row in-place.
 *
 * @param {string} spreadsheetId
 * @param {string} sheetName - "Expenses" or "Mileage"
 * @param {number} rowNum - 1-based sheet row number (as returned by readRows)
 * @param {Array<string|number>} values - Full row values in column order
 * @returns {Promise<void>}
 */
export async function updateRow(spreadsheetId, sheetName, rowNum, values) {
  const endCol = _colLetter(values.length);
  const range = encodeURIComponent(`${sheetName}!A${rowNum}:${endCol}${rowNum}`);
  const url =
    `${SHEETS_BASE}/${spreadsheetId}/values/${range}` +
    `?valueInputOption=USER_ENTERED`;

  const response = await apiFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [values] }),
  });

  if (!response.ok) await _throwSheetsError(response, 'updateRow');
}

/**
 * Hard-deletes a row from the sheet. All rows below shift up by one.
 * Uses the batchUpdate deleteDimension request, which requires the numeric
 * sheet tab ID (not the name) — resolved via _getSheetTabId.
 *
 * @param {string} spreadsheetId
 * @param {string} sheetName - "Expenses" or "Mileage"
 * @param {number} rowNum - 1-based sheet row number (as returned by readRows)
 * @returns {Promise<void>}
 */
export async function deleteRow(spreadsheetId, sheetName, rowNum) {
  const sheetId = await _getSheetTabId(spreadsheetId, sheetName);

  // DeleteDimensionRequest uses 0-based half-open [startIndex, endIndex).
  // Sheet row 1 = index 0, row 2 = index 1, etc.
  const startIndex = rowNum - 1;

  const response = await apiFetch(`${SHEETS_BASE}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex,
            endIndex: startIndex + 1,
          },
        },
      }],
    }),
  });

  if (!response.ok) await _throwSheetsError(response, 'deleteRow');
}
