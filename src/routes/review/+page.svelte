<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { selectedBusiness } from '$lib/store.js';
  import { pullTransactions } from '$lib/services/sheets.js';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** All uncategorized transactions loaded on mount */
  let transactions = $state([]);

  /** Index into transactions — which one is currently being reviewed */
  let index = $state(0);

  let loaded = $state(false);

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  let current  = $derived(transactions[index] ?? null);
  let total    = $derived(transactions.length);
  let done     = $derived(loaded && index >= total);
  let progress = $derived(total > 0 ? Math.round((index / total) * 100) : 0);

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  onMount(async () => {
    if (!$selectedBusiness) { goto('/'); return; }
    const biz = $selectedBusiness;
    const currentYear = new Date().getFullYear();
    const allRows = [];
    for (let y = currentYear; y >= currentYear - 2; y--) {
      const sid = biz.sheetIds?.[y];
      if (!sid) continue;
      try { allRows.push(...await pullTransactions(sid, 'Expenses')); }
      catch (err) { console.warn(`[review] pull ${y}:`, err); }
    }
    transactions = allRows
      .filter((r) => !r.category || r.category === 'Uncategorized')
      .sort((a, b) => b.date.localeCompare(a.date));
    loaded = true;
  });

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /** Skip this transaction without editing */
  function skip() {
    index++;
  }

  /** Build the URL to open the full expense form for a transaction */
  function buildEditUrl(txn) {
    const year = new Date(txn.date + 'T00:00:00').getFullYear();
    const u = new URL('/expense', window.location.origin);
    u.searchParams.set('biz',      $selectedBusiness.id);
    u.searchParams.set('year',     String(year));
    u.searchParams.set('txn',      txn.id);
    u.searchParams.set('returnTo', '/review');
    return u.toString();
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
      <!-- Transaction summary card -->
      <div
        class="rounded-xl border p-4 flex flex-col gap-2"
        style="border-color: var(--color-border); background-color: var(--color-surface-2);"
      >
        <div class="flex items-start justify-between gap-3">
          <span class="text-base font-semibold truncate" style="color: var(--color-text);">{current.vendor}</span>
          <span class="text-base font-bold flex-shrink-0" style="color: var(--color-primary);">
            ${Number(current.amount).toFixed(2)}
          </span>
        </div>
        <span class="text-sm" style="color: var(--color-text-muted);">{current.date}</span>
        {#if current.description}
          <p class="text-xs" style="color: var(--color-text-muted);">{current.description}</p>
        {/if}
      </div>

      <!-- Open full form to review/edit -->
      <a
        href={buildEditUrl(current)}
        class="w-full rounded-xl font-semibold text-base transition-opacity hover:opacity-80 flex items-center justify-center"
        style="min-height: 52px; background-color: var(--color-primary); color: var(--color-primary-text);"
      >
        Review →
      </a>

      <button
        onclick={skip}
        class="text-sm hover:opacity-70 transition-opacity px-2 py-2 self-start"
        style="color: var(--color-text-muted);"
      >
        Skip
      </button>
    {/if}

  </div>
</div>
