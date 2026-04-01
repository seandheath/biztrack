<!--
  Reusable loading spinner SVG.

  Props:
    size   {string}  — Tailwind size classes (default: 'w-5 h-5')
    label  {string}  — Accessible label (default: 'Loading')
-->
<script>
  let { size = 'w-5 h-5', label = 'Loading' } = $props();
</script>

<svg class="{size} animate-spin" fill="none" viewBox="0 0 24 24" aria-label={label}>
  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z" />
</svg>
