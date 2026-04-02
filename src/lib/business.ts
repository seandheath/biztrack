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
import { initSpreadsheet } from './services/sheets.js';
import { DEFAULT_CATEGORIES } from './constants.js';
import { get } from 'svelte/store';
import { businessConfig, businesses, selectedBusiness, mileageFavorites, defaultDrivers, updateBusiness } from './store.js';
import { ensureBizTrackFolder, saveProfile } from './profile.js';
import type { Business, BusinessConfig, MileageFavorite } from './types.js';

/**
 * Ensures a config object has all required fields with sensible defaults.
 * Centralizes the backfill logic that was previously scattered across
 * setupBusiness(), loadConfig(), and inline in page components.
 *
 * @param cfg - Config object from Drive config.json
 * @param businessName - Fallback name if config.name is missing
 * @returns The same cfg object, mutated in place
 */
export function normalizeConfig(cfg: BusinessConfig, businessName = ''): BusinessConfig {
  if (typeof cfg.name !== 'string' || !cfg.name) cfg.name = businessName;
  if (!Array.isArray(cfg.categories) || cfg.categories.length === 0)   cfg.categories       = [...DEFAULT_CATEGORIES];
  return cfg;
}

/**
 * Loads config + ensures the current year folder for a business.
 * Shared between expense and mileage pages — eliminates the duplicated
 * loadBusinessData() that each page previously had inline.
 *
 * Returns the (possibly updated) business object. Callers can add
 * page-specific work after this returns (e.g. vendor cache sync).
 */
export async function loadBusinessData(business: Business | null): Promise<Business | null> {
  if (!business) {
    businessConfig.set(null);
    return business;
  }

  // Resolve configFileId lazily for businesses added before Phase 8
  let biz = business;
  if (!biz.configFileId) {
    const configId = await findFile('config.json', biz.folderId);
    if (configId) {
      biz = { ...biz, configFileId: configId };
      updateBusiness(biz);
    }
  }

  // Load and normalize config
  await loadConfig(biz);

  // Ensure current year folder exists
  const year = new Date().getFullYear();
  const updated = await ensureYearFolder(biz, year);
  if (updated !== biz) {
    updateBusiness(updated);
    biz = updated;
  }

  return biz;
}

/** Strip characters that are invalid in Drive/Sheets file names: / \ : * ? " < > | */
function driveFileName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '');
}

// Deduplicates concurrent ensureYearFolder calls for the same business+year.
// Key: `${folderId}_${year}` — folderId is stable across reloads.
const _yearFolderInFlight = new Map<string, Promise<Business>>();

/**
 * Initializes a business against a user-selected Drive folder.
 *
 * - If config.json already exists in the folder (previously set up business),
 *   loads and returns it alongside the business object.
 * - If not, creates a default config.json.
 *
 * Does NOT create year folders — call ensureYearFolder() after this.
 *
 * @param name - User-defined business display name
 * @param folderId - Drive folder ID selected via the Picker
 */
