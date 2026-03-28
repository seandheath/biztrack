<script>
  /**
   * History screen — review, edit, and delete past expense and mileage entries.
   *
   * Loads rows from the selected business's Google Sheet for a user-chosen year.
   * Each row can be expanded inline for editing. Edits write back via updateRow();
   * deletes use deleteRow() with a two-tap confirm pattern.
   *
   * Receipt handling:
   *   - Replace: upload new file, update Receipt cell with new filename
   *   - Remove:  clear Receipt cell (old file left in Drive)
   *   - Unchanged: Receipt cell value carried forward as-is
   */

  import { onMount } from 'svelte';
  import { selectedBusiness, businessConfig } from '$lib/store.js';
  import { readRows, updateRow, deleteRow } from '$lib/sheets.js';
  import { uploadFile, listFileNames } from '$lib/drive.js';
  import { processReceipt, generateFilename } from '$lib/receipt.js';
  import { IRS_RATES, QUICKBOOKS_CATEGORIES } from '$lib/constants.js';
  import VendorAutocomplete from '../../components/VendorAutocomplete.svelte';
  import ReceiptPicker from '../../components/ReceiptPicker.svelte';
  import Toast from '../../components/Toast.svelte';

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

  /**
   * @typedef {Object} ExpenseRow
   * @property {number} rowNum
   * @property {string} date
   * @property {string} vendor
   * @property {string} desc
   * @property {string} amount
   * @property {string} category
   * @property {string} payment
   * @property {string} receipt
   * @property {string} notes
   */

  /**
   * @typedef {Object} MileageRow
   * @property {number} rowNum
   * @property {string} date
   * @property {string} from
   * @property {string} to
   * @property {string} purpose
   * @property {string} miles
   * @property {string} rate
   * @property {string} deduction
   */

  /** @type {Array<ExpenseRow|MileageRow>} */
  let rows = $state([]);
  let loading = $state(false);
  let loadError = $state('');

  // ---------------------------------------------------------------------------
  // Edit state
  // ---------------------------------------------------------------------------

  /** Row number currently expanded in read-only detail view, or null. */
  let viewRowNum = $state(/** @type {number|null} */(null));
  /** Row number currently in edit mode, or null. Must equal viewRowNum when set. */
  let editRowNum = $state(/** @type {number|null} */(null));

  /** Live copy of the fields being edited. */
  let editFields = $state(/** @type {Record<string,string>} */({}));

  let saving = $state(false);
  let deleting = $state(false);
  let editError = $state('');
  let confirmDelete = $state(false);

  /** New receipt file chosen by the user during edit. */
  let receiptFile = $state(/** @type {File|null} */(null));
  /** True if the user tapped "Remove" on an existing receipt. */
  let receiptCleared = $state(false);

  // IRS rate derived from editFields.date (for mileage edit)
  let editMilRate = $derived.by(() => {
    if (activeTab !== 'mileage' || !editFields.date) return 0.70;
    const year = new Date(editFields.date + 'T00:00:00').getFullYear();
    if (IRS_RATES[year]) return IRS_RATES[year];
    const years = Object.keys(IRS_RATES).map(Number).sort((a, b) => b - a);
    return IRS_RATES[years[0]] ?? 0.70;
  });

  let editMilDeduction = $derived.by(() => {
    if (activeTab !== 'mileage') return '';
    const m = parseFloat(editFields.miles);
    return isNaN(m) ? '' : (m * editMilRate).toFixed(2);
  });

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------

  let toastMessage = $state('');
  let toastType = $state(/** @type {'success'|'error'} */('success'));
  let toastVisible = $state(false);
  let toastTimer = null;

  function showToast(message, type = 'success') {
    toastMessage = message;
    toastType = type;
    toastVisible = true;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastVisible = false; }, 3000);
  }

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
    editRowNum = null;
    try {
      const sheetName = activeTab === 'expense' ? 'Expenses' : 'Mileage';
      const { rows: raw, rowNums } = await readRows(spreadsheetId, sheetName);
      const parsed = raw.map((r, i) =>
        activeTab === 'expense'
          ? parseExpenseRow(r, rowNums[i])
          : parseMileageRow(r, rowNums[i])
      );
      // Most recent first — reverse so newest dates appear at top
      rows = parsed.toReversed();
    } catch (err) {
      console.error('[history] loadRows:', err);
      loadError = friendlyError(err);
    } finally {
      loading = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Edit open / close
  // ---------------------------------------------------------------------------

  /** Open read-only detail view for a row. */
  function openView(row) {
    viewRowNum = row.rowNum;
    editRowNum = null;
    editFields = { ...row };
    receiptFile = null;
    receiptCleared = false;
    confirmDelete = false;
    editError = '';
  }

  /** Enter edit mode from the read-only view. */
  function startEdit() {
    editRowNum = viewRowNum;
  }

  /** Cancel edit — return to read-only view. */
  function closeEdit() {
    editRowNum = null;
    receiptFile = null;
    receiptCleared = false;
    confirmDelete = false;
    editError = '';
  }

  /** Close the detail view entirely. */
  function closeView() {
    viewRowNum = null;
    editRowNum = null;
    receiptFile = null;
    receiptCleared = false;
    confirmDelete = false;
    editError = '';
  }

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  async function saveEdit() {
    if (!spreadsheetId) return;
    saving = true;
    editError = '';
    try {
      const sheetName = activeTab === 'expense' ? 'Expenses' : 'Mileage';
      let receiptFilename = editFields.receipt ?? '';

      if (receiptFile) {
        // Upload replacement receipt
        const receiptFolderId = $selectedBusiness?.receiptFolderIds?.[selectedYear];
        if (receiptFolderId) {
          const { blob, ext } = await processReceipt(receiptFile);
          const existingNames = await listFileNames(receiptFolderId);
          receiptFilename = generateFilename(
            editFields.vendor ?? editFields.from ?? '',
            editFields.date,
            ext,
            existingNames
          );
          await uploadFile(receiptFilename, blob, blob.type || 'application/octet-stream', receiptFolderId);
        }
      } else if (receiptCleared) {
        receiptFilename = '';
      }

      let values;
      if (activeTab === 'expense') {
        values = [
          editFields.date,
          editFields.vendor,
          editFields.desc,
          parseFloat(editFields.amount || '0').toFixed(2),
          editFields.category,
          editFields.payment,
          receiptFilename,
          editFields.notes,
        ];
      } else {
        const rate = editMilRate;
        const miles = parseFloat(editFields.miles || '0');
        const deduction = isNaN(miles) ? 0 : parseFloat((miles * rate).toFixed(2));
        values = [
          editFields.date,
          editFields.from,
          editFields.to,
          editFields.purpose,
          isNaN(miles) ? editFields.miles : miles,
          rate,
          deduction,
        ];
      }

      await updateRow(spreadsheetId, sheetName, viewRowNum, values);

      // Patch local rows without reloading
      const updatedFields = activeTab === 'expense'
        ? { ...editFields, receipt: receiptFilename }
        : { ...editFields, rate: String(editMilRate), deduction: editMilDeduction };
      rows = rows.map((r) =>
        r.rowNum === viewRowNum ? { ...r, ...updatedFields } : r
      );

      closeView();
      showToast('Saved!', 'success');
    } catch (err) {
      console.error('[history] saveEdit:', err);
      editError = friendlyError(err);
    } finally {
      saving = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Delete (two-tap confirm)
  // ---------------------------------------------------------------------------

  async function handleDelete() {
    if (!confirmDelete) {
      confirmDelete = true;
      return;
    }
    if (!spreadsheetId) return;
    deleting = true;
    editError = '';
    try {
      const sheetName = activeTab === 'expense' ? 'Expenses' : 'Mileage';
      await deleteRow(spreadsheetId, sheetName, viewRowNum);
      rows = rows.filter((r) => r.rowNum !== viewRowNum);
      closeView();
      showToast('Deleted', 'success');
    } catch (err) {
      console.error('[history] deleteRow:', err);
      editError = friendlyError(err);
      confirmDelete = false;
    } finally {
      deleting = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle — initialize selectedYear once business is known
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
          <!-- ---------------------------------------------------------------
               Collapsed row summary
               --------------------------------------------------------------- -->
          {#if viewRowNum !== row.rowNum}
            <button
              type="button"
              onclick={() => openView(row)}
              class="w-full flex items-center justify-between px-4 text-left hover:opacity-80 transition-opacity"
              style="min-height: 52px;"
              aria-label="View entry from {row.date}"
            >
              <div class="flex flex-col gap-0.5 min-w-0 flex-1 pr-3">
                <span class="text-xs" style="color: var(--color-text-muted);">{row.date}</span>
                {#if activeTab === 'expense'}
                  <span class="text-sm font-medium truncate" style="color: var(--color-text);">{row.vendor}</span>
                {:else}
                  <span class="text-sm font-medium truncate" style="color: var(--color-text);">{row.from} → {row.to}</span>
                {/if}
              </div>
              <span class="text-sm font-semibold flex-shrink-0" style="color: var(--color-primary);">
                {#if activeTab === 'expense'}
                  ${row.amount}
                {:else}
                  {row.miles} mi
                {/if}
              </span>
            </button>

          <!-- ---------------------------------------------------------------
               Read-only detail view
               --------------------------------------------------------------- -->
          {:else if editRowNum !== row.rowNum}
            <div class="px-4 py-4 flex flex-col gap-1.5">

              {#if activeTab === 'expense'}
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
              {:else}
                <div class="flex justify-between items-baseline gap-3 py-0.5">
                  <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">Date</span>
                  <span class="text-sm text-right" style="color: var(--color-text);">{row.date}</span>
                </div>
                <div class="flex justify-between items-baseline gap-3 py-0.5">
                  <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">From</span>
                  <span class="text-sm text-right" style="color: var(--color-text);">{row.from}</span>
                </div>
                <div class="flex justify-between items-baseline gap-3 py-0.5">
                  <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">To</span>
                  <span class="text-sm text-right" style="color: var(--color-text);">{row.to}</span>
                </div>
                <div class="flex justify-between items-baseline gap-3 py-0.5">
                  <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">Purpose</span>
                  <span class="text-sm text-right" style="color: var(--color-text);">{row.purpose}</span>
                </div>
                <div class="flex justify-between items-baseline gap-3 py-0.5">
                  <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">Miles</span>
                  <span class="text-sm font-semibold text-right" style="color: var(--color-primary);">{row.miles} mi</span>
                </div>
                <div class="flex justify-between items-baseline gap-3 py-0.5">
                  <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">IRS Rate</span>
                  <span class="text-sm text-right" style="color: var(--color-text);">${row.rate}/mi</span>
                </div>
                <div class="flex justify-between items-baseline gap-3 py-0.5">
                  <span class="text-xs flex-shrink-0" style="color: var(--color-text-muted);">Deduction</span>
                  <span class="text-sm font-semibold text-right" style="color: var(--color-primary);">${row.deduction}</span>
                </div>
              {/if}

              <!-- Action row -->
              <div class="flex gap-2 pt-2">
                <button
                  type="button"
                  onclick={closeView}
                  class="rounded-xl text-sm px-4 flex-shrink-0 transition-opacity hover:opacity-70"
                  style="
                    min-height: 44px;
                    background-color: var(--color-surface-3);
                    color: var(--color-text-muted);
                  "
                >
                  Close
                </button>
                <button
                  type="button"
                  onclick={startEdit}
                  class="flex-1 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80 flex items-center justify-center gap-2"
                  style="
                    min-height: 44px;
                    background-color: var(--color-primary);
                    color: var(--color-primary-text);
                  "
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                  Edit
                </button>
              </div>

            </div>

          <!-- ---------------------------------------------------------------
               Edit form
               --------------------------------------------------------------- -->
          {:else}
            <div class="px-4 py-4 flex flex-col gap-3">

              {#if editError}
                <p class="text-sm rounded-xl px-3 py-2" style="color: var(--color-error); background-color: var(--color-surface-3);">
                  {editError}
                </p>
              {/if}

              {#if activeTab === 'expense'}
                <!-- ---- Expense edit fields ---- -->

                <div class="flex flex-col gap-1">
                  <label for="edit-date-{row.rowNum}" class="text-xs font-medium" style="color: var(--color-text-muted);">Date</label>
                  <input id="edit-date-{row.rowNum}" type="date" bind:value={editFields.date} />
                </div>

                <div class="flex flex-col gap-1">
                  <label for="edit-vendor-{row.rowNum}" class="text-xs font-medium" style="color: var(--color-text-muted);">Vendor / Payee</label>
                  <VendorAutocomplete id="edit-vendor-{row.rowNum}" bind:value={editFields.vendor} />
                </div>

                <div class="flex flex-col gap-1">
                  <label for="edit-desc-{row.rowNum}" class="text-xs font-medium" style="color: var(--color-text-muted);">Description</label>
                  <input id="edit-desc-{row.rowNum}" type="text" bind:value={editFields.desc} placeholder="What was this for?" />
                </div>

                <div class="flex flex-col gap-1">
                  <label for="edit-amount-{row.rowNum}" class="text-xs font-medium" style="color: var(--color-text-muted);">Amount ($)</label>
                  <input id="edit-amount-{row.rowNum}" type="text" inputmode="decimal" bind:value={editFields.amount} placeholder="0.00" />
                </div>

                <div class="flex flex-col gap-1">
                  <label for="edit-category-{row.rowNum}" class="text-xs font-medium" style="color: var(--color-text-muted);">Category</label>
                  <select id="edit-category-{row.rowNum}" bind:value={editFields.category}>
                    <option value="" disabled>Select category…</option>
                    {#each QUICKBOOKS_CATEGORIES as cat (cat)}
                      <option value={cat}>{cat}</option>
                    {/each}
                  </select>
                </div>

                <div class="flex flex-col gap-1">
                  <label for="edit-payment-{row.rowNum}" class="text-xs font-medium" style="color: var(--color-text-muted);">Payment Method</label>
                  <select id="edit-payment-{row.rowNum}" bind:value={editFields.payment}>
                    <option value="" disabled>Select method…</option>
                    {#each ($businessConfig?.payment_accounts ?? ['Cash']) as method (method)}
                      <option value={method}>{method}</option>
                    {/each}
                  </select>
                </div>

                <!-- Receipt -->
                <div class="flex flex-col gap-2">
                  <span class="text-xs font-medium" style="color: var(--color-text-muted);">Receipt</span>

                  {#if editFields.receipt && !receiptCleared && !receiptFile}
                    <div class="flex items-center gap-2 rounded-xl border px-3 py-2" style="border-color: var(--color-border); background-color: var(--color-surface-3);">
                      <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" style="color: var(--color-text-muted);">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                      </svg>
                      <span class="text-xs truncate flex-1" style="color: var(--color-text);">{editFields.receipt}</span>
                      <button
                        type="button"
                        onclick={() => { receiptCleared = true; }}
                        class="text-xs flex-shrink-0 hover:opacity-70 transition-opacity"
                        style="color: var(--color-error);"
                      >
                        Remove
                      </button>
                    </div>
                  {:else if receiptCleared && !receiptFile}
                    <div class="flex items-center gap-2 rounded-xl border px-3 py-2" style="border-color: var(--color-border); background-color: var(--color-surface-3);">
                      <span class="text-xs flex-1" style="color: var(--color-text-muted);">Receipt will be removed</span>
                      <button
                        type="button"
                        onclick={() => { receiptCleared = false; }}
                        class="text-xs flex-shrink-0 hover:opacity-70 transition-opacity"
                        style="color: var(--color-primary);"
                      >
                        Undo
                      </button>
                    </div>
                  {/if}

                  {#if !editFields.receipt || receiptCleared}
                    <ReceiptPicker id="edit-receipt-{row.rowNum}" bind:file={receiptFile} />
                  {:else if editFields.receipt && !receiptCleared}
                    <button
                      type="button"
                      onclick={() => { receiptCleared = true; }}
                      class="text-xs text-left hover:opacity-70 transition-opacity"
                      style="color: var(--color-primary); min-height: 36px; background: transparent;"
                    >
                      Replace receipt…
                    </button>
                  {/if}
                </div>

                <div class="flex flex-col gap-1">
                  <label for="edit-notes-{row.rowNum}" class="text-xs font-medium" style="color: var(--color-text-muted);">Notes</label>
                  <textarea id="edit-notes-{row.rowNum}" bind:value={editFields.notes} rows="2" style="resize: none;" placeholder="Any additional notes…"></textarea>
                </div>

              {:else}
                <!-- ---- Mileage edit fields ---- -->

                <div class="flex flex-col gap-1">
                  <label for="edit-mil-date-{row.rowNum}" class="text-xs font-medium" style="color: var(--color-text-muted);">Date</label>
                  <input id="edit-mil-date-{row.rowNum}" type="date" bind:value={editFields.date} />
                </div>

                <div class="flex flex-col gap-1">
                  <label for="edit-from-{row.rowNum}" class="text-xs font-medium" style="color: var(--color-text-muted);">From</label>
                  <input id="edit-from-{row.rowNum}" type="text" bind:value={editFields.from} placeholder="Starting address or city" />
                </div>

                <div class="flex flex-col gap-1">
                  <label for="edit-to-{row.rowNum}" class="text-xs font-medium" style="color: var(--color-text-muted);">To</label>
                  <input id="edit-to-{row.rowNum}" type="text" bind:value={editFields.to} placeholder="Destination" />
                </div>

                <div class="flex flex-col gap-1">
                  <label for="edit-purpose-{row.rowNum}" class="text-xs font-medium" style="color: var(--color-text-muted);">Purpose</label>
                  <input id="edit-purpose-{row.rowNum}" type="text" bind:value={editFields.purpose} placeholder="Client meeting, site visit…" />
                </div>

                <div class="grid gap-3" style="grid-template-columns: 1fr 1fr;">
                  <div class="flex flex-col gap-1">
                    <label for="edit-miles-{row.rowNum}" class="text-xs font-medium" style="color: var(--color-text-muted);">Miles</label>
                    <input id="edit-miles-{row.rowNum}" type="text" inputmode="decimal" bind:value={editFields.miles} placeholder="0.0" />
                  </div>
                  <div class="flex flex-col gap-1">
                    <label for="edit-irs-rate-{row.rowNum}" class="text-xs font-medium" style="color: var(--color-text-muted);">IRS Rate</label>
                    <input
                      id="edit-irs-rate-{row.rowNum}"
                      type="text"
                      value="${editMilRate}/mi"
                      readonly
                      tabindex="-1"
                      style="color: var(--color-text-muted); cursor: default;"
                    />
                  </div>
                </div>

                {#if editMilDeduction !== ''}
                  <div
                    class="rounded-xl px-4 py-3 flex items-center justify-between"
                    style="background-color: var(--color-surface-3); border: 1px solid var(--color-border);"
                  >
                    <span class="text-xs font-medium" style="color: var(--color-text-muted);">Estimated Deduction</span>
                    <span class="text-lg font-semibold" style="color: var(--color-primary);">${editMilDeduction}</span>
                  </div>
                {/if}
              {/if}

              <!-- Action buttons -->
              <div class="flex gap-2 pt-1">
                <button
                  type="button"
                  onclick={closeEdit}
                  disabled={saving || deleting}
                  class="rounded-xl text-sm px-4 flex-shrink-0 disabled:opacity-50 transition-opacity hover:opacity-70"
                  style="
                    min-height: 44px;
                    background-color: var(--color-surface-3);
                    color: var(--color-text-muted);
                  "
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onclick={handleDelete}
                  disabled={saving || deleting}
                  class="rounded-xl text-sm px-4 flex-shrink-0 disabled:opacity-50 transition-all"
                  style="
                    min-height: 44px;
                    background-color: {confirmDelete ? 'var(--color-error)' : 'var(--color-surface-3)'};
                    color: {confirmDelete ? '#ffffff' : 'var(--color-error)'};
                  "
                >
                  {#if deleting}
                    Deleting…
                  {:else if confirmDelete}
                    Confirm delete?
                  {:else}
                    Delete
                  {/if}
                </button>

                <button
                  type="button"
                  onclick={saveEdit}
                  disabled={saving || deleting}
                  class="flex-1 rounded-xl text-sm font-semibold disabled:opacity-50 transition-opacity flex items-center justify-center gap-2"
                  style="
                    min-height: 44px;
                    background-color: var(--color-primary);
                    color: var(--color-primary-text);
                  "
                >
                  {#if saving}
                    <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z" />
                    </svg>
                    Saving…
                  {:else}
                    Save
                  {/if}
                </button>
              </div>

            </div>
          {/if}
        {/each}
      </div>
    {/if}

  </div>
{/if}

<!-- Toast -->
<Toast message={toastMessage} type={toastType} visible={toastVisible} />
