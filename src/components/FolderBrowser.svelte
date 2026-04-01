<!--
  Custom Drive folder browser modal.

  Replaces the Google Picker (which fails on Chrome with third-party cookie
  partitioning). Uses the Drive REST API directly via listFolders() so no
  cross-origin iframe or cookie access is required.

  Props:
    open      {boolean}                          — controls visibility
    title     {string}                           — modal header text
    onselect  {({id:string,name:string})=>void}  — called when user confirms a folder
    oncancel  {()=>void}                         — called on close / cancel
-->
<script>
  import { listFolders, listSharedDrives, listSharedFolders } from '$lib/drive.js';
  import Spinner from './Spinner.svelte';

  // Sentinel IDs for virtual navigation nodes (not real Drive folder IDs).
  const VIRTUAL_ROOT    = '__vroot__';
  const SHARED_WITH_ME  = '__shared_with_me__';

  let { open, title = 'Select Folder', onselect, oncancel } = $props();

  // Navigation stack — last item is the folder currently being viewed.
  // Starts at a virtual root that lists drive locations.
  let stack   = $state([{ id: VIRTUAL_ROOT, name: 'Drive' }]);
  let folders = $state([]);
  let loading = $state(false);
  let error   = $state(null);

  let current   = $derived(stack[stack.length - 1]);
  // Selecting is only allowed on a real Drive folder (not a virtual node).
  let canSelect = $derived(
    stack.length > 1 &&
    current.id !== VIRTUAL_ROOT &&
    current.id !== SHARED_WITH_ME
  );

  // Reset and load virtual root whenever the modal opens.
  $effect(() => {
    if (open) {
      stack = [{ id: VIRTUAL_ROOT, name: 'Drive' }];
      error = null;
      loadVirtualRoot();
    }
  });

  /** Shows the top-level location picker: My Drive, Shared with me, Shared Drives. */
  async function loadVirtualRoot() {
    loading = true;
    error   = null;
    try {
      const drives = await listSharedDrives();
      folders = [
        { id: 'root', name: 'My Drive' },
        { id: SHARED_WITH_ME, name: 'Shared with me' },
        ...drives.sort((a, b) => a.name.localeCompare(b.name)),
      ];
    } catch (err) {
      console.error('[FolderBrowser] loadVirtualRoot:', err);
      error = 'Could not load drives. Check your connection and try again.';
      folders = [];
    } finally {
      loading = false;
    }
  }

  /** Lists folders shared with the user (flat list, not hierarchical). */
  async function loadSharedWithMe() {
    loading = true;
    error   = null;
    try {
      folders = await listSharedFolders();
      folders = [...folders].sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      console.error('[FolderBrowser] loadSharedWithMe:', err);
      error = 'Could not load shared folders.';
      folders = [];
    } finally {
      loading = false;
    }
  }

  async function loadFolders(parentId) {
    loading = true;
    error   = null;
    try {
      folders = await listFolders(parentId);
      folders = [...folders].sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      console.error('[FolderBrowser] loadFolders:', err);
      error = 'Could not load folders. Check your connection and try again.';
      folders = [];
    } finally {
      loading = false;
    }
  }

  /** Dispatches to the correct loader based on the target node. */
  function loadNode(id) {
    if (id === VIRTUAL_ROOT)   return loadVirtualRoot();
    if (id === SHARED_WITH_ME) return loadSharedWithMe();
    return loadFolders(id);
  }

  function navigate(folder) {
    stack = [...stack, { id: folder.id, name: folder.name }];
    loadNode(folder.id);
  }

  function navigateTo(index) {
    stack = stack.slice(0, index + 1);
    loadNode(stack[stack.length - 1].id);
  }

  function handleSelect() {
    const picked = current;
    stack   = [{ id: VIRTUAL_ROOT, name: 'Drive' }];
    folders = [];
    onselect(picked);
  }

  function handleCancel() {
    stack   = [{ id: VIRTUAL_ROOT, name: 'Drive' }];
    folders = [];
    oncancel();
  }
