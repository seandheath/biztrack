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
  import { liveQuery } from 'dexie';
  import { businesses, selectedBusiness, pendingReceipt } from '$lib/store.js';
  import { db } from '$lib/db/dexie.js';
  import BusinessDropdown from '../components/BusinessDropdown.svelte';

  // ---------------------------------------------------------------------------
  // Live state — driven by Dexie liveQuery
  // ---------------------------------------------------------------------------

  /** @type {import('$lib/db/dexie.js').Transaction[]} */
  let rows = $state([]);

  // Re-subscribe whenever the selected business changes.
  // $effect tracks $selectedBusiness reactively — when it changes, the old
  // subscription is cleaned up and a new one starts.
  $effect(() => {
    const bizId = $selectedBusiness?.id;
    if (!bizId) { rows = []; return; }
    const year = new Date().getFullYear();

    const sub = liveQuery(() =>
      db.transactions
        .where('[businessId+type+year]')
        .equals([bizId, 'expense', year])
        .toArray()
        .then((arr) => arr.sort((a, b) => b.date.localeCompare(a.date)))
    ).subscribe({
      next: (r) => { rows = r; },
      error: (err) => { console.error('[home] liveQuery:', err); },
    });

    return () => sub.unsubscribe();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function transactionUrl(row) {
    const year = new Date(row.date + 'T00:00:00').getFullYear();
    const u = new URL('/transaction', window.location.origin);
    u.searchParams.set('biz',  $selectedBusiness.id);
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

    <!-- =====================================================================
         Row list area — fills remaining space, scrollable
         ===================================================================== -->
    <div class="flex-1 overflow-y-auto px-4 pb-2">

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
        <!-- Row list — keyed by UUID, reactive via liveQuery -->
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
                {#if row.syncStatus !== 'synced'}
                  <span
                    class="w-2 h-2 rounded-full"
                    title={row.syncStatus === 'error' ? 'Sync failed' : row.syncStatus === 'conflict' ? 'Conflict' : 'Saving…'}
                    style="background-color: {row.syncStatus === 'error' ? 'var(--color-error)' : row.syncStatus === 'conflict' ? '#f59e0b' : 'var(--color-text-muted)'};"
                  ></span>
                {/if}
                <span class="text-sm font-semibold" style="color: var(--color-primary);">${Number(row.amount).toFixed(2)}</span>
              </div>
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

