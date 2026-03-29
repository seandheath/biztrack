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

  /** Years with data for the selected business — derived from sheetIds. */
  let availableYears = $state([]);

  /** Currently selected year (number). */
  let selectedYear = $state(new Date().getFullYear());

  $effect(() => {
    const biz = $selectedBusiness;
    if (!biz) { availableYears = []; return; }
    const sheetYears = Object.keys(biz.sheetIds ?? {}).map(Number).sort((a, b) => b - a);
    availableYears = sheetYears.map(String);
    if (availableYears.length && !availableYears.includes(String(selectedYear))) {
      const current = String(new Date().getFullYear());
      selectedYear = Number(availableYears.includes(current) ? current : availableYears[0]);
    }
  });

  // ---------------------------------------------------------------------------
  // Row state — pulled from Sheets
  // ---------------------------------------------------------------------------

  /** @type {import('$lib/services/sheets.js').TransactionRow[]} */
  let rows = $state([]);

  let loading = $state(false);

  $effect(() => {
    const biz = $selectedBusiness;
    const year = Number(selectedYear);
    if (!biz?.id || !year) { rows = []; return; }
    const spreadsheetId = biz.sheetIds?.[year];
    if (!spreadsheetId) { rows = []; return; }
    const sheetName = activeTab === 'mileage' ? 'Mileage' : 'Expenses';

    loading = true;
    pullTransactions(spreadsheetId, sheetName)
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
    u.searchParams.set('year', String(selectedYear));
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

    <!-- Row list — keyed by UUID -->
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
