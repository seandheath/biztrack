import { CACHE_KEY, QUEUE_KEY } from './data-model.js';
import { isDemo, storageKey, shareCache } from './version.js';
/** Google's browser token model: reconnect explicitly, without discarding work. */
import { GOOGLE_CLIENT_ID, DRIVE_SCOPE } from './constants.js';
import type { TokenUpdate } from './types.js';
export { DRIVE_SCOPE } from './constants.js';

const TOKEN = 'bt_at';
const EXPIRY = 'bt_exp';
const EMAIL = 'bt_email_hint';
let token: string | null = null;
let expiry: Date | null = null;
let email: string | null = null;
let verified = false;
let session = 0;
let activeRequests = 0;
let scriptPromise: Promise<void> | null = null;
let tokenUpdate: ((update: TokenUpdate) => void) | null = null;
let authRequired: ((pending: boolean) => void) | null = null;

type Pending = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
};
let reconnect: Pending | null = null;
let popup: Pending | null = null;

export class AuthError extends Error {}

function pending(): Pending {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

try {
  if (!isDemo) {
    email = localStorage.getItem(storageKey(EMAIL)) || null;
    const storedExpiry = new Date(localStorage.getItem(storageKey(EXPIRY)) || '');
    if (storedExpiry > new Date()) {
      token = localStorage.getItem(storageKey(TOKEN));
      expiry = storedExpiry;
    } else {
      localStorage.removeItem(storageKey(TOKEN));
      localStorage.removeItem(storageKey(EXPIRY));
    }
  }
} catch { /* Storage can be disabled. */ }

function notify(): void {
  tokenUpdate?.({ token: verified ? token : null, expiry, email });
}

/** Email is retained through expiry, and is verified before reconnecting work. */
export function getEmail(): string | null { return email; }
export function getSessionVersion(): number { return session; }
export function hasPendingOperations(): boolean { return activeRequests > 0 || !!popup || !!reconnect; }
export function isTokenValid(): boolean { return verified && !!token && !!expiry && expiry > new Date(); }
export function getTokenSecondsRemaining(): number {
  return token && expiry ? Math.max(0, (expiry.getTime() - Date.now()) / 1000) : 0;
}

export function expireToken(): void {
  if (isDemo) return;
  token = null;
  expiry = null;
  verified = false;
  try {
    localStorage.removeItem(storageKey(TOKEN));
    localStorage.removeItem(storageKey(EXPIRY));
  } catch {}
  notify();
}

export function loadGisScript(): Promise<void> {
  if (isDemo) return Promise.reject(new AuthError('Google access is unavailable in the demo.'));
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    const timeout = setTimeout(() => fail(), 15_000);
    const fail = () => {
      clearTimeout(timeout);
      script.remove();
      scriptPromise = null;
      reject(new AuthError('Could not load Google sign-in. Check your connection and retry.'));
    };
    script.onload = () => { clearTimeout(timeout); resolve(); };
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/** Always bypass caches when establishing the account behind a token. */
async function accountEmail(accessToken: string): Promise<string> {
  const response = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {
    headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new AuthError('Could not verify your Google account. Please reconnect.');
  const data = await response.json();
  if (typeof data.user?.emailAddress !== 'string' || !data.user.emailAddress) {
    throw new AuthError('Google did not return an account email. Please reconnect.');
  }
  return data.user.emailAddress.toLowerCase();
}

function checkAccount(actual: string, expected: string | null): void {
  if (expected && actual !== expected.toLowerCase()) {
    throw new AuthError(`Reconnect as ${expected}. Sign out first to use a different account.`);
  }
}

/** Validate a restored token before exposing account-specific cached data. */
export async function restoreSession(): Promise<void> {
  if (isDemo) return Promise.reject(new AuthError('Google access is unavailable in the demo.'));
  if (!token || !expiry || expiry <= new Date()) return;
  const version = session;
  const restoredToken = token;
  try {
    const actual = await accountEmail(restoredToken);
    if (version !== session || token !== restoredToken) return;
    checkAccount(actual, email);
    if (!expiry || expiry <= new Date()) { expireToken(); return; }
    // Legacy caches without an owner must not be loaded for an arbitrary account.
    if (!email) {
      if (localStorage.getItem(storageKey('biztrack_offline_queue')) || localStorage.getItem(storageKey(QUEUE_KEY))) {
        throw new AuthError('Unidentified pending changes exist. Sign out and review the discard warning before changing accounts.');
      }
      localStorage.removeItem(storageKey('bt_cache'));
      localStorage.removeItem(storageKey(CACHE_KEY));
      localStorage.removeItem(storageKey('bt_biz_folder'));
    }
    email = actual;
    verified = true;
    try { localStorage.setItem(storageKey(EMAIL), email); } catch {}
    notify();
  } catch (error) {
    if (version !== session || token !== restoredToken) return;
    expireToken();
    throw error;
  }
}

/** Called only from a button click, after the GIS script has loaded. */
export function requestToken(): Promise<void> {
  if (isDemo) return Promise.reject(new AuthError('Google access is unavailable in the demo.'));
  if (popup) return popup.promise;
  if (!window.google?.accounts?.oauth2) {
    return Promise.reject(new AuthError('Google sign-in is still loading. Please retry.'));
  }
  const attempt = pending();
  popup = attempt;
  const version = session;
  const expected = email;
  // Per-attempt callbacks prevent a late popup from restoring a cancelled session.
  try {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: async (response) => {
        if (popup !== attempt || session !== version) return;
        try {
          if (response.error) throw new AuthError(response.error === 'access_denied'
            ? 'Drive access was not granted. Your unfinished work is still here.'
            : `Google authorization failed: ${response.error}`);
          if (!response.access_token || !Number.isFinite(Number(response.expires_in)) || Number(response.expires_in) <= 30) {
            throw new AuthError('Google returned an invalid access token. Please retry.');
          }
          if (!response.scope?.split(' ').includes(DRIVE_SCOPE)) {
            throw new AuthError('Drive access is required to save. Please reconnect and grant permission.');
          }
          const grantedExpiry = new Date(Date.now() + (Number(response.expires_in) - 30) * 1000);
          const actual = await accountEmail(response.access_token);
          if (popup !== attempt || session !== version) return;
          checkAccount(actual, expected);
          if (!expected) {
            // Unknown legacy data may belong to another account.
            const { queueLength } = await import('./services/offline-queue.js');
            if (queueLength() || localStorage.getItem(storageKey('biztrack_offline_queue'))) throw new AuthError('Pending changes have no account owner. Sign out before using a different account.');
            if (popup !== attempt || session !== version) return;
            try {
              localStorage.removeItem(storageKey('bt_cache'));
              localStorage.removeItem(storageKey(CACHE_KEY));
              localStorage.removeItem(storageKey('bt_biz_folder'));
            } catch {}
          }
          token = response.access_token;
          expiry = grantedExpiry;
          email = actual;
          verified = true;
          try {
            localStorage.setItem(storageKey(TOKEN), token);
            localStorage.setItem(storageKey(EXPIRY), expiry.toISOString());
            localStorage.setItem(storageKey(EMAIL), email);
          } catch {}
          popup = null;
          const waiting = reconnect;
          reconnect = null;
          notify();
          authRequired?.(false);
          waiting?.resolve();
          attempt.resolve();
        } catch (error) {
          if (popup === attempt && session === version) cancelReconnection(error);
        }
      },
      error_callback: (error) => {
        if (popup !== attempt || session !== version) return;
        const type = (error as { type?: string })?.type;
        cancelReconnection(new AuthError(type === 'popup_failed_to_open'
          ? 'Google could not open a window. Allow popups for this site and retry.'
          : 'Reconnection cancelled. Your unfinished work is still here.'));
      },
    });
    client.requestAccessToken(expected ? { prompt: '', login_hint: expected } : { prompt: 'select_account' });
  } catch (error) { cancelReconnection(error); }
  return attempt.promise;
}

/** API calls wait here; only the explicit reconnect button opens Google's popup. */
export function ensureAuthorized(): Promise<void> {
  if (isDemo) return Promise.resolve();
  if (isTokenValid()) return Promise.resolve();
  if (!email) return Promise.reject(new AuthError('Sign in before saving to Google Drive.'));
  if (!navigator.onLine) return Promise.reject(new AuthError('Connect to the internet, then reconnect to Google Drive. Your unfinished work is still here.'));
  if (!reconnect) {
    reconnect = pending();
    authRequired?.(true);
  }
  return reconnect.promise;
}

export function cancelReconnection(error: unknown = new AuthError('Reconnection cancelled. Your unfinished work is still here.')): void {
  const waiting = reconnect;
  const attempt = popup;
  reconnect = null;
  popup = null;
  authRequired?.(false);
  waiting?.reject(error);
  attempt?.reject(error);
}

/** Count both data versions before offering to discard this installation's work. */
export function pendingChangeCount(): number {
  if (isDemo) return 0;
  return ['biztrack_offline_queue', QUEUE_KEY].reduce((count, key) => {
    const queue = JSON.parse(localStorage.getItem(storageKey(key)) || '[]');
    if (!Array.isArray(queue)) throw new AuthError('Cannot read pending changes. Preserve this device’s data.');
    return count + queue.length;
  }, 0);
}

/** Sign-out clears this device, but does not revoke the Google grant. */
export async function signOut(discardPending = false): Promise<void> {
  if (isDemo) return Promise.reject(new AuthError('Google access is unavailable in the demo.'));
  const { clearQueue } = await import('./services/offline-queue.js');
  if (pendingChangeCount() && !discardPending) throw new AuthError('Sync pending changes or explicitly discard them before signing out.');
  session++;
  cancelReconnection(new AuthError('Signed out. The operation was cancelled.'));
  expireToken();
  email = null;
  clearQueue();
  for (const key of [EMAIL, 'bt_biz_folder', 'bt_cache', CACHE_KEY, 'biztrack_selected_name', 'biztrack_upgrade_1_2', 'biztrack_offline_queue']) {
    try { localStorage.removeItem(storageKey(key)); } catch {}
  }
  const [{ clearProfileCache }, { clearTrashedCache }, { resetAccountStores }, { clearCache }] = await Promise.all([
    import('./profile.js'), import('./services/sheets.js'), import('./store.js'), import('./sync.js'),
  ]);
  clearProfileCache();
  clearTrashedCache();
  resetAccountStores();
  clearCache();
  try {
    if (typeof caches !== 'undefined') await Promise.all([
      caches.delete(storageKey('api-responses')), caches.delete(shareCache),
    ]);
  } finally { notify(); }
}

/** Explicit disconnection must report revocation failure instead of claiming success. */
export async function revokeToken(discardPending = false): Promise<void> {
  if (isDemo) return Promise.reject(new AuthError('Google access is unavailable in the demo.'));
  if (pendingChangeCount() && !discardPending) throw new AuthError('Sync or discard pending changes before disconnecting.');
  await ensureAuthorized();
  await loadGisScript();
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new AuthError('Google did not confirm disconnection. Please try again.')), 15_000);
    window.google.accounts.oauth2.revoke(token!, (response) => {
      clearTimeout(timeout);
      if (response.successful) resolve();
      else reject(new AuthError('Google did not confirm disconnection. Please try again.'));
    });
  });
  await signOut(discardPending);
}