</script>

{#if open}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
    style="background-color: rgba(0,0,0,0.45);"
    role="presentation"
    onpointerdown={(e) => { if (e.target === e.currentTarget) handleCancel(); }}
  >
    <!-- Panel -->
    <div
      class="w-full max-w-sm mx-auto flex flex-col rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-xl"
      style="
        background-color: var(--color-surface);
        max-height: 70vh;
      "
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >

      <!-- Header -->
      <div
        class="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
        style="border-color: var(--color-border);"
      >
        <span class="text-base font-semibold" style="color: var(--color-text);">{title}</span>
        <button
          type="button"
          onclick={handleCancel}
          class="rounded-lg p-1 hover:opacity-70 transition-opacity"
          aria-label="Close"
          style="color: var(--color-text-muted); min-width: 36px; min-height: 36px; display:flex; align-items:center; justify-content:center;"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Breadcrumb -->
      <div
        class="flex items-center gap-1 flex-wrap px-4 py-2 border-b flex-shrink-0 text-sm"
        style="border-color: var(--color-border);"
        aria-label="Navigation path"
      >
        {#each stack as crumb, i (crumb.id)}
          {#if i > 0}
            <span style="color: var(--color-text-muted);" aria-hidden="true">›</span>
          {/if}
          <button
            type="button"
            onclick={() => navigateTo(i)}
            class="hover:opacity-70 transition-opacity rounded px-1"
            style="
              color: {i === stack.length - 1 ? 'var(--color-text)' : 'var(--color-primary)'};
              font-weight: {i === stack.length - 1 ? '600' : '400'};
            "
          >
            {crumb.name}
          </button>
        {/each}
      </div>

      <!-- Folder list -->
      <div class="flex-1 overflow-y-auto">

        {#if loading}
          <div class="flex items-center justify-center gap-3 py-10">
            <span style="color: var(--color-text-muted);"><Spinner /></span>
            <span class="text-sm" style="color: var(--color-text-muted);">Loading…</span>
          </div>

        {:else if error}
          <p class="text-sm px-4 py-4 rounded-xl mx-4 my-3" style="color: var(--color-error); background-color: var(--color-surface-2);">
            {error}
          </p>

        {:else if folders.length === 0}
          <p class="text-sm text-center py-10" style="color: var(--color-text-muted);">
            No folders here.
          </p>

        {:else}
          <div
            class="divide-y"
            style="border-color: var(--color-border);"
          >
            {#each folders as f (f.id)}
              <button
                type="button"
                onclick={() => navigate(f)}
                class="w-full flex items-center gap-3 px-4 text-left hover:opacity-80 transition-opacity"
                style="min-height: 52px;"
              >
                <!-- Folder icon -->
                <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" style="color: var(--color-text-muted);">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                </svg>
                <span class="flex-1 text-sm truncate" style="color: var(--color-text);">{f.name}</span>
                <!-- Chevron right -->
                <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" style="color: var(--color-text-muted);">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            {/each}
          </div>
        {/if}

      </div>

      <!-- Footer -->
      <div
        class="flex gap-2 px-4 py-3 border-t flex-shrink-0"
        style="
          border-color: var(--color-border);
          padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
        "
      >
        <button
          type="button"
          onclick={handleCancel}
          class="flex-1 rounded-xl text-sm font-medium transition-opacity hover:opacity-70"
          style="
            min-height: 48px;
            background-color: var(--color-surface-2);
            color: var(--color-text-muted);
            border: 1px solid var(--color-border);
          "
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={handleSelect}
          disabled={!canSelect}
          class="flex-1 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
          style="
            min-height: 48px;
            background-color: var(--color-primary);
            color: var(--color-primary-text);
          "
        >
          Select This Folder
        </button>
      </div>

    </div>
  </div>
{/if}
