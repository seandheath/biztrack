/**
 * Google Picker API wrapper.
 *
 * The Picker is a callback-based browser library, not a REST API — apiFetch
 * is not used here. The current OAuth token is read directly via getToken().
 *
 * Used only during business setup (Phase 7). Not called during expense entry.
 */

import { GOOGLE_API_KEY, GOOGLE_APP_ID, getToken } from './auth.js';

// ---------------------------------------------------------------------------
// Script loading
// ---------------------------------------------------------------------------

/**
 * Deduplicates concurrent loadPickerApi() calls.
 * @type {Promise<void>|null}
 */
let _pickerPromise = null;

/**
 * Dynamically loads the Google API client script and the Picker library.
 * Safe to call multiple times — concurrent callers share the same promise.
 *
 * @returns {Promise<void>} Resolves when window.google.picker is ready.
 */
export function loadPickerApi() {
  if (_pickerPromise) return _pickerPromise;

  _pickerPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.defer = true;

    script.onload = () => {
      // gapi.load is now available — load the picker sub-library
      window.gapi.load('picker', {
        callback: () => resolve(),
        onerror: () => {
          _pickerPromise = null; // allow retry
          reject(new Error('Failed to load Google Picker library'));
        },
      });
    };

    script.onerror = () => {
      _pickerPromise = null; // allow retry
      reject(new Error('Failed to load Google API script'));
    };

    document.head.appendChild(script);
  });

  return _pickerPromise;
}

// ---------------------------------------------------------------------------
// Folder picker
// ---------------------------------------------------------------------------

/**
 * Opens the Google Picker in folder-selection mode.
 * Loads the Picker API if not already loaded.
 *
 * @returns {Promise<{id: string, name: string}|null>}
 *   Resolves with the selected folder's id and name, or null if cancelled.
 */
export async function openFolderPicker() {
  await loadPickerApi();

  const token = getToken();
  if (!token) throw new Error('openFolderPicker: no auth token — sign in first');

  return new Promise((resolve) => {
    // DocsView restricted to folders only
    const view = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
      .setSelectFolderEnabled(true)
      .setMimeTypes('application/vnd.google-apps.folder');

    const picker = new window.google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(GOOGLE_API_KEY)
      .setAppId(GOOGLE_APP_ID)
      .setCallback((data) => {
        const { Action, Document } = window.google.picker;
        if (data.action === Action.PICKED) {
          const doc = data.docs[0];
          resolve({ id: doc[Document.ID], name: doc[Document.NAME] });
        } else if (data.action === Action.CANCEL) {
          resolve(null);
        }
        // Other actions (e.g. LOADED) are ignored
      })
      .build();

    picker.setVisible(true);
  });
}
