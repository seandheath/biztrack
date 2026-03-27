<script>
  /**
   * Main screen — expense and mileage entry.
   *
   * Business selection triggers config load (Drive config.json) + vendor cache
   * sync (Expenses column B). Year-folder existence is ensured on load and on
   * submit when the expense date falls in a different year.
   *
   * Phase 8: expense form + vendor autocomplete
   * Phase 9: receipt picker (ReceiptPicker wired in)
   * Phase 10: mileage form (FavoriteRouteList wired in)
   */

  import { onMount } from 'svelte';
  import {
    businesses,
    selectedBusiness,
    businessConfig,
    vendorCache,
    pendingReceipt,
  } from '$lib/store.js';
  import { downloadJson, findFile, listFileNames, uploadFile } from '$lib/drive.js';
  import { appendRow, readColumn } from '$lib/sheets.js';
  import { ensureYearFolder, saveMileageFavorite } from '$lib/business.js';
  import { processReceipt, generateFilename } from '$lib/receipt.js';
  import { QUICKBOOKS_CATEGORIES, IRS_RATES } from '$lib/constants.js';
  import BusinessDropdown from '../components/BusinessDropdown.svelte';
  import VendorAutocomplete from '../components/VendorAutocomplete.svelte';
  import ReceiptPicker from '../components/ReceiptPicker.svelte';
  import FavoriteRouteList from '../components/FavoriteRouteList.svelte';
  import Toast from '../components/Toast.svelte';

  // ---------------------------------------------------------------------------
  // Tab state
  // ---------------------------------------------------------------------------

  /** @type {'expense'|'mileage'} */
  let activeTab = $state('expense');

  // ---------------------------------------------------------------------------
  // Config/loading state
  // ---------------------------------------------------------------------------

  /** True while config.json + vendor cache are loading after business select */
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
  // Mileage form state
  // ---------------------------------------------------------------------------

  let milDate      = $state(todayISO());
  let milFrom      = $state('');
  let milTo        = $state('');
  let milPurpose   = $state('');
  let milMiles     = $state('');
  let milErrors    = $state(/** @type {Record<string,string>} */({}));
  let milSubmitting = $state(false);

  /** True when the "save as favorite" name input is visible */
  let saveFavOpen    = $state(false);
  /** Favorite name being entered */
  let saveFavName    = $state('');
  let saveFavSaving  = $state(false);

  /**
   * Reactive IRS rate for the year of the current mileage date.
   * Falls back to the most recent known rate if the year isn't in IRS_RATES.
   */
  let milRate = $derived(() => {
    const year = new Date(milDate + 'T00:00:00').getFullYear();
    if (IRS_RATES[year]) return IRS_RATES[year];
    // Fall back to the highest known year's rate
    const years = Object.keys(IRS_RATES).map(Number).sort((a, b) => b - a);
    return IRS_RATES[years[0]] ?? 0.70;
  });

  /** Reactive deduction = miles × rate */
  let milDeduction = $derived(() => {
    const m = parseFloat(milMiles);
    return isNaN(m) ? '' : (m * milRate()).toFixed(2);
  });

  /** True when all mileage fields are filled (enables "Save as Favorite") */
  let milCanSaveFav = $derived(
    milFrom.trim() !== '' &&
    milTo.trim()   !== '' &&
    milPurpose.trim() !== '' &&
    milMiles !== '' &&
    !isNaN(parseFloat(milMiles))
  );

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

  /**
   * Translates an API error into a user-readable message.
   * @param {Error} err
   * @returns {string}
   */
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
      console.error('[main] loadBusinessData:', err);
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
    if (!navigator.onLine) {
      showToast('No connection. Please try again when online.', 'error');
      return;
    }

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

      const spreadsheetId   = biz.sheetIds[year];
      const receiptFolderId = biz.receiptFolderIds[year];
      const amount          = parseFloat(expAmount).toFixed(2);

      // Upload receipt if one is attached
      let receiptFilename = '';
      if (expReceipt && receiptFolderId) {
        const { blob, ext }   = await processReceipt(expReceipt);
        const existingNames   = await listFileNames(receiptFolderId);
        receiptFilename       = generateFilename(expVendor.trim(), expDate, ext, existingNames);
        await uploadFile(receiptFilename, blob, blob.type || 'application/octet-stream', receiptFolderId);
      }

      await appendRow(spreadsheetId, 'Expenses', [
        expDate,
        expVendor.trim(),
        expDesc.trim(),
        amount,
        expCategory,
        expPayment,
        receiptFilename,
        expNotes.trim(),
      ]);

      // Update vendor autocomplete cache
      const vendor = expVendor.trim();
      vendorCache.update((cache) =>
        cache.includes(vendor) ? cache : [...cache, vendor]
      );

      // Clear fields — preserve date, category, payment for rapid entry
      expVendor   = '';
      expDesc     = '';
      expAmount   = '';
      expNotes    = '';
      expReceipt  = null;
      expErrors   = {};

      showToast('Expense saved!', 'success');

      // Auto-focus vendor for next entry
      setTimeout(() => vendorInputEl?.focus(), 50);
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
  // Mileage form handlers
  // ---------------------------------------------------------------------------

  function validateMileage() {
    const errs = {};
    if (!milDate)               errs.date    = 'Required';
    if (!milFrom.trim())        errs.from    = 'Required';
    if (!milTo.trim())          errs.to      = 'Required';
    if (!milPurpose.trim())     errs.purpose = 'Required';
    if (!milMiles || isNaN(parseFloat(milMiles))) errs.miles = 'Valid miles required';
    milErrors = errs;
    return Object.keys(errs).length === 0;
  }

  async function submitMileage() {
    if (!validateMileage()) return;
    if (!navigator.onLine) {
      showToast('No connection. Please try again when online.', 'error');
      return;
    }

    milSubmitting = true;
    try {
      const year = new Date(milDate + 'T00:00:00').getFullYear();
      let biz = $selectedBusiness;

      if (!biz.sheetIds?.[year]) {
        biz = await ensureYearFolder(biz, year);
        businesses.update((list) => list.map((b) => b.name === biz.name ? biz : b));
        selectedBusiness.set(biz);
      }

      const rate      = milRate();
      const deduction = milDeduction();

      await appendRow(biz.sheetIds[year], 'Mileage', [
        milDate,
        milFrom.trim(),
        milTo.trim(),
        milPurpose.trim(),
        parseFloat(milMiles),
        rate,
        parseFloat(deduction),
      ]);

      // Clear fields — preserve date
      milFrom     = '';
      milTo       = '';
      milPurpose  = '';
      milMiles    = '';
      milErrors   = {};
      saveFavOpen = false;
      saveFavName = '';

      showToast('Mileage saved!', 'success');
    } catch (err) {
      console.error('[mileage] submit:', err);
      showToast(friendlyError(err), 'error');
    } finally {
      milSubmitting = false;
    }
  }

  /** Fill mileage form from a saved favorite route. */
  function applyFavorite(fav) {
    milFrom    = fav.from    ?? '';
    milTo      = fav.to      ?? '';
    milPurpose = fav.purpose ?? '';
    milMiles   = String(fav.miles ?? '');
    milDate    = todayISO();
    milErrors  = {};
  }

  async function handleSaveFavorite() {
    if (!saveFavName.trim()) return;
    saveFavSaving = true;
    try {
      const biz = $selectedBusiness;
      const cfg = $businessConfig;
      const fav = {
        name:    saveFavName.trim(),
        from:    milFrom.trim(),
        to:      milTo.trim(),
        purpose: milPurpose.trim(),
        miles:   parseFloat(milMiles),
      };
      await saveMileageFavorite(biz, cfg, fav);
      saveFavOpen = false;
      saveFavName = '';
      showToast('Favorite saved!', 'success');
    } catch (err) {
      console.error('[favorites] save:', err);
      showToast(friendlyError(err), 'error');
    } finally {
      saveFavSaving = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Year-rollover helpers
  // ---------------------------------------------------------------------------

  /**
   * Silently ensures the Drive year-folder exists for a given ISO date string.
   * Called from date field onchange handlers so the year folder is ready before
   * the user hits submit — avoids a delay at submission time.
   * Fast path (already cached) is synchronous, so this is a no-op in most cases.
   *
   * @param {string} isoDate - e.g. "2025-01-15"
   */
  async function prefetchYearFolder(isoDate) {
    const biz = $selectedBusiness;
    if (!biz || !isoDate) return;
    const year = new Date(isoDate + 'T00:00:00').getFullYear();
    if (biz.yearFolders?.[year]) return; // already cached, nothing to do
    try {
      const updated = await ensureYearFolder(biz, year);
      businesses.update((list) => list.map((b) => b.name === biz.name ? updated : b));
      selectedBusiness.set(updated);
    } catch (err) {
      // Non-fatal: submit handler will retry if year folder is still missing
      console.warn('[main] prefetchYearFolder failed:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  onMount(() => {
    if ($selectedBusiness) {
      loadBusinessData($selectedBusiness);
    }
    // Pick up any receipt shared from another app via Android Web Share Target
    if ($pendingReceipt) {
      expReceipt = $pendingReceipt;
      pendingReceipt.set(null);
    }
  });
</script>

<!-- ===================================================================
     Empty state: no businesses configured
     =================================================================== -->
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
      style="background-color: var(--color-primary); color: var(--color-primary-text);"
    >
      Open Settings
    </a>
  </div>

{:else}
  <!-- =================================================================
       Main screen
       ================================================================= -->
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

    <!-- Tab toggle: Expense / Mileage -->
    <div
      class="flex rounded-xl overflow-hidden border"
      style="border-color: var(--color-border);"
      role="tablist"
    >
      {#each ['expense', 'mileage'] as tab}
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === tab}
          onclick={() => { activeTab = tab; }}
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

    <!-- ---------------------------------------------------------------
         Expense form
         --------------------------------------------------------------- -->
    {#if activeTab === 'expense'}
      {#if !$selectedBusiness}
        <p class="text-center py-8 text-sm" style="color: var(--color-text-muted);">
          Select a business above.
        </p>
      {:else}
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
              <select id="exp-payment" bind:value={expPayment} required>
                <option value="" disabled>Select method…</option>
                {#each $businessConfig.payment_accounts as method (method)}
                  <option value={method}>{method}</option>
                {/each}
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
            <label class="text-sm font-medium" style="color: var(--color-text-muted);">
              Receipt <span style="color: var(--color-text-muted); font-weight: 400;">(optional)</span>
            </label>
            <ReceiptPicker bind:file={expReceipt} />
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
              Save Expense
            {/if}
          </button>

        </form>
      {/if}

    <!-- ---------------------------------------------------------------
         Mileage form
         --------------------------------------------------------------- -->
    {:else}
      {#if !$selectedBusiness}
        <p class="text-center py-8 text-sm" style="color: var(--color-text-muted);">
          Select a business above.
        </p>
      {:else}
        <form onsubmit={(e) => { e.preventDefault(); submitMileage(); }} class="flex flex-col gap-4" novalidate>

          <!-- Favorite route chips -->
          {#if $businessConfig?.mileage_favorites?.length}
            <FavoriteRouteList
              favorites={$businessConfig.mileage_favorites}
              onselect={applyFavorite}
            />
          {/if}

          <!-- Date -->
          <div class="flex flex-col gap-1">
            <label for="mil-date" class="text-sm font-medium" style="color: var(--color-text-muted);">Date</label>
            <input
              id="mil-date"
              type="date"
              bind:value={milDate}
              onchange={() => prefetchYearFolder(milDate)}
              required
            />
            {#if milErrors.date}
              <span class="text-xs" style="color: var(--color-error);">{milErrors.date}</span>
            {/if}
          </div>

          <!-- From -->
          <div class="flex flex-col gap-1">
            <label for="mil-from" class="text-sm font-medium" style="color: var(--color-text-muted);">From</label>
            <input id="mil-from" type="text" bind:value={milFrom} placeholder="Starting address or city" />
            {#if milErrors.from}
              <span class="text-xs" style="color: var(--color-error);">{milErrors.from}</span>
            {/if}
          </div>

          <!-- To -->
          <div class="flex flex-col gap-1">
            <label for="mil-to" class="text-sm font-medium" style="color: var(--color-text-muted);">To</label>
            <input id="mil-to" type="text" bind:value={milTo} placeholder="Destination" />
            {#if milErrors.to}
              <span class="text-xs" style="color: var(--color-error);">{milErrors.to}</span>
            {/if}
          </div>

          <!-- Purpose -->
          <div class="flex flex-col gap-1">
            <label for="mil-purpose" class="text-sm font-medium" style="color: var(--color-text-muted);">Purpose</label>
            <input id="mil-purpose" type="text" bind:value={milPurpose} placeholder="Client meeting, site visit…" />
            {#if milErrors.purpose}
              <span class="text-xs" style="color: var(--color-error);">{milErrors.purpose}</span>
            {/if}
          </div>

          <!-- Miles + IRS rate + Deduction -->
          <div class="grid gap-3" style="grid-template-columns: 1fr 1fr;">
            <div class="flex flex-col gap-1">
              <label for="mil-miles" class="text-sm font-medium" style="color: var(--color-text-muted);">Miles</label>
              <input id="mil-miles" type="text" inputmode="decimal" bind:value={milMiles} placeholder="0.0" required />
              {#if milErrors.miles}
                <span class="text-xs" style="color: var(--color-error);">{milErrors.miles}</span>
              {/if}
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium" style="color: var(--color-text-muted);">IRS Rate</label>
              <input
                type="text"
                value="${milRate()}/mi"
                readonly
                tabindex="-1"
                style="color: var(--color-text-muted); cursor: default;"
              />
            </div>
          </div>

          <!-- Deduction -->
          {#if milDeduction() !== ''}
            <div
              class="rounded-xl px-4 py-3 flex items-center justify-between"
              style="background-color: var(--color-surface-2); border: 1px solid var(--color-border);"
            >
              <span class="text-sm font-medium" style="color: var(--color-text-muted);">Estimated Deduction</span>
              <span class="text-xl font-semibold" style="color: var(--color-primary);">
                ${milDeduction()}
              </span>
            </div>
          {/if}

          <!-- Save as Favorite -->
          {#if milCanSaveFav}
            {#if !saveFavOpen}
              <button
                type="button"
                onclick={() => { saveFavOpen = true; }}
                class="text-sm font-medium text-left px-0 transition-opacity hover:opacity-70"
                style="
                  min-height: 36px;
                  background: transparent;
                  color: var(--color-primary);
                  justify-content: flex-start;
                  min-width: unset;
                "
              >
                + Save as Favorite
              </button>
            {:else}
              <div class="flex gap-2 items-center">
                <input
                  type="text"
                  bind:value={saveFavName}
                  placeholder="Favorite name…"
                  class="flex-1"
                />
                <button
                  type="button"
                  onclick={handleSaveFavorite}
                  disabled={saveFavSaving || !saveFavName.trim()}
                  class="rounded-xl font-medium text-sm px-4 flex-shrink-0 disabled:opacity-50"
                  style="
                    min-height: 44px;
                    background-color: var(--color-primary);
                    color: var(--color-primary-text);
                  "
                >
                  {saveFavSaving ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onclick={() => { saveFavOpen = false; saveFavName = ''; }}
                  class="rounded-xl text-sm px-2 flex-shrink-0"
                  style="
                    min-height: 44px;
                    background: transparent;
                    color: var(--color-text-muted);
                  "
                  aria-label="Cancel"
                >
                  ✕
                </button>
              </div>
            {/if}
          {/if}

          <!-- Submit -->
          <button
            type="submit"
            disabled={milSubmitting || configLoading}
            class="w-full rounded-xl font-semibold text-base transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
            style="
              min-height: 52px;
              background-color: var(--color-primary);
              color: var(--color-primary-text);
            "
          >
            {#if milSubmitting}
              <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z" />
              </svg>
              Saving…
            {:else}
              Save Mileage
            {/if}
          </button>

        </form>
      {/if}
    {/if}

  </div>
{/if}

<!-- Toast -->
<Toast message={toastMessage} type={toastType} visible={toastVisible} />
