<script>
  import { resolve } from '$app/paths';

  import { page } from '$app/stores';
</script>

  <div
    class="min-h-screen flex flex-col items-center justify-center gap-4 px-6"
    style="background-color: var(--color-surface); color: var(--color-text);"
  >
    <p class="text-lg font-semibold">{$page.status}: {$page.error?.message ?? 'Something went wrong'}</p>
    <a href={resolve('/')} style="color: var(--color-primary);">Go home</a>
  </div>
