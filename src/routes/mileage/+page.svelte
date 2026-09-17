<script>
  import { resolve } from '$app/paths';
  import { isDemo } from '$lib/version.js';

  import { ensureAuthorized, AuthError, getSessionVersion } from '$lib/auth.js';
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
    mileageFavorites,
    userEmail,
    updateBusiness,
    defaultDrivers,
  } from '$lib/store.js';
  import { pushTransactions, updateByUUID, deleteByUUID, replaceTransaction, ReplacementError, pullTransactions, readRow, findRowByTxnId } from '$lib/services/sheets.js';
  import { toast, showToast } from '$lib/toast.svelte.js';
  import { todayISO, friendlyError, returnRoute } from '$lib/util.js';
  import { enqueue, getQueue } from '$lib/services/offline-queue.js';
  import { syncStatus, cacheTransactions, getCachedTransactions, invalidatePull, removeCachedTransaction, updateCachedTransaction } from '$lib/sync.js';
  import { ensureYearFolder, saveMileageFavorite, updateMileageFavorite, saveDefaultDriver, loadBusinessData as _loadBusinessData } from '$lib/business.js';
  import BusinessDropdown from '../../components/BusinessDropdown.svelte';
  import FavoriteRouteList from '../../components/FavoriteRouteList.svelte';
  import Autocomplete from '../../components/Autocomplete.svelte';
  import { rankDrivers, suggestDrivers, validMiles } from '$lib/drivers.js';
  import Toast from '../../components/Toast.svelte';

  // ---------------------------------------------------------------------------
  // Config/loading state
  // ---------------------------------------------------------------------------

  let configLoading = $state(false);

  // ---------------------------------------------------------------------------
  // Mileage form state
  // ---------------------------------------------------------------------------

  let milDate      = $state(todayISO());
  let milDescription = $state('');
  let driverHistory = $state(/** @type {Record<string, import('$lib/services/sheets.js').TransactionRow[]>} */({}));
  let historyRequest = 0;
  let driverSuggestions = $derived(rankDrivers(driverHistory, getQueue()));
  let milMiles     = $state('');
  let milDriver    = $state('');
  let milErrors    = $state(/** @type {Record<string,string>} */({}));
  let milSubmitting = $state(false);

  // ---------------------------------------------------------------------------
  // Edit mode — pre-populated from ?biz=X&year=Y&txn=Z URL params
  // ---------------------------------------------------------------------------

  let editMode      = $state(false);
  let editLoading   = $state(false);
  let editLoadError = $state('');
  let editSheetId   = $state('');
  let editTxnId     = $state('');
  /** Route to navigate to after a successful edit-mode save (e.g. '/history'). */
  let returnTo      = $state('');

  /** True when the "save as favorite" name input is visible */
  let saveFavOpen    = $state(false);
  /** Favorite name being entered */
  let saveFavName    = $state('');
  let saveFavSaving  = $state(false);
  /** Editable name for the currently matched favorite (update flow). */
  let milUpdateFavName = $state('');

  // Delete state — edit mode only
  let confirmDelete = $state(false);
  let deleting      = $state(false);
  let deleteError   = $state('');

  // Default driver state
  let settingDefaultDriver = $state(false);

  /** Two-tap confirmation for duplicate entries. */
  let confirmDuplicate = $state(false);
  let milMatchedFavorite = $derived.by(() => {
    const favorites = $mileageFavorites[$selectedBusiness?.folderId] ?? [];
    return favorites.find(f => f.description === milDescription.trim()
      && f.miles === Number(milMiles) && f.driver === milDriver.trim()) ?? null;
  });

  let milUpdating = $state(false);

  // Sync the editable update-name field whenever the matched favorite changes.
  $effect(() => { milUpdateFavName = milMatchedFavorite?.name ?? ''; });

  // Reset duplicate confirmation when any matched field changes.
  $effect(() => {
    milDate; milDescription; milMiles; milDriver;
    confirmDuplicate = false;
  });

  /** True when all mileage fields are filled (enables "Save as Favorite") */
  let milCanSaveFav = $derived(milDescription.trim() !== '' && validMiles(milMiles) && milDriver.trim() !== '');

  async function loadBusinessData(business) {
    const request = ++historyRequest;
    const session = getSessionVersion();
    const current = () => request === historyRequest && session === getSessionVersion()
      && business?.folderId === $selectedBusiness?.folderId;
    driverHistory = {};
    if (!business) return;
    driverHistory = Object.fromEntries(Object.values(business.sheetIds).map(id => [id, getCachedTransactions(id, 'Mileage') ?? []]));
    configLoading = true;
    try {
      const loaded = await _loadBusinessData(business);
      if (!current() || !loaded) return;
      const sheets = Object.values(loaded.sheetIds);
      driverHistory = Object.fromEntries(sheets.map(id => [id, getCachedTransactions(id, 'Mileage') ?? []]));
      // One history refresh per visit/business, never per keystroke. Cached results work offline.
      for (const id of sheets) {
        if (!current()) return;
        try {
          const rows = await pullTransactions(id, 'Mileage');
          if (!current()) return;
          cacheTransactions(id, 'Mileage', rows);
          driverHistory = { ...driverHistory, [id]: rows };
        } catch (err) { if (err instanceof AuthError) throw err; }
      }
    } catch (err) { console.error('[mileage] loadBusinessData:', err); }
    finally { if (current()) configLoading = false; }
  }

  function validateMileage() {
    const errs = {};
    if (!milDate)               errs.date    = 'Required';
    if (!milDescription.trim()) errs.description = 'Required';
    if (!validMiles(milMiles)) errs.miles = 'Enter a distance greater than zero';
    if (!milDriver.trim())          errs.driver = 'Required';
    milErrors = errs;
    return Object.keys(errs).length === 0;
  }

  async function handleDelete() {
    if (!confirmDelete) { confirmDelete = true; return; }
    deleting = true;
    deleteError = '';
    try {
      const year = new Date(milDate + 'T00:00:00').getFullYear();
      const spreadsheetId = $selectedBusiness?.sheetIds?.[year] ?? editSheetId;
      await deleteByUUID(spreadsheetId, 'Mileage', editTxnId);
      removeCachedTransaction(spreadsheetId, 'Mileage', editTxnId);
      invalidatePull(spreadsheetId);
      goto(resolve(returnTo || '/'));
    } catch (err) {
      console.error('[mileage] delete:', err);
      deleteError = 'Delete failed. Try again.';
      confirmDelete = false;
    } finally {
      deleting = false;
    }
  }

  async function handleSetDefaultDriver() {
    settingDefaultDriver = true;
    try {
      await saveDefaultDriver($selectedBusiness, milDriver.trim());
      showToast(`Default driver set to "${milDriver.trim()}"`, 'success');
    } catch (err) {
      console.error('[mileage] setDefaultDriver:', err);
      showToast(friendlyError(err), 'error');
    } finally {
      settingDefaultDriver = false;
    }
  }

  async function submitMileage() {
    if (!validateMileage()) return;

    milSubmitting = true;
    try {
      await ensureAuthorized();
      const year = new Date(milDate + 'T00:00:00').getFullYear();
      let biz = $selectedBusiness;

      if (!biz.sheetIds?.[year]) {
        biz = await ensureYearFolder(biz, year);
        updateBusiness(biz);
      }

      const spreadsheetId = biz.sheetIds?.[year];
      if (!spreadsheetId) throw new Error(`No sheet found for ${year}.`);

      // Duplicate check — first tap shows warning, second tap proceeds
      if (!confirmDuplicate) {
        const cached = getCachedTransactions(spreadsheetId, 'Mileage') ?? [];
        const eff = Number(milMiles);
        const isDup = cached.some((r) =>
          (editMode ? r.id !== editTxnId : true) &&
          r.date === milDate &&
          r.description === milDescription.trim() &&
          Number(r.miles) === eff &&
          r.driver === milDriver.trim()
        );
        if (isDup) {
          confirmDuplicate = true;
          milSubmitting = false;
          return;
        }
      }
      confirmDuplicate = false;

      const row = {
        id:      editMode ? editTxnId : crypto.randomUUID(),
        date:    milDate,
        description: milDescription.trim(),
        miles:   String(Number(milMiles)),
        savedBy: $userEmail ?? '',
        driver:  milDriver.trim(),
      };

      if (editMode) {
        try {
          if (spreadsheetId !== editSheetId) {
            // Date changed to a different year — move row between sheets
            await replaceTransaction(editSheetId, spreadsheetId, 'Mileage', editTxnId, [row]);
          } else {
            await updateByUUID(spreadsheetId, 'Mileage', row);
          }
        } catch (err) {
          if (!navigator.onLine && !(err instanceof AuthError)) {
            enqueue(spreadsheetId === editSheetId
              ? { spreadsheetId, sheetName: 'Mileage', operation: 'update', row }
              : { operation: 'replace', sourceSpreadsheetId: editSheetId, spreadsheetId, sheetName: 'Mileage', originalId: editTxnId, rows: [row] });
            showToast('Saved offline — will sync when back online', 'success');
            goto(resolve('/'));
            return;
          }
          throw err;
        }
        showToast('Mileage updated!', 'success');
        if (spreadsheetId !== editSheetId) {
          removeCachedTransaction(editSheetId, 'Mileage', editTxnId);
          invalidatePull(editSheetId);
        }
        updateCachedTransaction(spreadsheetId, 'Mileage', row);
        invalidatePull(spreadsheetId);
        goto(resolve('/'));
        return;
      }

      try {
        await pushTransactions(spreadsheetId, 'Mileage', [row]);
      } catch (err) {
        if (!navigator.onLine && !(err instanceof AuthError)) {
          enqueue({ spreadsheetId, sheetName: 'Mileage', operation: 'create', row });
          showToast('Saved offline — will sync when back online', 'success');
          goto(resolve('/'));
          return;
        }
        throw err;
      }

      milErrors   = {};
      saveFavOpen = false;
      saveFavName = '';

      showToast('Mileage saved!', 'success');

      // Background re-pull to update cache
      invalidatePull(spreadsheetId);
      syncStatus.set('yellow');
      pullTransactions(spreadsheetId, 'Mileage')
        .then((pulled) => {
          syncStatus.set('green');
          cacheTransactions(spreadsheetId, 'Mileage', pulled);
        })
        .catch(() => syncStatus.set('red'));
      goto(resolve('/'));
    } catch (err) {
      console.error('[mileage] submit:', err);
      showToast(err instanceof ReplacementError ? err.message : friendlyError(err), 'error');
    } finally {
      milSubmitting = false;
    }
  }

  /** Fill mileage form from a saved favorite route. */
  function applyFavorite(fav) {
    milDescription = fav.description ?? '';
    milMiles     = String(fav.miles ?? '');
    milDriver    = fav.driver ?? '';
    if (!milDate) milDate = todayISO();
    milErrors    = {};
  }

  async function handleSaveFavorite() {
    if (!saveFavName.trim()) return;
    saveFavSaving = true;
    try {
      const biz = $selectedBusiness;
      const fav = {
        name:      saveFavName.trim(),
        description: milDescription.trim(),
        driver:    milDriver.trim(),
        miles:     parseFloat(milMiles),
      };
      await saveMileageFavorite(biz, fav);
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
    const matched = milMatchedFavorite;
    if (!matched || !milUpdateFavName.trim()) return;
    milUpdating = true;
    try {
      await updateMileageFavorite($selectedBusiness, matched.name, {
        name:      milUpdateFavName.trim(),
        description: milDescription.trim(),
        driver:    milDriver.trim(),
        miles:     parseFloat(milMiles),
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
  // Lifecycle
  // ---------------------------------------------------------------------------

  onMount(async () => {
    const sp = new URLSearchParams(window.location.search);
    const bizId  = sp.get('biz');
    const yearStr = sp.get('year');
    const txnId  = sp.get('txn');
    returnTo = returnRoute(sp.get('returnTo'));

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

        const row = await readRow(sheetId, 'Mileage', rowNum);
        milDate    = row.date    || todayISO();
        milDescription = row.description || '';
        milMiles   = row.miles   || '';
        milDriver  = row.driver  || '';
        editTxnId  = row.id      || txnId;
        editMode   = true;
      } catch (err) {
        console.error('[mileage] edit load:', err);
        editLoadError = err.message;
      } finally {
        editLoading = false;
      }
    } else if ($selectedBusiness) {
      milDriver = $defaultDrivers[$selectedBusiness.folderId] ?? '';
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
    <a href={resolve('/')} class="self-start rounded-xl text-sm font-medium px-5" style="min-height: 44px; display:inline-flex; align-items:center; background-color: var(--color-surface-2); color: var(--color-text);">← Go home</a>
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
          required
        />
        {#if milErrors.date}
          <span class="text-xs" style="color: var(--color-error);">{milErrors.date}</span>
        {/if}
      </div>

      <div class="flex flex-col gap-1">
        <label for="mil-description" class="text-sm font-medium" style="color: var(--color-text-muted);">Trip description</label>
        <input id="mil-description" type="text" bind:value={milDescription} placeholder="Supply pickup at Harbor Print" required />
        {#if milErrors.description}<span class="text-xs" style="color: var(--color-error);">{milErrors.description}</span>{/if}
      </div>
      <div class="flex flex-col gap-1">
        <label for="mil-miles" class="text-sm font-medium" style="color: var(--color-text-muted);">Total miles</label>
        <input id="mil-miles" type="text" inputmode="decimal" bind:value={milMiles} placeholder="0.0" required />
        {#if milErrors.miles}<span class="text-xs" style="color: var(--color-error);">{milErrors.miles}</span>{/if}
      </div>

      <!-- Driver (autocomplete from history) -->
      <div class="flex flex-col gap-1">
        <label for="mil-driver" class="text-sm font-medium" style="color: var(--color-text-muted);">Driver</label>
        <Autocomplete items={driverSuggestions} displayFn={(driver) => driver.name} getSuggestions={suggestDrivers} id="mil-driver" bind:value={milDriver} placeholder="Driver name" listboxPrefix="driver" />
        {#if milErrors.driver}
          <span class="text-xs" style="color: var(--color-error);">{milErrors.driver}</span>
        {/if}
        {#if !isDemo && milDriver.trim() && milDriver.trim() !== ($defaultDrivers[$selectedBusiness?.folderId] ?? '')}
          <button
            type="button"
            onclick={handleSetDefaultDriver}
            disabled={settingDefaultDriver}
            class="text-xs self-start hover:opacity-70 transition-opacity disabled:opacity-50"
            style="color: var(--color-primary);"
          >
            {settingDefaultDriver ? 'Saving…' : 'Set as default driver'}
          </button>
        {/if}
      </div>

      <!-- Save / Update Favorite -->
      {#if !isDemo && milCanSaveFav}
        {#if milMatchedFavorite}
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
          background-color: {confirmDuplicate ? 'var(--color-warning, #e67e22)' : 'var(--color-primary)'};
          color: {confirmDuplicate ? '#ffffff' : 'var(--color-primary-text)'};
        "
      >
        {#if milSubmitting}
          <Spinner />
          Saving…
        {:else if confirmDuplicate}
          Duplicate entry — tap to confirm
        {:else}
          {editMode ? 'Save Changes' : 'Save Mileage'}
        {/if}
      </button>

      <!-- Delete — any edit mode -->
      {#if editMode}
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
  {/if}

  {/if}

</div>

<!-- Toast -->
<Toast message={toast.message} type={toast.type} visible={toast.visible} />
