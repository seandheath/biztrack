<script>
  /**
   * Mileage Favorites management screen.
   * Lists saved routes from config.json and allows deletion.
   * Favorites are added from the mileage entry form on the main screen.
   */

  import { goto } from '$app/navigation';
  import { selectedBusiness, businessConfig } from '$lib/store.js';
  import { deleteMileageFavorite } from '$lib/business.js';
  import { get } from 'svelte/store';

  /** Track which favorite is being deleted (by name) */
  let deletingName = $state(/** @type {string|null} */(null));

  /** Inline error message */
  let error = $state('');

  async function handleDelete(name) {
    const biz = get(selectedBusiness);
    const cfg = get(businessConfig);

    if (!biz || !cfg) {
      error = 'No business selected. Go back to main screen first.';
      return;
    }

    deletingName = name;
    error = '';
    try {
      await deleteMileageFavorite(biz, cfg, name);
    } catch (err) {
      console.error('[favorites] delete:', err);
      error = 'Failed to delete. Check your connection and try again.';
    } finally {
      deletingName = null;
    }
  }
</script>

<div class="px-4 py-6 flex flex-col gap-4 max-w-lg mx-auto">

  {#if !$selectedBusiness}
    <div class="rounded-xl border p-6 text-center" style="border-color: var(--color-border);">
      <p class="text-base" style="color: var(--color-text-muted);">
        Select a business on the main screen to manage its favorites.
      </p>
      <a
        href="/"
        class="mt-4 inline-flex rounded-xl text-sm font-medium px-5"
        style="background-color: var(--color-primary); color: var(--color-primary-text); min-height: 44px;"
      >
        Go to Main Screen
      </a>
    </div>

  {:else if !$businessConfig}
    <div class="flex items-center justify-center py-12 gap-3">
      <svg class="w-5 h-5 animate-spin" style="color: var(--color-text-muted);" fill="none" viewBox="0 0 24 24" aria-hidden="true">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z" />
      </svg>
      <span class="text-sm" style="color: var(--color-text-muted);">Loading…</span>
    </div>

  {:else}
    <!-- Business context label -->
    <p class="text-xs font-semibold uppercase tracking-wider px-1" style="color: var(--color-text-muted);">
      {$selectedBusiness.name}
    </p>

    {#if error}
      <p class="text-sm rounded-xl px-4 py-3" style="color: var(--color-error); background-color: var(--color-surface-2);">
        {error}
      </p>
    {/if}

    {#if $businessConfig.mileage_favorites.length === 0}
      <div
        class="rounded-xl border p-6 text-center"
        style="border-color: var(--color-border); background-color: var(--color-surface-2);"
      >
        <p class="text-base" style="color: var(--color-text-muted);">
          No favorites saved yet.
        </p>
        <p class="mt-1 text-sm" style="color: var(--color-text-muted);">
          Fill in a mileage entry on the main screen and tap "Save as Favorite".
        </p>
      </div>

    {:else}
      <div
        class="rounded-xl border divide-y overflow-hidden"
        style="border-color: var(--color-border); background-color: var(--color-surface-2);"
      >
        {#each $businessConfig.mileage_favorites as fav (fav.name)}
          <div class="px-4 py-3 flex items-start justify-between gap-3">
            <div class="flex-1 min-w-0">
              <p class="text-base font-medium truncate" style="color: var(--color-text);">{fav.name}</p>
              <p class="text-xs mt-0.5 truncate" style="color: var(--color-text-muted);">
                {fav.from} → {fav.to}
              </p>
              <p class="text-xs" style="color: var(--color-text-muted);">
                {fav.miles} mi · {fav.purpose}
              </p>
            </div>
            <button
              onclick={() => handleDelete(fav.name)}
              disabled={deletingName === fav.name}
              class="flex-shrink-0 rounded p-1 hover:opacity-70 transition-opacity disabled:opacity-40"
              aria-label="Delete {fav.name}"
              style="color: var(--color-text-muted); min-width: 36px; min-height: 36px;"
            >
              {#if deletingName === fav.name}
                <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z" />
                </svg>
              {:else}
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              {/if}
            </button>
          </div>
        {/each}
      </div>
    {/if}
  {/if}

</div>
