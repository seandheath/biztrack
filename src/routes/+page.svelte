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
  import { get } from 'svelte/store';
  import { businesses, selectedBusiness, pendingReceipt, deviceMode } from '$lib/store.js';
  import { pullTransactions } from '$lib/services/sheets.js';
  import { localPullTransactions } from '$lib/services/local-store.js';
  import { syncStatus, getCachedTransactions, cacheTransactions, shouldPull, markPullStarted, markPullComplete, markPullFailed } from '$lib/sync.js';
  import BusinessDropdown from '../components/BusinessDropdown.svelte';

  // ---------------------------------------------------------------------------
  // Live state — pulled from Sheets (expenses + mileage merged)
  // ---------------------------------------------------------------------------

  /** @type {(import('$lib/services/sheets.js').TransactionRow & { _type: 'expense' | 'mileage' })[]} */
  let rows = $state([]);

  /** Count of uncategorized expense transactions — drives the review banner */
  let uncategorizedCount = $state(0);

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

  // Generation counter for stale-pull detection — when the $effect re-runs
  // (e.g. selectedBusiness changes), previous in-flight results are discarded.
  let pullGen = 0;

  $effect(() => {
    const biz = $selectedBusiness;
    const gen = ++pullGen;
    if (!biz) { rows = []; uncategorizedCount = 0; return; }

    const year = new Date().getFullYear();

    // Device-only mode: read directly from localStorage
    if (get(deviceMode)) {
      loading = true;
      Promise.all([
        localPullTransactions(biz.id, year, 'Expenses'),
        localPullTransactions(biz.id, year, 'Mileage'),
      ]).then(([exp, mil]) => {
        if (gen !== pullGen) return;
        rows = mergeAndSort(exp, mil);
        uncategorizedCount = exp.filter((r) => !r.category || r.category === 'Uncategorized').length;
      }).finally(() => { if (gen === pullGen) loading = false; });
      return;
    }

    // Google mode: pull from Sheets with caching
    const spreadsheetId = biz.sheetIds?.[year];
    if (!spreadsheetId) { rows = []; return; }

    // Load cached rows immediately — no spinner, no empty-state flash
    const cachedExp = getCachedTransactions(spreadsheetId, 'Expenses');
    const cachedMil = getCachedTransactions(spreadsheetId, 'Mileage');
    const hasCached = cachedExp || cachedMil;
    if (hasCached) {
      const merged = mergeAndSort(cachedExp ?? [], cachedMil ?? []);
      rows = merged;
      uncategorizedCount = (cachedExp ?? []).filter((r) => !r.category || r.category === 'Uncategorized').length;
    }

    // Skip network pull if one is already in-flight or cooldown hasn't expired.
    if (!shouldPull(spreadsheetId)) return;

    // Background pull from both sheets in parallel
    loading = !hasCached;
    syncStatus.set('yellow');
    markPullStarted(spreadsheetId);
    Promise.all([
      pullTransactions(spreadsheetId, 'Expenses'),
      pullTransactions(spreadsheetId, 'Mileage'),
    ])
      .then(([pulledExp, pulledMil]) => {
        if (gen !== pullGen) return; // stale — effect re-ran, discard
        rows = mergeAndSort(pulledExp, pulledMil);
        uncategorizedCount = pulledExp.filter((r) => !r.category || r.category === 'Uncategorized').length;
        syncStatus.set('green');
        markPullComplete(spreadsheetId);
        cacheTransactions(spreadsheetId, 'Expenses', pulledExp);
        cacheTransactions(spreadsheetId, 'Mileage', pulledMil);
      })
      .catch((err) => {
        if (gen !== pullGen) return;
        console.error('[home] pull:', err);
        syncStatus.set('red');
        markPullFailed(spreadsheetId);
        if (!hasCached) rows = [];
      })
      .finally(() => { if (gen === pullGen) loading = false; });
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function transactionUrl(row) {
    const year = new Date(row.date + 'T00:00:00').getFullYear();
    const route = row._type === 'mileage' ? '/mileage' : '/expense';
    const u = new URL(route, window.location.origin);
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
       Dashboard: transaction log + entry buttons
       ======================================================================= -->
  <div class="flex flex-col h-full">

    <!-- Business selector -->
    <div class="px-4 pt-3 pb-2 flex-shrink-0">
      <BusinessDropdown />
    </div>

    <!-- Uncategorized review banner — shown when import leaves unreviewed rows -->
    {#if uncategorizedCount > 0}
      <div class="px-4 pb-2 flex-shrink-0">
        <a
          href="/review"
          class="w-full flex items-center justify-center px-4 py-2.5 text-sm font-medium transition-opacity hover:opacity-80"
          style="background-color: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 0.5rem; color: var(--color-primary);"
        >
          {uncategorizedCount} Uncategorized Transaction{uncategorizedCount === 1 ? '' : 's'} — Review →
        </a>
      </div>
    {/if}

    <!-- =====================================================================
         Row list area — fills remaining space, scrolls independently
         ===================================================================== -->
    <div class="flex-1 overflow-y-auto px-4 pb-2">

      {#if !$selectedBusiness}
        <p class="text-center py-12 text-sm" style="color: var(--color-text-muted);">
          Select a business above.
        </p>

      {:else if rows.length === 0}
        <div class="flex flex-col items-center justify-center py-12 gap-3 text-center">
          <p class="text-base" style="color: var(--color-text-muted);">No entries recorded yet.</p>
          <p class="text-sm" style="color: var(--color-text-muted);">
            Tap <strong>+ Expense</strong> or <strong>+ Mileage</strong> below to add your first entry.
          </p>
        </div>

      {:else}
        <!-- Row list — keyed by UUID -->
        <div
          class="rounded-xl border overflow-hidden divide-y"
          style="border-color: var(--color-border); background-color: var(--color-surface-2);"
        >
          {#each rows as row (row.id)}
            {#if row._type === 'mileage'}
              <a
                href={transactionUrl(row)}
                class="w-full flex items-center px-4 text-left hover:opacity-80 transition-opacity"
                style="min-height: 64px; display: flex; background-color: var(--color-surface-3);"
                aria-label="View mileage: {row.from} to {row.to}, {row.date}"
              >
                <div class="flex flex-col gap-0.5 flex-1 min-w-0 pr-3">
                  <span class="text-sm font-medium truncate" style="color: var(--color-text);">{row.from} → {row.to}</span>
                  <span class="text-xs" style="color: var(--color-text-muted);">{row.date} · Mileage</span>
                </div>
                <div class="flex items-center gap-1.5 flex-shrink-0">
                  <span class="text-sm font-semibold" style="color: var(--color-primary);">{row.miles} mi</span>
                </div>
              </a>
            {:else}
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
                  {#if row.receipt}
                    <svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                         aria-label="Receipt attached" style="color: var(--color-text-muted);">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                  {/if}
                  <span class="text-sm font-semibold" style="color: var(--color-primary);">${Number(row.amount).toFixed(2)}</span>
                </div>
              </a>
            {/if}
          {/each}
        </div>
      {/if}

    </div>

    <!-- =====================================================================
         Bottom entry buttons — always visible (flex-shrink-0 prevents scroll)
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

