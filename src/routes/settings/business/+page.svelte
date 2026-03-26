<script>
  import { goto } from '$app/navigation';
  import { businesses, selectedBusiness, businessConfig } from '$lib/store.js';
  import { setupBusiness, ensureYearFolder } from '$lib/business.js';
  import { openFolderPicker } from '$lib/picker.js';

  /** @type {string} */
  let name = $state('');

  /** @type {{id: string, name: string}|null} */
  let folder = $state(null);

  /** @type {boolean} */
  let loading = $state(false);

  /** @type {string|null} */
  let error = $state(null);

  async function selectFolder() {
    error = null;
    try {
      const picked = await openFolderPicker();
      if (picked) folder = picked;
    } catch (err) {
      error = 'Could not open folder picker. Please try again.';
      console.error('[business] Picker error:', err);
    }
  }

  async function submit() {
    error = null;
    const trimmedName = name.trim();

    if (!trimmedName) { error = 'Business name is required.'; return; }
    if (!folder)       { error = 'Select a Drive folder first.'; return; }
    if ($businesses.some((b) => b.name === trimmedName)) {
      error = `"${trimmedName}" is already added.`;
      return;
    }

    loading = true;
    try {
      const year = new Date().getFullYear();
      const { business, config } = await setupBusiness(trimmedName, folder.id);
      const withYear = await ensureYearFolder(business, year);

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

  <!-- Drive folder selector -->
  <div class="flex flex-col gap-2">
    <span class="text-sm font-medium" style="color: var(--color-text-muted);">Drive Folder</span>
    <button
      onclick={selectFolder}
      disabled={loading}
      class="rounded-xl border px-4 text-base text-left flex items-center gap-3 hover:opacity-70 transition-opacity disabled:opacity-50"
      style="
        min-height: 48px;
        background-color: var(--color-surface-2);
        border-color: var(--color-border);
        color: var(--color-text);
      "
    >
      <!-- Folder icon -->
      <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" style="color: var(--color-text-muted);">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
      </svg>
      {#if folder}
        <span>{folder.name}</span>
      {:else}
        <span style="color: var(--color-text-muted);">Select Drive Folder…</span>
      {/if}
    </button>
    <p class="text-xs px-1" style="color: var(--color-text-muted);">
      Choose an existing folder in your Google Drive. Expenses and receipts will be stored inside it.
    </p>
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
    disabled={loading || !name.trim() || !folder}
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
        Setting up…
      </span>
    {:else}
      Add Business
    {/if}
  </button>

</div>
