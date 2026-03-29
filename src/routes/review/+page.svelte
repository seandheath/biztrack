<script module>
  // Persists across SvelteKit client-side navigations within the session.
  // Transactions in this set are filtered out so they don't reappear.
  let skippedIds = new Set();
</script>

<script>
  /**
   * Review screen — routes directly to the expense edit form for each
   * uncategorized transaction. The summary card is intentionally gone;
   * the edit form is the review.
   *
   * Skip mechanism: the expense form navigates back as
   *   /review?skipped=<txnId>
   * This page picks up the param, adds it to the module-level skippedIds
   * Set, then redirects to the next transaction (or "all caught up").
   */

  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { selectedBusiness } from '$lib/store.js';
  import { pullTransactions } from '$lib/services/sheets.js';

  let loaded = $state(false);
  let total  = $state(0);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function buildEditUrl(txn) {
    const year = new Date(txn.date + 'T00:00:00').getFullYear();
    const u = new URL('/expense', window.location.origin);
    u.searchParams.set('biz',      $selectedBusiness.id);
    u.searchParams.set('year',     String(year));
    u.searchParams.set('txn',      txn.id);
    u.searchParams.set('returnTo', '/review');
    return u.toString();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  onMount(async () => {
    if (!$selectedBusiness) { goto('/'); return; }

    // Pick up any skipped txnId from the URL before pulling
    const sp = new URLSearchParams(window.location.search);
    const justSkipped = sp.get('skipped');
    if (justSkipped) skippedIds.add(justSkipped);

    const biz = $selectedBusiness;
    const currentYear = new Date().getFullYear();
    const allRows = [];
    for (let y = currentYear; y >= currentYear - 2; y--) {
      const sid = biz.sheetIds?.[y];
      if (!sid) continue;
      try { allRows.push(...await pullTransactions(sid, 'Expenses')); }
      catch (err) { console.warn(`[review] pull ${y}:`, err); }
    }

    const uncategorized = allRows
      .filter((r) => (!r.category || r.category === 'Uncategorized') && !skippedIds.has(r.id))
      .sort((a, b) => b.date.localeCompare(a.date));

    total = uncategorized.length;

    if (uncategorized.length > 0) {
      // Go directly to the edit form — replaceState so back button goes home
      goto(buildEditUrl(uncategorized[0]), { replaceState: true });
    } else {
      loaded = true;
    }
  });
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
    <span class="w-12"></span>
  </div>

  <!-- Body -->
  <div class="flex-1 overflow-y-auto px-4 py-6 flex flex-col gap-6 max-w-lg mx-auto w-full">

    {#if !loaded}
      <!-- Loading / redirecting -->
      <div class="flex items-center justify-center py-12">
        <svg class="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24" aria-label="Loading">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z"></path>
        </svg>
      </div>

    {:else}
      <!-- All caught up -->
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
    {/if}

  </div>
</div>
