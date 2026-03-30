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
  import { pullTransactions } from '$lib/services/sheets.js';
  import BusinessDropdown from '../components/BusinessDropdown.svelte';

  // ---------------------------------------------------------------------------
  // Live state — pulled from Sheets
  // ---------------------------------------------------------------------------

  /** @type {import('$lib/services/sheets.js').TransactionRow[]} */
  let rows = $state([]);

  /** Count of uncategorized expense transactions — drives the review banner */
  let uncategorizedCount = $state(0);

  let loading = $state(false);

  $effect(() => {
    const biz = $selectedBusiness;
    if (!biz) { rows = []; uncategorizedCount = 0; return; }
    const spreadsheetId = biz.sheetIds?.[new Date().getFullYear()];
    if (!spreadsheetId) { rows = []; return; }

    loading = true;
    pullTransactions(spreadsheetId, 'Expenses')
      .then((pulled) => {
        const sorted = pulled.sort((a, b) => b.date.localeCompare(a.date));
        rows = sorted;
        uncategorizedCount = sorted.filter((r) => !r.category || r.category === 'Uncategorized').length;
      })
      .catch((err) => { console.error('[home] pull:', err); rows = []; })
      .finally(() => { loading = false; });
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function transactionUrl(row) {
    const year = new Date(row.date + 'T00:00:00').getFullYear();
    const u = new URL('/transaction', window.location.origin);
    u.searchParams.set('biz',  $selectedBusiness.id ?? $selectedBusiness.folderId);
    u.searchParams.set('year', String(year));
    u.searchParams.set('txn',  row.id);
    return u.toString();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  onMount(() => {
    // Redirect Android Web Share Target receipts to the entry form
    if ($pendingReceipt) {
      goto('/expense');
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
       Dashboard: transaction log + sticky entry buttons
       ======================================================================= -->

  <!-- Scrollable content — pb-[84px] clears the sticky button bar below -->
  <div class="pb-[84px]">

    <!-- Business selector -->
    <div class="px-4 pt-3 pb-2">
      <BusinessDropdown />
    </div>

    <!-- Uncategorized review banner — shown when import leaves unreviewed rows -->
    {#if uncategorizedCount > 0}
      <div class="px-4 pb-2">
        <a
          href="/review"
          class="flex items-center justify-between px-4 py-2.5 rounded-xl text-sm font-medium transition-opacity hover:opacity-80"
          style="background-color: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-primary);"
        >
          <span>{uncategorizedCount} uncategorized transaction{uncategorizedCount === 1 ? '' : 's'}</span>
          <span>Review →</span>
        </a>
      </div>
    {/if}

    <!-- =====================================================================
         Row list area — <main> handles scrolling
         ===================================================================== -->
    <div class="px-4 pb-2">

      {#if !$selectedBusiness}
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
        <!-- Row list — keyed by UUID -->
        <div
          class="rounded-xl border overflow-hidden divide-y"
          style="border-color: var(--color-border); background-color: var(--color-surface-2);"
        >
          {#each rows as row (row.id)}
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
          {/each}
        </div>
      {/if}

    </div>
  </div>

  <!-- =====================================================================
       Bottom entry buttons — sticky to viewport bottom while list scrolls
       ===================================================================== -->
  <div
    class="sticky bottom-0 flex gap-3 px-4 py-4 border-t"
    style="
      background-color: var(--color-surface);
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

{/if}

