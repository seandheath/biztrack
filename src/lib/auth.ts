/**
 * Google Identity Services (GIS) token model authentication.
 *
 * Token state is persisted to localStorage so the app can skip re-auth when
 * reopened within the ~1-hour token lifetime. The token auto-expires
 * regardless of storage location, and only grants drive.file scope (files the
 * app created), so the exposure window increase over sessionStorage is minimal.
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
import type { TokenUpdate } from './types.js';

// localStorage keys for token persistence across tab closes
const _LS_TOKEN  = 'bt_at';
const _LS_EXPIRY = 'bt_exp';

// Email hint in localStorage (non-sensitive) — persists across tab closes so
// silent re-auth can be attempted on next app open without showing a popup.
const _LS_EMAIL_HINT = 'bt_email_hint';

// Re-export for callers that imported these from auth.js before Phase 6.
export { DRIVE_SCOPE } from './constants.js';
export { GOOGLE_API_KEY, GOOGLE_APP_ID } from './constants.js';

// ---------------------------------------------------------------------------
// Private module state
// ---------------------------------------------------------------------------

/** Current OAuth access token */
let _token: string | null = null;

/** Expiry timestamp of the current token */
let _tokenExpiry: Date | null = null;

/** Signed-in user's email address */
let _userEmail: string | null = null;

// Restore a still-valid token from localStorage.
// Tokens expire after ~1 hour; localStorage lets the app skip re-auth on tab reopen.
// try/catch guards against browsers with localStorage disabled (e.g. private mode).
try {
  const storedToken  = localStorage.getItem(_LS_TOKEN);
  const storedExpiry = localStorage.getItem(_LS_EXPIRY);
  if (storedToken && storedExpiry) {
    const expiry = new Date(storedExpiry);
    if (expiry > new Date()) {
      _token       = storedToken;
      _tokenExpiry = expiry;
      _userEmail   = localStorage.getItem(_LS_EMAIL_HINT) ?? null;
    } else {
      // Expired — remove stale entries (email hint stays for "Continue as" flow)
      localStorage.removeItem(_LS_TOKEN);
      localStorage.removeItem(_LS_EXPIRY);
    }
  }
} catch { /* localStorage unavailable */ }

/** GIS TokenClient instance */
let _tokenClient: google.accounts.oauth2.TokenClient | null = null;

/** Deduplicates concurrent loadGisScript() calls. */
let _scriptPromise: Promise<void> | null = null;

// Callbacks registered by +layout.svelte
let _onTokenUpdate: ((update: TokenUpdate) => void) | null = null;

/** Fired on 401 or missing token to trigger sign-in screen */
let _onAuthRequired: (() => void) | null = null;

// One-shot resolve/reject for requestToken() / refreshToken() promises
let _pendingResolve: (() => void) | null = null;
let _pendingReject: ((reason: unknown) => void) | null = null;

// ---------------------------------------------------------------------------
// Script loading
// ---------------------------------------------------------------------------

/**
 * Dynamically loads the Google Identity Services script.
 * Safe to call multiple times — concurrent callers share the same promise.
 */
