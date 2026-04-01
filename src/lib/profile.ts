/**
 * Cross-device profile sync via Google Drive.
 *
 * Maintains a BizTrack/ folder in the user's Drive root containing
 * profile.json — an array of business objects (folder IDs, sheet IDs, etc.).
 * This lets a user sign in on a new device and automatically recover their
 * business list without re-adding everything manually.
 *
 * Uses drive.file scope only (no extra permissions required).
 * The BizTrack folder ID is cached in localStorage to avoid a Drive
 * round-trip on every page navigation or app reopen.
 */

import { apiFetch } from './auth.js';
import { findFile, createFolder, downloadJson, uploadJson, updateJson } from './drive.js';
import type { Business, MileageFavorite, ProfileData } from './types.js';

const BIZTRACK_FOLDER_NAME = 'BizTrack';
const PROFILE_FILENAME     = 'profile.json';
const LS_FOLDER_KEY        = 'bt_biz_folder';

// Deduplicates concurrent calls — prevents two callers from both running
// findFile() before either has stored the result, causing both to create the folder.
let _ensureFolderInFlight: Promise<string> | null = null;

// Module-level cache of the profile.json file ID to avoid a findFile() on every save.
let _profileFileId: string | null = null;

/**
 * Finds or creates the root BizTrack folder in the user's Drive root.
 * Result is cached in localStorage across tab closes.
 *
 * Only app-created files are visible under drive.file scope, so findFile
 * will return the folder we previously created — no ambiguity with
 * user-created folders of the same name.
 */
export async function ensureBizTrackFolder(): Promise<string> {
  try {
    const cached = localStorage.getItem(LS_FOLDER_KEY);
    if (cached) {
      // Validate the cached folder still exists and isn't trashed
      try {
        const resp = await apiFetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(cached)}?fields=trashed`
        );
        if (resp.ok) {
          const data = await resp.json();
          if (!data.trashed) return cached;
        }
      } catch { /* Network/auth error — fall through to find-or-create */ }
      // Cache is stale — clear and fall through
      localStorage.removeItem(LS_FOLDER_KEY);
    }
  } catch { /* localStorage unavailable */ }

  if (_ensureFolderInFlight) return _ensureFolderInFlight;

  _ensureFolderInFlight = (async () => {
    try {
      let folderId = await findFile(BIZTRACK_FOLDER_NAME, 'root');
      if (!folderId) {
        const { id } = await createFolder(BIZTRACK_FOLDER_NAME, 'root');
        folderId = id;
      }
      try { localStorage.setItem(LS_FOLDER_KEY, folderId); } catch {}
      return folderId;
    } finally {
      // Clear on success OR error so subsequent calls can retry if needed
      _ensureFolderInFlight = null;
    }
  })();

  return _ensureFolderInFlight;
}

/**
 * Loads the businesses array from profile.json in the BizTrack folder.
 * Returns null if no profile file exists yet (first login ever).
 *
 * @param folderId - BizTrack root folder ID
 */
export async function loadProfile(folderId: string): Promise<ProfileData | null> {
  const fileId = await findFile(PROFILE_FILENAME, folderId);
  if (!fileId) return null;
  const data = await downloadJson<{ businesses?: unknown[]; mileage_favorites?: Record<string, MileageFavorite[]> }>(fileId);
  return Array.isArray(data.businesses) ? {
    businesses: data.businesses as ProfileData['businesses'],
    mileage_favorites: data.mileage_favorites ?? {},
  } : null;
}

/**
 * Saves (or creates) profile.json in the BizTrack folder with the
 * current businesses list.
 *
 * @param folderId - BizTrack root folder ID
 * @param bizList - Full businesses array from the store
 * @param mileageFavs - User-owned mileage favorites keyed by business folderId
 */
export async function saveProfile(
  folderId: string,
  bizList: Business[],
  mileageFavs: Record<string, MileageFavorite[]> = {},
): Promise<void> {
  // Only persist the minimal fields needed to locate each business on Drive.
  // All other state (sheetIds, yearFolders, configFileId, etc.) is
  // discovered from Drive folder structure on each session start.
  const minimal = bizList.map(({ name, folderId: bFolderId }) => ({ name, folderId: bFolderId }));
  const payload = { businesses: minimal, mileage_favorites: mileageFavs };

  // Use cached file ID to skip the findFile() lookup after the first save
  if (!_profileFileId) {
    _profileFileId = await findFile(PROFILE_FILENAME, folderId);
  }

  if (_profileFileId) {
    await updateJson(_profileFileId, payload);
  } else {
    const { id } = await uploadJson(PROFILE_FILENAME, payload, folderId);
    _profileFileId = id;
  }
}

/** Clears the cached profile file ID. Call on sign-out. */
export function clearProfileCache(): void {
  _profileFileId = null;
}
