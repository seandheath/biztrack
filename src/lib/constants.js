/**
 * App-wide constants for BizTrack.
 *
 * Credentials are Vite env vars — inlined at build time into the JS bundle.
 * Values live in .env locally and in GitHub Actions repository secrets for CI.
 * See .env.example for required variable names.
 */

// ---------------------------------------------------------------------------
// Google credentials
// ---------------------------------------------------------------------------

/** @type {string} OAuth 2.0 client ID from Google Cloud Console */
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

/**
 * API key restricted to Google Picker API.
 * Public by design (spec §9.3) — kept out of source control via .env.
 * @type {string}
 */
export const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;

/**
 * Google Cloud project number (numeric string), required by the Picker API.
 * @type {string}
 */
export const GOOGLE_APP_ID = import.meta.env.VITE_GOOGLE_APP_ID;

/**
 * Drive OAuth scopes:
 *   drive.file            — create/read/write files the app creates (expenses, receipts, config)
 *   drive.metadata.readonly — list all user folders so the custom folder browser can navigate
 *                             beyond app-created folders (required for "Select Existing Folder")
 */
export const DRIVE_SCOPE =
  'https://www.googleapis.com/auth/drive.file ' +
  'https://www.googleapis.com/auth/drive.metadata.readonly';

// ---------------------------------------------------------------------------
// Payment methods
// ---------------------------------------------------------------------------

/** Default payment method — always present, cannot be deleted */
export const DEFAULT_PAYMENT_METHODS = ['Cash'];

// ---------------------------------------------------------------------------
// IRS standard mileage rates
// ---------------------------------------------------------------------------

/**
 * IRS standard mileage rates by year (USD per mile).
 * Update 2026 when the IRS announces the rate.
 * @type {Record<number, number>}
 */
export const IRS_RATES = {
  2024: 0.67,
  2025: 0.70,
  2026: 0.70,
};

// ---------------------------------------------------------------------------
// QuickBooks expense categories
// ---------------------------------------------------------------------------

/**
 * Standard QuickBooks category list for Schedule C deductions.
 * Fixed for v1 — no user customization.
 * @type {string[]}
 */
export const QUICKBOOKS_CATEGORIES = [
  'Advertising',
  'Car & Truck Expenses',
  'Commissions & Fees',
  'Contract Labor',
  'Depreciation',
  'Employee Benefits',
  'Insurance',
  'Interest (Mortgage)',
  'Interest (Other)',
  'Legal & Professional Services',
  'Office Expenses',
  'Pension & Profit Sharing',
  'Rent or Lease (Vehicles/Machinery/Equipment)',
  'Rent or Lease (Other Business Property)',
  'Repairs & Maintenance',
  'Supplies',
  'Taxes & Licenses',
  'Travel',
  'Meals',
  'Utilities',
  'Wages',
  'Other Expenses',
];
