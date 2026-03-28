<script>
  /**
   * Mileage entry form.
   *
   * Extracted from the former home page (/) as a dedicated route.
   * Business selection triggers config load (needed for favorites list) + year folder ensure.
   * Favorite routes appear as chips that pre-fill the form fields.
   */

  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    businesses,
    selectedBusiness,
    businessConfig,
  } from '$lib/store.js';
  import { downloadJson, findFile } from '$lib/drive.js';
  import { appendRow, updateRow, readRow, findRowByTxnId } from '$lib/sheets.js';
  import { ensureYearFolder, saveMileageFavorite } from '$lib/business.js';
  import { IRS_RATES } from '$lib/constants.js';
  import BusinessDropdown from '../../components/BusinessDropdown.svelte';
  import FavoriteRouteList from '../../components/FavoriteRouteList.svelte';
  import Toast from '../../components/Toast.svelte';

  // ---------------------------------------------------------------------------
  // Config/loading state
  // ---------------------------------------------------------------------------

  let configLoading = $state(false);

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

  // ---------------------------------------------------------------------------
  // Edit mode — pre-populated from ?biz=X&year=Y&txn=Z URL params
  // ---------------------------------------------------------------------------

  let editMode      = $state(false);
  let editLoading   = $state(false);
  let editLoadError = $state('');
  let editRowNum    = $state(/** @type {number|null} */(null));
  let editSheetId   = $state('');
  let editTxnId     = $state('');

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
   * Loads config.json and ensures the current year folder exists.
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

      if (configId) {
        const cfg = await downloadJson(configId);
        if (!Array.isArray(cfg.payment_accounts))  cfg.payment_accounts  = ['Cash'];
        if (!Array.isArray(cfg.mileage_favorites)) cfg.mileage_favorites = [];
        businessConfig.set(cfg);
      }

      const year = new Date().getFullYear();
      const updated = await ensureYearFolder(business, year);
      if (updated !== business) {
        businesses.update((list) => list.map((b) => b.name === business.name ? updated : b));
        selectedBusiness.set(updated);
      }
    } catch (err) {
      console.error('[mileage] loadBusinessData:', err);
    } finally {
      configLoading = false;
    }
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

      const values = [
        milDate,
        milFrom.trim(),
        milTo.trim(),
        milPurpose.trim(),
        parseFloat(milMiles),
        rate,
        parseFloat(deduction),
      ];

      if (editMode) {
        await updateRow(editSheetId, 'Mileage', editRowNum, [...values, editTxnId]);
        showToast('Mileage updated!', 'success');
        goto('/');
        return;
      }

      await appendRow(biz.sheetIds[year], 'Mileage', [...values, crypto.randomUUID()]);

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
      console.error('[mileage] saveFavorite:', err);
      showToast(friendlyError(err), 'error');
    } finally {
      saveFavSaving = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Year-rollover helper
  // ---------------------------------------------------------------------------

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
      console.warn('[mileage] prefetchYearFolder failed:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  onMount(async () => {
    const sp = new URLSearchParams(window.location.search);
    const bizId  = sp.get('biz');
    const yearStr = sp.get('year');
    const txnId  = sp.get('txn');

    if (bizId && yearStr && txnId) {
      editLoading = true;
      try {
        const biz = $businesses.find((b) => b.id === bizId);
        if (!biz) throw new Error("Business not found. Make sure you're signed in to the correct account.");
        selectedBusiness.set(biz);
        await loadBusinessData(biz);

        const yr = parseInt(yearStr, 10);
        const sheetId = biz.sheetIds?.[yr] ?? $selectedBusiness?.sheetIds?.[yr];
        if (!sheetId) throw new Error(`No mileage sheet found for ${yr}.`);
        editSheetId = sheetId;

        const rowNum = await findRowByTxnId(sheetId, txnId, 'Mileage', 'H');
        if (rowNum === null) throw new Error('Mileage entry not found.');
        editRowNum = rowNum;

        const raw = await readRow(sheetId, 'Mileage', rowNum);
        milDate    = raw[0] || todayISO();
        milFrom    = raw[1] || '';
        milTo      = raw[2] || '';
        milPurpose = raw[3] || '';
        milMiles   = raw[4] || '';
        editTxnId  = raw[7] || txnId;
        editMode   = true;
      } catch (err) {
        console.error('[mileage] edit load:', err);
        editLoadError = err.message;
      } finally {
        editLoading = false;
      }
    } else if ($selectedBusiness) {
      loadBusinessData($selectedBusiness);
    }
  });
</script>

<div class="px-4 pt-4 pb-8 flex flex-col gap-4 max-w-lg mx-auto">

  {#if editLoading}
    <div class="flex items-center justify-center py-16 gap-3">
      <svg class="w-5 h-5 animate-spin" style="color: var(--color-text-muted);" fill="none" viewBox="0 0 24 24" aria-hidden="true">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z" />
      </svg>
      <span class="text-sm" style="color: var(--color-text-muted);">Loading…</span>
    </div>
  {:else if editLoadError}
    <p class="text-sm rounded-xl px-4 py-3 mt-4" style="color: var(--color-error); background-color: var(--color-surface-2);">
      {editLoadError}
    </p>
    <a href="/" class="self-start rounded-xl text-sm font-medium px-5" style="min-height: 44px; display:inline-flex; align-items:center; background-color: var(--color-surface-2); color: var(--color-text);">← Go home</a>
  {:else}

  {#if editMode}
    <!-- Edit mode banner -->
    <div class="rounded-xl px-4 py-3 flex items-center gap-3" style="background-color: var(--color-surface-2); border: 1px solid var(--color-border);">
      <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" style="color: var(--color-text-muted);">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
      </svg>
      <span class="text-sm" style="color: var(--color-text-muted);">Editing mileage entry</span>
    </div>
  {/if}

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

      <!-- Miles + IRS rate -->
      <div class="grid gap-3" style="grid-template-columns: 1fr 1fr;">
        <div class="flex flex-col gap-1">
          <label for="mil-miles" class="text-sm font-medium" style="color: var(--color-text-muted);">Miles</label>
          <input id="mil-miles" type="text" inputmode="decimal" bind:value={milMiles} placeholder="0.0" required />
          {#if milErrors.miles}
            <span class="text-xs" style="color: var(--color-error);">{milErrors.miles}</span>
          {/if}
        </div>
        <div class="flex flex-col gap-1">
          <label for="mil-irs-rate" class="text-sm font-medium" style="color: var(--color-text-muted);">IRS Rate</label>
          <input
            id="mil-irs-rate"
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
          {editMode ? 'Save Changes' : 'Save Mileage'}
        {/if}
      </button>

    </form>
  {/if}

  {/if}

</div>

<!-- Toast -->
<Toast message={toastMessage} type={toastType} visible={toastVisible} />
