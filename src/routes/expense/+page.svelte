<script>
  /**
   * Expense entry form.
   *
   * Extracted from the former home page (/) as a dedicated route.
   * Business selection triggers config load + vendor cache sync + year folder ensure.
   * Supports rapid entry: date, category, and payment method are preserved after submit.
   * Handles Android Web Share Target receipts via $pendingReceipt store.
   */

  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    businesses,
    selectedBusiness,
    businessConfig,
    vendorCache,
    pendingReceipt,
    userEmail,
  } from '$lib/store.js';
  import { downloadJson, findFile, listFileNames, uploadFile } from '$lib/drive.js';
  import { appendRow, readColumn, updateRow, readRow, findRowByTxnId } from '$lib/sheets.js';
  import { enqueueCreate, enqueueUpdate } from '$lib/services/sync.js';
  import { ensureYearFolder } from '$lib/business.js';
  import { processReceipt, generateFilename } from '$lib/receipt.js';
  import { QUICKBOOKS_CATEGORIES } from '$lib/constants.js';
  import BusinessDropdown from '../../components/BusinessDropdown.svelte';
  import VendorAutocomplete from '../../components/VendorAutocomplete.svelte';
  import ReceiptPicker from '../../components/ReceiptPicker.svelte';
  import Toast from '../../components/Toast.svelte';

  // ---------------------------------------------------------------------------
  // Config/loading state
  // ---------------------------------------------------------------------------

  let configLoading = $state(false);

  // ---------------------------------------------------------------------------
  // Expense form state
  // ---------------------------------------------------------------------------

  let expDate      = $state(todayISO());
  let expVendor    = $state('');
  let expDesc      = $state('');
  let expAmount    = $state('');
  let expCategory  = $state('');
  let expPayment   = $state('');
  let expNotes     = $state('');
  let expReceipt   = $state(/** @type {File|null} */(null));
  let expErrors    = $state(/** @type {Record<string,string>} */({}));
  let expSubmitting = $state(false);

  /** Ref to vendor input for auto-focus after submit */
  let vendorInputEl = $state(null);

  // ---------------------------------------------------------------------------
  // Share state — post-save share panel + share URL edit mode
  // ---------------------------------------------------------------------------

  /** txnId of the most recently saved expense; shows share panel when set. */
  let lastSavedTxnId = $state('');
  let lastSavedYear  = $state(0);

  /** True when the page loaded from a share URL and is editing an existing row. */
  let shareMode        = $state(false);
  let shareLoading     = $state(false);
  let shareLoadError   = $state('');
  let shareRowNum      = $state(/** @type {number|null} */(null));
  let shareSheetId     = $state('');
  let shareSubmittedBy = $state('');
  let shareTxnId       = $state('');

  // ---------------------------------------------------------------------------
  // Toast state
  // ---------------------------------------------------------------------------

  let toastMessage = $state('');
  let toastType    = $state(/** @type {'success'|'error'} */('success'));
  let toastVisible = $state(false);
  let toastTimer   = null;

  function showToast(message, type = 'success') {
    toastMessage = message;
    toastType    = type;
    toastVisible = true;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastVisible = false; }, 3000);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function friendlyError(err) {
    const msg = err?.message ?? '';
    if (msg.includes('401')) return 'Session expired. Please sign in again.';
    if (msg.includes('403')) return 'Permission denied. Check Drive sharing.';
    return 'Network error. Try again.';
  }

  // ---------------------------------------------------------------------------
  // Business data load
  // ---------------------------------------------------------------------------

  /**
   * Loads config.json and syncs vendor cache for a given business.
   * Also ensures the current year folder exists (fast-path if already cached).
   *
   * @param {Object} business
   */
  async function loadBusinessData(business) {
    if (!business) {
      businessConfig.set(null);
      return;
    }

    configLoading = true;
    try {
      // Resolve configFileId lazily for businesses added before Phase 8
      let configId = business.configFileId;
      if (!configId) {
        configId = await findFile('config.json', business.folderId);
        if (configId) {
          const updated = { ...business, configFileId: configId };
          businesses.update((list) => list.map((b) => b.name === business.name ? updated : b));
          selectedBusiness.set(updated);
          business = updated;
        }
      }

      // Load config
      if (configId) {
        const cfg = await downloadJson(configId);
        if (!Array.isArray(cfg.payment_accounts))  cfg.payment_accounts  = ['Cash'];
        if (!Array.isArray(cfg.mileage_favorites)) cfg.mileage_favorites = [];
        businessConfig.set(cfg);
        // Default payment method for a fresh load
        if (!expPayment) expPayment = cfg.payment_accounts[0] ?? '';
      }

      // Ensure current year folder exists (creates Drive structure if needed)
      const year = new Date().getFullYear();
      const updated = await ensureYearFolder(business, year);
      if (updated !== business) {
        businesses.update((list) => list.map((b) => b.name === business.name ? updated : b));
        selectedBusiness.set(updated);
        business = updated;
      }

      // Sync vendor autocomplete cache from column B of this year's sheet
      const sheetId = business.sheetIds?.[year];
      if (sheetId) {
        const vendors = await readColumn(sheetId, 'Expenses', 'B');
        const unique = [...new Set(vendors.filter(Boolean))];
        vendorCache.set(unique);
      }
    } catch (err) {
      console.error('[expense] loadBusinessData:', err);
    } finally {
      configLoading = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Expense form handlers
  // ---------------------------------------------------------------------------

  function validateExpense() {
    const errs = {};
    if (!expDate)                              errs.date     = 'Required';
    if (!expVendor.trim())                     errs.vendor   = 'Required';
    if (!expAmount || isNaN(parseFloat(expAmount))) errs.amount = 'Valid amount required';
    if (!expCategory)                          errs.category = 'Required';
    if (!expPayment)                           errs.payment  = 'Required';
    expErrors = errs;
    return Object.keys(errs).length === 0;
  }

  async function submitExpense() {
    if (!validateExpense()) return;

    expSubmitting = true;
    try {
      const year = new Date(expDate + 'T00:00:00').getFullYear();
      let biz = $selectedBusiness;

      // Ensure the target year folder exists (handles backdated expenses)
      if (!biz.sheetIds?.[year]) {
        biz = await ensureYearFolder(biz, year);
        businesses.update((list) => list.map((b) => b.name === biz.name ? biz : b));
        selectedBusiness.set(biz);
      }

      const receiptFolderId = biz.receiptFolderIds?.[year];
      const amount = parseFloat(expAmount);

      // Upload receipt to Drive if one is attached (requires network)
      let receiptDriveId = '';
      if (expReceipt && receiptFolderId) {
        const { blob, ext }  = await processReceipt(expReceipt);
        const existingNames  = await listFileNames(receiptFolderId);
        const filename       = generateFilename(expVendor.trim(), expDate, ext, existingNames);
        const uploaded       = await uploadFile(filename, blob, blob.type || 'application/octet-stream', receiptFolderId);
        receiptDriveId       = uploaded.id;
      }

      if (shareMode) {
        // Editing a shared expense — update via sync engine
        await enqueueUpdate(shareTxnId, {
          date:          expDate,
          vendor:        expVendor.trim(),
          description:   expDesc.trim(),
          amount,
          category:      expCategory,
          paymentMethod: expPayment,
          receiptDriveId: receiptDriveId || undefined,
          notes:         expNotes.trim(),
          submittedBy:   shareSubmittedBy,
        });
        showToast('Details saved!', 'success');
        shareMode = false;
      } else {
        // New expense — write to Dexie, sync engine pushes to Sheets
        const txnId = await enqueueCreate({
          businessId:    biz.id,
          type:          'expense',
          year,
          date:          expDate,
          vendor:        expVendor.trim(),
          description:   expDesc.trim(),
          amount,
          category:      expCategory,
          paymentMethod: expPayment,
          receiptDriveId: receiptDriveId || undefined,
          notes:         expNotes.trim(),
          submittedBy:   $userEmail ?? '',
        });

        // Update vendor autocomplete cache
        const vendor = expVendor.trim();
        vendorCache.update((cache) =>
          cache.includes(vendor) ? cache : [...cache, vendor]
        );

        // Show share panel
        lastSavedTxnId = txnId;
        lastSavedYear  = year;

        showToast('Expense saved!', 'success');

        // Clear fields — preserve date, category, payment for rapid entry
        expVendor   = '';
        expDesc     = '';
        expAmount   = '';
        expNotes    = '';
        expReceipt  = null;
        expErrors   = {};

        // Auto-focus vendor for next entry
        setTimeout(() => vendorInputEl?.focus(), 50);
      }
    } catch (err) {
      console.error('[expense] submit:', err);
      showToast(friendlyError(err), 'error');
    } finally {
      expSubmitting = false;
    }
  }

  function handleAmountBlur() {
    const val = parseFloat(expAmount);
    if (!isNaN(val)) expAmount = val.toFixed(2);
  }

  // ---------------------------------------------------------------------------
  // Year-rollover helper
  // ---------------------------------------------------------------------------

  /**
   * Silently ensures the Drive year-folder exists for a given ISO date string.
   * Called from the date field onchange handler to pre-warm the folder before submit.
   *
   * @param {string} isoDate
   */
  async function prefetchYearFolder(isoDate) {
    const biz = $selectedBusiness;
    if (!biz || !isoDate) return;
    const year = new Date(isoDate + 'T00:00:00').getFullYear();
    if (biz.yearFolders?.[year]) return;
    try {
      const updated = await ensureYearFolder(biz, year);
      businesses.update((list) => list.map((b) => b.name === biz.name ? updated : b));
      selectedBusiness.set(updated);
    } catch (err) {
      console.warn('[expense] prefetchYearFolder failed:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Share helpers
  // ---------------------------------------------------------------------------

  function buildShareUrl(bizId, year, txnId) {
    const u = new URL('/expense', window.location.origin);
    u.searchParams.set('biz',  bizId);
    u.searchParams.set('year', String(year));
    u.searchParams.set('txn',  txnId);
    return u.toString();
  }

  async function doShare() {
    const url = buildShareUrl($selectedBusiness.id, lastSavedYear, lastSavedTxnId);
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Complete this expense', url });
      } else {
        await navigator.clipboard.writeText(url);
        showToast('Link copied!', 'success');
      }
      lastSavedTxnId = '';
    } catch {
      // User cancelled share — leave panel open
    }
  }

  async function doCopyShareLink() {
    const url = buildShareUrl($selectedBusiness.id, lastSavedYear, lastSavedTxnId);
    await navigator.clipboard.writeText(url);
    showToast('Link copied!', 'success');
    lastSavedTxnId = '';
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  onMount(async () => {
    // Pick up any receipt shared from another app via Android Web Share Target
    if ($pendingReceipt) {
      expReceipt = $pendingReceipt;
      pendingReceipt.set(null);
    }

    // Check for share URL params: ?biz=X&year=Y&txn=Z
    const sp = new URLSearchParams(window.location.search);
    const bizId = sp.get('biz');
    const yearStr = sp.get('year');
    const txnId = sp.get('txn');

    if (bizId && yearStr && txnId) {
      shareMode = true;
      shareLoading = true;
      try {
        const biz = $businesses.find((b) => b.id === bizId);
        if (!biz) throw new Error("Business not found. Make sure you're signed in to the correct account.");
        selectedBusiness.set(biz);
        await loadBusinessData(biz);

        const yr = parseInt(yearStr, 10);
        const sheetId = biz.sheetIds?.[yr] ?? $selectedBusiness?.sheetIds?.[yr];
        if (!sheetId) throw new Error(`No expense sheet found for ${yr}.`);
        shareSheetId = sheetId;

        const rowNum = await findRowByTxnId(sheetId, txnId);
        if (rowNum === null) throw new Error('Transaction not found.');
        shareRowNum = rowNum;

        const raw = await readRow(sheetId, 'Expenses', rowNum);
        expDate     = raw[0] || todayISO();
        expVendor   = raw[1] || '';
        expDesc     = raw[2] || '';
        expAmount   = raw[3] || '';
        expCategory = raw[4] || '';
        expPayment  = raw[5] || '';
        expNotes    = raw[7] || '';
        shareSubmittedBy = raw[8] || '';
        shareTxnId  = raw[9] || txnId;
      } catch (err) {
        console.error('[expense] share load:', err);
        shareLoadError = err.message;
      } finally {
        shareLoading = false;
      }
    } else if ($selectedBusiness) {
      loadBusinessData($selectedBusiness);
    }
  });
</script>

<div class="px-4 pt-4 pb-8 flex flex-col gap-4 max-w-lg mx-auto">

  <!-- Business selector + loading indicator -->
  <div class="flex items-center gap-2">
    <div class="flex-1">
      <BusinessDropdown onchange={loadBusinessData} />
    </div>
    {#if configLoading}
      <svg
        class="w-5 h-5 animate-spin flex-shrink-0"
        style="color: var(--color-text-muted);"
        fill="none"
        viewBox="0 0 24 24"
        aria-label="Loading…"
        aria-hidden="true"
      >
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z" />
      </svg>
    {/if}
  </div>

  {#if shareLoadError}
    <!-- Share URL error — business not found or transaction missing -->
    <div class="rounded-xl border p-5 flex flex-col gap-3 text-center"
         style="border-color: var(--color-error); background-color: var(--color-surface-2);">
      <p class="text-sm font-medium" style="color: var(--color-error);">{shareLoadError}</p>
      <a href="/" class="text-sm" style="color: var(--color-primary);">Go to main page</a>
    </div>

  {:else if shareLoading}
    <!-- Loading shared transaction -->
    <div class="flex items-center justify-center py-12 gap-3">
      <svg class="w-5 h-5 animate-spin" style="color: var(--color-text-muted);" fill="none" viewBox="0 0 24 24" aria-hidden="true">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z" />
      </svg>
      <span class="text-sm" style="color: var(--color-text-muted);">Loading expense…</span>
    </div>

  {:else if !$selectedBusiness}
    <p class="text-center py-8 text-sm" style="color: var(--color-text-muted);">
      Select a business above.
    </p>
  {:else}
    {#if shareMode}
      <!-- Share mode banner -->
      <div class="rounded-xl px-4 py-3 text-sm" style="background-color: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text-muted);">
        Completing expense{shareSubmittedBy ? ` shared by ${shareSubmittedBy}` : ''}. Fill in any missing details and save.
      </div>
    {/if}

    <form onsubmit={(e) => { e.preventDefault(); submitExpense(); }} class="flex flex-col gap-4" novalidate>

      <!-- Date -->
      <div class="flex flex-col gap-1">
        <label for="exp-date" class="text-sm font-medium" style="color: var(--color-text-muted);">Date</label>
        <input
          id="exp-date"
          type="date"
          bind:value={expDate}
          onchange={() => prefetchYearFolder(expDate)}
          required
        />
        {#if expErrors.date}
          <span class="text-xs" style="color: var(--color-error);">{expErrors.date}</span>
        {/if}
      </div>

      <!-- Vendor -->
      <div class="flex flex-col gap-1">
        <label for="exp-vendor" class="text-sm font-medium" style="color: var(--color-text-muted);">Vendor / Payee</label>
        <VendorAutocomplete id="exp-vendor" bind:value={expVendor} bind:inputEl={vendorInputEl} />
        {#if expErrors.vendor}
          <span class="text-xs" style="color: var(--color-error);">{expErrors.vendor}</span>
        {/if}
      </div>

      <!-- Description -->
      <div class="flex flex-col gap-1">
        <label for="exp-desc" class="text-sm font-medium" style="color: var(--color-text-muted);">
          Description <span style="color: var(--color-text-muted); font-weight: 400;">(optional)</span>
        </label>
        <input id="exp-desc" type="text" bind:value={expDesc} placeholder="What was this for?" />
      </div>

      <!-- Amount -->
      <div class="flex flex-col gap-1">
        <label for="exp-amount" class="text-sm font-medium" style="color: var(--color-text-muted);">Amount ($)</label>
        <input
          id="exp-amount"
          type="text"
          inputmode="decimal"
          bind:value={expAmount}
          onblur={handleAmountBlur}
          placeholder="0.00"
          required
        />
        {#if expErrors.amount}
          <span class="text-xs" style="color: var(--color-error);">{expErrors.amount}</span>
        {/if}
      </div>

      <!-- Category -->
      <div class="flex flex-col gap-1">
        <label for="exp-category" class="text-sm font-medium" style="color: var(--color-text-muted);">Category</label>
        <select id="exp-category" bind:value={expCategory} required>
          <option value="" disabled>Select category…</option>
          {#each QUICKBOOKS_CATEGORIES as cat (cat)}
            <option value={cat}>{cat}</option>
          {/each}
        </select>
        {#if expErrors.category}
          <span class="text-xs" style="color: var(--color-error);">{expErrors.category}</span>
        {/if}
      </div>

      <!-- Payment Method -->
      <div class="flex flex-col gap-1">
        <label for="exp-payment" class="text-sm font-medium" style="color: var(--color-text-muted);">Payment Method</label>
        {#if $businessConfig?.payment_accounts?.length}
          <select
            id="exp-payment"
            value={expPayment}
            onchange={(e) => {
              if (e.target.value === '__add_payment__') { goto('/settings/payments'); return; }
              expPayment = e.target.value;
            }}
            required
          >
            <option value="" disabled>Select method…</option>
            {#each $businessConfig.payment_accounts as method (method)}
              <option value={method}>{method}</option>
            {/each}
            <option value="__add_payment__" style="color: var(--color-primary);">+ Add Payment Method…</option>
          </select>
        {:else}
          <select id="exp-payment" disabled>
            <option>Loading…</option>
          </select>
        {/if}
        {#if expErrors.payment}
          <span class="text-xs" style="color: var(--color-error);">{expErrors.payment}</span>
        {/if}
      </div>

      <!-- Receipt -->
      <div class="flex flex-col gap-1">
        <label for="exp-receipt" class="text-sm font-medium" style="color: var(--color-text-muted);">
          Receipt <span style="color: var(--color-text-muted); font-weight: 400;">(optional)</span>
        </label>
        <ReceiptPicker id="exp-receipt" bind:file={expReceipt} />
      </div>

      <!-- Notes -->
      <div class="flex flex-col gap-1">
        <label for="exp-notes" class="text-sm font-medium" style="color: var(--color-text-muted);">
          Notes <span style="color: var(--color-text-muted); font-weight: 400;">(optional)</span>
        </label>
        <textarea
          id="exp-notes"
          bind:value={expNotes}
          rows="2"
          placeholder="Any additional notes…"
          style="resize: none;"
        ></textarea>
      </div>

      <!-- Submit -->
      <button
        type="submit"
        disabled={expSubmitting || configLoading}
        class="w-full rounded-xl font-semibold text-base transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
        style="
          min-height: 52px;
          background-color: var(--color-primary);
          color: var(--color-primary-text);
        "
      >
        {#if expSubmitting}
          <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z" />
          </svg>
          Saving…
        {:else}
          {shareMode ? 'Save Changes' : 'Save Expense'}
        {/if}
      </button>

    </form>

    <!-- Share panel — appears after a successful new expense save -->
    {#if lastSavedTxnId && $selectedBusiness?.id}
      <div class="rounded-xl border p-4 flex flex-col gap-3"
           style="border-color: var(--color-border); background-color: var(--color-surface-2);">
        <p class="text-sm font-medium" style="color: var(--color-text);">Share for completion?</p>
        <p class="text-xs" style="color: var(--color-text-muted);">
          Send this link to someone to fill in missing details.
        </p>
        <div class="flex gap-2">
          {#if typeof navigator !== 'undefined' && navigator.share}
            <button
              type="button"
              onclick={doShare}
              class="flex-1 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
              style="min-height: 44px; background-color: var(--color-primary); color: var(--color-primary-text);"
            >
              Share Link
            </button>
          {/if}
          <button
            type="button"
            onclick={doCopyShareLink}
            class="flex-1 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
            style="min-height: 44px; background-color: var(--color-surface-3, var(--color-border)); color: var(--color-text);"
          >
            Copy Link
          </button>
          <button
            type="button"
            onclick={() => lastSavedTxnId = ''}
            class="rounded-xl px-3 text-sm transition-opacity hover:opacity-70"
            style="min-height: 44px; color: var(--color-text-muted);"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      </div>
    {/if}

  {/if}

</div>

<!-- Toast -->
<Toast message={toastMessage} type={toastType} visible={toastVisible} />
