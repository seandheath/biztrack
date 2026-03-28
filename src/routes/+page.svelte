<script>
  /**
   * Home screen — transaction log.
   *
   * Shows the most recent expense entries for the selected business (current year),
   * newest first. Rows are read-only; tapping expands a detail view with a link
   * to /history for editing. Two bottom buttons navigate to the entry form routes.
   *
   * Android Web Share Target receipts are detected on mount and redirect to /expense.
   */

  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { businesses, selectedBusiness, pendingReceipt } from '$lib/store.js';
  import { readRows } from '$lib/sheets.js';
  import BusinessDropdown from '../components/BusinessDropdown.svelte';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let loading = $state(false);
  let loadError = $state('');
  /** @type {Array<{rowNum:number,date:string,vendor:string,desc:string,amount:string,category:string,payment:string,receipt:string,notes:string,txnId:string}>} */
  let rows = $state([]);

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  /** Spreadsheet ID for the current calendar year, if the selected business has one. */
  let spreadsheetId = $derived(
    $selectedBusiness?.sheetIds?.[String(new Date().getFullYear())] ?? null
  );

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function friendlyError(err) {
    const msg = err?.message ?? '';
    if (msg.includes('401')) return 'Session expired. Please sign in again.';
    if (msg.includes('403')) return 'Permission denied. Check Drive sharing.';
    return 'Network error. Try again.';
  }

  /** Parse a flat string array (from Sheets) into a typed expense object. */
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
      // raw[8] = submittedBy (not displayed on home page)
      txnId:    raw[9] ?? '',
    };
  }

  function transactionUrl(row) {
    const year = new Date(row.date + 'T00:00:00').getFullYear();
    const u = new URL('/transaction', window.location.origin);
    u.searchParams.set('biz',  $selectedBusiness.id);
    u.searchParams.set('year', String(year));
    u.searchParams.set('txn',  row.txnId);
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
      const { rows: raw, rowNums } = await readRows(spreadsheetId, 'Expenses');
      rows = raw.map((r, i) => parseExpenseRow(r, rowNums[i])).toReversed();
    } catch (err) {
      console.error('[home] loadRows:', err);
      loadError = friendlyError(err);
    } finally {
      loading = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  onMount(() => {
    // Redirect Android Web Share Target receipts to the entry form
    if ($pendingReceipt) {
      goto('/expense');
      return;
    }
    if ($selectedBusiness && spreadsheetId) {
      loadRows();
    }
  });
</script>

<!-- =========================================================================
     Empty state: no businesses configured
     ========================================================================= -->
{#if $businesses.length === 0}
  <div class="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center gap-4">
    <div class="text-4xl" aria-hidden="true">🗂️</div>
    <h2 class="text-xl font-semibold" style="color: var(--color-text);">No businesses yet</h2>
    <p class="text-base" style="color: var(--color-text-muted);">
      Add a business to start tracking.
    </p>
    <a
      href="/settings/business"
      class="mt-2 rounded-xl text-sm font-medium px-6"
      style="background-color: var(--color-primary); color: var(--color-primary-text); min-height: 44px; display:inline-flex; align-items:center;"
    >
      Add Business
    </a>
  </div>

{:else}
  <!-- =======================================================================
       Dashboard: transaction log + entry buttons
       ======================================================================= -->
  <div class="flex flex-col h-full">

    <!-- Business selector -->
    <div class="px-4 pt-3 pb-2 flex-shrink-0">
      <BusinessDropdown onchange={() => loadRows()} />
    </div>

    <!-- =====================================================================
         Row list area — fills remaining space, scrollable when row expanded
         ===================================================================== -->
    <div class="flex-1 overflow-y-auto px-4 pb-2">

      {#if loading}
        <!-- Loading spinner -->
        <div class="flex items-center justify-center py-12 gap-3">
          <svg class="w-5 h-5 animate-spin" style="color: var(--color-text-muted);" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z" />
          </svg>
          <span class="text-sm" style="color: var(--color-text-muted);">Loading…</span>
        </div>

      {:else if loadError}
        <p class="text-sm rounded-xl px-4 py-3 mt-2" style="color: var(--color-error); background-color: var(--color-surface-2);">
          {loadError}
        </p>

      {:else if !$selectedBusiness}
        <p class="text-center py-12 text-sm" style="color: var(--color-text-muted);">
          Select a business above.
        </p>

      {:else if rows.length === 0}
        <div class="flex flex-col items-center justify-center py-12 gap-3 text-center">
          <p class="text-base" style="color: var(--color-text-muted);">No expenses recorded yet.</p>
          <p class="text-sm" style="color: var(--color-text-muted);">
            Tap <strong>+ Expense</strong> below to add your first entry.
          </p>
        </div>

      {:else}
        <!-- Row list -->
        <div
          class="rounded-xl border overflow-hidden divide-y"
          style="border-color: var(--color-border); background-color: var(--color-surface-2);"
        >
          {#each rows as row (row.rowNum)}
            <a
              href={transactionUrl(row)}
              class="w-full flex items-center px-4 text-left hover:opacity-80 transition-opacity"
              style="min-height: 64px; display: flex;"
              aria-label="View entry: {row.vendor}, {row.date}"
            >
              <div class="flex flex-col gap-0.5 flex-1 min-w-0 pr-3">
                <span class="text-sm font-medium truncate" style="color: var(--color-text);">{row.vendor}</span>
                <span class="text-xs" style="color: var(--color-text-muted);">{row.date}{row.category ? ' · ' + row.category : ''}</span>
              </div>
              <span class="text-sm font-semibold flex-shrink-0" style="color: var(--color-primary);">
                ${row.amount}
              </span>
            </a>
          {/each}
        </div>
      {/if}

    </div>

    <!-- =====================================================================
         Bottom entry buttons — always visible
         ===================================================================== -->
    <div
      class="flex gap-3 px-4 py-4 border-t flex-shrink-0"
      style="
        border-color: var(--color-border);
        padding-bottom: max(1rem, env(safe-area-inset-bottom));
      "
    >
      <a
        href="/expense"
        class="flex-1 rounded-xl font-semibold text-base flex items-center justify-center transition-opacity hover:opacity-80"
        style="
          min-height: 52px;
          background-color: var(--color-primary);
          color: var(--color-primary-text);
        "
      >
        + Expense
      </a>
      <a
        href="/mileage"
        class="flex-1 rounded-xl font-semibold text-base flex items-center justify-center transition-opacity hover:opacity-80"
        style="
          min-height: 52px;
          background-color: var(--color-primary);
          color: var(--color-primary-text);
        "
      >
        + Mileage
      </a>
    </div>

  </div>
{/if}

