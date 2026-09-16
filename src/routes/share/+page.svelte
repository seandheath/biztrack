<script>
  import { resolve } from '$app/paths';

  import Spinner from '../../components/Spinner.svelte';
  /**
   * Web Share Target handler (Android only).
   *
   * When the user shares a receipt from another app on Android, the service
   * worker intercepts this build's POST /share/ request, stores the file in
   * its receipt cache, and redirects here with GET to consume it.
   *
   * On mount, this page reads the file from the SW cache, stores it in the
   * pendingReceipt store, and navigates to / where the expense form picks it up.
   *
   * If the SW is not available or no file is cached, navigates to / silently.
   */

  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { pendingReceipt } from '$lib/store.js';
  import { shareCache, receiptKey } from '$lib/version.js';

  onMount(async () => {
    if ('caches' in window) {
      try {
        const cache = await caches.open(shareCache);
        const response = await cache.match(receiptKey);
        if (response) {
          const blob = await response.blob();
          const filename = response.headers.get('X-Filename') ?? 'receipt';
          const file = new File([blob], filename, { type: blob.type });
          pendingReceipt.set(file);
          // Consume — prevent the file from being read twice
          await cache.delete(receiptKey);
        }
      } catch (err) {
        console.error('[share] failed to read pending receipt:', err);
      }
    }
    // Navigate to the main form — the expense form checks $pendingReceipt on mount
    goto(resolve('/'));
  });
</script>

<!-- Brief loading state while the file is being read from the SW cache -->
<div
  class="flex flex-col items-center justify-center min-h-[60vh] gap-4"
  aria-label="Loading shared receipt…"
>
  <span style="color: var(--color-primary);"><Spinner size="w-10 h-10" /></span>
  <p class="text-sm" style="color: var(--color-text-muted);">Opening receipt…</p>
</div>
