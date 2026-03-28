/**
 * Google Drive API v3 service layer (TypeScript).
 *
 * Relocated from src/lib/drive.js. API surface is identical — existing callers
 * can import from either path during migration; this file is the canonical version.
 *
 * All functions use apiFetch() from auth.js — Bearer header injection and
 * 401/network error handling are handled there. Callers must check response.ok.
 *
 * No gapi.client — raw fetch only. Supports multipart uploads up to 5MB.
 */

import { apiFetch } from '../auth.js';

const FILES_URL  = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/**
 * Throws a descriptive error from a non-ok Drive API response.
 */
async function _throwDriveError(response: Response, context: string): Promise<never> {
  let message = `Drive ${context} failed (HTTP ${response.status})`;
  try {
    const body = await response.json();
    const err = body?.error;
    if (err?.message) message = `Drive ${context}: ${err.message} (${response.status})`;
  } catch {
    // Body not JSON — use status-only message
  }
  throw new Error(message);
}

// ---------------------------------------------------------------------------
// Folder operations
// ---------------------------------------------------------------------------

/**
 * Creates a Drive folder inside a parent folder.
 */
export async function createFolder(name: string, parentId: string): Promise<{ id: string; name: string }> {
  const response = await apiFetch(FILES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  if (!response.ok) return _throwDriveError(response, 'createFolder');
  const data = await response.json();
  return { id: data.id, name: data.name };
}

/**
 * Lists names of all non-trashed files (non-folder) directly inside a folder.
 * Used to enumerate existing receipt filenames for increment generation.
 */
export async function listFileNames(parentId: string): Promise<string[]> {
  const q = `'${parentId}' in parents and mimeType!='${FOLDER_MIME}' and trashed=false`;
  const url = `${FILES_URL}?q=${encodeURIComponent(q)}&fields=files(name)&pageSize=1000`;
  const response = await apiFetch(url);
  if (!response.ok) return _throwDriveError(response, 'listFileNames');
  const data = await response.json();
  return (data.files ?? []).map((f: { name: string }) => f.name);
}

/**
 * Lists all non-trashed folders directly inside a parent folder.
 */
export async function listFolders(parentId: string): Promise<Array<{ id: string; name: string }>> {
  const q = `'${parentId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`;
  const url = `${FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1000`;
  const response = await apiFetch(url);
  if (!response.ok) return _throwDriveError(response, 'listFolders');
  const data = await response.json();
  return data.files ?? [];
}

/**
 * Finds a file or folder by exact name within a parent folder.
 * Returns the file ID, or null if not found.
 */
export async function findFile(name: string, parentId: string): Promise<string | null> {
  const safeName = name.replace(/'/g, "\\'");
  const q = `name='${safeName}' and '${parentId}' in parents and trashed=false`;
  const url = `${FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=10`;
  const response = await apiFetch(url);
  if (!response.ok) return _throwDriveError(response, 'findFile');
  const data = await response.json();
  return data.files?.[0]?.id ?? null;
}

/**
 * Returns metadata for a specific file or folder.
 */
export async function getFileMeta(fileId: string): Promise<{ id: string; name: string; parents: string[] }> {
  const url = `${FILES_URL}/${encodeURIComponent(fileId)}?fields=id,name,parents`;
  const response = await apiFetch(url);
  if (!response.ok) return _throwDriveError(response, 'getFileMeta');
  return response.json();
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------

/**
 * Uploads a file to Drive using multipart upload (supports up to 5MB).
 */
export async function uploadFile(
  filename: string,
  blob: Blob,
  mimeType: string,
  parentId: string,
): Promise<{ id: string; name: string }> {
  const metadata = JSON.stringify({ name: filename, parents: [parentId], mimeType });
  const form = new FormData();
  form.append('metadata', new Blob([metadata], { type: 'application/json' }));
  form.append('file', blob);

  const response = await apiFetch(`${UPLOAD_URL}?uploadType=multipart&fields=id,name`, {
    method: 'POST',
    body: form,
    // Do NOT set Content-Type — browser sets it with the correct multipart boundary
  });
  if (!response.ok) return _throwDriveError(response, 'uploadFile');
  const data = await response.json();
  return { id: data.id, name: data.name };
}

/**
 * Downloads and parses a JSON file from Drive.
 */
export async function downloadJson(fileId: string): Promise<unknown> {
  const url = `${FILES_URL}/${encodeURIComponent(fileId)}?alt=media`;
  const response = await apiFetch(url);
  if (!response.ok) return _throwDriveError(response, 'downloadJson');
  return response.json();
}

/**
 * Creates a new JSON file in Drive.
 */
export async function uploadJson(
  filename: string,
  data: unknown,
  parentId: string,
): Promise<{ id: string; name: string }> {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  return uploadFile(filename, blob, 'application/json', parentId);
}

/**
 * Overwrites an existing Drive file with new JSON content.
 * Uses media upload — metadata (name/parents) is not changed.
 */
export async function updateJson(fileId: string, data: unknown): Promise<{ id: string }> {
  const url = `${UPLOAD_URL}/${encodeURIComponent(fileId)}?uploadType=media&fields=id`;
  const response = await apiFetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) return _throwDriveError(response, 'updateJson');
  return response.json();
}

/**
 * Moves a file from one folder to another.
 */
export async function moveFile(
  fileId: string,
  newParentId: string,
  oldParentId: string,
): Promise<{ id: string }> {
  const url =
    `${FILES_URL}/${encodeURIComponent(fileId)}` +
    `?addParents=${encodeURIComponent(newParentId)}` +
    `&removeParents=${encodeURIComponent(oldParentId)}` +
    `&fields=id,parents`;
  const response = await apiFetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!response.ok) return _throwDriveError(response, 'moveFile');
  return response.json();
}
