<script>
  /**
   * History screen — review past expense and mileage entries.
   *
   * Pure list view: tapping any row navigates to /transaction for
   * the full read-only detail, edit, share, and delete actions.
   */

  import { onMount } from 'svelte';
  import { liveQuery } from 'dexie';
  import { selectedBusiness } from '$lib/store.js';
  import { db } from '$lib/db/dexie.js';

  // ---------------------------------------------------------------------------
  // Tab / year state
  // ---------------------------------------------------------------------------

  /** @type {'expense'|'mileage'} */
  let activeTab = $state('expense');

  /** Years with sheets for the selected business, newest first. */
  let availableYears = $derived(
    Object.keys($selectedBusiness?.sheetIds ?? {})
      .sort()
      .reverse()
  );

  /** Currently selected year (number). */
  let selectedYear = $state(new Date().getFullYear());

  // ---------------------------------------------------------------------------
  // Live row state — driven by Dexie liveQuery
  // ---------------------------------------------------------------------------

  /** @type {import('$lib/db/dexie.js').Transaction[]} */
  let rows = $state([]);

  // Re-subscribe whenever business, year, or tab changes.
  $effect(() => {
    const bizId = $selectedBusiness?.id;
    const year  = Number(selectedYear);
    const type  = activeTab; // tracked as reactive dependency

    if (!bizId || !year) { rows = []; return; }

    const sub = liveQuery(() =>
      db.transactions
        .where('[businessId+type+year]')
        .equals([bizId, type, year])
        .toArray()
        .then((arr) => arr.sort((a, b) => b.date.localeCompare(a.date)))
    ).subscribe({
      next:  (r) => { rows = r; },
      error: (err) => { console.error('[history] liveQuery:', err); },
    });

    return () => sub.unsubscribe();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function transactionUrl(row) {
    const u = new URL('/transaction', window.location.origin);
    u.searchParams.set('biz',  $selectedBusiness.id);
    u.searchParams.set('year', String(selectedYear));
    u.searchParams.set('txn',  row.id);
    if (activeTab === 'mileage') u.searchParams.set('type', 'mileage');
    return u.toString();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  onMount(() => {
    if ($selectedBusiness) {
      const years = Object.keys($selectedBusiness.sheetIds ?? {}).sort().reverse();
      const currentYear = String(new Date().getFullYear());
      const bestYear = years.includes(currentYear) ? currentYear : (years[0] ?? String(currentYear));
      selectedYear = Number(bestYear);
    }
  });
</script>

<!-- =========================================================================
     No business selected
     ========================================================================= -->
{#if !$selectedBusiness}
  <div class="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center gap-4">
    <p class="text-base" style="color: var(--color-text-muted);">
      Select a business on the main screen first.
    </p>
    <a
      href="/"
      class="rounded-xl text-sm font-medium px-6"
      style="background-color: var(--color-primary); color: var(--color-primary-text); min-height: 44px; display:inline-flex; align-items:center;"
    >
      Go to Main Screen
    </a>
  </div>

{:else}
  <div class="px-4 pt-4 pb-8 flex flex-col gap-4 max-w-lg mx-auto">

    <!-- Business label -->
    <p class="text-xs font-semibold uppercase tracking-wider px-1" style="color: var(--color-text-muted);">
      {$selectedBusiness.name}
    </p>

    <!-- Controls row: year selector + tab toggle -->
    <div class="flex gap-3 items-center">
      <!-- Year selector -->
      {#if availableYears.length > 0}
        <select
          value={String(selectedYear)}
          onchange={(e) => { selectedYear = Number(e.target.value); }}
          class="text-sm"
          style="min-height: 40px; flex-shrink: 0;"
          aria-label="Select year"
        >
          {#each availableYears as year (year)}
            <option value={year}>{year}</option>
          {/each}
        </select>
      {:else}
        <span class="text-sm" style="color: var(--color-text-muted);">No data yet</span>
      {/if}

      <!-- Tab toggle -->
      <div
        class="flex flex-1 rounded-xl overflow-hidden border"
        style="border-color: var(--color-border);"
        role="tablist"
      >
        {#each ['expense', 'mileage'] as tab}
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            onclick={() => { activeTab = tab; }}
            class="flex-1 text-sm font-medium capitalize transition-colors"
            style="
              min-height: 40px;
              background-color: {activeTab === tab ? 'var(--color-primary)' : 'var(--color-surface-2)'};
              color: {activeTab === tab ? 'var(--color-primary-text)' : 'var(--color-text-muted)'};
            "
          >
            {tab}
          </button>
        {/each}
      </div>
    </div>

    <!-- Empty state -->
    {#if rows.length === 0}
      <div class="text-center py-12">
        <p class="text-base" style="color: var(--color-text-muted);">
          No {activeTab} entries in {selectedYear}.
        </p>
      </div>

    <!-- Row list — keyed by UUID, reactive via liveQuery -->
    {:else}
      <div
        class="rounded-xl border overflow-hidden divide-y"
        style="border-color: var(--color-border); background-color: var(--color-surface-2);"
      >
        {#each rows as row (row.id)}
          {#if activeTab === 'expense'}
            <a
              href={transactionUrl(row)}
              class="w-full flex items-center justify-between px-4 hover:opacity-80 transition-opacity"
              style="min-height: 52px; display: flex;"
              aria-label="View entry from {row.date}"
            >
              <div class="flex flex-col gap-0.5 min-w-0 flex-1 pr-3">
                <span class="text-xs" style="color: var(--color-text-muted);">{row.date}</span>
                <span class="text-sm font-medium truncate" style="color: var(--color-text);">{row.vendor}</span>
              </div>
              <div class="flex items-center gap-1.5 flex-shrink-0">
                {#if row.syncStatus !== 'synced'}
                  <span
                    class="w-2 h-2 rounded-full"
                    title={row.syncStatus === 'error' ? 'Sync failed' : row.syncStatus === 'conflict' ? 'Conflict' : 'Saving…'}
                    style="background-color: {row.syncStatus === 'error' ? 'var(--color-error)' : row.syncStatus === 'conflict' ? '#f59e0b' : 'var(--color-text-muted)'};"
                  ></span>
                {/if}
                <span class="text-sm font-semibold" style="color: var(--color-primary);">${row.amount}</span>
              </div>
            </a>
          {:else}
            <a
              href={transactionUrl(row)}
              class="w-full flex items-center justify-between px-4 hover:opacity-80 transition-opacity"
              style="min-height: 52px; display: flex;"
              aria-label="View entry from {row.date}"
            >
              <div class="flex flex-col gap-0.5 min-w-0 flex-1 pr-3">
                <span class="text-xs" style="color: var(--color-text-muted);">{row.date}</span>
                <span class="text-sm font-medium truncate" style="color: var(--color-text);">{row.from} → {row.to}</span>
              </div>
              <div class="flex items-center gap-1.5 flex-shrink-0">
                {#if row.syncStatus !== 'synced'}
                  <span
                    class="w-2 h-2 rounded-full"
                    title={row.syncStatus === 'error' ? 'Sync failed' : row.syncStatus === 'conflict' ? 'Conflict' : 'Saving…'}
                    style="background-color: {row.syncStatus === 'error' ? 'var(--color-error)' : row.syncStatus === 'conflict' ? '#f59e0b' : 'var(--color-text-muted)'};"
                  ></span>
                {/if}
                <span class="text-sm font-semibold" style="color: var(--color-primary);">{row.miles} mi</span>
              </div>
            </a>
          {/if}
        {/each}
      </div>
    {/if}

  </div>
{/if}
