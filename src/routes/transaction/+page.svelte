<script>
  /**
   * Transaction read-only view.
   *
   * Loaded via /transaction?biz=X&year=Y&txn=Z[&type=mileage] — displays a single
   * expense or mileage row from the sheet in read-only form. Provides Share, Edit,
   * and Delete actions. Used when navigating from the main log or history page.
   */

  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { businesses, selectedBusiness } from '$lib/store.js';
  import { findRowByTxnId, readRow } from '$lib/sheets.js';
  import { getTransaction } from '$lib/db/queries.js';
  import { enqueueDelete } from '$lib/services/sync.js';
  import Toast from '../../components/Toast.svelte';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let loading = $state(true);
  let loadError = $state('');
  let syncStatus = $state('');
  let deleting = $state(false);
  let confirmDelete = $state(false);
  let deleteError = $state('');

  /** Parsed row fields for display. */
  let fields = $state(/** @type {Record<string,string>} */({}));

  /** URL params — needed to build edit/share URLs. */
  let bizId = $state('');
  let year  = $state(0);
  let txnId = $state('');
  /** 'expense' or 'mileage' */
  let type  = $state('expense');

  /** 1-based row number in the sheet (for delete). */
  let rowNum        = $state(/** @type {number|null} */(null));
  let spreadsheetId = $state('');

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------

  let toastMessage = $state('');
  let toastType    = $state(/** @type {'success'|'error'} */('success'));
  let toastVisible = $state(false);
  let toastTimer   = null;

  function showToast(message, t = 'success') {
    toastMessage = message;
    toastType    = t;
    toastVisible = true;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastVisible = false; }, 3000);
  }

  // ---------------------------------------------------------------------------
  // URL builders
  // ---------------------------------------------------------------------------

  function buildEditUrl() {
    const route = type === 'mileage' ? '/mileage' : '/expense';
    const u = new URL(route, window.location.origin);
    u.searchParams.set('biz',  bizId);
    u.searchParams.set('year', String(year));
    u.searchParams.set('txn',  txnId);
    return u.toString();
  }

  function buildShareUrl() {
    const u = new URL('/transaction', window.location.origin);
    u.searchParams.set('biz',  bizId);
    u.searchParams.set('year', String(year));
    u.searchParams.set('txn',  txnId);
    if (type === 'mileage') u.searchParams.set('type', 'mileage');
    return u.toString();
  }

  async function doShare() {
    const url = buildShareUrl();
    const title = type === 'mileage' ? 'Mileage entry' : 'Complete this expense';
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
      } else {
        await navigator.clipboard.writeText(url);
        showToast('Link copied!', 'success');
      }
    } catch {
      // User cancelled share
    }
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  async function handleDelete() {
    if (!confirmDelete) { confirmDelete = true; return; }
    deleting = true;
    deleteError = '';
    try {
      // Enqueue delete — sync engine removes from Sheets and then from Dexie
      await enqueueDelete(txnId, bizId, year);
      goto('/');
    } catch (err) {
      console.error('[transaction] delete:', err);
      deleteError = 'Delete failed. Try again.';
      confirmDelete = false;
    } finally {
      deleting = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  onMount(async () => {
    const sp = new URLSearchParams(window.location.search);
    bizId = sp.get('biz') ?? '';
    year  = parseInt(sp.get('year') ?? '0', 10);
    txnId = sp.get('txn') ?? '';
    type  = sp.get('type') ?? 'expense';

    if (!bizId || !year || !txnId) {
      loadError = 'Invalid link.';
      loading = false;
      return;
    }

    try {
      const biz = $businesses.find((b) => b.id === bizId);
      if (!biz) throw new Error("Business not found. Make sure you're signed in to the correct account.");
      selectedBusiness.set(biz);

      const sheetId = biz.sheetIds?.[year];
      if (!sheetId) throw new Error(`No sheet found for ${year}.`);
      spreadsheetId = sheetId;

      // Try Dexie first (fast, works offline). Fall back to Sheets API if not found
      // (e.g. shared link opened before first-launch pull, or legacy transaction).
      const local = await getTransaction(txnId);

      if (local) {
        // Populate fields from Dexie
        if (local.type === 'mileage') {
          fields = {
            date:      local.date      ?? '',
            from:      local.from      ?? '',
            to:        local.to        ?? '',
            purpose:   local.purpose   ?? '',
            miles:     String(local.miles     ?? ''),
            rate:      String(local.irsRate   ?? ''),
            deduction: String(local.deduction ?? ''),
          };
        } else {
          fields = {
            date:        local.date          ?? '',
            vendor:      local.vendor        ?? '',
            desc:        local.description   ?? '',
            amount:      local.amount != null ? Number(local.amount).toFixed(2) : '',
            category:    local.category      ?? '',
            payment:     local.paymentMethod ?? '',
            receipt:     local.receiptDriveId ?? '',
            notes:       local.notes         ?? '',
            submittedBy: local.submittedBy   ?? '',
          };
        }
        syncStatus = local.syncStatus;
      } else {
        // Fallback: read from Sheets (covers shared links and pre-migration data)
        if (type === 'mileage') {
          const rn = await findRowByTxnId(sheetId, txnId, 'Mileage', 'H');
          if (rn === null) throw new Error('Mileage entry not found.');
          rowNum = rn;
          const raw = await readRow(sheetId, 'Mileage', rowNum);
          fields = {
            date:      raw[0] ?? '',
            from:      raw[1] ?? '',
            to:        raw[2] ?? '',
            purpose:   raw[3] ?? '',
            miles:     raw[4] ?? '',
            rate:      raw[5] ?? '',
            deduction: raw[6] ?? '',
          };
        } else {
          const rn = await findRowByTxnId(sheetId, txnId);
          if (rn === null) throw new Error('Transaction not found.');
          rowNum = rn;
          const raw = await readRow(sheetId, 'Expenses', rowNum);
          fields = {
            date:        raw[0] ?? '',
            vendor:      raw[1] ?? '',
            desc:        raw[2] ?? '',
            amount:      raw[3] ?? '',
            category:    raw[4] ?? '',
            payment:     raw[5] ?? '',
            receipt:     raw[6] ?? '',
            notes:       raw[7] ?? '',
            submittedBy: raw[8] ?? '',
          };
        }
      }
    } catch (err) {
      console.error('[transaction] load:', err);
      loadError = err.message;
    } finally {
      loading = false;
    }
  });
</script>

<div class="px-4 pt-4 pb-8 flex flex-col gap-4 max-w-lg mx-auto">

  {#if loading}
    <!-- Loading spinner -->
    <div class="flex items-center justify-center py-16 gap-3">
      <svg class="w-5 h-5 animate-spin" style="color: var(--color-text-muted);" fill="none" viewBox="0 0 24 24" aria-hidden="true">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z" />
      </svg>
      <span class="text-sm" style="color: var(--color-text-muted);">Loading…</span>
    </div>

  {:else if loadError}
    <!-- Load error -->
    <p class="text-sm rounded-xl px-4 py-3 mt-4" style="color: var(--color-error); background-color: var(--color-surface-2);">
      {loadError}
    </p>
    <a
      href="/"
      class="self-start rounded-xl text-sm font-medium px-5"
      style="min-height: 44px; display:inline-flex; align-items:center; background-color: var(--color-surface-2); color: var(--color-text);"
    >
      ← Go home
    </a>

  {:else}
    <!-- Detail card -->
    <div
      class="rounded-xl border overflow-hidden"
      style="border-color: var(--color-border); background-color: var(--color-surface-2);"
    >
      <div class="px-4 py-4 flex flex-col gap-1.5">

        {#if type === 'mileage'}
          <!-- Mileage fields -->
          <div class="flex justify-between items-baseline gap-3 py-0.5">
            <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">Date</span>
            <span class="text-sm text-right" style="color: var(--color-text);">{fields.date}</span>
          </div>
          <div class="flex justify-between items-baseline gap-3 py-0.5">
            <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">From</span>
            <span class="text-sm text-right" style="color: var(--color-text);">{fields.from}</span>
          </div>
          <div class="flex justify-between items-baseline gap-3 py-0.5">
            <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">To</span>
            <span class="text-sm text-right" style="color: var(--color-text);">{fields.to}</span>
          </div>
          {#if fields.purpose}
            <div class="flex justify-between items-baseline gap-3 py-0.5">
              <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">Purpose</span>
              <span class="text-sm text-right" style="color: var(--color-text);">{fields.purpose}</span>
            </div>
          {/if}
          <div class="flex justify-between items-baseline gap-3 py-0.5">
            <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">Miles</span>
            <span class="text-sm font-semibold text-right" style="color: var(--color-primary);">{fields.miles} mi</span>
          </div>
          {#if fields.rate}
            <div class="flex justify-between items-baseline gap-3 py-0.5">
              <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">IRS Rate</span>
              <span class="text-sm text-right" style="color: var(--color-text);">${fields.rate}/mi</span>
            </div>
          {/if}
          <div class="flex justify-between items-baseline gap-3 py-0.5">
            <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">Deduction</span>
            <span class="text-sm font-semibold text-right" style="color: var(--color-primary);">${fields.deduction}</span>
          </div>

        {:else}
          <!-- Expense fields -->
          <div class="flex justify-between items-baseline gap-3 py-0.5">
            <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">Date</span>
            <span class="text-sm text-right" style="color: var(--color-text);">{fields.date}</span>
          </div>
          <div class="flex justify-between items-baseline gap-3 py-0.5">
            <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">Vendor</span>
            <span class="text-sm text-right" style="color: var(--color-text);">{fields.vendor}</span>
          </div>
          {#if fields.desc}
            <div class="flex justify-between items-baseline gap-3 py-0.5">
              <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">Description</span>
              <span class="text-sm text-right" style="color: var(--color-text);">{fields.desc}</span>
            </div>
          {/if}
          <div class="flex justify-between items-baseline gap-3 py-0.5">
            <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">Amount</span>
            <span class="text-sm font-semibold text-right" style="color: var(--color-primary);">${fields.amount}</span>
          </div>
          {#if fields.category}
            <div class="flex justify-between items-baseline gap-3 py-0.5">
              <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">Category</span>
              <span class="text-sm text-right" style="color: var(--color-text);">{fields.category}</span>
            </div>
          {/if}
          {#if fields.payment}
            <div class="flex justify-between items-baseline gap-3 py-0.5">
              <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">Payment</span>
              <span class="text-sm text-right" style="color: var(--color-text);">{fields.payment}</span>
            </div>
          {/if}
          {#if fields.receipt}
            <div class="flex justify-between items-baseline gap-3 py-0.5">
              <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">Receipt</span>
              <span class="text-sm text-right truncate max-w-[60%]" style="color: var(--color-text);">{fields.receipt}</span>
            </div>
          {/if}
          {#if fields.notes}
            <div class="flex justify-between items-baseline gap-3 py-0.5">
              <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">Notes</span>
              <span class="text-sm text-right" style="color: var(--color-text);">{fields.notes}</span>
            </div>
          {/if}
          {#if fields.submittedBy}
            <div class="flex justify-between items-baseline gap-3 py-0.5">
              <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">Submitted by</span>
              <span class="text-sm text-right truncate max-w-[60%]" style="color: var(--color-text-muted);">{fields.submittedBy}</span>
            </div>
          {/if}
        {/if}

        {#if syncStatus && syncStatus !== 'synced'}
          <div class="flex justify-between items-baseline gap-3 py-0.5 mt-1">
            <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">Sync</span>
            <span class="text-sm text-right" style="color: {syncStatus === 'error' ? 'var(--color-error)' : syncStatus === 'conflict' ? '#f59e0b' : 'var(--color-text-muted)'};">
              {syncStatus === 'pending' ? 'Saving locally…' : syncStatus === 'error' ? 'Sync failed' : 'Conflict'}
            </span>
          </div>
        {/if}

      </div>
    </div>

    {#if deleteError}
      <p class="text-sm rounded-xl px-4 py-3" style="color: var(--color-error); background-color: var(--color-surface-2);">
        {deleteError}
      </p>
    {/if}

    <!-- Action row -->
    <div class="flex gap-3 flex-wrap">
      <a
        href="/"
        class="rounded-xl text-sm px-4 flex-shrink-0 flex items-center justify-center transition-opacity hover:opacity-70"
        style="min-height: 44px; background-color: var(--color-surface-2); color: var(--color-text-muted); border: 1px solid var(--color-border);"
      >
        ← Back
      </a>
      <button
        type="button"
        onclick={doShare}
        class="rounded-xl text-sm px-4 font-medium flex-shrink-0 transition-opacity hover:opacity-80"
        style="min-height: 44px; background-color: var(--color-surface-2); color: var(--color-text); border: 1px solid var(--color-border);"
      >
        Share
      </button>
      {#if spreadsheetId}
        <a
          href="https://docs.google.com/spreadsheets/d/{spreadsheetId}/edit"
          target="_blank"
          rel="noopener noreferrer"
          class="rounded-xl text-sm px-4 flex-shrink-0 flex items-center justify-center gap-1.5 transition-opacity hover:opacity-80"
          style="min-height: 44px; background-color: var(--color-surface-2); color: var(--color-text); border: 1px solid var(--color-border);"
        >
          <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          Sheets
        </a>
      {/if}
      <button
        type="button"
        onclick={handleDelete}
        disabled={deleting}
        class="rounded-xl text-sm px-4 flex-shrink-0 disabled:opacity-50 transition-all"
        style="
          min-height: 44px;
          background-color: {confirmDelete ? 'var(--color-error)' : 'var(--color-surface-2)'};
          color: {confirmDelete ? '#ffffff' : 'var(--color-error)'};
          border: 1px solid {confirmDelete ? 'var(--color-error)' : 'var(--color-border)'};
        "
      >
        {#if deleting}Deleting…{:else if confirmDelete}Confirm delete?{:else}Delete{/if}
      </button>
      <a
        href={buildEditUrl()}
        class="flex-1 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-opacity hover:opacity-80"
        style="min-height: 44px; background-color: var(--color-primary); color: var(--color-primary-text);"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
        </svg>
        Edit
      </a>
    </div>

  {/if}

</div>

<!-- Toast -->
<Toast message={toastMessage} type={toastType} visible={toastVisible} />