export function loadGisScript(): Promise<void> {
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
export function initTokenClient(): void {
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
 */
export function requestToken(): Promise<void> {
  return new Promise((resolve, reject) => {
    _pendingResolve = resolve;
    _pendingReject = reject;
    _tokenClient!.requestAccessToken({ prompt: 'select_account' });
  });
}

/**
 * Silently refreshes the access token using a saved login hint.
 * Shows minimal UI — at most an account picker, no re-consent.
 * Used for the "Session expiring" banner flow (spec §4.2).
 */
export function refreshToken(loginHint: string): Promise<void> {
  return new Promise((resolve, reject) => {
    _pendingResolve = resolve;
    _pendingReject = reject;
    _tokenClient!.requestAccessToken({ prompt: '', login_hint: loginHint });
  });
}

// ---------------------------------------------------------------------------
// Private GIS callbacks
// ---------------------------------------------------------------------------

/**
 * GIS token response callback. Fires on both success and error.
 */
function _handleTokenResponse(tokenResponse: google.accounts.oauth2.TokenResponse): void {
  if (tokenResponse.error) {
    const err = tokenResponse.error;
    const resolve = _pendingResolve;
    const reject = _pendingReject;
    _pendingResolve = null;
    _pendingReject = null;
    // popup_closed_by_user is not an error — user intentionally dismissed
    if (err === 'popup_closed_by_user' || err === 'access_denied') {
      reject?.(err);
    } else {
      reject?.(new Error(`Auth error: ${err}`));
    }
    return;
  }

  _token = tokenResponse.access_token;
  // expires_in is in seconds; subtract 30s buffer for clock skew
  _tokenExpiry = new Date(Date.now() + (tokenResponse.expires_in - 30) * 1000);

  try {
    localStorage.setItem(_LS_TOKEN,  _token);
    localStorage.setItem(_LS_EXPIRY, _tokenExpiry.toISOString());
  } catch { /* localStorage unavailable */ }
  // Email hint written to localStorage so silent re-auth works across tab opens

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
 */
function _handleTokenError(error: unknown): void {
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
async function _fetchUserEmail(): Promise<void> {
  try {
    // Use Drive About API (drive.file scope is sufficient) instead of the
    // userinfo endpoint, which requires the 'email'/'openid' scope.
    const resp = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user',
      { headers: { Authorization: `Bearer ${_token}` } },
    );
    if (resp.ok) {
      const data = await resp.json();
      _userEmail = data.user?.emailAddress ?? null;
      try { localStorage.setItem(_LS_EMAIL_HINT, _userEmail ?? ''); } catch {}
      _onTokenUpdate?.({ token: _token, expiry: _tokenExpiry, email: _userEmail });
    }
  } catch {
    // Email is cosmetic — swallow silently, app continues without it
  }
}

// ---------------------------------------------------------------------------
// Token inspection
// ---------------------------------------------------------------------------

/** Returns the current access token, or null if not signed in. */
export function getToken(): string | null {
  return _token;
}

/** Returns the signed-in user's email, or null if unknown. */
export function getEmail(): string | null {
  return _userEmail;
}

/** Returns true if a token exists and has not expired. */
export function isTokenValid(): boolean {
  return !!_token && !!_tokenExpiry && _tokenExpiry > new Date();
}

/**
 * Returns seconds until the token expires, or 0 if no token / already expired.
 * Used by the session expiry banner check (< 300s → show banner).
 */
export function getTokenSecondsRemaining(): number {
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
export async function revokeToken(): Promise<void> {
  if (_token) {
    // Fire-and-forget revocation — no need to await
    window.google.accounts.oauth2.revoke(_token, () => {});
  }
  _token = null;
  _tokenExpiry = null;
  _userEmail = null;
  try {
    localStorage.removeItem(_LS_TOKEN);
    localStorage.removeItem(_LS_EXPIRY);
    localStorage.removeItem(_LS_EMAIL_HINT);
    localStorage.removeItem('bt_biz_folder');
  } catch {}

  try {
    const { clearQueue } = await import('./services/offline-queue.js');
    const { clearTrashedCache } = await import('./services/sheets.js');
    const { clearProfileCache } = await import('./profile.js');
    clearQueue();
    clearTrashedCache();
    clearProfileCache();
  } catch {}

  _onTokenUpdate?.({ token: null, expiry: null, email: null });
}

// ---------------------------------------------------------------------------
// Callback registration
// ---------------------------------------------------------------------------

/**
 * Registers a callback to be called whenever token state changes.
 * Called by +layout.svelte to bridge auth events into Svelte stores.
 */
export function onTokenUpdate(callback: (update: TokenUpdate) => void): void {
  _onTokenUpdate = callback;
  // If a token was restored from localStorage before this callback was
  // registered, notify immediately so the authToken store transitions to
  // authenticated without waiting for a new sign-in.
  if (_token && _tokenExpiry) {
    callback({ token: _token, expiry: _tokenExpiry, email: _userEmail });
    // Email may be absent if _fetchUserEmail() failed or hadn't completed when
    // the page was last navigated away from. Re-fetch it now so the Account
    // section in Settings can display the signed-in address.
    if (!_userEmail) {
      _fetchUserEmail();
    }
  }
}

/**
 * Registers a callback to be called when re-authentication is required
 * (401 response or missing token on an API call).
 * Called by +layout.svelte to show the sign-in screen.
 */
export function onAuthRequired(callback: () => void): void {
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
 */
export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  if (!isTokenValid()) {
    _onAuthRequired?.();
    throw new Error('Not authenticated');
  }

  const headers = {
    ...options.headers,
    Authorization: `Bearer ${_token}`,
  };

  let response: Response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch (err) {
    throw new Error(`Network error: ${(err as Error).message}`);
  }

  if (response.status === 401) {
    // Token rejected server-side (revoked externally, clock skew, etc.)
    _token = null;
    _tokenExpiry = null;
    try {
      localStorage.removeItem(_LS_TOKEN);
      localStorage.removeItem(_LS_EXPIRY);
    } catch {}
    _onAuthRequired?.();
    throw new Error('Session expired');
  }

  return response;
}
