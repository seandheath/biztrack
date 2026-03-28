/**
 * Business setup and year-folder management.
 *
 * Coordinates drive.js and sheets.js to build the expected Drive structure:
 *
 *   <Business Folder>/
 *     config.json
 *     2026/
 *       2026_<name>_expenses   (Google Sheet — Expenses + Mileage tabs)
 *       2026_<name>_Receipts/
 *
 * No token parameter — apiFetch() in auth.js reads the token from module state.
 */

import { findFile, downloadJson, uploadJson, updateJson, createFolder, moveFile, listFolders } from './drive.js';
import { createExpenseSheet } from './sheets.js';
import { DEFAULT_PAYMENT_METHODS } from './constants.js';
import { businessConfig, businesses, selectedBusiness } from './store.js';

/** Strip characters that are invalid in Drive/Sheets file names: / \ : * ? " < > | */
function driveFileName(name) {
  return name.replace(/[/\\:*?"<>|]/g, '');
}

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
    name,
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
    if (typeof config.name !== 'string' || !config.name) config.name = name;
    if (!Array.isArray(config.payment_accounts)) config.payment_accounts = [...DEFAULT_PAYMENT_METHODS];
    if (!Array.isArray(config.mileage_favorites)) config.mileage_favorites = [];
  } else {
    const { id } = await uploadJson('config.json', defaultConfig, folderId);
    configFileId = id;
    config = defaultConfig;
  }

  // Ensure config has a stable business ID — generate and persist if missing
  if (!config.id) {
    config.id = crypto.randomUUID();
    await updateJson(configFileId, config);
  }

  const business = {
    id: config.id,
    name,
    folderId,
    configFileId,
    yearFolders: {},
    sheetIds: {},
    receiptFolderIds: {},
  };

  return { business, config };
}

// ---------------------------------------------------------------------------
// Config helpers — read/write config.json for a business
// ---------------------------------------------------------------------------

/**
 * Downloads config.json from Drive and updates the businessConfig store.
 * Safe to call even if configFileId is missing (returns null).
 *
 * @param {Object} business
 * @returns {Promise<Object|null>} Loaded config, or null if unavailable
 */
export async function loadConfig(business) {
  if (!business?.configFileId) return null;
  const cfg = await downloadJson(business.configFileId);
  // Backfill name for configs written before this field was added
  if (typeof cfg.name !== 'string' || !cfg.name) cfg.name = business.name ?? '';
  if (!Array.isArray(cfg.payment_accounts))  cfg.payment_accounts  = [...DEFAULT_PAYMENT_METHODS];
  if (!Array.isArray(cfg.mileage_favorites)) cfg.mileage_favorites = [];
  // Backfill business ID — generate and persist if missing, then update store
  if (!cfg.id) {
    cfg.id = crypto.randomUUID();
    await updateJson(business.configFileId, cfg);
  }
  if (!business.id || business.id !== cfg.id) {
    const updated = { ...business, id: cfg.id };
    businesses.update((list) => list.map((b) => b.name === business.name ? updated : b));
    selectedBusiness.update((b) => b?.name === business.name ? updated : b);
  }
  businessConfig.set(cfg);
  return cfg;
}

/**
 * Writes config back to Drive and updates the businessConfig store.
 *
 * @param {Object} business
 * @param {Object} config - New config to persist
 * @returns {Promise<void>}
 */
export async function saveConfig(business, config) {
  if (!business?.configFileId) throw new Error('business.configFileId is missing');
  await updateJson(business.configFileId, config);
  businessConfig.set(config);
}

/**
 * Adds a payment method to a business config and saves to Drive.
 * No-op if the method already exists.
 *
 * @param {Object} business
 * @param {Object} config - Current config
 * @param {string} method - Method label to add
 * @returns {Promise<Object>} Updated config
 */
