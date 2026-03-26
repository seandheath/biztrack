<script>
  import '../app.css';
  import { page } from '$app/stores';

  /** @type {{ children: import('svelte').Snippet }} */
  let { children } = $props();

  // Determine navigation context from current route
  // Used to show/hide the gear icon and back button in the top bar.
  let isSettings = $derived($page.url.pathname.startsWith('/settings'));
  let isSettingsRoot = $derived($page.url.pathname === '/settings');
  let isSettingsSub = $derived(isSettings && !isSettingsRoot);

  // Back link target depends on depth: sub-settings pages → /settings, settings root → /
  let backHref = $derived(isSettingsSub ? '/settings' : '/');
</script>

<div class="min-h-screen flex flex-col" style="background-color: var(--color-surface); color: var(--color-text);">

  <!-- Top bar: sticky, full-width, contains nav controls and app title -->
  <header
    class="sticky top-0 z-10 flex items-center h-14 px-2 border-b"
    style="
      background-color: var(--color-surface);
      border-color: var(--color-border);
      padding-top: env(safe-area-inset-top);
    "
  >
    <!-- Back button (settings sub-pages only) -->
    {#if isSettingsSub}
      <a
        href={backHref}
        class="rounded-lg hover:opacity-70 transition-opacity"
        aria-label="Go back"
        style="color: var(--color-primary);"
      >
        <!-- Chevron left -->
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </a>
    {/if}

    <!-- App title -->
    <span class="flex-1 text-center text-lg font-semibold tracking-tight px-2">
      BizTrack
    </span>

    <!-- Gear icon (main screen and settings root — not sub-pages, which have back button) -->
    {#if !isSettingsSub}
      <a
        href={isSettings ? '/' : '/settings'}
        class="rounded-lg hover:opacity-70 transition-opacity"
        aria-label={isSettings ? 'Go to main screen' : 'Open settings'}
        style="color: var(--color-text-muted);"
      >
        {#if isSettings}
          <!-- X / close icon when on settings root -->
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        {:else}
          <!-- Gear icon on main screen -->
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        {/if}
      </a>
    {:else}
      <!-- Spacer to keep title centered on sub-settings pages -->
      <div class="w-12"></div>
    {/if}
  </header>

  <!-- Main content area -->
  <!-- padding-bottom respects notched phone home indicator (spec §6.1) -->
  <main
    class="flex-1 overflow-y-auto"
    style="padding-bottom: env(safe-area-inset-bottom);"
  >
    {@render children()}
  </main>
</div>
