<script>
  /**
   * Per-business configuration screen.
   * Reached by tapping a business row in /settings.
   * Allows editing the business name and links to payment/mileage sub-settings.
   */

  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { businesses, selectedBusiness, businessConfig } from '$lib/store.js';
  import { loadConfig, saveConfig } from '$lib/business.js';
  import { get } from 'svelte/store';

  // Snapshot the business at load time so name changes don't cause reactivity issues
  // while the user is mid-edit.
  const initialBiz = get(selectedBusiness);

  /** @type {string} */
  let name = $state(initialBiz?.name ?? '');

  /** @type {boolean} */
  let saving = $state(false);

  /** @type {string} */
  let error = $state('');

  /** @type {boolean} */
  let configLoading = $state(false);

  onMount(async () => {
    if (!get(businessConfig) && initialBiz) {
      configLoading = true;
      try { await loadConfig(initialBiz); }
      finally { configLoading = false; }
    }
  });

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) { error = 'Name cannot be empty.'; return; }

    const biz = get(selectedBusiness);
    const cfg = get(businessConfig);
    if (!biz || !cfg) { error = 'No business loaded.'; return; }

    if (trimmed === biz.name) return;

    if (get(businesses).some((b) => b.name === trimmed)) {
      error = `"${trimmed}" is already in use.`;
      return;
    }

    saving = true;
    error  = '';
    try {
      const updatedCfg = { ...cfg, name: trimmed };
      await saveConfig(biz, updatedCfg);

      const updatedBiz = { ...biz, name: trimmed };
      businesses.update((list) =>
        list.map((b) => (b.name === biz.name ? updatedBiz : b))
      );
      selectedBusiness.set(updatedBiz);
    } catch (err) {
      console.error('[business-config] save name:', err);
      error = 'Failed to save. Check your connection.';
    } finally {
      saving = false;
    }
  }
</script>

<div class="px-4 py-6 flex flex-col gap-6 max-w-lg mx-auto">

  {#if !initialBiz}
    <div class="rounded-xl border p-6 text-center" style="border-color: var(--color-border);">
      <p class="text-base" style="color: var(--color-text-muted);">
        Select a business on the main screen first.
      </p>
      <a
        href="/"
        class="mt-4 inline-flex items-center justify-center rounded-xl text-sm font-medium px-5"
        style="background-color: var(--color-primary); color: var(--color-primary-text); min-height: 44px;"
      >
        Go to Main Screen
      </a>
    </div>

  {:else}

    <!-- Business name edit -->
    <section>
      <h2 class="text-xs font-semibold uppercase tracking-wider mb-2 px-1" style="color: var(--color-text-muted);">
        Business Name
      </h2>

      {#if error}
        <p class="text-sm rounded-xl px-4 py-3 mb-3" role="alert"
           style="color: var(--color-error); background-color: var(--color-surface-2);">
          {error}
        </p>
      {/if}

      <div class="flex gap-2">
        <input
          id="biz-name"
          type="text"
          bind:value={name}
          disabled={saving}
          onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSave(); } }}
          onblur={handleSave}
          class="flex-1 rounded-xl border px-4 text-base outline-none focus:ring-2"
          style="
            min-height: 48px;
            background-color: var(--color-surface-2);
            border-color: var(--color-border);
            color: var(--color-text);
            --tw-ring-color: var(--color-primary);
          "
        />
        <button
          onclick={handleSave}
          disabled={saving || configLoading || !name.trim() || name.trim() === $selectedBusiness?.name}
          class="rounded-xl px-4 font-semibold text-sm transition-opacity hover:opacity-80 disabled:opacity-40 flex-shrink-0"
          style="
            min-height: 48px;
            background-color: var(--color-primary);
            color: var(--color-primary-text);
          "
        >
          {#if saving}
            <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z"></path>
            </svg>
          {:else}
            Save
          {/if}
        </button>
      </div>
    </section>

    <!-- Per-business settings links -->
    <section>
      <h2 class="text-xs font-semibold uppercase tracking-wider mb-2 px-1" style="color: var(--color-text-muted);">
        Configuration
      </h2>
      <div class="rounded-xl border divide-y overflow-hidden"
           style="border-color: var(--color-border); background-color: var(--color-surface-2);">
        <a
          href="/settings/payments"
          class="flex items-center justify-between px-4 hover:opacity-70 transition-opacity"
          style="color: var(--color-text); min-height: 48px;"
        >
          <span class="text-base">Payment Methods</span>
          <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
        </a>
        <a
          href="/settings/favorites"
          class="flex items-center justify-between px-4 hover:opacity-70 transition-opacity"
          style="color: var(--color-text); min-height: 48px;"
        >
          <span class="text-base">Mileage Favorites</span>
          <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
        </a>
      </div>
    </section>

  {/if}

</div>
