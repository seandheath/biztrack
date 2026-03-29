<script>
  /**
   * Expense Categories management screen.
   * Per-business list of categories from config.json.
   * "Uncategorized" is always present and cannot be removed.
   */

  import { selectedBusiness, businessConfig } from '$lib/store.js';
  import { addCategory, removeCategory } from '$lib/business.js';
  import { get } from 'svelte/store';

  let addOpen   = $state(false);
  let newCat    = $state('');
  let adding    = $state(false);
  let deletingCat = $state(/** @type {string|null} */(null));
  let error     = $state('');

  async function handleAdd() {
    const trimmed = newCat.trim();
    if (!trimmed) return;

    const biz = get(selectedBusiness);
    const cfg = get(businessConfig);
    if (!biz || !cfg) { error = 'No business loaded.'; return; }

    adding = true;
    error  = '';
    try {
      await addCategory(biz, cfg, trimmed);
      newCat  = '';
      addOpen = false;
    } catch (err) {
      console.error('[categories] add:', err);
      error = 'Failed to save. Check your connection.';
    } finally {
      adding = false;
    }
  }

  async function handleDelete(category) {
    const biz = get(selectedBusiness);
    const cfg = get(businessConfig);
    if (!biz || !cfg) return;

    deletingCat = category;
    error = '';
    try {
      await removeCategory(biz, cfg, category);
    } catch (err) {
      console.error('[categories] delete:', err);
      error = 'Failed to delete. Try again.';
    } finally {
      deletingCat = null;
    }
  }
</script>

<div class="px-4 py-6 flex flex-col gap-4 max-w-lg mx-auto">

  {#if !$selectedBusiness}
    <div class="rounded-xl border p-6 text-center" style="border-color: var(--color-border);">
      <p class="text-base" style="color: var(--color-text-muted);">
        Select a business on the main screen first.
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
    <p class="text-xs font-semibold uppercase tracking-wider px-1" style="color: var(--color-text-muted);">
      {$selectedBusiness.name}
    </p>

    {#if error}
      <p class="text-sm rounded-xl px-4 py-3" style="color: var(--color-error); background-color: var(--color-surface-2);">
        {error}
      </p>
    {/if}

    <div
      class="rounded-xl border divide-y overflow-hidden"
      style="border-color: var(--color-border); background-color: var(--color-surface-2);"
    >
      {#each $businessConfig.categories as category (category)}
        <div class="flex items-center justify-between px-4" style="min-height: 52px;">
          <span class="text-base" style="color: var(--color-text);">{category}</span>
          {#if category !== 'Uncategorized'}
            <button
              onclick={() => handleDelete(category)}
              disabled={deletingCat === category}
              class="ml-3 flex-shrink-0 rounded p-1 hover:opacity-70 transition-opacity disabled:opacity-40"
              aria-label="Remove {category}"
              style="color: var(--color-text-muted); min-width: 36px; min-height: 36px;"
            >
              {#if deletingCat === category}
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
          {:else}
            <!-- Spacer to keep "Uncategorized" row aligned -->
            <div class="w-9" aria-hidden="true"></div>
          {/if}
        </div>
      {/each}

      <!-- Add category row -->
      {#if addOpen}
        <div class="flex items-center gap-2 px-4 py-2">
          <input
            type="text"
            bind:value={newCat}
            placeholder="e.g. Equipment Rental"
            onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
            class="flex-1 text-sm"
            style="min-height: 40px;"
          />
          <button
            type="button"
            onclick={handleAdd}
            disabled={adding || !newCat.trim()}
            class="rounded-xl text-sm font-medium px-4 flex-shrink-0 disabled:opacity-50"
            style="min-height: 40px; background-color: var(--color-primary); color: var(--color-primary-text);"
          >
            {adding ? '…' : 'Add'}
          </button>
          <button
            type="button"
            onclick={() => { addOpen = false; newCat = ''; }}
            class="rounded-xl text-sm px-2 flex-shrink-0"
            style="min-height: 40px; background: transparent; color: var(--color-text-muted);"
            aria-label="Cancel"
          >
            ✕
          </button>
        </div>
      {:else}
        <button
          type="button"
          onclick={() => { addOpen = true; }}
          class="w-full flex items-center px-4 text-left hover:opacity-70 transition-opacity"
          style="color: var(--color-primary); min-height: 52px;"
        >
          <span class="text-base">+ Add Category</span>
        </button>
      {/if}
    </div>

    <p class="text-xs px-1" style="color: var(--color-text-muted);">
      "Uncategorized" is always available and cannot be removed.
    </p>
  {/if}

</div>
