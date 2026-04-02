<script>
  /* global __APP_VERSION__ */
  const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';

  import '../app.css';
  import Spinner from '../components/Spinner.svelte';
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import {
    loadGisScript,
    initTokenClient,
    requestToken,
    refreshToken,
    revokeToken,
    isTokenValid,
    getTokenSecondsRemaining,
    onTokenUpdate,
    onAuthRequired,
  } from '$lib/auth.js';
  import { get } from 'svelte/store';
  import { authToken, userEmail, isAuthenticated, businesses, selectedBusiness, mileageFavorites, defaultDrivers, deviceMode, businessConfig } from '$lib/store.js';
  import { isDeviceModeActive, enterDeviceMode } from '$lib/device-mode.js';
  import { localGetBusinesses, localLoadConfig } from '$lib/services/local-store.js';
  import { ensureBizTrackFolder, loadProfile, saveProfile } from '$lib/profile.js';
  import { loadConfig, discoverYearFolders, ensureYearFolder } from '$lib/business.js';
  import { findFile, downloadJson } from '$lib/drive.js';
  import * as storage from '$lib/storage.js';
  import { drainQueue } from '$lib/services/offline-queue.js';
  import { syncStatus, loadCache, writeCache, clearCache, getCachedBusinesses } from '$lib/sync.js';

  /** @type {{ children: import('svelte').Snippet }} */
  let { children } = $props();

  // ---------------------------------------------------------------------------
  // Route context (for top-bar navigation)
  // ---------------------------------------------------------------------------

  let isSettings = $derived($page.url.pathname.startsWith('/settings'));
  let isSettingsRoot = $derived($page.url.pathname === '/settings');
  let isSettingsSub = $derived(isSettings && !isSettingsRoot);
  let isHistory = $derived($page.url.pathname.startsWith('/history'));
  let isExpense = $derived($page.url.pathname === '/expense');
  let isMileage = $derived($page.url.pathname === '/mileage');
  let isEntryForm = $derived(isExpense || isMileage);
  let backHref = $derived(
    isSettingsSub ? '/settings'
    : isEntryForm ? ($page.url.searchParams.get('returnTo') || '/')
    : '/'
  );

  // Public routes bypass the auth guard entirely — needed for OAuth consent screen URLs
  const PUBLIC_ROUTES = ['/privacy', '/terms'];
  let isPublicRoute = $derived(PUBLIC_ROUTES.includes($page.url.pathname));

  // ---------------------------------------------------------------------------
  // Auth state
  // ---------------------------------------------------------------------------

  /** Tracks whether the device currently has network access */
  let isOnline = $state(true);

  /** Whether the sign-in popup/script is in flight */
  let signingIn = $state(false);

  /** Inline error shown below the sign-in button on failure */
  let signInError = $state(null);

  /** Email from a prior session — shown in "Continue as" button */
  let returningEmail = $state(null);

  /** True when token has < 5 minutes remaining — shows the refresh banner */
  let refreshBannerVisible = $state(false);

  /**
   * True on iOS Safari when the app is NOT already installed as a PWA.
   * Triggers the "Add to Home Screen" install prompt.
   */
  let showIosInstallPrompt = $state(false);

  /** User dismissed the iOS install prompt (persisted to localStorage) */
  let iosPromptDismissed = $state(false);

  /** True while initFromDrive() is in flight — prevents flash of empty-state */
  let appLoading = $state(false);

  /** Prevents initFromDrive() from re-running on the email-only onTokenUpdate callback */
  let driveInitialized = false;

  // ---------------------------------------------------------------------------
  // Device-only mode initialization
  // ---------------------------------------------------------------------------

  /**
   * Populates stores from localStorage when running in device-only mode.
   * No network calls — purely synchronous reads.
   */
  function initFromLocal() {
    const bizList = localGetBusinesses();
    businesses.set(bizList);

    const savedName = storage.get('biztrack_selected_name', null);
    const toSelect = (savedName && bizList.find((b) => b.name === savedName)) ?? bizList[0] ?? null;
    if (toSelect) {
      selectedBusiness.set(toSelect);
      // Load config synchronously from localStorage
      const cfg = storage.get(`bt_local_config_${toSelect.id}`, null);
      if (cfg) businessConfig.set(cfg);
    }

    // Load profile data (favorites, drivers)
    const profile = storage.get('bt_local_profile', null);
    if (profile) {
      mileageFavorites.set(profile.mileage_favorites ?? {});
      defaultDrivers.set(profile.default_drivers ?? {});
    }

    syncStatus.set('green');
  }

  /** Enters device mode and initializes local data. */
  function handleEnterDeviceMode() {
    enterDeviceMode();
    initFromLocal();
  }

  // ---------------------------------------------------------------------------
  // Drive-first initialization
  // ---------------------------------------------------------------------------

  /**
   * Discovers business structure from Drive on every session start.
   * Reads profile.json for the {name, folderId} index, then for each business
   * finds config.json (→ id) and scans year subfolders (→ sheetIds etc.).
   * Populates the businesses store from scratch — no localStorage cache.
   */
  /**
   * Discovers business structure from Drive on every session start.
   * Returns true if all businesses hydrated successfully, false if any
   * fell back to cached data (caller should set sync status accordingly).
   */
  async function initFromDrive() {
    let usedFallback = false;
    try {
      const rootFolderId = await ensureBizTrackFolder();
      const profile = await loadProfile(rootFolderId);
      if (!profile?.businesses?.length) return usedFallback;

      // Build lookup of cached businesses so we can fall back on hydration failure
      // instead of caching a broken skeleton with empty sheetIds.
      const cachedByFolder = new Map(
        getCachedBusinesses().map((b) => [b.folderId, b]),
      );

      const currentYear = new Date().getFullYear();
      const hydrated = await Promise.all(
        profile.businesses.map(async ({ name, folderId }) => {
          try {
            // config.json holds the stable business UUID and user preferences
            const configFileId = await findFile('config.json', folderId);
            let id = null;
            if (configFileId) {
              const cfg = await downloadJson(configFileId);
              id = cfg.id ?? null;
            }
            const skeleton = { name, folderId, configFileId, id, yearFolders: {}, sheetIds: {}, receiptFolderIds: {} };
            const discovered = await discoverYearFolders(skeleton);
            return await ensureYearFolder(discovered, currentYear);
          } catch (err) {
            console.warn(`[init] failed to hydrate "${name}":`, err);
            // Fall back to cached version to preserve sheetIds and transaction access
            const cached = cachedByFolder.get(folderId);
            if (cached) {
              usedFallback = true;
              return cached;
            }
            return { name, folderId, configFileId: null, id: null, yearFolders: {}, sheetIds: {}, receiptFolderIds: {} };
          }
        })
      );

      businesses.set(hydrated);
      mileageFavorites.set(profile.mileage_favorites ?? {});
      defaultDrivers.set(profile.default_drivers ?? {});

      const savedName = storage.get<string | null>('biztrack_selected_name', null);
      const toSelect = (savedName && hydrated.find((b) => b.name === savedName)) ?? hydrated[0] ?? null;
      if (toSelect) selectedBusiness.set(toSelect);
    } catch (err) {
      console.warn('[init] Drive discovery failed:', err);
    }
    return usedFallback;
  }

  const IOS_PROMPT_KEY = 'biztrack_ios_prompt_dismissed';

  onMount(async () => {
    // Device-only mode: skip all Google auth, initialize from localStorage
    if (isDeviceModeActive()) {
      enterDeviceMode();
      initFromLocal();

      // Still register SW update handling for PWA cache freshness
      _registerServiceWorkerUpdates();
      return;
    }

    // Read saved email hint for the "Continue as" button.
    // GIS requestAccessToken() always opens a popup — even with prompt:''.
    // Calling it from onMount (no user gesture) causes the browser to block it.
    // Instead, show a button so the popup is triggered by user interaction.
    if (!isTokenValid()) {
      const hint = localStorage.getItem('bt_email_hint');
      if (hint) returningEmail = hint;
    }

    // Initialize online state and listen for changes
    isOnline = navigator.onLine;
    const setOnline  = () => { isOnline = true; };
    const setOffline = () => { isOnline = false; };
    const drainOnOnline = () => { drainQueue().catch(console.warn); };
    window.addEventListener('online',  setOnline);
    window.addEventListener('online',  drainOnOnline);
    window.addEventListener('offline', setOffline);

    // iOS install prompt: show when running in Safari (not standalone) on iOS
    // and the user hasn't permanently dismissed it
    const isIos        = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
                      || ('standalone' in navigator && navigator.standalone);
    const alreadyDismissed = storage.get(IOS_PROMPT_KEY, false);
    if (isIos && !isStandalone && !alreadyDismissed) {
      showIosInstallPrompt = true;
    }

    // Bridge auth.js events → Svelte stores.
    // auth.js is framework-agnostic; these callbacks are the integration seam.
    onTokenUpdate(({ token, email }) => {
      authToken.set(token);
      if (email) userEmail.set(email);
      if (token && !driveInitialized) {
        driveInitialized = true;

        // Load cache immediately — app becomes usable without waiting for Drive
        const hadCache = loadCache();
        appLoading = !hadCache;

        // Background sync from Drive
        syncStatus.set('yellow');
        initFromDrive()
          .then((usedFallback) => {
            writeCache();
            syncStatus.set(usedFallback ? 'yellow' : 'green');
            return drainQueue().catch(console.warn);
          })
          .catch((err) => {
            console.warn('[sync] Drive init failed:', err);
            syncStatus.set('red');
          })
          .finally(() => { appLoading = false; });
      }
    });
    onAuthRequired(() => {
      authToken.set(null);
      userEmail.set(null);
    });

    // Check token expiry every 30 seconds (spec §4.2).
    const interval = setInterval(() => {
      const secs = getTokenSecondsRemaining();
      // Show banner when < 5 minutes remain (but token is still valid)
      refreshBannerVisible = $isAuthenticated && secs > 0 && secs < 300;
      // If token silently expired between checks, force sign-in screen
      if ($isAuthenticated && secs === 0) {
        authToken.set(null);
        userEmail.set(null);
      }
    }, 30_000);

    _registerServiceWorkerUpdates();

    // onMount cleanup
    return () => {
      clearInterval(interval);
      window.removeEventListener('online',  setOnline);
      window.removeEventListener('online',  drainOnOnline);
      window.removeEventListener('offline', setOffline);
    };
  });

  /**
   * Registers SW controllerchange + update handlers.
   * Shared between Google auth and device-only mode onMount paths.
   */
  function _registerServiceWorkerUpdates() {
    // Reload when a new SW takes control so the app picks up fresh cached assets.
    const onControllerChange = () => window.location.reload();
    navigator.serviceWorker?.addEventListener('controllerchange', onControllerChange);

    // Explicit SW update check — registerSW.js only registers, does not handle SKIP_WAITING.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (!reg) return;
        const skipWaiting = (sw) => sw.postMessage({ type: 'SKIP_WAITING' });
        if (reg.waiting) { skipWaiting(reg.waiting); }
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              skipWaiting(sw);
            }
          });
        });
        reg.update().catch(() => {});
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  async function handleSignIn() {
    signingIn = true;
    signInError = null;
    try {
      await loadGisScript();
      initTokenClient();
      await requestToken();
      // _handleTokenResponse in auth.js fires, calls _onTokenUpdate,
      // which sets authToken store → $isAuthenticated becomes true
    } catch (err) {
      // popup_closed_by_user: user dismissed popup intentionally — silent
      // access_denied: user denied — silent (they can try again)
      if (err !== 'popup_closed_by_user' && err !== 'access_denied' && err?.type !== 'popup_closed') {
        signInError = 'Sign-in failed. Please try again.';
        console.error('[auth] Sign-in error:', err);
      }
    } finally {
      signingIn = false;
    }
  }

  async function handleContinue() {
    signingIn = true;
    signInError = null;
    try {
      await loadGisScript();
      initTokenClient();
      await refreshToken(returningEmail);
    } catch (err) {
      if (err !== 'popup_closed_by_user' && err !== 'access_denied' && err?.type !== 'popup_closed') {
        signInError = 'Sign-in failed. Please try again.';
        console.error('[auth] Continue error:', err);
      }
    } finally {
      signingIn = false;
    }
  }

  /** Called by Settings → Account sign-out button */
  export function handleSignOut() {
    clearCache();
    revokeToken();
    // _onTokenUpdate fires → authToken.set(null) → sign-in screen shows
  }

  async function handleRefresh() {
    refreshBannerVisible = false;
    try {
      await refreshToken($userEmail);
      // _handleTokenResponse fires → token refreshed, banner stays hidden
    } catch {
      // Silent refresh failed (user revoked access, etc.) — force full re-auth
      authToken.set(null);
      userEmail.set(null);
    }
  }
