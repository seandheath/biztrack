/**
 * Google Drive API v3 service layer.
 *
 * All functions use apiFetch() from auth.js — Bearer header injection and
 * 401/network error handling are handled there. Callers must check response.ok.
 *
 * No gapi.client — raw fetch only. Supports multipart uploads up to 5MB.
 */

import { apiFetch } from './auth.js';
import { throwApiError } from './api-error.js';

const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVES_URL = 'https://www.googleapis.com/drive/v3/drives';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

// Shared/Team Drive support — append to any files endpoint URL.
const ALL_DRIVES = 'supportsAllDrives=true&includeItemsFromAllDrives=true';

/** @param {Response} r @param {string} ctx */
async function _throwDriveError(r, ctx) { return throwApiError(r, `Drive ${ctx}`); }

// ---------------------------------------------------------------------------
// Folder operations
// ---------------------------------------------------------------------------

/**
 * Creates a Drive folder inside a parent folder.
 *
 * @param {string} name - Folder name
 * @param {string} parentId - Parent folder ID (use 'root' for Drive root)
 * @returns {Promise<{id: string, name: string}>}
 */
export async function createFolder(name, parentId) {
  const response = await apiFetch(`${FILES_URL}?${ALL_DRIVES}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      parents: [parentId],
    }),
  });

  if (!response.ok) await _throwDriveError(response, 'createFolder');
  const data = await response.json();
  return { id: data.id, name: data.name };
}

/**
 * Lists names of all non-trashed files (non-folder) directly inside a folder.
 * Used to enumerate existing receipt filenames for increment generation.
 *
 * @param {string} parentId - Parent folder ID
 * @returns {Promise<string[]>} Array of file names
 */
export async function listFileNames(parentId) {
  const q = `'${parentId}' in parents and mimeType!='${FOLDER_MIME}' and trashed=false`;
  const allFiles = [];
  let pageToken = '';
  do {
    const url = `${FILES_URL}?q=${encodeURIComponent(q)}&fields=files(name),nextPageToken&pageSize=1000&${ALL_DRIVES}`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const response = await apiFetch(url);
    if (!response.ok) await _throwDriveError(response, 'listFileNames');
    const data = await response.json();
    allFiles.push(...(data.files ?? []));
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);
  return allFiles.map((f) => f.name);
}

/**
 * Lists all non-trashed folders directly inside a parent folder.
 *
 * @param {string} parentId - Parent folder ID
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function listFolders(parentId) {
  const q = `'${parentId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`;
  const allFiles = [];
  let pageToken = '';
  do {
    const url = `${FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id,name),nextPageToken&pageSize=1000&${ALL_DRIVES}`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const response = await apiFetch(url);
    if (!response.ok) await _throwDriveError(response, 'listFolders');
    const data = await response.json();
    allFiles.push(...(data.files ?? []));
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);
  return allFiles;
}

/**
 * Lists all Shared Drives (Team Drives) the user has access to.
 *
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function listSharedDrives() {
  const allDrives = [];
  let pageToken = '';
  do {
    const url = `${DRIVES_URL}?fields=drives(id,name),nextPageToken&pageSize=100`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const response = await apiFetch(url);
    if (!response.ok) await _throwDriveError(response, 'listSharedDrives');
    const data = await response.json();
    allDrives.push(...(data.drives ?? []));
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);
  return allDrives;
}

/**
 * Lists all non-trashed folders that have been shared with the current user.
 *
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function listSharedFolders() {
  const q = `sharedWithMe=true and mimeType='${FOLDER_MIME}' and trashed=false`;
  const allFiles = [];
  let pageToken = '';
  do {
    const url = `${FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id,name),nextPageToken&pageSize=1000&${ALL_DRIVES}`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const response = await apiFetch(url);
    if (!response.ok) await _throwDriveError(response, 'listSharedFolders');
    const data = await response.json();
    allFiles.push(...(data.files ?? []));
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);
  return allFiles;
}

/**
 * Finds a file or folder by exact name within a parent folder.
 *
 * @param {string} name - Exact filename or folder name to search for
 * @param {string} parentId - Parent folder ID
 * @returns {Promise<string|null>} File ID, or null if not found
 */
export async function findFile(name, parentId) {
  // Escape single quotes in the name for Drive query syntax
  const safeName = name.replace(/'/g, "\\'");
  const q = `name='${safeName}' and '${parentId}' in parents and trashed=false`;
  const url = `${FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=10&${ALL_DRIVES}`;

  const response = await apiFetch(url);
  if (!response.ok) await _throwDriveError(response, 'findFile');
  const data = await response.json();
  return data.files?.[0]?.id ?? null;
}

/**
 * Returns metadata for a specific file or folder.
 *
 * @param {string} fileId
 * @returns {Promise<{id: string, name: string, parents: string[]}>}
 */
export async function getFileMeta(fileId) {
  const url = `${FILES_URL}/${encodeURIComponent(fileId)}?fields=id,name,parents&${ALL_DRIVES}`;
  const response = await apiFetch(url);
  if (!response.ok) await _throwDriveError(response, 'getFileMeta');
  return response.json();
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------

/**
 * Uploads a file to Drive using multipart upload (supports up to 5MB).
 *
 * @param {string} filename
 * @param {Blob} blob - File content
 * @param {string} mimeType - MIME type of the file content
 * @param {string} parentId - Destination folder ID
 * @returns {Promise<{id: string, name: string}>}
 */
export async function uploadFile(filename, blob, mimeType, parentId) {
  const metadata = JSON.stringify({ name: filename, parents: [parentId], mimeType });

  // Drive multipart upload: boundary-delimited metadata + file content.
  // Using FormData with Blob parts triggers multipart/form-data encoding automatically.
  const form = new FormData();
  form.append('metadata', new Blob([metadata], { type: 'application/json' }));
  form.append('file', blob);

  const response = await apiFetch(`${UPLOAD_URL}?uploadType=multipart&fields=id,name&${ALL_DRIVES}`, {
    method: 'POST',
    body: form,
    // Do NOT set Content-Type — browser sets it with the correct boundary
  });

  if (!response.ok) await _throwDriveError(response, 'uploadFile');
  const data = await response.json();
  return { id: data.id, name: data.name };
}

/**
 * Downloads and parses a JSON file from Drive.
 *
 * @param {string} fileId
 * @returns {Promise<Object>} Parsed JSON content
 */
export async function downloadJson(fileId) {
  const url = `${FILES_URL}/${encodeURIComponent(fileId)}?alt=media&${ALL_DRIVES}`;
  const response = await apiFetch(url);
  if (!response.ok) await _throwDriveError(response, 'downloadJson');
  return response.json();
}

/**
 * Creates a new JSON file in Drive.
 *
 * @param {string} filename
 * @param {Object} data - Data to serialize as JSON
 * @param {string} parentId - Destination folder ID
 * @returns {Promise<{id: string, name: string}>}
 */
export async function uploadJson(filename, data, parentId) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  return uploadFile(filename, blob, 'application/json', parentId);
}

/**
 * Overwrites an existing Drive file with new JSON content.
 * Uses media upload (metadata unchanged — name/parents are not updated).
 *
 * @param {string} fileId
 * @param {Object} data - New data to serialize as JSON
 * @returns {Promise<{id: string}>}
 */
export async function updateJson(fileId, data) {
  const url = `${UPLOAD_URL}/${encodeURIComponent(fileId)}?uploadType=media&fields=id&${ALL_DRIVES}`;
  const response = await apiFetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) await _throwDriveError(response, 'updateJson');
  return response.json();
}

/**
 * Moves a file from one folder to another.
 *
 * @param {string} fileId
 * @param {string} newParentId - Destination folder ID
 * @param {string} oldParentId - Current parent folder ID (required to remove it)
 * @returns {Promise<{id: string}>}
 */
export async function moveFile(fileId, newParentId, oldParentId) {
  const url =
    `${FILES_URL}/${encodeURIComponent(fileId)}` +
    `?addParents=${encodeURIComponent(newParentId)}` +
    `&removeParents=${encodeURIComponent(oldParentId)}` +
    `&fields=id,parents&${ALL_DRIVES}`;

  const response = await apiFetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!response.ok) await _throwDriveError(response, 'moveFile');
  return response.json();
}
