<script>
  import Spinner from '../../components/Spinner.svelte';
  /**
   * History screen — review past expense and mileage entries.
   *
   * Pure list view: tapping any row navigates to /transaction for
   * the full read-only detail, edit, share, and delete actions.
   */

  import { selectedBusiness } from '$lib/store.js';
  import { pullTransactions } from '$lib/services/sheets.js';
  import { syncStatus, getCachedTransactions, cacheTransactions } from '$lib/sync.js';

  // ---------------------------------------------------------------------------
  // Year state
  // ---------------------------------------------------------------------------

  /** Years with data — derived directly from sheetIds so it's always in sync. */
  let availableYears = $derived.by(() => {
    const biz = $selectedBusiness;
    if (!biz) return [];
    return Object.keys(biz.sheetIds ?? {}).map(Number).sort((a, b) => b - a).map(String);
  });

  /** Currently selected year (string to match availableYears and <select> value). */
  let selectedYear = $state('');

  // Keep selectedYear valid whenever availableYears changes.
  $effect(() => {
    if (!availableYears.length) { selectedYear = ''; return; }
    if (!availableYears.includes(selectedYear)) {
      const current = String(new Date().getFullYear());
      selectedYear = availableYears.includes(current) ? current : availableYears[0];
    }
  });

  /** Derived spreadsheet ID — always reflects the current year selection. */
  let spreadsheetId = $derived(
    $selectedBusiness?.sheetIds?.[Number(selectedYear)] ?? ''
  );

  // ---------------------------------------------------------------------------
  // Row state — pulled from Sheets (expenses + mileage merged)
  // ---------------------------------------------------------------------------

  /** @type {(import('$lib/services/sheets.js').TransactionRow & { _type: 'expense' | 'mileage' })[]} */
  let rows = $state([]);

  let loading = $state(false);

  /**
   * Tag each row with its type and merge two arrays into a date-sorted list.
   * @param {import('$lib/services/sheets.js').TransactionRow[]} expenses
   * @param {import('$lib/services/sheets.js').TransactionRow[]} mileage
   */
  function mergeAndSort(expenses, mileage) {
    const tagged = [
      ...expenses.map((r) => ({ ...r, _type: /** @type {const} */ ('expense') })),
      ...mileage.map((r)  => ({ ...r, _type: /** @type {const} */ ('mileage') })),
    ];
    return tagged.sort((a, b) => b.date.localeCompare(a.date));
  }

  $effect(() => {
    const sid = spreadsheetId;
    if (!sid) { rows = []; return; }

    // Load cached rows for instant render
    const cachedExp = getCachedTransactions(sid, 'Expenses');
    const cachedMil = getCachedTransactions(sid, 'Mileage');
    const hasCached = cachedExp || cachedMil;
    if (hasCached) {
      rows = mergeAndSort(cachedExp ?? [], cachedMil ?? []);
    }

    // Background pull from both sheets in parallel
    loading = !hasCached;
    syncStatus.set('yellow');
    Promise.all([
      pullTransactions(sid, 'Expenses'),
      pullTransactions(sid, 'Mileage'),
    ])
      .then(([pulledExp, pulledMil]) => {
        rows = mergeAndSort(pulledExp, pulledMil);
        syncStatus.set('green');
        cacheTransactions(sid, 'Expenses', pulledExp);
        cacheTransactions(sid, 'Mileage', pulledMil);
      })
      .catch((err) => {
        console.error('[history] pull:', err);
        syncStatus.set('red');
        if (!hasCached) rows = [];
      })
      .finally(() => { loading = false; });
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function transactionUrl(row) {
    const u = new URL('/transaction', window.location.origin);
    u.searchParams.set('biz',  $selectedBusiness.id ?? $selectedBusiness.folderId);
    u.searchParams.set('year', selectedYear);
    u.searchParams.set('txn',  row.id);
    if (row._type === 'mileage') u.searchParams.set('type', 'mileage');
    return u.toString();
  }

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

    <!-- Year selector -->
    <div class="flex gap-3 items-center">
      {#if availableYears.length > 0}
        <select
          bind:value={selectedYear}
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
    </div>

    <!-- Loading / empty / row list -->
    {#if loading}
      <div class="flex items-center justify-center py-12">
        <Spinner size="w-6 h-6" />
      </div>

    {:else if rows.length === 0}
      <div class="text-center py-12">
        <p class="text-base" style="color: var(--color-text-muted);">
          No entries in {selectedYear}.
        </p>
      </div>

    {:else}
      <!-- Row list — keyed by UUID -->
      <div
        class="rounded-xl border overflow-hidden divide-y"
        style="border-color: var(--color-border); background-color: var(--color-surface-2);"
      >
        {#each rows as row (row.id)}
          {#if row._type === 'expense'}
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
                {#if row.receiptDriveId}
                  <svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                       aria-label="Receipt attached" style="color: var(--color-text-muted);">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                {/if}
                <span class="text-sm font-semibold" style="color: var(--color-primary);">${Number(row.amount).toFixed(2)}</span>
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
                <span class="text-sm font-semibold" style="color: var(--color-primary);">{row.miles} mi</span>
              </div>
            </a>
          {/if}
        {/each}
      </div>
    {/if}

  </div>
{/if}
