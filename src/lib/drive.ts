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
import type { DriveFile } from './types.js';

const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVES_URL = 'https://www.googleapis.com/drive/v3/drives';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

// Shared/Team Drive support — append to any files endpoint URL.
const ALL_DRIVES = 'supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives';

async function _throwDriveError(r: Response, ctx: string): Promise<never> { return throwApiError(r, `Drive ${ctx}`); }

// ---------------------------------------------------------------------------
// Folder operations
// ---------------------------------------------------------------------------

/**
 * Creates a Drive folder inside a parent folder.
 *
 * @param name - Folder name
 * @param parentId - Parent folder ID (use 'root' for Drive root)
 */
export async function createFolder(name: string, parentId: string): Promise<DriveFile> {
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

/** Read every page of a Drive file query; used by receipt and folder listings. */
async function listFiles(query: string, context: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken = '';
  do {
    const url = `${FILES_URL}?q=${encodeURIComponent(query)}&fields=files(id,name),nextPageToken&pageSize=1000&${ALL_DRIVES}`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const response = await apiFetch(url);
    if (!response.ok) await _throwDriveError(response, context);
    const data = await response.json();
    files.push(...(data.files ?? []));
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);
  return files;
}

/** Existing receipt names, used to generate a unique upload filename. */
export async function listFileNames(parentId: string): Promise<string[]> {
  const files = await listFiles(
    `'${parentId}' in parents and mimeType!='${FOLDER_MIME}' and trashed=false`, 'listFileNames',
  );
  return files.map(file => file.name);
}

/** Non-trashed folders directly inside a parent folder. */
export function listFolders(parentId: string): Promise<DriveFile[]> {
  return listFiles(`'${parentId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`, 'listFolders');
}

/**
 * Lists all Shared Drives (Team Drives) the user has access to.
 */
export async function listSharedDrives(): Promise<DriveFile[]> {
  const allDrives: DriveFile[] = [];
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
 */
export function listSharedFolders(): Promise<DriveFile[]> {
  return listFiles(`sharedWithMe=true and mimeType='${FOLDER_MIME}' and trashed=false`, 'listSharedFolders');
}

/**
 * Finds a file or folder by exact name within a parent folder.
 *
 * @param name - Exact filename or folder name to search for
 * @param parentId - Parent folder ID
 * @returns File ID, or null if not found
 */
export async function findFile(name: string, parentId: string): Promise<string | null> {
  // Escape single quotes in the name for Drive query syntax
  const safeName = name.replace(/'/g, "\\'");
  const q = `name='${safeName}' and '${parentId}' in parents and trashed=false`;
  const url = `${FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=10&${ALL_DRIVES}`;

  const response = await apiFetch(url);
  if (!response.ok) await _throwDriveError(response, 'findFile');
  const data = await response.json();
  return data.files?.[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------

/**
 * Uploads a file to Drive using multipart upload (supports up to 5MB).
 *
 * @param filename
 * @param blob - File content
 * @param mimeType - MIME type of the file content
 * @param parentId - Destination folder ID
 */
export async function uploadFile(filename: string, blob: Blob, mimeType: string, parentId: string): Promise<DriveFile> {
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
 */
export async function downloadJson<T = unknown>(fileId: string): Promise<T> {
  const url = `${FILES_URL}/${encodeURIComponent(fileId)}?alt=media&${ALL_DRIVES}`;
  const response = await apiFetch(url);
  if (!response.ok) await _throwDriveError(response, 'downloadJson');
  return response.json();
}

/**
 * Creates a new JSON file in Drive.
 *
 * @param filename
 * @param data - Data to serialize as JSON
 * @param parentId - Destination folder ID
 */
export async function uploadJson(filename: string, data: unknown, parentId: string): Promise<DriveFile> {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  return uploadFile(filename, blob, 'application/json', parentId);
}

/**
 * Overwrites an existing Drive file with new JSON content.
 * Uses media upload (metadata unchanged — name/parents are not updated).
 */
export async function updateJson(fileId: string, data: unknown): Promise<{ id: string }> {
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
 * @param fileId
 * @param newParentId - Destination folder ID
 * @param oldParentId - Current parent folder ID (required to remove it)
 */
export async function moveFile(fileId: string, newParentId: string, oldParentId: string): Promise<{ id: string }> {
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
