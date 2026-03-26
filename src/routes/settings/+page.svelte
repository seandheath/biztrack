<script>
  // Settings screen (Phase 7.3 for businesses/payments/favorites sections).
  // Account section wired here in Phase 2.
  import { userEmail } from '$lib/store.js';

  // handleSignOut is exported from +layout.svelte.
  // SvelteKit doesn't provide a direct way to call parent layout methods,
  // so we import revokeToken directly and let the layout's _onTokenUpdate
  // callback handle clearing the stores.
  import { revokeToken } from '$lib/auth.js';

  function signOut() {
    revokeToken();
  }
</script>

<div class="px-4 py-6 flex flex-col gap-6 max-w-lg mx-auto">

  <!-- Businesses -->
  <section>
    <h2 class="text-xs font-semibold uppercase tracking-wider mb-2 px-1" style="color: var(--color-text-muted);">
      Businesses
    </h2>
    <div class="rounded-xl border divide-y overflow-hidden" style="border-color: var(--color-border); background-color: var(--color-surface-2);">
      <a
        href="/settings/business"
        class="flex items-center justify-between px-4 hover:opacity-70 transition-opacity"
        style="color: var(--color-primary);"
      >
        <span class="text-base">Add Business</span>
        <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </a>
    </div>
    <p class="text-xs mt-1 px-1" style="color: var(--color-text-muted);">
      Business list coming in Phase 7.
    </p>
  </section>

  <!-- Per-business settings -->
  <section>
    <h2 class="text-xs font-semibold uppercase tracking-wider mb-2 px-1" style="color: var(--color-text-muted);">
      Per-Business
    </h2>
    <div class="rounded-xl border divide-y overflow-hidden" style="border-color: var(--color-border); background-color: var(--color-surface-2);">
      <a
        href="/settings/payments"
        class="flex items-center justify-between px-4 hover:opacity-70 transition-opacity"
        style="color: var(--color-text);"
      >
        <span class="text-base">Payment Methods</span>
        <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </a>
      <a
        href="/settings/favorites"
        class="flex items-center justify-between px-4 hover:opacity-70 transition-opacity"
        style="color: var(--color-text);"
      >
        <span class="text-base">Mileage Favorites</span>
        <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
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

</div>
