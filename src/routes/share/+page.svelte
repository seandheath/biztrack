<script>
  /**
   * Web Share Target handler (Android only).
   *
   * When the user shares a receipt from another app on Android, the service
   * worker intercepts the POST /share request, stores the file blob in the
   * 'biztrack-share' cache, and redirects to /?shared=1. That GET request
   * loads this page (or the main page after the SW redirect).
   *
   * On mount, this page reads the file from the SW cache, stores it in the
   * pendingReceipt store, and navigates to / where the expense form picks it up.
   *
   * If the SW is not available or no file is cached, navigates to / silently.
   */

  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { pendingReceipt } from '$lib/store.js';

  onMount(async () => {
    if ('caches' in window) {
      try {
        const cache = await caches.open('biztrack-share');
        const response = await cache.match('/pending-receipt');
        if (response) {
          const blob = await response.blob();
          const filename = response.headers.get('X-Filename') ?? 'receipt';
          const file = new File([blob], filename, { type: blob.type });
          pendingReceipt.set(file);
          // Consume — prevent the file from being read twice
          await cache.delete('/pending-receipt');
        }
      } catch (err) {
        console.error('[share] failed to read pending receipt:', err);
      }
    }
    // Navigate to the main form — the expense form checks $pendingReceipt on mount
    goto('/');
  });
</script>

<!-- Brief loading state while the file is being read from the SW cache -->
<div
  class="flex flex-col items-center justify-center min-h-[60vh] gap-4"
  aria-label="Loading shared receipt…"
>
  <svg
    class="w-10 h-10 animate-spin"
    style="color: var(--color-primary);"
    fill="none"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
    <path
      class="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z"
    />
  </svg>
  <p class="text-sm" style="color: var(--color-text-muted);">Opening receipt…</p>
</div>