export async function setupBusiness(
  name: string,
  folderId: string,
): Promise<{ business: Business; config: BusinessConfig }> {
  const defaultConfig: BusinessConfig = {
    name,
    mileage_favorites: [],
    categories: [...DEFAULT_CATEGORIES],
  };

  const configId = await findFile('config.json', folderId);

  let config: BusinessConfig;
  let configFileId: string;
  if (configId) {
    config = await downloadJson<BusinessConfig>(configId);
    configFileId = configId;
    normalizeConfig(config, name);
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

  const business: Business = {
    id: config.id!,
    name: config.name,
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
 */
export async function loadConfig(business: Business): Promise<BusinessConfig | null> {
  if (!business?.configFileId) return null;
  const cfg = await downloadJson<BusinessConfig>(business.configFileId);
  normalizeConfig(cfg, business.name ?? '');
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
 */
export async function saveConfig(business: Business, config: BusinessConfig): Promise<void> {
  if (!business?.configFileId) throw new Error('business.configFileId is missing');
  await updateJson(business.configFileId, config);
  businessConfig.set(config);
}

/**
 * Saves a new mileage favorite to the user's profile.json.
 * Favorites are user-owned and keyed by business folderId — independent of config.json.
 */
export async function saveMileageFavorite(business: Business, _cfg: unknown, favorite: MileageFavorite): Promise<void> {
  const folderId = business.folderId;
  mileageFavorites.update((all) => {
    const current = Array.isArray(all[folderId]) ? all[folderId] : [];
    // Upsert: if a favorite with the same name exists, replace it in-place
    const idx = current.findIndex((f) => f.name === favorite.name);
    if (idx !== -1) {
      const updated = [...current];
      updated[idx] = favorite;
      return { ...all, [folderId]: updated };
    }
    return { ...all, [folderId]: [...current, favorite] };
  });
  const rootFolderId = await ensureBizTrackFolder();
  await saveProfile(rootFolderId, get(businesses), get(mileageFavorites), get(defaultDrivers));
}

/**
 * Updates an existing mileage favorite in-place (matched by originalName) in the user's profile.json.
 * Supports renaming: pass the old name as originalName and the new name inside favorite.
 */
export async function updateMileageFavorite(business: Business, _cfg: unknown, originalName: string, favorite: MileageFavorite): Promise<void> {
  const folderId = business.folderId;
  mileageFavorites.update((all) => {
    const current = Array.isArray(all[folderId]) ? all[folderId] : [];
    return { ...all, [folderId]: current.map((f) => f.name === originalName ? favorite : f) };
  });
  const rootFolderId = await ensureBizTrackFolder();
  await saveProfile(rootFolderId, get(businesses), get(mileageFavorites), get(defaultDrivers));
}

/**
 * Deletes a mileage favorite by name from the user's profile.json.
 */
export async function deleteMileageFavorite(business: Business, _cfg: unknown, name: string): Promise<void> {
  const folderId = business.folderId;
  mileageFavorites.update((all) => {
    const current = Array.isArray(all[folderId]) ? all[folderId] : [];
    return { ...all, [folderId]: current.filter((f) => f.name !== name) };
  });
  const rootFolderId = await ensureBizTrackFolder();
  await saveProfile(rootFolderId, get(businesses), get(mileageFavorites), get(defaultDrivers));
}

/**
 * Sets (or clears) the default driver for a business.
 * Persisted in profile.json — user-specific, not shared config.
 */
export async function saveDefaultDriver(business: Business, driver: string): Promise<void> {
  const folderId = business.folderId;
  defaultDrivers.update((all) => {
    if (!driver) {
      const { [folderId]: _, ...rest } = all;
      return rest;
    }
    return { ...all, [folderId]: driver };
  });
  const rootFolderId = await ensureBizTrackFolder();
  await saveProfile(rootFolderId, get(businesses), get(mileageFavorites), get(defaultDrivers));
}

/**
 * Adds an expense category to a business config and saves to Drive.
 * No-op if the category already exists.
 */
export async function addCategory(business: Business, config: BusinessConfig, category: string): Promise<BusinessConfig> {
  const trimmed = category.trim();
  if (!trimmed || (config.categories ?? []).includes(trimmed)) return config;
  const updated = { ...config, categories: [...(config.categories ?? []), trimmed] };
  await saveConfig(business, updated);
  return updated;
}

/**
 * Removes an expense category from a business config and saves to Drive.
 * Refuses to remove 'Uncategorized' (required default).
 */
export async function removeCategory(business: Business, config: BusinessConfig, category: string): Promise<BusinessConfig> {
  if (category === 'Uncategorized') return config;
  const updated = {
    ...config,
    categories: (config.categories ?? []).filter((c) => c !== category),
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
 */
export async function discoverYearFolders(business: Business): Promise<Business> {
  const subfolders = await listFolders(business.folderId);
  const yearFolders: Record<number, string> = {};
  const sheetIds: Record<number, string> = {};
  const receiptFolderIds: Record<number, string> = {};

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
 */
export async function ensureYearFolder(business: Business, year: number): Promise<Business> {
  // Reject non-4-digit years (e.g. partial values from date input intermediate events)
  if (year < 1000 || year > 9999) return business;

  // Fast path: both folder and sheet IDs are cached locally.
  // Require sheetIds[year] as well — if it was cleared (e.g. by 404 recovery in
  // the sync engine), we need to go through the Drive check to rediscover it.
  if (business.yearFolders[year] && business.sheetIds?.[year]) return business;

  // Deduplicate concurrent calls for the same business+year (e.g. prefetch on
  // date change races with loadBusinessData on mount after a SW-triggered reload).
  const key = `${business.folderId}_${year}`;
  if (_yearFolderInFlight.has(key)) return _yearFolderInFlight.get(key)!;

  const promise = _doEnsureYearFolder(business, year);
  _yearFolderInFlight.set(key, promise);
  promise.finally(() => _yearFolderInFlight.delete(key));
  return promise;
}

async function _doEnsureYearFolder(business: Business, year: number): Promise<Business> {
  // Check Drive for an existing year folder before creating one.
  // Handles stale local cache after page reload (e.g. SW controllerchange reload).
  const existingFolderId = await findFile(String(year), business.folderId);
  if (existingFolderId) {
    // Recover existing sheet and receipts folder IDs from Drive
    const safeName = driveFileName(business.name);
    let [existingSheetId, existingReceiptFolderId] = await Promise.all([
      findFile(`${year}_${safeName}_expenses`, existingFolderId),
      findFile(`${year}_${safeName}_Receipts`, existingFolderId),
    ]);

    // Sheet missing (was deleted) and no cached ID — create a fresh one
    if (!existingSheetId && !business.sheetIds?.[year]) {
      const { spreadsheetId } = await initSpreadsheet(`${year}_${safeName}_expenses`);
      await moveFile(spreadsheetId, existingFolderId, 'root');
      existingSheetId = spreadsheetId;
    }

    // Receipts folder missing and no cached ID — create it
    if (!existingReceiptFolderId && !business.receiptFolderIds?.[year]) {
      const { id } = await createFolder(`${year}_${safeName}_Receipts`, existingFolderId);
      existingReceiptFolderId = id;
    }

    return {
      ...business,
      yearFolders:      { ...business.yearFolders,      [year]: existingFolderId },
      sheetIds:         { ...business.sheetIds,         [year]: existingSheetId         ?? business.sheetIds?.[year] },
      receiptFolderIds: { ...business.receiptFolderIds, [year]: existingReceiptFolderId ?? business.receiptFolderIds?.[year] },
    };
  }

  // No existing folder — create the full year structure
  const { id: yearFolderId } = await createFolder(String(year), business.folderId);

  // Create the expense sheet — lands in Drive root, must be moved immediately
  const safeName = driveFileName(business.name);
  const { spreadsheetId } = await initSpreadsheet(`${year}_${safeName}_expenses`);

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
