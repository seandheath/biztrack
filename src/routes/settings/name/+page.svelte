<script>
  /**
   * Business Name edit screen.
   * Updates the name in the businesses store, selectedBusiness, and config.json.
   * Profile sync (profile.json) is handled automatically by the layout's
   * businesses store subscription (debounced 2s).
   */

  import { goto } from '$app/navigation';
  import { businesses, selectedBusiness, businessConfig } from '$lib/store.js';
  import { saveConfig } from '$lib/business.js';
  import { get } from 'svelte/store';

  const biz = get(selectedBusiness);

  /** @type {string} */
  let name = $state(biz?.name ?? '');

  /** @type {boolean} */
  let saving = $state(false);

  /** @type {string} */
  let error = $state('');

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) { error = 'Name cannot be empty.'; return; }

    const cfg = get(businessConfig);
    if (!biz || !cfg) { error = 'No business loaded.'; return; }

    if (trimmed === biz.name) { goto('/settings'); return; }

    const existing = get(businesses);
    if (existing.some((b) => b.name === trimmed)) {
      error = `"${trimmed}" is already in use.`;
      return;
    }

    saving = true;
    error  = '';
    try {
      // Update config.json on Drive with new name
      const updatedCfg = { ...cfg, name: trimmed };
      await saveConfig(biz, updatedCfg);

      // Update the businesses list (triggers profile.json sync via layout subscription)
      const updatedBiz = { ...biz, name: trimmed };
      businesses.update((list) =>
        list.map((b) => (b.name === biz.name ? updatedBiz : b))
      );
      selectedBusiness.set(updatedBiz);

      goto('/settings');
    } catch (err) {
      console.error('[name] save:', err);
      error = 'Failed to save. Check your connection.';
    } finally {
      saving = false;
    }
  }
</script>

<div class="px-4 py-6 flex flex-col gap-5 max-w-lg mx-auto">

  {#if !biz}
    <div class="rounded-xl border p-6 text-center" style="border-color: var(--color-border);">
      <p class="text-base" style="color: var(--color-text-muted);">
        Select a business on the main screen first.
      </p>
      <a
        href="/"
        class="mt-4 inline-flex rounded-xl text-sm font-medium px-5"
        style="background-color: var(--color-primary); color: var(--color-primary-text); min-height: 44px;"
      >
        Go to Main Screen
      </a>
    </div>

  {:else}
    <h2 class="text-xl font-semibold" style="color: var(--color-text);">Business Name</h2>

    <p class="text-xs font-semibold uppercase tracking-wider px-1" style="color: var(--color-text-muted);">
      {biz.name}
    </p>

    {#if error}
      <p class="text-sm rounded-xl px-4 py-3" role="alert" style="color: var(--color-error); background-color: var(--color-surface-2);">
        {error}
      </p>
    {/if}

    <div class="flex flex-col gap-1">
      <label for="biz-name" class="text-sm font-medium" style="color: var(--color-text-muted);">
        Name
      </label>
      <input
        id="biz-name"
        type="text"
        bind:value={name}
        disabled={saving}
        onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSave(); } }}
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

    <button
      onclick={handleSave}
      disabled={saving || !name.trim()}
      class="rounded-xl px-4 font-semibold text-base transition-opacity hover:opacity-80 disabled:opacity-40"
      style="
        min-height: 48px;
        background-color: var(--color-primary);
        color: var(--color-primary-text);
      "
    >
      {#if saving}
        <span class="flex items-center justify-center gap-2">
          <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z"></path>
          </svg>
          Saving…
        </span>
      {:else}
        Save
      {/if}
    </button>
  {/if}

</div>
