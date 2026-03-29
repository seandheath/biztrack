<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { selectedBusiness, userEmail } from '$lib/store.js';
  import { enqueueUpdate } from '$lib/services/sync.js';
  import { queryUncategorized } from '$lib/db/queries.js';
  import { QUICKBOOKS_CATEGORIES } from '$lib/constants.js';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** All uncategorized transactions loaded on mount */
  let transactions = $state([]);

  /** Index into transactions — which one is currently being reviewed */
  let index = $state(0);

  /** Category selected for the current transaction */
  let category = $state('');

  let saving        = $state(false);
  let loaded        = $state(false);
  let applyToVendor = $state(false);

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  let current = $derived(transactions[index] ?? null);
  let total   = $derived(transactions.length);
  let done    = $derived(loaded && index >= total);

  // Progress percentage for the bar
  let progress = $derived(total > 0 ? Math.round((index / total) * 100) : 0);

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  onMount(async () => {
    if (!$selectedBusiness) { goto('/'); return; }
    transactions = await queryUncategorized($selectedBusiness.id);
    category = transactions[0]?.category || 'Uncategorized';
    loaded = true;
  });

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /** Advance index and reset category selector to the next transaction's value */
  function advance() {
    index++;
    applyToVendor = false;
    category = transactions[index]?.category || 'Uncategorized';
  }

  /** Save the selected category to the current transaction (or all matching vendor+year), then advance */
  async function saveAndNext() {
    if (!current || saving) return;
    saving = true;
    try {
      if (applyToVendor) {
        const toUpdate = transactions.filter(
          (t) => t.vendor === current.vendor && t.year === current.year
        );
        for (const t of toUpdate) {
          await enqueueUpdate(t.id, { category });
        }
        const updatedIds = new Set(toUpdate.map((t) => t.id));
        const removedBefore = transactions.slice(0, index).filter((t) => updatedIds.has(t.id)).length;
        transactions = transactions.filter((t) => !updatedIds.has(t.id));
        index = Math.max(0, index - removedBefore);
        applyToVendor = false;
        category = transactions[index]?.category || 'Uncategorized';
      } else {
        await enqueueUpdate(current.id, { category });
        advance();
      }
    } finally {
      saving = false;
    }
  }

  /** Skip this transaction without saving */
  function skip() {
    advance();
  }

  /** Navigate to the full expense editor for the current transaction */
  function editFull() {
    if (!current) return;
    const u = new URL('/expense', window.location.origin);
    u.searchParams.set('biz',  $selectedBusiness.id);
    u.searchParams.set('year', String(current.year));
    u.searchParams.set('txn',  current.id);
    goto(u.toString());
  }
</script>

