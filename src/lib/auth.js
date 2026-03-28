/**
 * Google Identity Services (GIS) token model authentication.
 *
 * Token state is persisted to sessionStorage so navigations within the same
 * tab survive page reloads without re-authentication. sessionStorage is
 * cleared when the tab closes — appropriate for a 1-hour GIS access token.
 *
 * This module is intentionally framework-agnostic. It knows nothing about
 * Svelte stores. The layout component registers callbacks via onTokenUpdate()
 * and onAuthRequired() to bridge events into the reactive store system.
 *
 * Usage pattern (from +layout.svelte):
 *   onMount(() => {
 *     onTokenUpdate(({ token, email }) => { authToken.set(token); ... });
 *     onAuthRequired(() => { authToken.set(null); });
 *   });
 *   // On sign-in button click:
 *   await loadGisScript();
 *   initTokenClient();
 *   await requestToken();
 */

// ---------------------------------------------------------------------------
// Credentials (migrated to constants.js in Phase 6)
// ---------------------------------------------------------------------------

import { GOOGLE_CLIENT_ID, DRIVE_SCOPE } from './constants.js';

// sessionStorage keys — short names to reduce XSS exposure window
const _SS_TOKEN  = 'bt_at';
const _SS_EXPIRY = 'bt_exp';
const _SS_EMAIL  = 'bt_email';

// Re-export for callers that imported these from auth.js before Phase 6.
export { DRIVE_SCOPE } from './constants.js';
export { GOOGLE_API_KEY, GOOGLE_APP_ID } from './constants.js';

// ---------------------------------------------------------------------------
// Private module state
// ---------------------------------------------------------------------------

/** @type {string|null} Current OAuth access token */
let _token = null;

/** @type {Date|null} Expiry timestamp of the current token */
let _tokenExpiry = null;

/** @type {string|null} Signed-in user's email address */
let _userEmail = null;

// Restore a still-valid token from the current tab's sessionStorage.
// sessionStorage is cleared when the tab closes; tokens expire after ~1 hour.
// try/catch guards against browsers with sessionStorage disabled (e.g. private mode).
try {
  const storedToken  = sessionStorage.getItem(_SS_TOKEN);
  const storedExpiry = sessionStorage.getItem(_SS_EXPIRY);
  const storedEmail  = sessionStorage.getItem(_SS_EMAIL);
  if (storedToken && storedExpiry) {
    const expiry = new Date(storedExpiry);
    if (expiry > new Date()) {
      _token       = storedToken;
      _tokenExpiry = expiry;
      _userEmail   = storedEmail ?? null;
    } else {
      // Expired — remove stale entries
      sessionStorage.removeItem(_SS_TOKEN);
      sessionStorage.removeItem(_SS_EXPIRY);
      sessionStorage.removeItem(_SS_EMAIL);
    }
  }
} catch { /* sessionStorage unavailable */ }

/** @type {Object|null} GIS TokenClient instance */
let _tokenClient = null;

/**
 * Deduplicates concurrent loadGisScript() calls.
 * @type {Promise<void>|null}
 */
let _scriptPromise = null;

// Callbacks registered by +layout.svelte
/** @type {((update: {token: string|null, expiry: Date|null, email: string|null}) => void)|null} */
let _onTokenUpdate = null;

/** @type {(() => void)|null} Fired on 401 or missing token to trigger sign-in screen */
let _onAuthRequired = null;

// One-shot resolve/reject for requestToken() / refreshToken() promises
/** @type {(() => void)|null} */
let _pendingResolve = null;

/** @type {((reason: unknown) => void)|null} */
let _pendingReject = null;

// ---------------------------------------------------------------------------
// Script loading
// ---------------------------------------------------------------------------

/**
 * Dynamically loads the Google Identity Services script.
 * Safe to call multiple times — concurrent callers share the same promise.
 *
 * @returns {Promise<void>}
 */