export async function addPaymentMethod(business, config, method) {
  const trimmed = method.trim();
  if (!trimmed || config.payment_accounts.includes(trimmed)) return config;
  const updated = { ...config, payment_accounts: [...config.payment_accounts, trimmed] };
  await saveConfig(business, updated);
  return updated;
}

/**
 * Removes a payment method from a business config and saves to Drive.
 * Refuses to remove 'Cash' (required default).
 *
 * @param {Object} business
 * @param {Object} config - Current config
 * @param {string} method - Method label to remove
 * @returns {Promise<Object>} Updated config
 */
export async function removePaymentMethod(business, config, method) {
  if (method === 'Cash') return config;
  const updated = {
    ...config,
    payment_accounts: config.payment_accounts.filter((m) => m !== method),
  };
  await saveConfig(business, updated);
  return updated;
}

/**
 * Saves a new mileage favorite and persists config to Drive.
 *
 * @param {Object} business
 * @param {Object} config - Current config
 * @param {{name:string, from:string, to:string, miles:number, purpose:string}} favorite
 * @returns {Promise<Object>} Updated config
 */
export async function saveMileageFavorite(business, config, favorite) {
  const updated = {
    ...config,
    mileage_favorites: [...config.mileage_favorites, favorite],
  };
  await saveConfig(business, updated);
  return updated;
}

/**
 * Deletes a mileage favorite by name and persists config to Drive.
 *
 * @param {Object} business
 * @param {Object} config - Current config
 * @param {string} name - Favorite name to remove
 * @returns {Promise<Object>} Updated config
 */
export async function deleteMileageFavorite(business, config, name) {
  const updated = {
    ...config,
    mileage_favorites: config.mileage_favorites.filter((f) => f.name !== name),
  };
  await saveConfig(business, updated);
  return updated;
}

// ---------------------------------------------------------------------------

/**
 * Discovers existing year folder structure for a business already set up in Drive.
 * Used during import to reconstruct local state without creating new Drive files.
 *
 * Scans the business root for subfolders whose name is a 4-digit year (e.g. "2025").
 * For each year folder found, looks up:
 *   - {year}_expenses  (Google Sheet → sheetId)
 *   - {year}_Receipts  (subfolder → receiptFolderId)
 *
 * @param {Object} business - Business object from setupBusiness
 * @returns {Promise<Object>} Updated business with all discovered year IDs
 */
export async function discoverYearFolders(business) {
  const subfolders = await listFolders(business.folderId);
  const yearFolders = {};
  const sheetIds = {};
  const receiptFolderIds = {};

  for (const folder of subfolders) {
    if (!/^\d{4}$/.test(folder.name)) continue;
    const year = parseInt(folder.name, 10);
    yearFolders[year] = folder.id;

    const safeName = driveFileName(business.name);
    const sheetId = await findFile(`${year}_${safeName}_expenses`, folder.id);
    if (sheetId) sheetIds[year] = sheetId;

    const inner = await listFolders(folder.id);
    const rf = inner.find((f) => f.name === `${year}_${safeName}_Receipts`);
    if (rf) receiptFolderIds[year] = rf.id;
  }

  return { ...business, yearFolders, sheetIds, receiptFolderIds };
}

// ---------------------------------------------------------------------------

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
  const safeName = driveFileName(business.name);
  const { spreadsheetId } = await createExpenseSheet(`${year}_${safeName}_expenses`);

  // Move sheet from Drive root into the year folder
  await moveFile(spreadsheetId, yearFolderId, 'root');

  // Create the receipts folder inside the year folder
  const { id: receiptFolderId } = await createFolder(`${year}_${safeName}_Receipts`, yearFolderId);

  return {
    ...business,
    yearFolders:      { ...business.yearFolders,      [year]: yearFolderId },
    sheetIds:         { ...business.sheetIds,         [year]: spreadsheetId },
    receiptFolderIds: { ...business.receiptFolderIds, [year]: receiptFolderId },
  };
}
