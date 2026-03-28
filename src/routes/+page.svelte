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
  import Toast from '../components/Toast.svelte';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let loading = $state(false);
  let loadError = $state('');
  /** @type {Array<{rowNum:number,date:string,vendor:string,desc:string,amount:string,category:string,payment:string,receipt:string,notes:string}>} */
  let rows = $state([]);
  /** Row number currently expanded for read-only detail, or null. */
  let viewRowNum = $state(/** @type {number|null} */(null));

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
    };
  }

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  async function loadRows() {
    if (!spreadsheetId) { rows = []; return; }
    loading = true;
    loadError = '';
    viewRowNum = null;
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
  // Toast (for future use / error display)
  // ---------------------------------------------------------------------------

  let toastMessage = $state('');
  let toastType    = $state(/** @type {'success'|'error'} */('success'));
  let toastVisible = $state(false);

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
      Add a business in Settings to start tracking.
    </p>
    <a
      href="/settings"
      class="mt-2 rounded-xl text-sm font-medium px-6"
      style="background-color: var(--color-primary); color: var(--color-primary-text); min-height: 44px; display:inline-flex; align-items:center;"
    >
      Open Settings
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

            {#if viewRowNum !== row.rowNum}
              <!-- ---------------------------------------------------------
                   Collapsed row
                   --------------------------------------------------------- -->
              <button
                type="button"
                onclick={() => { viewRowNum = row.rowNum; }}
                class="w-full flex items-center px-4 text-left hover:opacity-80 transition-opacity"
                style="min-height: 64px;"
                aria-label="View entry: {row.vendor}, {row.date}"
              >
                <div class="flex flex-col gap-0.5 flex-1 min-w-0 pr-3">
                  <span class="text-sm font-medium truncate" style="color: var(--color-text);">{row.vendor}</span>
                  <span class="text-xs" style="color: var(--color-text-muted);">{row.date}{row.category ? ' · ' + row.category : ''}</span>
                </div>
                <span class="text-sm font-semibold flex-shrink-0" style="color: var(--color-primary);">
                  ${row.amount}
                </span>
              </button>

            {:else}
              <!-- ---------------------------------------------------------
                   Expanded read-only detail
                   --------------------------------------------------------- -->
              <div class="px-4 py-4 flex flex-col gap-1.5">

                <!-- Field rows -->
                <div class="flex justify-between items-baseline gap-3 py-0.5">
                  <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">Date</span>
                  <span class="text-sm text-right" style="color: var(--color-text);">{row.date}</span>
                </div>
                <div class="flex justify-between items-baseline gap-3 py-0.5">
                  <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">Vendor</span>
                  <span class="text-sm text-right" style="color: var(--color-text);">{row.vendor}</span>
                </div>
                {#if row.desc}
                  <div class="flex justify-between items-baseline gap-3 py-0.5">
                    <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">Description</span>
                    <span class="text-sm text-right" style="color: var(--color-text);">{row.desc}</span>
                  </div>
                {/if}
                <div class="flex justify-between items-baseline gap-3 py-0.5">
                  <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">Amount</span>
                  <span class="text-sm font-semibold text-right" style="color: var(--color-primary);">${row.amount}</span>
                </div>
                <div class="flex justify-between items-baseline gap-3 py-0.5">
                  <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">Category</span>
                  <span class="text-sm text-right" style="color: var(--color-text);">{row.category}</span>
                </div>
                <div class="flex justify-between items-baseline gap-3 py-0.5">
                  <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">Payment</span>
                  <span class="text-sm text-right" style="color: var(--color-text);">{row.payment}</span>
                </div>
                {#if row.receipt}
                  <div class="flex justify-between items-baseline gap-3 py-0.5">
                    <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">Receipt</span>
                    <span class="text-sm text-right truncate max-w-[60%]" style="color: var(--color-text);">{row.receipt}</span>
                  </div>
                {/if}
                {#if row.notes}
                  <div class="flex justify-between items-baseline gap-3 py-0.5">
                    <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">Notes</span>
                    <span class="text-sm text-right" style="color: var(--color-text);">{row.notes}</span>
                  </div>
                {/if}

                <!-- Action row -->
                <div class="flex gap-2 pt-2">
                  <button
                    type="button"
                    onclick={() => { viewRowNum = null; }}
                    class="rounded-xl text-sm px-4 transition-opacity hover:opacity-70"
                    style="
                      min-height: 40px;
                      background-color: var(--color-surface-3);
                      color: var(--color-text-muted);
                    "
                  >
                    Close
                  </button>
                  <a
                    href="/history"
                    class="flex-1 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-opacity hover:opacity-80"
                    style="
                      min-height: 40px;
                      background-color: var(--color-primary);
                      color: var(--color-primary-text);
                    "
                  >
                    <!-- Pencil icon -->
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                    Edit in History
                  </a>
                </div>

              </div>
            {/if}

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
          background-color: var(--color-surface-2);
          color: var(--color-text);
          border: 1px solid var(--color-border);
        "
      >
        + Mileage
      </a>
    </div>

  </div>
{/if}

<!-- Toast -->
<Toast message={toastMessage} type={toastType} visible={toastVisible} />