export function loadGisScript() {
  if (_scriptPromise) return _scriptPromise;
  _scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      _scriptPromise = null; // allow retry on failure
      reject(new Error('Failed to load Google Identity Services'));
    };
    document.head.appendChild(script);
  });
  return _scriptPromise;
}

// ---------------------------------------------------------------------------
// Token client initialization
// ---------------------------------------------------------------------------

/**
 * Initializes the GIS token client. No-op if already initialized.
 * Must be called after loadGisScript() resolves.
 * GIS supports only one initTokenClient() call per page load.
 */
export function initTokenClient() {
  if (_tokenClient) return;
  _tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: _handleTokenResponse,
    error_callback: _handleTokenError,
  });
}

// ---------------------------------------------------------------------------
// Token request / refresh
// ---------------------------------------------------------------------------

/**
 * Triggers the GIS sign-in popup and requests an access token.
 * Shows the full account chooser and consent screen.
 *
 * @returns {Promise<void>} Resolves when token is received and stored.
 */
export function requestToken() {
  return new Promise((resolve, reject) => {
    _pendingResolve = resolve;
    _pendingReject = reject;
    _tokenClient.requestAccessToken({ prompt: 'select_account' });
  });
}

/**
 * Silently refreshes the access token using a saved login hint.
 * Shows minimal UI — at most an account picker, no re-consent.
 * Used for the "Session expiring" banner flow (spec §4.2).
 *
 * @param {string} loginHint - The signed-in user's email address
 * @returns {Promise<void>}
 */
export function refreshToken(loginHint) {
  return new Promise((resolve, reject) => {
    _pendingResolve = resolve;
    _pendingReject = reject;
    _tokenClient.requestAccessToken({ prompt: '', login_hint: loginHint });
  });
}

// ---------------------------------------------------------------------------
// Private GIS callbacks
// ---------------------------------------------------------------------------

/**
 * GIS token response callback. Fires on both success and error.
 * @param {Object} tokenResponse
 */
function _handleTokenResponse(tokenResponse) {
  if (tokenResponse.error) {
    const err = tokenResponse.error;
    const resolve = _pendingResolve;
    const reject = _pendingReject;
    _pendingResolve = null;
    _pendingReject = null;
    // popup_closed_by_user is not an error — user intentionally dismissed
    if (err === 'popup_closed_by_user' || err === 'access_denied') {
      reject(err);
    } else {
      reject(new Error(`Auth error: ${err}`));
    }
    return;
  }

  _token = tokenResponse.access_token;
  // expires_in is in seconds; subtract 30s buffer for clock skew
  _tokenExpiry = new Date(Date.now() + (tokenResponse.expires_in - 30) * 1000);

  try {
    sessionStorage.setItem(_SS_TOKEN,  _token);
    sessionStorage.setItem(_SS_EXPIRY, _tokenExpiry.toISOString());
  } catch { /* sessionStorage unavailable */ }

  // Notify stores immediately — isAuthenticated flips to true
  _onTokenUpdate?.({ token: _token, expiry: _tokenExpiry, email: null });

  // Resolve the requestToken() / refreshToken() promise
  const resolve = _pendingResolve;
  _pendingResolve = null;
  _pendingReject = null;
  resolve?.();

  // Fetch user email async — cosmetic, does not block sign-in transition
  _fetchUserEmail();
}

/**
 * GIS error_callback — fires for non-consent errors (popup blocked, etc.)
 * @param {Object} error
 */
function _handleTokenError(error) {
  const reject = _pendingReject;
  _pendingResolve = null;
  _pendingReject = null;
  reject?.(error);
}

/**
 * Fetches the signed-in user's email via the userinfo endpoint.
 * The GIS token model does not return email in the token response.
 * Fires a second _onTokenUpdate when the email is available.
 */
