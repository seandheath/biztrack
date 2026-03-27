<!--
  Receipt file picker with preview.

  Props:
    file  {File|null}  — bindable; the currently selected file (or null)

  No capture attribute — lets the user choose from camera, gallery, or file
  browser. Works on both desktop and mobile.
-->
<script>
  import { isImage } from '$lib/receipt.js';

  let { file = $bindable(null) } = $props();

  /** ObjectURL for image preview — revoked on clear or new selection. */
  let previewUrl = $state(null);

  /** Hidden file input element */
  let inputEl = $state(null);

  function handleChange(event) {
    const selected = event.target.files?.[0] ?? null;
    if (!selected) return;
    clearPreview();
    file = selected;
    if (isImage(selected)) {
      previewUrl = URL.createObjectURL(selected);
    }
  }

  function clearReceipt() {
    clearPreview();
    file = null;
    // Reset input so the same file can be re-selected
    if (inputEl) inputEl.value = '';
  }

  function clearPreview() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
  }

  /** Format bytes as human-readable size string. */
  function formatSize(bytes) {
    if (bytes < 1024)         return `${bytes} B`;
    if (bytes < 1024 * 1024)  return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

<!-- Hidden file input -->
<input
  bind:this={inputEl}
  type="file"
  accept="image/*,application/pdf"
  onchange={handleChange}
  class="sr-only"
  tabindex="-1"
  aria-hidden="true"
/>

{#if !file}
  <!-- Add receipt button -->
  <button
    type="button"
    onclick={() => inputEl?.click()}
    class="w-full flex items-center gap-3 rounded-xl border px-4 text-sm font-medium transition-opacity hover:opacity-70"
    style="
      min-height: 48px;
      border-color: var(--color-border);
      background-color: var(--color-surface-2);
      color: var(--color-text-muted);
    "
  >
    <!-- Paperclip icon -->
    <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
        d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
    </svg>
    <span>Add Receipt (photo or PDF)</span>
  </button>

{:else if previewUrl}
  <!-- Image preview -->
  <div
    class="relative rounded-xl overflow-hidden border"
    style="border-color: var(--color-border);"
  >
    <img
      src={previewUrl}
      alt="Receipt preview"
      class="w-full object-contain max-h-48"
      style="background-color: var(--color-surface-3);"
    />
    <button
      type="button"
      onclick={clearReceipt}
      class="absolute top-2 right-2 rounded-full w-8 h-8 flex items-center justify-center shadow"
      style="background-color: var(--color-surface); color: var(--color-text-muted);"
      aria-label="Remove receipt"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  </div>

{:else}
  <!-- PDF info row -->
  <div
    class="flex items-center gap-3 rounded-xl border px-4"
    style="
      min-height: 48px;
      border-color: var(--color-border);
      background-color: var(--color-surface-2);
    "
  >
    <!-- PDF icon -->
    <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
      aria-hidden="true" style="color: var(--color-error);">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
        d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
    <div class="flex-1 min-w-0">
      <p class="text-sm truncate" style="color: var(--color-text);">{file.name}</p>
      <p class="text-xs" style="color: var(--color-text-muted);">{formatSize(file.size)}</p>
    </div>
    <button
      type="button"
      onclick={clearReceipt}
      class="ml-2 flex-shrink-0 rounded p-1 hover:opacity-70 transition-opacity"
      aria-label="Remove receipt"
      style="color: var(--color-text-muted);"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  </div>
{/if}
