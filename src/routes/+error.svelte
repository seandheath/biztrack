<script>
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  // Silently redirect 404s to root — these are most likely OAuth callback
  // URLs (e.g. from YubiKey/WebAuthn flows) that land on a route with no
  // matching SvelteKit handler.
  onMount(() => {
    if ($page.status === 404) goto('/', { replaceState: true });
  });
</script>

{#if $page.status !== 404}
  <div
    class="min-h-screen flex flex-col items-center justify-center gap-4 px-6"
    style="background-color: var(--color-surface); color: var(--color-text);"
  >
    <p class="text-lg font-semibold">{$page.status}: {$page.error?.message ?? 'Something went wrong'}</p>
    <a href="/" style="color: var(--color-primary);">Go home</a>
  </div>
{/if}