async function _fetchUserEmail() {
  try {
    const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${_token}` },
    });
    if (resp.ok) {
      const data = await resp.json();
      _userEmail = data.email ?? null;
      try { sessionStorage.setItem(_SS_EMAIL, _userEmail); } catch {}
      _onTokenUpdate?.({ token: _token, expiry: _tokenExpiry, email: _userEmail });
    }
  } catch {
    // Email is cosmetic — swallow silently, app continues without it
  }
}

// ---------------------------------------------------------------------------
// Token inspection
// ---------------------------------------------------------------------------

/**
 * Returns the current access token, or null if not signed in.
 * @returns {string|null}
 */
export function getToken() {
  return _token;
}

/**
 * Returns the signed-in user's email, or null if unknown.
 * @returns {string|null}
 */
export function getEmail() {
  return _userEmail;
}

/**
 * Returns true if a token exists and has not expired.
 * @returns {boolean}
 */
export function isTokenValid() {
  return !!_token && !!_tokenExpiry && _tokenExpiry > new Date();
}

/**
 * Returns seconds until the token expires, or 0 if no token / already expired.
 * Used by the session expiry banner check (< 300s → show banner).
 * @returns {number}
 */
export function getTokenSecondsRemaining() {
  if (!_token || !_tokenExpiry) return 0;
  return Math.max(0, (_tokenExpiry.getTime() - Date.now()) / 1000);
}

// ---------------------------------------------------------------------------
// Sign-out
// ---------------------------------------------------------------------------

/**
 * Revokes the current token and clears all auth state.
 * Notifies registered callbacks so Svelte stores reset to unauthenticated.
 */
export function revokeToken() {
  if (_token) {
    // Fire-and-forget revocation — no need to await
    window.google.accounts.oauth2.revoke(_token, () => {});
  }
  _token = null;
  _tokenExpiry = null;
  _userEmail = null;
  try {
    sessionStorage.removeItem(_SS_TOKEN);
    sessionStorage.removeItem(_SS_EXPIRY);
    sessionStorage.removeItem(_SS_EMAIL);
  } catch {}
  _onTokenUpdate?.({ token: null, expiry: null, email: null });
}

// ---------------------------------------------------------------------------
// Callback registration
// ---------------------------------------------------------------------------

/**
 * Registers a callback to be called whenever token state changes.
 * Called by +layout.svelte to bridge auth events into Svelte stores.
 *
 * @param {(update: {token: string|null, expiry: Date|null, email: string|null}) => void} callback
 */
export function onTokenUpdate(callback) {
  _onTokenUpdate = callback;
  // If a token was restored from sessionStorage before this callback was
  // registered, notify immediately so the authToken store transitions to
  // authenticated without waiting for a new sign-in.
  if (_token && _tokenExpiry) {
    callback({ token: _token, expiry: _tokenExpiry, email: _userEmail });
  }
}

/**
 * Registers a callback to be called when re-authentication is required
 * (401 response or missing token on an API call).
 * Called by +layout.svelte to show the sign-in screen.
 *
 * @param {() => void} callback
 */
export function onAuthRequired(callback) {
  _onAuthRequired = callback;
}

// ---------------------------------------------------------------------------
// API fetch wrapper
// ---------------------------------------------------------------------------

/**
 * Authenticated fetch wrapper for all Google API calls.
 *
 * - Adds Authorization: Bearer header automatically
 * - Triggers re-auth on 401 (session expired server-side)
 * - Throws descriptive errors for auth and network failures
 * - Returns the raw Response — callers handle .json() and response.ok
 *
 * Used by drive.js (Phase 3) and sheets.js (Phase 4).
 *
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
export async function apiFetch(url, options = {}) {
  if (!isTokenValid()) {
    _onAuthRequired?.();
    throw new Error('Not authenticated');
  }

  const headers = {
    ...options.headers,
    Authorization: `Bearer ${_token}`,
  };

  let response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch (err) {
    throw new Error(`Network error: ${err.message}`);
  }

  if (response.status === 401) {
    // Token rejected server-side (revoked externally, clock skew, etc.)
    _token = null;
    _tokenExpiry = null;
    try {
      sessionStorage.removeItem(_SS_TOKEN);
      sessionStorage.removeItem(_SS_EXPIRY);
    } catch {}
    _onAuthRequired?.();
    throw new Error('Session expired');
  }

  return response;
}
