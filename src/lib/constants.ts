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

/** OAuth 2.0 client ID from Google Cloud Console */
export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID;

/**
 * API key restricted to Google Picker API.
 * Public by design (spec §9.3) — kept out of source control via .env.
 */
export const GOOGLE_API_KEY: string = import.meta.env.VITE_GOOGLE_API_KEY;

/**
 * Google Cloud project number (numeric string), required by the Picker API.
 */
export const GOOGLE_APP_ID: string = import.meta.env.VITE_GOOGLE_APP_ID;

/**
 * Drive OAuth scope:
 *   drive — full read/write access to all files and folders.
 *
 * Required because businesses on Shared Drives contain files created by other
 * users or app instances. Narrower scopes (drive.file, drive.metadata.readonly)
 * cannot read or write those files, blocking import and multi-user workflows.
 */
export const DRIVE_SCOPE: string = 'https://www.googleapis.com/auth/drive';

// ---------------------------------------------------------------------------
// IRS standard mileage rates
// ---------------------------------------------------------------------------

/**
 * IRS standard mileage rates by year (USD per mile).
 * Update 2026 when the IRS announces the rate.
 */
export const IRS_RATES: Record<number, number> = {
  2024: 0.67,
  2025: 0.70,
  2026: 0.70,
};

// ---------------------------------------------------------------------------
// Default expense categories — Schedule C + Schedule E combined
// ---------------------------------------------------------------------------

/**
 * Default category set for new businesses covering both Schedule C (sole
 * proprietor / LLC) and Schedule E (rental / royalty) IRS line items.
 * Saved to config.json and user-editable via Settings → Expense Categories.
 */
export const DEFAULT_CATEGORIES: readonly string[] = [
  'Uncategorized',

  // Income (Schedule E)
  'Rents Received',
  'Royalties Received',

  // Expenses — Schedule C & E combined
  'Advertising',                   // Sch C line 8  / Sch E line 5
  'Car & Truck Expenses',          // Sch C line 9  / Sch E line 6
  'Cleaning & Maintenance',        // Sch E line 7
  'Commissions & Fees',            // Sch C line 10 / Sch E line 8
  'Contract Labor',                // Sch C line 11
  'Depreciation & Depletion',      // Sch C line 13 / Sch E line 18
  'Employee Benefits',             // Sch C line 14
  'Insurance',                     // Sch C line 15 / Sch E line 9
  'Interest - Mortgage',           // Sch C line 16a / Sch E line 12
  'Interest - Other',              // Sch C line 16b / Sch E line 13
  'Legal & Professional Services', // Sch C line 17 / Sch E line 10
  'Management Fees',               // Sch E line 11
  'Meals',                         // Sch C line 24b
  'Office Expenses',               // Sch C line 18
  'Pension & Profit Sharing',      // Sch C line 19
  'Rent or Lease - Equipment',     // Sch C line 20a
  'Rent or Lease - Property',      // Sch C line 20b
  'Repairs & Maintenance',         // Sch C line 21 / Sch E line 14
  'Supplies',                      // Sch C line 22 / Sch E line 15
  'Taxes & Licenses',              // Sch C line 23 / Sch E line 16
  'Travel',                        // Sch C line 24a
  'Utilities',                     // Sch C line 25 / Sch E line 17
  'Wages',                         // Sch C line 26
  'Other Expenses',
] as const;
