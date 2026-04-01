<script>
  import Spinner from '../../components/Spinner.svelte';
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
    mileageFavorites,
    userEmail,
    updateBusiness,
  } from '$lib/store.js';
  import { pushTransactions, updateByUUID, pullTransactions, readRow, findRowByTxnId } from '$lib/services/sheets.js';
  import { toast, showToast } from '$lib/toast.js';
  import { todayISO, friendlyError } from '$lib/util.js';
  import { enqueue } from '$lib/services/offline-queue.js';
  import { syncStatus, cacheTransactions } from '$lib/sync.js';
  import { ensureYearFolder, saveMileageFavorite, updateMileageFavorite, loadBusinessData as _loadBusinessData } from '$lib/business.js';
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
  /** Editable name for the currently matched favorite (update flow). */
  let milUpdateFavName = $state('');

  /** Whether to double entered miles (round trip). */
  let milRoundTrip = $state(false);

  /**
   * Effective miles to store — doubled when round trip is checked.
   * Returns a string so it can be passed directly to the row.
   */
  let milEffectiveMiles = $derived(() => {
    const m = parseFloat(milMiles);
    if (isNaN(m)) return milMiles;
    return milRoundTrip ? String(m * 2) : milMiles;
  });

  /**
   * Existing favorite whose from/to/miles/roundTrip all match the current form state.
   * When non-null, offer "Update" instead of "Save as Favorite".
   */
  let milMatchedFavorite = $derived(() => {
    const favs = $mileageFavorites[$selectedBusiness?.folderId] ?? [];
    const from = milFrom.trim();
    const to   = milTo.trim();
    const m    = parseFloat(milMiles);
    if (!from || !to || isNaN(m)) return null;
    return favs.find((f) =>
      f.from === from &&
      f.to   === to   &&
      f.miles === m   &&
      (f.roundTrip ?? false) === milRoundTrip
    ) ?? null;
  });

  let milUpdating = $state(false);

  // Sync the editable update-name field whenever the matched favorite changes.
  $effect(() => { milUpdateFavName = milMatchedFavorite()?.name ?? ''; });

  /** True when all mileage fields are filled (enables "Save as Favorite") */
  let milCanSaveFav = $derived(
    milFrom.trim() !== '' &&
    milTo.trim()   !== '' &&
    milMiles !== '' &&
    !isNaN(parseFloat(milMiles))
  );

  // ---------------------------------------------------------------------------
  // Business data load
  // ---------------------------------------------------------------------------

  /**
   * Loads config + year folder via shared helper.
   * @param {Object} business
   */
  async function loadBusinessData(business) {
    configLoading = true;
    try {
      await _loadBusinessData(business);
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
    if (!milFrom.trim())        errs.from  = 'Required';
    if (!milTo.trim())          errs.to    = 'Required';
    if (!milMiles || isNaN(parseFloat(milMiles))) errs.miles = 'Valid miles required';
    milErrors = errs;
    return Object.keys(errs).length === 0;
  }

  async function submitMileage() {
    if (!validateMileage()) return;

    milSubmitting = true;
    try {
      const year = new Date(milDate + 'T00:00:00').getFullYear();
      let biz = $selectedBusiness;

      if (!biz.sheetIds?.[year]) {
        biz = await ensureYearFolder(biz, year);
        updateBusiness(biz);
      }

      const spreadsheetId = biz.sheetIds?.[year];
      if (!spreadsheetId) throw new Error(`No sheet found for ${year}.`);

      if (editMode) {
        const updatedRow = {
          id:      editTxnId,
          date:    milDate,
          from:    milFrom.trim(),
          to:      milTo.trim(),
          purpose: milPurpose.trim(),
          miles:   milEffectiveMiles(),
          savedBy: $userEmail ?? '',
        };
        try {
          await updateByUUID(spreadsheetId, 'Mileage', updatedRow);
        } catch (err) {
          if (!navigator.onLine) {
            enqueue({ spreadsheetId, sheetName: 'Mileage', operation: 'update', row: updatedRow });
            showToast('Saved offline — will sync when back online', 'success');
            goto('/');
            return;
          }
          throw err;
        }
        showToast('Mileage updated!', 'success');
        goto('/');
        return;
      }

      const newRow = {
        id:      crypto.randomUUID(),
        date:    milDate,
        from:    milFrom.trim(),
        to:      milTo.trim(),
        purpose: milPurpose.trim(),
        miles:   milEffectiveMiles(),
        savedBy: $userEmail ?? '',
      };
      try {
        await pushTransactions(spreadsheetId, 'Mileage', [newRow]);
      } catch (err) {
        if (!navigator.onLine) {
          enqueue({ spreadsheetId, sheetName: 'Mileage', operation: 'create', row: newRow });
          showToast('Saved offline — will sync when back online', 'success');
          milFrom = ''; milTo = ''; milPurpose = ''; milMiles = ''; milErrors = {};
          saveFavOpen = false; saveFavName = '';
          return;
        }
        throw err;
      }

      // Clear fields — preserve date
      milFrom     = '';
      milTo       = '';
      milPurpose  = '';
      milMiles    = '';
      milErrors   = {};
      saveFavOpen = false;
      saveFavName = '';

      showToast('Mileage saved!', 'success');

      // Background re-pull to update cache
      syncStatus.set('yellow');
      pullTransactions(spreadsheetId, 'Mileage')
        .then((pulled) => {
          syncStatus.set('green');
          cacheTransactions(spreadsheetId, 'Mileage', pulled);
        })
        .catch(() => syncStatus.set('red'));
    } catch (err) {
      console.error('[mileage] submit:', err);
      showToast(friendlyError(err), 'error');
    } finally {
      milSubmitting = false;
    }
  }

  /** Fill mileage form from a saved favorite route. */
  function applyFavorite(fav) {
    milFrom      = fav.from    ?? '';
    milTo        = fav.to      ?? '';
    milPurpose   = fav.purpose ?? '';
    milMiles     = String(fav.miles ?? '');
    milDate      = todayISO();
    milErrors    = {};
    milRoundTrip = false;
  }

  async function handleSaveFavorite() {
    if (!saveFavName.trim()) return;
    saveFavSaving = true;
    try {
      const biz = $selectedBusiness;
      const cfg = $businessConfig;
      const fav = {
        name:      saveFavName.trim(),
        from:      milFrom.trim(),
        to:        milTo.trim(),
        purpose:   milPurpose.trim(),
        miles:     parseFloat(milMiles),
        roundTrip: milRoundTrip,
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

  async function handleUpdateFavorite() {
    const matched = milMatchedFavorite();
    if (!matched || !milUpdateFavName.trim()) return;
    milUpdating = true;
    try {
      await updateMileageFavorite($selectedBusiness, $businessConfig, matched.name, {
        name:      milUpdateFavName.trim(),
        from:      milFrom.trim(),
        to:        milTo.trim(),
        purpose:   milPurpose.trim(),
        miles:     parseFloat(milMiles),
        roundTrip: milRoundTrip,
      });
      showToast(`"${milUpdateFavName.trim()}" updated!`, 'success');
    } catch (err) {
      console.error('[mileage] updateFavorite:', err);
      showToast(friendlyError(err), 'error');
    } finally {
      milUpdating = false;
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
      updateBusiness(updated);
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

        const rowNum = await findRowByTxnId(sheetId, txnId, 'Mileage');
        if (rowNum === null) throw new Error('Mileage entry not found.');
        editRowNum = rowNum;

        const row = await readRow(sheetId, 'Mileage', rowNum);
        milDate    = row.date    || todayISO();
        milFrom    = row.from    || '';
        milTo      = row.to      || '';
        milPurpose = row.purpose || '';
        milMiles   = row.miles   || '';
        editTxnId  = row.id      || txnId;
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
      <span style="color: var(--color-text-muted);"><Spinner /></span>
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
      <span style="color: var(--color-text-muted);"><Spinner size="w-5 h-5 flex-shrink-0" /></span>
    {/if}
  </div>

  {#if !$selectedBusiness}
    <p class="text-center py-8 text-sm" style="color: var(--color-text-muted);">
      Select a business above.
    </p>
  {:else}
    <form onsubmit={(e) => { e.preventDefault(); submitMileage(); }} class="flex flex-col gap-4" novalidate>

      <!-- Favorite route chips (user-owned, from profile.json) -->
      {#if ($mileageFavorites[$selectedBusiness?.folderId] ?? []).length}
        <FavoriteRouteList
          favorites={$mileageFavorites[$selectedBusiness.folderId]}
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

      <!-- Miles + Round trip (inline) -->
      <div class="grid gap-3" style="grid-template-columns: 1fr 1fr;">
        <div class="flex flex-col gap-1">
          <label for="mil-miles" class="text-sm font-medium" style="color: var(--color-text-muted);">Miles</label>
          <input id="mil-miles" type="text" inputmode="decimal" bind:value={milMiles} placeholder="0.0" required />
          {#if milErrors.miles}
            <span class="text-xs" style="color: var(--color-error);">{milErrors.miles}</span>
          {/if}
        </div>
        <button
          type="button"
          onclick={() => { milRoundTrip = !milRoundTrip; }}
          class="rounded-xl font-medium text-sm transition-colors w-full"
          style="
            min-height: 44px;
            align-self: end;
            background-color: {milRoundTrip ? 'var(--color-primary)' : 'var(--color-surface-2)'};
            color: {milRoundTrip ? 'var(--color-primary-text)' : 'var(--color-text-muted)'};
            border: 1px solid {milRoundTrip ? 'var(--color-primary)' : 'var(--color-border)'};
          "
        >
          Round trip
        </button>
      </div>
      {#if milRoundTrip && milEffectiveMiles() !== milMiles && milEffectiveMiles() !== ''}
        <span class="text-xs -mt-2" style="color: var(--color-text-muted);">Total: {milEffectiveMiles()} mi</span>
      {/if}

      <!-- Purpose (optional) -->
      <div class="flex flex-col gap-1">
        <label for="mil-purpose" class="text-sm font-medium" style="color: var(--color-text-muted);">
          Purpose <span style="font-weight: normal;">(optional)</span>
        </label>
        <input id="mil-purpose" type="text" bind:value={milPurpose} placeholder="Client meeting, site visit…" />
      </div>

      <!-- Save / Update Favorite -->
      {#if milCanSaveFav}
        {#if milMatchedFavorite()}
          <!-- Matched an existing favorite — show editable name + Update button -->
          <div class="flex gap-2 items-center">
            <input
              type="text"
              bind:value={milUpdateFavName}
              placeholder="Favorite name…"
              class="flex-1"
            />
            <button
              type="button"
              onclick={handleUpdateFavorite}
              disabled={milUpdating || !milUpdateFavName.trim()}
              class="rounded-xl font-medium text-sm px-4 flex-shrink-0 disabled:opacity-50"
              style="
                min-height: 44px;
                background-color: var(--color-primary);
                color: var(--color-primary-text);
              "
            >
              {milUpdating ? 'Updating…' : 'Update'}
            </button>
          </div>
        {:else if !saveFavOpen}
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
          <Spinner />
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
<Toast message={toast.message} type={toast.type} visible={toast.visible} />
