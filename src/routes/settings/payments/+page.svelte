<script>
  /**
   * Payment Methods management screen.
   * Per-business list of payment accounts from config.json.
   * "Cash" is always present and cannot be removed.
   */

  import { selectedBusiness, businessConfig } from '$lib/store.js';
  import { addPaymentMethod, removePaymentMethod } from '$lib/business.js';
  import { get } from 'svelte/store';

  let addOpen    = $state(false);
  let newMethod  = $state('');
  let adding     = $state(false);
  let deletingMethod = $state(/** @type {string|null} */(null));
  let error      = $state('');

  async function handleAdd() {
    const trimmed = newMethod.trim();
    if (!trimmed) return;

    const biz = get(selectedBusiness);
    const cfg = get(businessConfig);
    if (!biz || !cfg) { error = 'No business loaded.'; return; }

    adding = true;
    error  = '';
    try {
      await addPaymentMethod(biz, cfg, trimmed);
      newMethod = '';
      addOpen   = false;
    } catch (err) {
      console.error('[payments] add:', err);
      error = 'Failed to save. Check your connection.';
    } finally {
      adding = false;
    }
  }

  async function handleDelete(method) {
    const biz = get(selectedBusiness);
    const cfg = get(businessConfig);
    if (!biz || !cfg) return;

    deletingMethod = method;
    error = '';
    try {
      await removePaymentMethod(biz, cfg, method);
    } catch (err) {
      console.error('[payments] delete:', err);
      error = 'Failed to delete. Try again.';
    } finally {
      deletingMethod = null;
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
      {#each $businessConfig.payment_accounts as method (method)}
        <div class="flex items-center justify-between px-4" style="min-height: 52px;">
          <span class="text-base" style="color: var(--color-text);">{method}</span>
          {#if method !== 'Cash'}
            <button
              onclick={() => handleDelete(method)}
              disabled={deletingMethod === method}
              class="ml-3 flex-shrink-0 rounded p-1 hover:opacity-70 transition-opacity disabled:opacity-40"
              aria-label="Remove {method}"
              style="color: var(--color-text-muted); min-width: 36px; min-height: 36px;"
            >
              {#if deletingMethod === method}
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
            <!-- Spacer to keep "Cash" row aligned -->
            <div class="w-9" aria-hidden="true"></div>
          {/if}
        </div>
      {/each}

      <!-- Add method row -->
      {#if addOpen}
        <div class="flex items-center gap-2 px-4 py-2">
          <input
            type="text"
            bind:value={newMethod}
            placeholder="e.g. Chase Business Visa x4521"
            onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
            class="flex-1 text-sm"
            style="min-height: 40px;"
          />
          <button
            type="button"
            onclick={handleAdd}
            disabled={adding || !newMethod.trim()}
            class="rounded-xl text-sm font-medium px-4 flex-shrink-0 disabled:opacity-50"
            style="min-height: 40px; background-color: var(--color-primary); color: var(--color-primary-text);"
          >
            {adding ? '…' : 'Add'}
          </button>
          <button
            type="button"
            onclick={() => { addOpen = false; newMethod = ''; }}
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
          <span class="text-base">+ Add Payment Method</span>
        </button>
      {/if}
    </div>

    <p class="text-xs px-1" style="color: var(--color-text-muted);">
      "Cash" is always available and cannot be removed.
    </p>
  {/if}

</div>
