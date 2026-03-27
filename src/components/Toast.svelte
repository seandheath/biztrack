<!--
  Toast notification — floats at bottom of screen, auto-dismisses via parent.

  Props:
    message  {string}              — notification text
    type     {'success'|'error'}   — controls color
    visible  {boolean}             — controls visibility (parent manages timer)
-->
<script>
  let { message = '', type = 'success', visible = false } = $props();
</script>

{#if visible}
  <div
    class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium max-w-sm w-[calc(100%-2rem)] text-center"
    style="
      background-color: {type === 'success' ? 'var(--color-success)' : 'var(--color-error)'};
      color: #ffffff;
      padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
    "
    role="status"
    aria-live="polite"
  >
    {message}
  </div>
{/if}
