<script>
  /**
   * History screen — review past expense and mileage entries.
   *
   * Pure list view: tapping any row navigates to /transaction for
   * the full read-only detail, edit, share, and delete actions.
   */

  import { selectedBusiness } from '$lib/store.js';
  import { pullTransactions } from '$lib/services/sheets.js';

  // ---------------------------------------------------------------------------
  // Tab / year state
  // ---------------------------------------------------------------------------

  /** @type {'expense'|'mileage'} */
  let activeTab = $state('expense');

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
  // Row state — pulled from Sheets
  // ---------------------------------------------------------------------------

  /** @type {import('$lib/services/sheets.js').TransactionRow[]} */
  let rows = $state([]);

  let loading = $state(false);

  $effect(() => {
    const sid = spreadsheetId;
    const tab = activeTab;
    if (!sid) { rows = []; return; }
    const sheetName = tab === 'mileage' ? 'Mileage' : 'Expenses';

    loading = true;
    pullTransactions(sid, sheetName)
      .then((pulled) => { rows = pulled.sort((a, b) => b.date.localeCompare(a.date)); })
      .catch((err) => { console.error('[history] pull:', err); rows = []; })
      .finally(() => { loading = false; });
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function transactionUrl(row) {
    const u = new URL('/transaction', window.location.origin);
    u.searchParams.set('biz',  $selectedBusiness.id);
    u.searchParams.set('year', selectedYear);
    u.searchParams.set('txn',  row.id);
    if (activeTab === 'mileage') u.searchParams.set('type', 'mileage');
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

    <!-- Controls row: year selector + tab toggle -->
    <div class="flex gap-3 items-center">
      <!-- Year selector -->
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

    <!-- Loading / empty / row list -->
    {#if loading}
      <div class="flex items-center justify-center py-12">
        <svg class="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24" aria-label="Loading">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z"></path>
        </svg>
      </div>

    {:else if rows.length === 0}
      <div class="text-center py-12">
        <p class="text-base" style="color: var(--color-text-muted);">
          No {activeTab} entries in {selectedYear}.
        </p>
      </div>

    {:else}
      <!-- Row list — keyed by UUID -->
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
