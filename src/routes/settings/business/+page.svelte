<script>
  import { goto } from '$app/navigation';
  import { businesses, selectedBusiness, businessConfig } from '$lib/store.js';
  import { setupBusiness, ensureYearFolder, discoverYearFolders } from '$lib/business.js';
  import { createFolder } from '$lib/drive.js';
  import FolderBrowser from '../../components/FolderBrowser.svelte';

  /** @type {string} */
  let name = $state('');

  /** @type {boolean} */
  let loading = $state(false);

  /** @type {string|null} */
  let error = $state(null);

  // ---------------------------------------------------------------------------
  // Folder mode: 'pick' (existing) | 'create' (new)
  // ---------------------------------------------------------------------------

  /** @type {'pick'|'create'} */
  let folderMode = $state('pick');

  /** 'pick' mode: the folder selected via browser */
  let folder = $state(/** @type {{id:string,name:string}|null} */(null));

  /** 'create' mode: name of the folder to create (falls back to business name) */
  let newFolderName = $state('');

  /** 'create' mode: optional parent folder (null = Drive root) */
  let parentFolder = $state(/** @type {{id:string,name:string}|null} */(null));

  function setMode(mode) {
    folderMode = mode;
    folder = null;
    newFolderName = '';
    parentFolder = null;
    error = null;
    importMode = false;
  }

  // ---------------------------------------------------------------------------
  // Import mode (uses 'pick' folder path + discoverYearFolders)
  // ---------------------------------------------------------------------------

  /** True when the user initiated an import (vs. a fresh add). */
  let importMode = $state(false);

  // ---------------------------------------------------------------------------
  // Folder browser state
  // ---------------------------------------------------------------------------

  let browserOpen   = $state(false);
  /** Which slot the browser selection will fill: 'main' | 'parent' */
  let browserTarget = $state(/** @type {'main'|'parent'} */('main'));

  function openBrowser(target) {
    browserTarget = target;
    browserOpen   = true;
    error         = null;
  }

  function handleFolderSelected(picked) {
    browserOpen = false;
    if (browserTarget === 'main') {
      folder = picked;
      if (importMode && !name.trim()) name = picked.name;
    } else {
      parentFolder = picked;
    }
  }

  function importBusiness() {
    error      = null;
    importMode = true;
    folderMode = 'pick';
    openBrowser('main');
  }

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  async function submit() {
    error = null;
    const trimmedName = name.trim();

    if (!trimmedName) { error = 'Business name is required.'; return; }
    if (folderMode === 'pick' && !folder) { error = 'Select a Drive folder first.'; return; }
    if ($businesses.some((b) => b.name === trimmedName)) {
      error = `"${trimmedName}" is already added.`;
      return;
    }

    loading = true;
    try {
      const year = new Date().getFullYear();

      let targetFolder = folder;
      if (folderMode === 'create') {
        const fname = newFolderName.trim() || trimmedName;
        const parentId = parentFolder?.id ?? 'root';
        targetFolder = await createFolder(fname, parentId);
      }

      const { business, config } = await setupBusiness(trimmedName, targetFolder.id);
      const discovered = importMode ? await discoverYearFolders(business) : business;
      const withYear = await ensureYearFolder(discovered, year);

      businesses.update((list) => [...list, withYear]);
      selectedBusiness.set(withYear);
      businessConfig.set(config);

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

  let submitDisabled = $derived(
    loading ||
    !name.trim() ||
    (folderMode === 'pick' && !folder)
  );

  let submitLabel  = $derived(importMode ? 'Import Business' : 'Add Business');
  let spinnerLabel = $derived(importMode ? 'Importing…' : 'Setting up…');
  let browserTitle = $derived(
    browserTarget === 'parent' ? 'Select Parent Folder' :
    importMode ? 'Select Business Folder' :
    'Select Folder'
  );
</script>

<div class="px-4 py-6 flex flex-col gap-5 max-w-lg mx-auto">

  <h2 class="text-xl font-semibold" style="color: var(--color-text);">Add Business</h2>

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
      disabled={loading}
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

  <!-- Drive folder section -->
  <div class="flex flex-col gap-3">
    <span class="text-sm font-medium" style="color: var(--color-text-muted);">Drive Folder</span>

    <!-- Mode toggle -->
    <div
      class="flex rounded-xl overflow-hidden border"
      style="border-color: var(--color-border);"
    >
      <button
        type="button"
        onclick={() => setMode('pick')}
        disabled={loading}
        class="flex-1 text-sm font-medium py-2 transition-colors"
        style="
          background-color: {folderMode === 'pick' ? 'var(--color-primary)' : 'var(--color-surface-2)'};
          color: {folderMode === 'pick' ? 'var(--color-primary-text)' : 'var(--color-text-muted)'};
        "
      >
        Select Existing
      </button>
      <button
        type="button"
        onclick={() => setMode('create')}
        disabled={loading}
        class="flex-1 text-sm font-medium py-2 transition-colors border-l"
        style="
          border-color: var(--color-border);
          background-color: {folderMode === 'create' ? 'var(--color-primary)' : 'var(--color-surface-2)'};
          color: {folderMode === 'create' ? 'var(--color-primary-text)' : 'var(--color-text-muted)'};
        "
      >
        Create New
      </button>
    </div>

    {#if folderMode === 'pick'}
      <!-- Existing folder browser trigger -->
      <button
        onclick={() => openBrowser('main')}
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
      {#if importMode}
        <p class="text-xs px-1" style="color: var(--color-primary);">
          Existing data will be reconnected, not overwritten.
        </p>
      {:else}
        <p class="text-xs px-1" style="color: var(--color-text-muted);">
          Choose an existing folder in your Google Drive. Expenses and receipts will be stored inside it.
        </p>
      {/if}

    {:else}
      <!-- New folder name -->
      <div class="flex flex-col gap-1">
        <label for="new-folder-name" class="text-xs" style="color: var(--color-text-muted);">Folder Name</label>
        <input
          id="new-folder-name"
          type="text"
          bind:value={newFolderName}
          placeholder={name.trim() || 'e.g. Acme LLC'}
          disabled={loading}
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

      <!-- Optional parent folder -->
      <div class="flex flex-col gap-1">
        <span class="text-xs" style="color: var(--color-text-muted);">Store Inside (optional)</span>
        <button
          onclick={() => openBrowser('parent')}
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
          {#if parentFolder}
            <span>{parentFolder.name}</span>
          {:else}
            <span style="color: var(--color-text-muted);">Drive root (default)</span>
          {/if}
        </button>
      </div>

      <p class="text-xs px-1" style="color: var(--color-text-muted);">
        A new folder will be created in your Google Drive.
      </p>
    {/if}
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
        <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z"></path>
        </svg>
        {spinnerLabel}
      </span>
    {:else}
      {submitLabel}
    {/if}
  </button>

  <!-- Divider -->
  <div class="flex items-center gap-3">
    <hr class="flex-1" style="border-color: var(--color-border);" />
    <span class="text-xs" style="color: var(--color-text-muted);">or</span>
    <hr class="flex-1" style="border-color: var(--color-border);" />
  </div>

  <!-- Import existing business -->
  <button
    onclick={importBusiness}
    disabled={loading}
    class="rounded-xl px-4 font-semibold text-base transition-opacity hover:opacity-70 disabled:opacity-40"
    style="
      min-height: 48px;
      background-color: var(--color-surface-2);
      color: var(--color-text);
      border: 1px solid var(--color-border);
    "
  >
    Import Business
  </button>

</div>

<!-- Folder browser modal — rendered outside the form flow -->
<FolderBrowser
  open={browserOpen}
  title={browserTitle}
  onselect={handleFolderSelected}
  oncancel={() => { browserOpen = false; }}
/>
