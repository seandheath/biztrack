<!--
  Business selector dropdown.

  Props:
    onchange  {(business: Object|null) => void}  — called when selection changes
-->
<script>
  import { businesses, selectedBusiness } from '$lib/store.js';

  let { onchange } = $props();

  function handleChange(event) {
    const name = event.target.value;
    const biz = $businesses.find((b) => b.name === name) ?? null;
    selectedBusiness.set(biz);
    onchange?.(biz);
  }
</script>

<div class="relative">
  <select
    value={$selectedBusiness?.name ?? ''}
    onchange={handleChange}
    class="pr-8"
    aria-label="Select business"
    style="appearance: none; -webkit-appearance: none;"
  >
    {#if !$selectedBusiness}
      <option value="" disabled>Select a business…</option>
    {/if}
    {#each $businesses as b (b.name)}
      <option value={b.name}>{b.name}</option>
    {/each}
  </select>
  <!-- Chevron icon overlay -->
  <svg
    class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4"
    style="color: var(--color-text-muted);"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
  </svg>
</div>