</script>

<!-- =========================================================================
     PUBLIC: No auth, no app shell (privacy policy, terms of service)
     ========================================================================= -->

{#if isPublicRoute}
  {@render children()}

<!-- =========================================================================
     UNAUTHENTICATED: Full-page sign-in screen
     ========================================================================= -->

{:else if !$isAuthenticated}
  <div
    class="min-h-screen flex flex-col items-center justify-center px-6 gap-8"
    style="background-color: var(--color-surface); color: var(--color-text);"
  >
    <!-- Wordmark -->
    <div class="text-center">
      <div class="text-5xl mb-3" aria-hidden="true">🧾</div>
      <h1 class="text-3xl font-bold tracking-tight">BizTrack</h1>
      <p class="mt-2 text-base" style="color: var(--color-text-muted);">
        Business expense &amp; mileage tracker
      </p>
    </div>

    <!-- Sign-in controls -->
    <div class="flex flex-col items-center gap-3 w-full max-w-xs">
      {#if returningEmail}
        <!-- Returning user: one-tap continue (popup triggered by user gesture, not blocked) -->
        <button
          onclick={handleContinue}
          disabled={signingIn}
          class="w-full flex items-center justify-center gap-3 rounded-xl px-6 font-medium text-base transition-opacity hover:opacity-80 disabled:opacity-50"
          style="min-height: 48px; background-color: var(--color-primary); color: #ffffff;"
          aria-busy={signingIn}
        >
          {#if signingIn}
            <Spinner />
            <span>Signing in…</span>
          {:else}
            <span>Continue as {returningEmail}</span>
          {/if}
        </button>
        <button
          onclick={handleSignIn}
          disabled={signingIn}
          class="text-sm underline disabled:opacity-50"
          style="color: var(--color-text-muted);"
        >
          Use a different account
        </button>
      {:else}
        <!-- First-time or signed-out user: full Google sign-in button -->
        <button
          onclick={handleSignIn}
          disabled={signingIn}
          class="w-full flex items-center justify-center gap-3 rounded-xl border px-6 font-medium text-base transition-opacity hover:opacity-80 disabled:opacity-50"
          style="
            min-height: 48px;
            background-color: #ffffff;
            color: #1f1f1f;
            border-color: #dadce0;
          "
          aria-busy={signingIn}
        >
          {#if signingIn}
            <Spinner />
            <span>Signing in…</span>
          {:else}
            <!-- Google "G" logo SVG -->
            <svg class="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            <span>Sign in with Google</span>
          {/if}
        </button>
      {/if}

      {#if signInError}
        <p class="text-sm text-center" style="color: var(--color-error);" role="alert">
          {signInError}
        </p>
      {/if}

      <!-- Divider -->
      <div class="flex items-center gap-3 w-full">
        <div class="flex-1 h-px" style="background-color: var(--color-border);"></div>
        <span class="text-xs" style="color: var(--color-text-muted);">or</span>
        <div class="flex-1 h-px" style="background-color: var(--color-border);"></div>
      </div>

      <!-- Device-only mode -->
      <button
        onclick={handleEnterDeviceMode}
        class="w-full flex items-center justify-center gap-2 rounded-xl border px-6 font-medium text-sm transition-opacity hover:opacity-80"
        style="
          min-height: 48px;
          border-color: var(--color-border);
          color: var(--color-text-muted);
          background-color: var(--color-surface);
        "
      >
        <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
        <span>Use without Google</span>
      </button>
      <p class="text-xs text-center" style="color: var(--color-text-muted);">
        Data stays on this device only
      </p>
    </div>

    <!-- Footer note -->
    <p class="text-xs text-center max-w-xs" style="color: var(--color-text-muted);">
      Your data is stored in your own Google Drive. BizTrack only accesses files it creates.
    </p>
    {#if appVersion}
      <p class="text-xs text-center" style="color: var(--color-text-muted);">v{appVersion}</p>
    {/if}
  </div>

<!-- =========================================================================
     AUTHENTICATED: App shell
     ========================================================================= -->

{:else}
  <!-- Offline banner — z-30 so it renders above the session banner (hidden in device mode) -->
  {#if !isOnline && !$deviceMode}
    <div
      class="sticky top-0 z-30 flex items-center justify-center px-4 py-2 text-sm font-medium"
      style="background-color: var(--color-error); color: #ffffff;"
      role="status"
    >
      <svg class="w-4 h-4 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636a9 9 0 010 12.728M15.536 8.464a5 5 0 010 7.072M12 12h.01M3 3l18 18" />
      </svg>
      No connection — changes will sync when online
    </div>
  {/if}

  <!-- Session expiry banner — z-20 so it renders above the sticky header (hidden in device mode) -->
  {#if refreshBannerVisible && !$deviceMode}
    <div
      class="sticky top-0 z-20 flex items-center justify-between px-4 py-2 text-sm"
      style="background-color: var(--color-primary); color: var(--color-primary-text);"
      role="status"
    >
      <span>Session expiring — tap to continue</span>
      <button
        onclick={handleRefresh}
        class="font-semibold underline rounded"
        style="min-height: 48px; min-width: 48px; color: inherit;"
      >
        Continue
      </button>
    </div>
  {/if}

  <!-- App chrome: sticky top bar + scrollable main content -->
  <div
    class="flex flex-col"
    style="height: 100dvh; background-color: var(--color-surface); color: var(--color-text);"
  >
    <header
      class="sticky top-0 z-10 flex items-center h-14 px-2 border-b"
      style="
        background-color: var(--color-surface);
        border-color: var(--color-border);
        padding-top: env(safe-area-inset-top);
      "
    >
      <!-- Back button (settings sub-pages + entry form pages) -->
      {#if isSettingsSub || isEntryForm}
        <a
          href={backHref}
          class="rounded-lg hover:opacity-70 transition-opacity"
          aria-label="Go back"
          style="color: var(--color-primary);"
        >
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </a>
      {:else if !isSettings && !isHistory}
        <!-- History clock icon — visible on main screen -->
        <a
          href="/history"
          class="rounded-lg hover:opacity-70 transition-opacity"
          aria-label="View history"
          style="color: var(--color-text-muted);"
        >
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </a>
      {:else}
        <div class="w-8" aria-hidden="true"></div>
      {/if}

      <!-- App title with sync indicator -->
      <a
        href="/"
        class="flex-1 flex items-center justify-center gap-1.5 text-lg font-semibold tracking-tight px-2 hover:opacity-70 transition-opacity"
        style="color: var(--color-text);"
      >
        BizTrack
        {#if $deviceMode}
          <svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="#22c55e" viewBox="0 0 24 24" aria-label="Device-only mode" role="status">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        {:else}
          <span
            class="inline-block w-2 h-2 rounded-full flex-shrink-0"
            style="background-color: {$syncStatus === 'green' ? '#22c55e' :
                                       $syncStatus === 'yellow' ? '#eab308' : '#ef4444'};"
            role="status"
            aria-label="Sync status: {$syncStatus === 'green' ? 'synced' :
                                       $syncStatus === 'yellow' ? 'syncing' : 'sync error'}"
          ></span>
        {/if}
      </a>

      <!-- Gear / close icon (hidden on entry form pages) -->
      {#if !isSettingsSub && !isEntryForm}
        <a
          href={isSettings || isHistory ? '/' : '/settings'}
          class="rounded-lg hover:opacity-70 transition-opacity"
          aria-label={isSettings || isHistory ? 'Go to main screen' : 'Open settings'}
          style="color: var(--color-text-muted);"
        >
          {#if isSettings || isHistory}
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          {:else}
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          {/if}
        </a>
      {:else}
        <!-- Spacer keeps title centered on sub-settings pages (back btn on left) -->
        <div class="w-12" aria-hidden="true"></div>
      {/if}
    </header>

    <main class="flex-1 overflow-y-auto">
      {#if appLoading}
        <div class="flex items-center justify-center min-h-[60vh]">
          <span style="color: var(--color-primary);"><Spinner size="w-8 h-8" /></span>
        </div>
      {:else}
        {@render children()}
      {/if}
    </main>

    <!-- iOS install prompt — fixed bottom bar, only on iOS Safari when not installed -->
    {#if showIosInstallPrompt && !iosPromptDismissed}
      <div
        class="fixed bottom-0 left-0 right-0 z-40 px-4 py-3 flex items-start gap-3 border-t shadow-lg"
        style="
          background-color: var(--color-surface-2);
          border-color: var(--color-border);
          padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
        "
        role="complementary"
        aria-label="Install BizTrack"
      >
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold" style="color: var(--color-text);">Install BizTrack</p>
          <p class="text-xs mt-0.5" style="color: var(--color-text-muted);">
            Tap
            <svg class="w-4 h-4 inline-block mx-0.5 align-text-bottom" fill="currentColor" viewBox="0 0 24 24" aria-label="Share">
              <path d="M12 2l-4 4h3v8h2V6h3L12 2zm-7 14v4h14v-4h-2v2H7v-2H5z"/>
            </svg>
            then <strong>Add to Home Screen</strong>
          </p>
        </div>
        <button
          onclick={() => { iosPromptDismissed = true; storage.set(IOS_PROMPT_KEY, true); }}
          class="flex-shrink-0 rounded p-1 hover:opacity-70 transition-opacity"
          aria-label="Dismiss"
          style="color: var(--color-text-muted); min-width: 36px; min-height: 36px;"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    {/if}
  </div>
{/if}
