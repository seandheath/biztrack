<script module>
  // Vendor → {category, paymentMethod} defaults derived from the current sheet.
  // Module-level so it survives SvelteKit client-side navigations within the session.
  let vendorDefaults = {};
</script>

<script>
  import Spinner from '../../components/Spinner.svelte';
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
    paymentMethodCache,
    pendingReceipt,
    userEmail,
    updateBusiness,
  } from '$lib/store.js';
  import { listFileNames, uploadFile, findFile } from '$lib/drive.js';
  import { pushTransactions, updateByUUID, deleteByUUID, batchSetCategory, pullTransactions, readRow, findRowByTxnId } from '$lib/services/sheets.js';
  import { toast, showToast } from '$lib/toast.svelte.js';
  import { todayISO, friendlyError } from '$lib/util.js';
  import { enqueue } from '$lib/services/offline-queue.js';
  import { syncStatus, cacheTransactions, invalidatePull, removeCachedTransaction, updateCachedTransaction } from '$lib/sync.js';
  import { ensureYearFolder, loadBusinessData as _loadBusinessData } from '$lib/business.js';
  import { processReceipt, generateFilename } from '$lib/receipt.js';
  import { DEFAULT_CATEGORIES } from '$lib/constants.js';

  let categories = $derived($businessConfig?.categories ?? DEFAULT_CATEGORIES);
  import BusinessDropdown from '../../components/BusinessDropdown.svelte';
  import Autocomplete from '../../components/Autocomplete.svelte';
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

  /** Only active in review mode — apply chosen category to all uncategorized rows for this vendor. */
  let applyToAll    = $state(false);

  // Delete state — review mode only
  let confirmDelete = $state(false);
  let deleting      = $state(false);
  let deleteError   = $state('');

  async function handleDelete() {
    if (!confirmDelete) { confirmDelete = true; return; }
    deleting = true;
    deleteError = '';
    try {
      const year = new Date(expDate + 'T00:00:00').getFullYear();
      const spreadsheetId = $selectedBusiness?.sheetIds?.[year] ?? shareSheetId;
      await deleteByUUID(spreadsheetId, 'Expenses', shareTxnId);
      removeCachedTransaction(spreadsheetId, 'Expenses', shareTxnId);
      invalidatePull(spreadsheetId);
      goto(returnTo || '/');
    } catch (err) {
      console.error('[expense] delete:', err);
      deleteError = 'Delete failed. Try again.';
      confirmDelete = false;
    } finally {
      deleting = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Split mode state
  // ---------------------------------------------------------------------------

  let splitMode = $state(false);
  /** @type {{ description: string, amount: string, category: string }[]} */
  let splits = $state([
    { description: '', amount: '', category: '' },
    { description: '', amount: '', category: '' },
  ]);

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
  /** Route to navigate to after a successful edit-mode save (e.g. '/review'). */
  let returnTo         = $state('');
  let shareLoading     = $state(false);
  let shareLoadError   = $state('');
  let shareRowNum      = $state(/** @type {number|null} */(null));
  let shareSheetId     = $state('');
  let shareSubmittedBy = $state('');
  let shareTxnId       = $state('');

  // Existing receipt link — populated when editing a transaction that has a receipt
  let existingReceipt    = $state('');
  let existingReceiptUrl = $state('');

  // Hide existing receipt link when user picks a new file
  $effect(() => { if (expReceipt) { existingReceipt = ''; existingReceiptUrl = ''; } });

  // ---------------------------------------------------------------------------
  // Business data load
  // ---------------------------------------------------------------------------

  /**
   * Loads config + year folder via shared helper, then syncs expense-specific
   * vendor cache and sets the default payment method.
   *
   * @param {Object} business
   */
  async function loadBusinessData(business) {
    configLoading = true;
    try {
      const biz = await _loadBusinessData(business);
      if (!biz) return;

      // Sync vendor + payment method autocomplete caches from this year's sheet
      const year = new Date().getFullYear();
      const sheetId = biz.sheetIds?.[year];
      if (sheetId) {
        const expenseRows = await pullTransactions(sheetId, 'Expenses');
        const uniqueVendors = [...new Set(expenseRows.map((r) => r.vendor).filter(Boolean))];
        vendorCache.set(uniqueVendors);
        const uniquePayments = [...new Set(expenseRows.map((r) => r.paymentMethod).filter(Boolean))];
        paymentMethodCache.set(uniquePayments);
        _cacheVendorDefaults(expenseRows);
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

  function handleVendorPick(vendor) {
    const d = vendorDefaults[vendor];
    if (!d) return;
    if (!expCategory && d.category) expCategory = d.category;
    if (!expPayment && d.paymentMethod) expPayment = d.paymentMethod;
  }

  function _cacheVendorDefaults(rows) {
    const defaults = {};
    for (const row of rows.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))) {
      if (row.vendor && !defaults[row.vendor])
        defaults[row.vendor] = { category: row.category || undefined, paymentMethod: row.paymentMethod || undefined };
    }
    vendorDefaults = defaults;
  }

  function validateExpense() {
    const errs = {};
    if (!expDate)        errs.date    = 'Required';
    if (!expVendor.trim()) errs.vendor = 'Required';
    if (!expPayment)     errs.payment = 'Required';
    if (splitMode) {
      const valid = splits.some((s) => s.amount && s.category);
      if (!valid) errs.splits = 'At least one line needs an amount and category';
    } else {
      if (!expAmount || isNaN(parseFloat(expAmount))) errs.amount   = 'Valid amount required';
      if (!expCategory)                               errs.category = 'Required';
    }
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
        updateBusiness(biz);
      }

      const receiptFolderId = biz.receiptFolderIds?.[year];
      const amount = parseFloat(expAmount);

      // Upload receipt to Drive if one is attached (requires network)
      let receiptFilename = '';
      if (expReceipt && receiptFolderId) {
        const { blob, ext }  = await processReceipt(expReceipt);
        const existingNames  = await listFileNames(receiptFolderId);
        const filename       = generateFilename(expVendor.trim(), expDate, ext, existingNames);
        await uploadFile(filename, blob, blob.type || 'application/octet-stream', receiptFolderId);
        receiptFilename      = filename;
      }

      const spreadsheetId = biz.sheetIds?.[year];
      if (!spreadsheetId) throw new Error(`No sheet found for ${year}.`);

      if (shareMode) {
        // Editing a shared expense
        const common = {
          date:           expDate,
          vendor:         expVendor.trim(),
          paymentMethod:  expPayment,
          receipt: receiptFilename || '',
          notes:          expNotes.trim(),
          submittedBy:    shareSubmittedBy,
        };

        if (splitMode) {
          // Split: delete original row, push multiple new rows
          const validLines = splits.filter((s) => s.amount && s.category);
          const rows = validLines.map((split) => ({
            ...common,
            id:          crypto.randomUUID(),
            description: split.description.trim(),
            amount:      split.amount,
            category:    split.category,
          }));
          try {
            // Always delete original from its source sheet
            await deleteByUUID(shareSheetId, 'Expenses', shareTxnId);
            await pushTransactions(spreadsheetId, 'Expenses', rows);
          } catch (err) {
            if (!navigator.onLine) {
              enqueue({ spreadsheetId: shareSheetId, sheetName: 'Expenses', operation: 'delete', row: { id: shareTxnId } });
              for (const row of rows)
                enqueue({ spreadsheetId, sheetName: 'Expenses', operation: 'create', row });
              showToast('Saved offline — will sync when back online', 'success');
              if (returnTo) { goto(returnTo); return; }
              shareMode = false;
              return;
            }
            throw err;
          }
          showToast(`Split into ${validLines.length} expenses!`, 'success');
          // Update local cache — remove original, invalidate so destination pulls fresh data
          removeCachedTransaction(shareSheetId, 'Expenses', shareTxnId);
          invalidatePull(spreadsheetId);
          if (shareSheetId !== spreadsheetId) invalidatePull(shareSheetId);
          if (returnTo) { goto(returnTo); return; }
          shareMode = false;
        } else {
          // Single-row update
          const updatedRow = {
            ...common,
            id:             shareTxnId,
            description:    expDesc.trim(),
            amount:         String(amount),
            category:       expCategory,
          };
          try {
            if (spreadsheetId !== shareSheetId) {
              // Date changed to a different year — move row between sheets
              await deleteByUUID(shareSheetId, 'Expenses', shareTxnId);
              await pushTransactions(spreadsheetId, 'Expenses', [updatedRow]);
            } else {
              await updateByUUID(spreadsheetId, 'Expenses', updatedRow);
            }
          } catch (err) {
            if (!navigator.onLine) {
              enqueue({ spreadsheetId, sheetName: 'Expenses', operation: 'update', row: updatedRow });
              showToast('Saved offline — will sync when back online', 'success');
              if (returnTo) { goto(returnTo); return; }
              shareMode = false;
              return;
            }
            throw err;
          }
          showToast('Details saved!', 'success');
          // Update local cache so destination page renders fresh data instantly
          if (spreadsheetId !== shareSheetId) {
            removeCachedTransaction(shareSheetId, 'Expenses', shareTxnId);
            invalidatePull(shareSheetId);
          }
          updateCachedTransaction(spreadsheetId, 'Expenses', updatedRow);
          invalidatePull(spreadsheetId);
          if (returnTo) {
            if (applyToAll && expVendor && expCategory) {
              const biz = $selectedBusiness;
              const currentYear = new Date().getFullYear();
              for (let y = currentYear; y >= currentYear - 2; y--) {
                const sid = biz.sheetIds?.[y];
                if (!sid) continue;
                try {
                  const rows = await pullTransactions(sid, 'Expenses');
                  const targets = rows
                    .filter((r) => r.vendor === expVendor && r.id !== shareTxnId &&
                                   (!r.category || r.category === 'Uncategorized'))
                    .map((r) => r.id);
                  if (targets.length) await batchSetCategory(sid, targets, expCategory);
                } catch (err) { console.warn('[expense] batchSetCategory:', err); }
              }
            }
            goto(returnTo);
            return;
          }
          shareMode = false;
        }
      } else {
        // New expense — push directly to Sheets
        const common = {
          date:           expDate,
          vendor:         expVendor.trim(),
          paymentMethod:  expPayment,
          receipt: receiptFilename || '',
          notes:          expNotes.trim(),
          submittedBy:    $userEmail ?? '',
        };

        let txnId;
        if (splitMode) {
          const validLines = splits.filter((s) => s.amount && s.category);
          const rows = validLines.map((split) => ({
            ...common,
            id:          crypto.randomUUID(),
            description: split.description.trim(),
            amount:      split.amount,
            category:    split.category,
          }));
          try {
            await pushTransactions(spreadsheetId, 'Expenses', rows);
          } catch (err) {
            if (!navigator.onLine) {
              for (const row of rows)
                enqueue({ spreadsheetId, sheetName: 'Expenses', operation: 'create', row });
              showToast('Saved offline — will sync when back online', 'success');
            } else { throw err; }
          }
        } else {
          txnId = crypto.randomUUID();
          const row = {
            ...common,
            id:          txnId,
            description: expDesc.trim(),
            amount:      String(amount),
            category:    expCategory,
          };
          try {
            await pushTransactions(spreadsheetId, 'Expenses', [row]);
          } catch (err) {
            if (!navigator.onLine) {
              enqueue({ spreadsheetId, sheetName: 'Expenses', operation: 'create', row });
              showToast('Saved offline — will sync when back online', 'success');
            } else { throw err; }
          }
        }

        // Update vendor + payment method autocomplete caches
        const vendor = expVendor.trim();
        vendorCache.update((cache) =>
          cache.includes(vendor) ? cache : [...cache, vendor]
        );
        const payment = expPayment.trim();
        if (payment) {
          paymentMethodCache.update((cache) =>
            cache.includes(payment) ? cache : [...cache, payment]
          );
        }

        // Show share panel (only in single mode — split rows share no single txnId)
        if (!splitMode && txnId) {
          lastSavedTxnId = txnId;
          lastSavedYear  = year;
        }

        showToast(splitMode ? `${splits.filter((s) => s.amount && s.category).length} expenses saved!` : 'Expense saved!', 'success');

        // Background re-pull to update cache
        invalidatePull(spreadsheetId);
        syncStatus.set('yellow');
        pullTransactions(spreadsheetId, 'Expenses')
          .then((pulled) => {
            syncStatus.set('green');
            cacheTransactions(spreadsheetId, 'Expenses', pulled);
          })
          .catch(() => syncStatus.set('red'));

        // Clear fields — preserve date, category, payment for rapid entry
        expVendor   = '';
        expDesc     = '';
        expAmount   = '';
        expNotes    = '';
        expReceipt  = null;
        expErrors   = {};
        if (splitMode) {
          splits = [
            { description: '', amount: '', category: '' },
            { description: '', amount: '', category: '' },
          ];
        }

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

  function handleAmountInput(e) {
    const digits = e.target.value.replace(/\D/g, '');
    if (!digits) { expAmount = ''; return; }
    expAmount = (parseInt(digits, 10) / 100).toFixed(2);
    // Rewrite displayed value so next keystroke appends to the formatted string
    e.target.value = expAmount;
  }

  function handleAmountBlur() {
    const val = parseFloat(expAmount);
    if (!isNaN(val)) expAmount = val.toFixed(2);
  }

  // ---------------------------------------------------------------------------
  // Split mode handlers
  // ---------------------------------------------------------------------------

  function toggleSplitMode() {
    splitMode = !splitMode;
    if (splitMode) {
      // Carry existing description into first line if set
      splits = [
        { description: expDesc, amount: expAmount, category: expCategory },
        { description: '', amount: '', category: '' },
      ];
    }
  }

  function addSplitLine() {
    splits = [...splits, { description: '', amount: '', category: '' }];
  }

  function removeSplitLine(i) {
    if (splits.length <= 2) return;
    splits = splits.filter((_, idx) => idx !== i);
  }

  /** Calculator-style amount input for split lines. */
  function handleSplitAmountInput(e, i) {
    const digits = e.target.value.replace(/\D/g, '');
    const val = digits ? (parseInt(digits, 10) / 100).toFixed(2) : '';
    splits = splits.map((s, idx) => idx === i ? { ...s, amount: val } : s);
    e.target.value = val;
  }

  function handleSplitAmountBlur(i) {
    const val = parseFloat(splits[i].amount);
    if (!isNaN(val)) splits = splits.map((s, idx) => idx === i ? { ...s, amount: val.toFixed(2) } : s);
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
    const url = buildShareUrl($selectedBusiness.id ?? $selectedBusiness.folderId, lastSavedYear, lastSavedTxnId);
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
    const url = buildShareUrl($selectedBusiness.id ?? $selectedBusiness.folderId, lastSavedYear, lastSavedTxnId);
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
      returnTo = sp.get('returnTo') ?? '';
      try {
        const biz = $businesses.find((b) => b.id === bizId);
        if (!biz) throw new Error("Business not found. Make sure you're signed in to the correct account.");
        selectedBusiness.set(biz);
        await loadBusinessData(biz);

        const yr = parseInt(yearStr, 10);

        const sheetId = biz.sheetIds?.[yr];
        if (!sheetId) throw new Error(`No expense sheet found for ${yr}.`);
        shareSheetId = sheetId;

        const rowNum = await findRowByTxnId(sheetId, txnId);
        if (rowNum === null) throw new Error('Transaction not found.');
        shareRowNum = rowNum;

        const row = await readRow(sheetId, 'Expenses', rowNum);
        expDate          = row.date          || todayISO();
        expVendor        = row.vendor        || '';
        expDesc          = row.description   || '';
        expAmount        = row.amount        || '';
        expCategory      = row.category      || '';
        expPayment       = row.paymentMethod || '';
        expNotes         = row.notes         || '';
        shareSubmittedBy = row.submittedBy   || '';
        shareTxnId       = row.id            || txnId;

        // Resolve existing receipt to a viewable Drive link
        if (row.receipt) {
          existingReceipt = row.receipt;
          const rfId = biz.receiptFolderIds?.[yr];
          if (rfId) {
            const fileId = await findFile(row.receipt, rfId);
            if (fileId) existingReceiptUrl = `https://drive.google.com/file/d/${fileId}/view`;
          }
        }
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
      <span style="color: var(--color-text-muted);"><Spinner size="w-5 h-5 flex-shrink-0" /></span>
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
      <span style="color: var(--color-text-muted);"><Spinner /></span>
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
          required
        />
        {#if expErrors.date}
          <span class="text-xs" style="color: var(--color-error);">{expErrors.date}</span>
        {/if}
      </div>

      <!-- Vendor -->
      <div class="flex flex-col gap-1">
        <label for="exp-vendor" class="text-sm font-medium" style="color: var(--color-text-muted);">Vendor / Payee</label>
        <Autocomplete items={$vendorCache} id="exp-vendor" bind:value={expVendor} bind:inputEl={vendorInputEl} onpick={handleVendorPick} placeholder="Vendor/Payee" listboxPrefix="vendor" />
        {#if expErrors.vendor}
          <span class="text-xs" style="color: var(--color-error);">{expErrors.vendor}</span>
        {/if}
      </div>

      <!-- Amount / Split toggle -->
      {#if !splitMode}
        <div class="flex flex-col gap-1">
          <div class="flex items-center justify-between">
            <label for="exp-amount" class="text-sm font-medium" style="color: var(--color-text-muted);">Amount ($)</label>
            <button
              type="button"
              onclick={toggleSplitMode}
              class="text-xs px-2 py-0.5 rounded-lg transition-opacity hover:opacity-70"
              style="color: var(--color-primary); border: 1px solid var(--color-primary);"
            >
              Split
            </button>
          </div>
          <input
            id="exp-amount"
            type="text"
            inputmode="numeric"
            bind:value={expAmount}
            oninput={handleAmountInput}
            onblur={handleAmountBlur}
            placeholder="0.00"
            required
          />
          {#if expErrors.amount}
            <span class="text-xs" style="color: var(--color-error);">{expErrors.amount}</span>
          {/if}
        </div>

        <!-- Category (single mode) -->
        <div class="flex flex-col gap-1">
          <label for="exp-category" class="text-sm font-medium" style="color: var(--color-text-muted);">Category</label>
          <select id="exp-category" bind:value={expCategory} required>
            <option value="" disabled>Select category…</option>
            {#each categories as cat (cat)}
              <option value={cat}>{cat}</option>
            {/each}
          </select>
          {#if expErrors.category}
            <span class="text-xs" style="color: var(--color-error);">{expErrors.category}</span>
          {/if}
        </div>

      {:else}
        <!-- Split mode — multiple line items -->
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium" style="color: var(--color-text-muted);">Split Lines</span>
            <button
              type="button"
              onclick={toggleSplitMode}
              class="text-xs px-2 py-0.5 rounded-lg transition-opacity hover:opacity-70"
              style="color: var(--color-text-muted); border: 1px solid var(--color-border);"
            >
              Single
            </button>
          </div>

          {#each splits as split, i (i)}
            <div class="rounded-xl border p-3 flex flex-col gap-2" style="border-color: var(--color-border); background-color: var(--color-surface-2);">
              <!-- Description + remove -->
              <div class="flex items-center gap-2">
                <input
                  type="text"
                  value={split.description}
                  oninput={(e) => splits = splits.map((s, idx) => idx === i ? { ...s, description: e.target.value } : s)}
                  placeholder="Description (optional)"
                  class="flex-1 text-sm"
                  style="min-height: 36px;"
                />
                {#if splits.length > 2}
                  <button
                    type="button"
                    onclick={() => removeSplitLine(i)}
                    class="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg transition-opacity hover:opacity-70"
                    style="color: var(--color-text-muted);"
                    aria-label="Remove line"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                {:else}
                  <span class="w-7 flex-shrink-0"></span>
                {/if}
              </div>
              <!-- Amount -->
              <input
                type="text"
                inputmode="numeric"
                value={split.amount}
                oninput={(e) => handleSplitAmountInput(e, i)}
                onblur={() => handleSplitAmountBlur(i)}
                placeholder="0.00"
                class="w-full text-sm"
                style="min-height: 36px;"
              />
              <!-- Category -->
              <select
                  value={split.category}
                  onchange={(e) => splits = splits.map((s, idx) => idx === i ? { ...s, category: e.target.value } : s)}
                  class="w-full text-sm"
                  style="min-height: 36px;"
                >
                  <option value="" disabled>Category…</option>
                  {#each categories as cat (cat)}
                    <option value={cat}>{cat}</option>
                  {/each}
                </select>
            </div>
          {/each}

          <button
            type="button"
            onclick={addSplitLine}
            class="text-sm py-2 rounded-xl transition-opacity hover:opacity-70"
            style="color: var(--color-primary); border: 1px dashed var(--color-border);"
          >
            + Add Line
          </button>

          {#if expErrors.splits}
            <span class="text-xs" style="color: var(--color-error);">{expErrors.splits}</span>
          {/if}
        </div>
      {/if}

      <!-- Payment Method -->
      <div class="flex flex-col gap-1">
        <label for="exp-payment" class="text-sm font-medium" style="color: var(--color-text-muted);">Payment Method</label>
        <Autocomplete items={$paymentMethodCache} id="exp-payment" bind:value={expPayment} placeholder="e.g. Chase Visa x4521" listboxPrefix="payment" />
        {#if expErrors.payment}
          <span class="text-xs" style="color: var(--color-error);">{expErrors.payment}</span>
        {/if}
      </div>

      <!-- Receipt -->
      <div class="flex flex-col gap-1">
        <label for="exp-receipt" class="text-sm font-medium" style="color: var(--color-text-muted);">
          Receipt <span style="color: var(--color-text-muted); font-weight: 400;">(optional)</span>
        </label>
        {#if existingReceipt && existingReceiptUrl}
          <a href={existingReceiptUrl} target="_blank" rel="noopener noreferrer"
             class="text-sm flex items-center gap-1.5 underline"
             style="color: var(--color-primary);">
            <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
            {existingReceipt}
          </a>
        {/if}
        <ReceiptPicker id="exp-receipt" bind:file={expReceipt} />
      </div>

      <!-- Description (single mode only — in split mode description is per-line) -->
      {#if !splitMode}
        <div class="flex flex-col gap-1">
          <label for="exp-desc" class="text-sm font-medium" style="color: var(--color-text-muted);">
            Description <span style="color: var(--color-text-muted); font-weight: 400;">(optional)</span>
          </label>
          <input id="exp-desc" type="text" bind:value={expDesc} placeholder="What was this for?" />
        </div>
      {/if}

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

      <!-- Apply-to-all checkbox — only in review mode, single expense (not split) -->
      {#if returnTo === '/review' && !splitMode}
        <label class="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            bind:checked={applyToAll}
            style="width:20px; height:20px; min-width:0; min-height:0; flex-shrink:0; margin-top:2px;"
          />
          <span class="text-sm" style="color: var(--color-text-muted);">
            Apply this category to all uncategorized {expVendor ? `"${expVendor}"` : 'vendor'} transactions
          </span>
        </label>
      {/if}

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
          <Spinner />
          Saving…
        {:else}
          {shareMode ? 'Save Changes' : 'Save Expense'}
        {/if}
      </button>

      <!-- Skip — only in review mode -->
      {#if returnTo}
        <button
          type="button"
          onclick={() => goto(`${returnTo}?skipped=${shareTxnId}`)}
          class="text-sm hover:opacity-70 transition-opacity px-2 py-2 self-center"
          style="color: var(--color-text-muted);"
        >
          Skip for now
        </button>
      {/if}

      <!-- Delete — any edit mode -->
      {#if shareMode}
        {#if deleteError}
          <p class="text-xs text-center" style="color: var(--color-error);">{deleteError}</p>
        {/if}
        <button
          type="button"
          onclick={handleDelete}
          disabled={deleting}
          class="text-sm hover:opacity-70 transition-all disabled:opacity-50 px-2 py-2 self-center rounded-lg"
          style="
            color: {confirmDelete ? '#ffffff' : 'var(--color-error)'};
            background-color: {confirmDelete ? 'var(--color-error)' : 'transparent'};
          "
        >
          {#if deleting}Deleting…{:else if confirmDelete}Confirm delete?{:else}Delete{/if}
        </button>
      {/if}

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
<Toast message={toast.message} type={toast.type} visible={toast.visible} />
