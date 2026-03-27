<!--
  Horizontal scrollable list of mileage favorite route chips.

  Props:
    favorites  {Array}                         — mileage_favorites from businessConfig
    onselect   {(favorite: Object) => void}    — called when user taps a chip
-->
<script>
  let { favorites = [], onselect } = $props();
</script>

{#if favorites.length > 0}
  <div class="flex flex-col gap-1">
    <span class="text-xs font-semibold uppercase tracking-wider" style="color: var(--color-text-muted);">
      Favorites
    </span>
    <div
      class="flex gap-2 overflow-x-auto pb-1"
      style="-webkit-overflow-scrolling: touch; scrollbar-width: none;"
    >
      {#each favorites as fav (fav.name)}
        <button
          type="button"
          onclick={() => onselect?.(fav)}
          class="flex-shrink-0 rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-opacity hover:opacity-70"
          style="
            min-height: 36px;
            border-color: var(--color-primary);
            color: var(--color-primary);
            background-color: transparent;
          "
        >
          {fav.name}
        </button>
      {/each}
    </div>
  </div>
{/if}
