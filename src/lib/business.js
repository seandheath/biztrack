/**
 * Business setup and year-folder management.
 *
 * Coordinates drive.js and sheets.js to build the expected Drive structure:
 *
 *   <Business Folder>/
 *     config.json
 *     2026/
 *       2026_expenses     (Google Sheet)
 *       2026_Receipts/
 *
 * No token parameter — apiFetch() in auth.js reads the token from module state.
 */

import { findFile, downloadJson, uploadJson, createFolder, moveFile } from './drive.js';
import { createExpenseSheet } from './sheets.js';
import { DEFAULT_PAYMENT_METHODS } from './constants.js';

/**
 * Initializes a business against a user-selected Drive folder.
 *
 * - If config.json already exists in the folder (previously set up business),
 *   loads and returns it alongside the business object.
 * - If not, creates a default config.json.
 *
 * Does NOT create year folders — call ensureYearFolder() after this.
 *
 * @param {string} name - User-defined business display name
 * @param {string} folderId - Drive folder ID selected via the Picker
 * @returns {Promise<{business: Object, config: Object}>}
 *   business: { name, folderId, yearFolders: {}, sheetIds: {}, receiptFolderIds: {} }
 *   config:   { payment_accounts: string[], mileage_favorites: Array }
 */
export async function setupBusiness(name, folderId) {
  const defaultConfig = {
    payment_accounts: [...DEFAULT_PAYMENT_METHODS],
    mileage_favorites: [],
  };

  const configId = await findFile('config.json', folderId);

  let config;
  let configFileId;
  if (configId) {
    config = await downloadJson(configId);
    configFileId = configId;
    // Guard against malformed config missing required keys
    if (!Array.isArray(config.payment_accounts)) config.payment_accounts = [...DEFAULT_PAYMENT_METHODS];
    if (!Array.isArray(config.mileage_favorites)) config.mileage_favorites = [];
  } else {
    const { id } = await uploadJson('config.json', defaultConfig, folderId);
    configFileId = id;
    config = defaultConfig;
  }

  const business = {
    name,
    folderId,
    configFileId,
    yearFolders: {},
    sheetIds: {},
    receiptFolderIds: {},
  };

  return { business, config };
}

/**
 * Ensures the Drive folder structure for a given year exists.
 * Creates the year folder, expense sheet, and receipts folder if not present.
 * Returns the business object unchanged if the year is already cached locally.
 *
 * Call this on:
 *   - Business add (current year)
 *   - App launch (current year, to catch year rollovers)
 *   - When user enters an expense dated in a different year
 *
 * @param {Object} business - Business object from setupBusiness or the store
 * @param {number} year - e.g. 2026
 * @returns {Promise<Object>} Updated business object with year IDs populated
 */
export async function ensureYearFolder(business, year) {
  // Fast path: year already set up (cached from previous session)
  if (business.yearFolders[year]) return business;

  // Create the YYYY/ subfolder inside the business root
  const { id: yearFolderId } = await createFolder(String(year), business.folderId);

  // Create the expense sheet — lands in Drive root, must be moved immediately
  const { spreadsheetId } = await createExpenseSheet(`${year}_expenses`);

  // Move sheet from Drive root into the year folder
  await moveFile(spreadsheetId, yearFolderId, 'root');

  // Create the receipts folder inside the year folder
  const { id: receiptFolderId } = await createFolder(`${year}_Receipts`, yearFolderId);

  return {
    ...business,
    yearFolders:      { ...business.yearFolders,      [year]: yearFolderId },
    sheetIds:         { ...business.sheetIds,         [year]: spreadsheetId },
    receiptFolderIds: { ...business.receiptFolderIds, [year]: receiptFolderId },
  };
}