<div class="flex flex-col h-full" style="background-color: var(--color-surface);">

  <!-- Header -->
  <div
    class="flex items-center justify-between px-4 pt-4 pb-3 flex-shrink-0 border-b"
    style="border-color: var(--color-border);"
  >
    <a
      href="/"
      class="text-sm flex items-center gap-1 hover:opacity-70 transition-opacity"
      style="color: var(--color-primary);"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      Home
    </a>
    <h1 class="text-base font-semibold" style="color: var(--color-text);">Review Uncategorized</h1>
    {#if !done && total > 0}
      <span class="text-sm" style="color: var(--color-text-muted);">{index + 1} of {total}</span>
    {:else}
      <span class="w-12"></span>
    {/if}
  </div>

  <!-- Progress bar -->
  {#if total > 0}
    <div class="h-1 flex-shrink-0" style="background-color: var(--color-border);">
      <div
        class="h-full transition-all duration-300"
        style="width: {progress}%; background-color: var(--color-primary);"
      ></div>
    </div>
  {/if}

  <!-- Body -->
  <div class="flex-1 overflow-y-auto px-4 py-6 flex flex-col gap-6 max-w-lg mx-auto w-full">

    {#if !loaded}
      <!-- Loading -->
      <div class="flex items-center justify-center py-12">
        <svg class="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24" aria-label="Loading">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z"></path>
        </svg>
      </div>

    {:else if done}
      <!-- All done -->
      <div class="flex flex-col items-center justify-center py-12 gap-4 text-center">
        <div class="w-12 h-12 rounded-full flex items-center justify-center" style="background-color: var(--color-success); opacity: 0.15;"></div>
        <svg class="w-10 h-10 -mt-14" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" style="color: var(--color-success);">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
        </svg>
        <div>
          <p class="text-lg font-semibold" style="color: var(--color-text);">All caught up</p>
          <p class="text-sm mt-1" style="color: var(--color-text-muted);">
            {total === 0 ? 'No uncategorized transactions found.' : 'All uncategorized transactions have been reviewed.'}
          </p>
        </div>
        <a
          href="/"
          class="rounded-xl font-medium text-base px-8 flex items-center justify-center transition-opacity hover:opacity-80"
          style="min-height: 48px; background-color: var(--color-primary); color: var(--color-primary-text);"
        >
          Back to Home
        </a>
      </div>

    {:else if current}
      <!-- Transaction card -->
      <div
        class="rounded-xl border p-4 flex flex-col gap-3"
        style="border-color: var(--color-border); background-color: var(--color-surface-2);"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="flex flex-col gap-0.5 min-w-0">
            <span class="text-base font-semibold truncate" style="color: var(--color-text);">{current.vendor}</span>
            <span class="text-sm" style="color: var(--color-text-muted);">{current.date}</span>
          </div>
          <span class="text-base font-bold flex-shrink-0" style="color: var(--color-primary);">
            ${Number(current.amount).toFixed(2)}
          </span>
        </div>

        {#if current.paymentMethod}
          <div class="flex items-center gap-2 text-sm" style="color: var(--color-text-muted);">
            <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
            {current.paymentMethod}
          </div>
        {/if}

        {#if current.description}
          <p class="text-xs leading-snug" style="color: var(--color-text-muted);">{current.description}</p>
        {/if}
      </div>

      <!-- Category selector -->
      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium" style="color: var(--color-text);" for="category-select">
          Category
        </label>
        <select
          id="category-select"
          bind:value={category}
          class="rounded-xl border px-3 text-base"
          style="
            min-height: 48px;
            background-color: var(--color-surface-2);
            border-color: var(--color-border);
            color: var(--color-text);
          "
        >
          {#each QUICKBOOKS_CATEGORIES as c}
            <option value={c}>{c}</option>
          {/each}
        </select>
      </div>

      <!-- Apply to vendor checkbox -->
      <label class="flex items-center gap-3 text-sm cursor-pointer select-none">
        <input
          type="checkbox"
          bind:checked={applyToVendor}
          class="w-4 h-4 rounded"
          style="accent-color: var(--color-primary);"
        />
        <span style="color: var(--color-text-muted);">
          Apply to all <strong style="color: var(--color-text);">{current.vendor}</strong> transactions this year
        </span>
      </label>

      <!-- Actions -->
      <div class="flex flex-col gap-3">
        <button
          onclick={saveAndNext}
          disabled={saving || category === 'Uncategorized'}
          class="w-full rounded-xl font-semibold text-base transition-opacity hover:opacity-80 disabled:opacity-50"
          style="min-height: 52px; background-color: var(--color-primary); color: var(--color-primary-text);"
          aria-busy={saving}
        >
          {saving ? 'Saving…' : category === 'Uncategorized' ? 'Select a category first'
            : applyToVendor ? `Apply to all ${current.vendor}` : 'Save & Next'}
        </button>

        <div class="flex items-center justify-between">
          <button
            onclick={skip}
            class="text-sm hover:opacity-70 transition-opacity px-2 py-2"
            style="color: var(--color-text-muted);"
          >
            Skip
          </button>
          <button
            onclick={editFull}
            class="text-sm hover:opacity-70 transition-opacity px-2 py-2"
            style="color: var(--color-primary);"
          >
            Edit full transaction →
          </button>
        </div>
      </div>
    {/if}

  </div>
</div>
