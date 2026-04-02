<script>
  import { goto } from '$app/navigation';
  import Spinner from '../../../components/Spinner.svelte';
  import { get } from 'svelte/store';
  import { businesses, selectedBusiness, businessConfig, mileageFavorites, defaultDrivers } from '$lib/store.js';
  import { setupBusiness, ensureYearFolder, discoverYearFolders, normalizeConfig } from '$lib/business.js';
  import { findFile, downloadJson } from '$lib/drive.js';
  import { saveProfile } from '$lib/profile.js';
  import FolderBrowser from '../../../components/FolderBrowser.svelte';

  /** @type {string} */
  let name = $state('');

  /** @type {boolean} */
  let loading = $state(false);

  /** @type {string|null} */
  let error = $state(null);

  /** The folder selected via browser */
  let folder = $state(/** @type {{id:string,name:string}|null} */(null));

  /** True when the selected folder contains an existing config.json */
  let detectedImport = $state(false);

  // ---------------------------------------------------------------------------
  // Folder browser
  // ---------------------------------------------------------------------------

  let browserOpen = $state(false);

  function openBrowser() {
    browserOpen = true;
    error       = null;
  }

  async function handleFolderSelected(picked) {
    browserOpen = false;
    folder = picked;
    detectedImport = false;
    name = '';

    // Probe for existing config.json to detect a BizTrack business
    try {
      const configId = await findFile('config.json', picked.id);
      if (configId) {
        const config = await downloadJson(configId);
        normalizeConfig(config, picked.name);
        name = config.name;
        detectedImport = true;
      }
    } catch (e) {
      // Detection failed — treat as new folder
      console.warn('[business] import detection:', e);
    }
  }

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  async function submit() {
    error = null;
    const trimmedName = name.trim();

    if (!trimmedName) { error = 'Business name is required.'; return; }
    if (!folder) { error = 'Select a Drive folder first.'; return; }
    if ($businesses.some((b) => b.name === trimmedName)) {
      error = `"${trimmedName}" is already added.`;
      return;
    }

    loading = true;
    try {
      const year = new Date().getFullYear();

      const { business, config } = await setupBusiness(trimmedName, folder.id);
      const discovered = detectedImport ? await discoverYearFolders(business) : business;
      const withYear = await ensureYearFolder(discovered, year);

      businesses.update((list) => [...list, withYear]);
      selectedBusiness.set(withYear);
      businessConfig.set(config);

      // Update profile.json so other devices discover the new business
      const rootFolderId = localStorage.getItem('bt_biz_folder');
      if (rootFolderId) {
        await saveProfile(rootFolderId, get(businesses), get(mileageFavorites), get(defaultDrivers)).catch((e) => console.warn('[business] profile save:', e));
      }

      goto('/settings');
    } catch (err) {
      error = err.message ?? 'Setup failed. Check your Drive permissions and try again.';
      console.error('[business] Setup error:', err);
    } finally {
      loading = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  let submitDisabled = $derived(loading || !name.trim() || !folder);
  let submitLabel  = $derived(detectedImport ? 'Import Business' : 'Add Business');
  let spinnerLabel = $derived(detectedImport ? 'Importing…' : 'Setting up…');
</script>

<div class="px-4 py-6 flex flex-col gap-5 max-w-lg mx-auto">

  <h2 class="text-xl font-semibold" style="color: var(--color-text);">Add Business</h2>

  <!-- Drive folder section -->
  <div class="flex flex-col gap-3">
    <span class="text-sm font-medium" style="color: var(--color-text-muted);">Drive Folder</span>

    <p class="text-xs px-1" style="color: var(--color-text-muted);">
      Select an existing business folder to import it, or any folder to start fresh.
    </p>

    <button
      onclick={openBrowser}
      disabled={loading}
      class="rounded-xl border px-4 text-base text-left flex items-center gap-3 hover:opacity-70 transition-opacity disabled:opacity-50"
      style="
        min-height: 48px;
        background-color: var(--color-surface-2);
        border-color: var(--color-border);
        color: var(--color-text);
      "
    >
      <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" style="color: var(--color-text-muted);">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
      </svg>
      {#if folder}
        <span>{folder.name}</span>
      {:else}
        <span style="color: var(--color-text-muted);">Select Drive Folder…</span>
      {/if}
    </button>

    {#if detectedImport}
      <p class="text-xs px-1" style="color: var(--color-primary);">
        Existing BizTrack business detected — data will be reconnected, not overwritten.
      </p>
    {:else if folder}
      <p class="text-xs px-1" style="color: var(--color-text-muted);">
        New business — expenses and receipts will be stored in this folder.
      </p>
    {/if}
  </div>

  <!-- Business name -->
  <div class="flex flex-col gap-1">
    <label
      for="biz-name"
      class="text-sm font-medium"
      style="color: var(--color-text-muted);"
    >
      Business Name
    </label>
    <input
      id="biz-name"
      type="text"
      bind:value={name}
      placeholder="e.g. Acme LLC"
      disabled={loading || detectedImport}
      class="rounded-xl border px-4 text-base outline-none focus:ring-2"
      style="
        min-height: 48px;
        background-color: var(--color-surface-2);
        border-color: var(--color-border);
        color: var(--color-text);
        --tw-ring-color: var(--color-primary);
      "
    />
  </div>

  <!-- Error -->
  {#if error}
    <p class="text-sm rounded-xl px-4 py-3" role="alert" style="color: var(--color-error); background-color: var(--color-surface-2);">
      {error}
    </p>
  {/if}

  <!-- Submit -->
  <button
    onclick={submit}
    disabled={submitDisabled}
    class="rounded-xl px-4 font-semibold text-base transition-opacity hover:opacity-80 disabled:opacity-40"
    style="
      min-height: 48px;
      background-color: var(--color-primary);
      color: var(--color-primary-text);
    "
  >
    {#if loading}
      <span class="flex items-center justify-center gap-2">
        <Spinner size="w-4 h-4" />
        {spinnerLabel}
      </span>
    {:else}
      {submitLabel}
    {/if}
  </button>

</div>

<!-- Folder browser modal -->
<FolderBrowser
  open={browserOpen}
  title="Select Folder"
  onselect={handleFolderSelected}
  oncancel={() => { browserOpen = false; }}
/>
