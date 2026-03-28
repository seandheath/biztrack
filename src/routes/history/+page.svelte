<script>
  /**
   * History screen — review past expense and mileage entries.
   *
   * Pure list view: tapping any row navigates to /transaction for
   * the full read-only detail, edit, share, and delete actions.
   */

  import { onMount } from 'svelte';
  import { selectedBusiness } from '$lib/store.js';
  import { readRows } from '$lib/sheets.js';

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

  /** Currently selected year string. */
  let selectedYear = $state('');

  /** Spreadsheet ID for the selected year. */
  let spreadsheetId = $derived($selectedBusiness?.sheetIds?.[selectedYear] ?? null);

  // ---------------------------------------------------------------------------
  // Row state
  // ---------------------------------------------------------------------------

  /** @type {Array<Object>} */
  let rows = $state([]);
  let loading = $state(false);
  let loadError = $state('');

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function friendlyError(err) {
    const msg = err?.message ?? '';
    if (msg.includes('401')) return 'Session expired. Please sign in again.';
    if (msg.includes('403')) return 'Permission denied. Check Drive sharing.';
    return 'Network error. Try again.';
  }

  /** Parse a flat string array from Sheets into a typed expense object. */
  function parseExpenseRow(raw, rowNum) {
    return {
      rowNum,
      date:     raw[0] ?? '',
      vendor:   raw[1] ?? '',
      desc:     raw[2] ?? '',
      amount:   raw[3] ?? '',
      category: raw[4] ?? '',
      payment:  raw[5] ?? '',
      receipt:  raw[6] ?? '',
      notes:    raw[7] ?? '',
      // raw[8] = submittedBy (not displayed in history)
      txnId:    raw[9] ?? '',
    };
  }

  /** Parse a flat string array from Sheets into a typed mileage object. */
  function parseMileageRow(raw, rowNum) {
    return {
      rowNum,
      date:      raw[0] ?? '',
      from:      raw[1] ?? '',
      to:        raw[2] ?? '',
      purpose:   raw[3] ?? '',
      miles:     raw[4] ?? '',
      rate:      raw[5] ?? '',
      deduction: raw[6] ?? '',
      txnId:     raw[7] ?? '',
    };
  }

  function transactionUrl(row, type = 'expense') {
    const u = new URL('/transaction', window.location.origin);
    u.searchParams.set('biz',  $selectedBusiness.id);
    u.searchParams.set('year', String(selectedYear));
    u.searchParams.set('txn',  row.txnId);
    if (type === 'mileage') u.searchParams.set('type', 'mileage');
    return u.toString();
  }

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  async function loadRows() {
    if (!spreadsheetId) { rows = []; return; }
    loading = true;
    loadError = '';
    try {
      const sheetName = activeTab === 'expense' ? 'Expenses' : 'Mileage';
      const { rows: raw, rowNums } = await readRows(spreadsheetId, sheetName);
      const parsed = raw.map((r, i) =>
        activeTab === 'expense'
          ? parseExpenseRow(r, rowNums[i])
          : parseMileageRow(r, rowNums[i])
      );
      // Most recent first
      rows = parsed.toReversed();
    } catch (err) {
      console.error('[history] loadRows:', err);
      loadError = friendlyError(err);
    } finally {
      loading = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  onMount(() => {
    if ($selectedBusiness) {
      const years = Object.keys($selectedBusiness.sheetIds ?? {}).sort().reverse();
      const currentYear = String(new Date().getFullYear());
      selectedYear = years.includes(currentYear) ? currentYear : (years[0] ?? '');
      if (selectedYear) loadRows();
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
          bind:value={selectedYear}
          onchange={loadRows}
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
            onclick={() => { activeTab = tab; loadRows(); }}
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

    <!-- Loading -->
    {#if loading}
      <div class="flex items-center justify-center py-12 gap-3">
        <svg class="w-5 h-5 animate-spin" style="color: var(--color-text-muted);" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z" />
        </svg>
        <span class="text-sm" style="color: var(--color-text-muted);">Loading…</span>
      </div>

    <!-- Load error -->
    {:else if loadError}
      <p class="text-sm rounded-xl px-4 py-3" style="color: var(--color-error); background-color: var(--color-surface-2);">
        {loadError}
      </p>

    <!-- Empty state -->
    {:else if rows.length === 0 && selectedYear}
      <div class="text-center py-12">
        <p class="text-base" style="color: var(--color-text-muted);">
          No {activeTab} entries in {selectedYear}.
        </p>
      </div>

    <!-- Row list -->
    {:else}
      <div
        class="rounded-xl border overflow-hidden divide-y"
        style="border-color: var(--color-border); background-color: var(--color-surface-2);"
      >
        {#each rows as row (row.rowNum)}
          {#if activeTab === 'expense'}
            <a
              href={transactionUrl(row, 'expense')}
              class="w-full flex items-center justify-between px-4 hover:opacity-80 transition-opacity"
              style="min-height: 52px; display: flex;"
              aria-label="View entry from {row.date}"
            >
              <div class="flex flex-col gap-0.5 min-w-0 flex-1 pr-3">
                <span class="text-xs" style="color: var(--color-text-muted);">{row.date}</span>
                <span class="text-sm font-medium truncate" style="color: var(--color-text);">{row.vendor}</span>
              </div>
              <span class="text-sm font-semibold flex-shrink-0" style="color: var(--color-primary);">${row.amount}</span>
            </a>
          {:else}
            <a
              href={transactionUrl(row, 'mileage')}
              class="w-full flex items-center justify-between px-4 hover:opacity-80 transition-opacity"
              style="min-height: 52px; display: flex;"
              aria-label="View entry from {row.date}"
            >
              <div class="flex flex-col gap-0.5 min-w-0 flex-1 pr-3">
                <span class="text-xs" style="color: var(--color-text-muted);">{row.date}</span>
                <span class="text-sm font-medium truncate" style="color: var(--color-text);">{row.from} → {row.to}</span>
              </div>
              <span class="text-sm font-semibold flex-shrink-0" style="color: var(--color-primary);">{row.miles} mi</span>
            </a>
          {/if}
        {/each}
      </div>
    {/if}

  </div>
{/if}
