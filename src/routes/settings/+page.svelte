<script>
  import { goto } from '$app/navigation';
  import { userEmail, businesses, selectedBusiness } from '$lib/store.js';
  import { revokeToken } from '$lib/auth.js';

  // Injected by vite.config.js at build time
  /* global __APP_VERSION__ */
  const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';

  function signOut() {
    revokeToken();
  }

  function openBusiness(business) {
    selectedBusiness.set(business);
    goto('/settings/business-config');
  }
</script>

<div class="px-4 py-6 flex flex-col gap-6 max-w-lg mx-auto">

  <!-- Businesses -->
  <section>
    <h2 class="text-xs font-semibold uppercase tracking-wider mb-2 px-1" style="color: var(--color-text-muted);">
      Businesses
    </h2>
    <div class="rounded-xl border divide-y overflow-hidden flex flex-col" style="border-color: var(--color-border); background-color: var(--color-surface-2);">
      {#each $businesses as business (business.name)}
        <div
          role="button"
          tabindex="0"
          onclick={() => openBusiness(business)}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') openBusiness(business); }}
          class="flex items-center px-4 hover:opacity-70 transition-opacity cursor-pointer"
          style="min-height: 48px;"
        >
          <span class="text-base truncate" style="color: var(--color-text);">{business.name}</span>
        </div>
      {/each}
      <a
        href="/settings/business"
        class="flex items-center px-4 hover:opacity-70 transition-opacity"
        style="color: var(--color-primary); min-height: 48px;"
      >
        <span class="text-base">Add Business</span>
      </a>
    </div>
  </section>

  <!-- Account -->
  <section>
    <h2 class="text-xs font-semibold uppercase tracking-wider mb-2 px-1" style="color: var(--color-text-muted);">
      Account
    </h2>
    <div class="rounded-xl border divide-y overflow-hidden" style="border-color: var(--color-border); background-color: var(--color-surface-2);">
      <!-- Signed-in email -->
      <div class="flex items-center px-4 py-3">
        <svg class="w-5 h-5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" style="color: var(--color-text-muted);">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
        <span class="text-sm truncate" style="color: var(--color-text);">
          {$userEmail ?? 'Loading…'}
        </span>
      </div>
      <!-- Sign out -->
      <button
        onclick={signOut}
        class="w-full flex items-center px-4 text-left hover:opacity-70 transition-opacity"
        style="color: var(--color-error); min-height: 48px;"
      >
        <svg class="w-5 h-5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
        <span class="text-base">Sign Out</span>
      </button>
    </div>
  </section>

  <!-- Data -->
  <section>
    <h2 class="text-xs font-semibold uppercase tracking-wider mb-2 px-1" style="color: var(--color-text-muted);">
      Data
    </h2>
    <div class="rounded-xl border divide-y overflow-hidden" style="border-color: var(--color-border); background-color: var(--color-surface-2);">
      <a
        href="/settings/csv-import"
        class="flex items-center px-4 hover:opacity-70 transition-opacity"
        style="color: var(--color-text); min-height: 48px;"
      >
        <span class="text-base">Import bank CSV</span>
      </a>
    </div>
  </section>

  <!-- App version -->
  {#if appVersion}
    <p class="text-center text-xs pb-2" style="color: var(--color-text-muted);">
      BizTrack v{appVersion}
    </p>
  {/if}

</div>