export function onTokenUpdate(callback: ((update: TokenUpdate) => void) | null): void { tokenUpdate = callback; }
export function onAuthRequired(callback: ((pending: boolean) => void) | null): void { authRequired = callback; }

/** Resume only the rejected request after reconnecting; never replay a whole save. */
export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  if (isDemo) return Promise.reject(new AuthError('Google access is unavailable in the demo.'));
  const target = new URL(url);
  if (target.protocol !== 'https:' || !['www.googleapis.com', 'sheets.googleapis.com'].includes(target.hostname)) {
    throw new Error('Unsupported Google API URL');
  }
  const version = session;
  activeRequests++;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      await ensureAuthorized();
      if (version !== session) throw new AuthError('Signed out. The operation was cancelled.');
      const sentToken = token;
      const headers = new Headers(options.headers);
      headers.set('Authorization', `Bearer ${sentToken}`);
      const response = await fetch(url, { ...options, headers, cache: 'no-store' });
      if (version !== session) throw new AuthError('Signed out. The operation was cancelled.');
      if (response.status !== 401) return response;
      // A slow rejection of an old token must not invalidate a newer token.
      if (token === sentToken) expireToken();
      if (attempt === 1) throw new AuthError('Google rejected the renewed access. Reconnect and try again.');
    }
    throw new AuthError('Reconnect to Google Drive.');
  } finally { activeRequests--; }
}
