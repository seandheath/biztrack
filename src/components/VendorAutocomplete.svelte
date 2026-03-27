<!--
  Vendor text input with autocomplete dropdown from vendorCache.

  Props:
    value       {string}   — bindable text value
    inputEl     {Element}  — bindable ref to the underlying <input>
    placeholder {string}
-->
<script>
  import { vendorCache } from '$lib/store.js';

  let {
    value = $bindable(''),
    inputEl = $bindable(null),
    placeholder = 'Vendor/Payee',
    id = undefined,
  } = $props();

  let open = $state(false);
  let activeIdx = $state(-1);

  /** Derived id for the listbox element, referenced by aria-controls. */
  let listboxId = $derived(id ? `${id}-listbox` : 'vendor-listbox');

  /** Top 5 cache entries that include the current query. */
  let suggestions = $derived(
    value.trim().length > 0
      ? $vendorCache
          .filter((v) => v.toLowerCase().includes(value.toLowerCase()))
          .slice(0, 5)
      : []
  );

  function pick(vendor) {
    value = vendor;
    open = false;
    activeIdx = -1;
  }

  function handleInput() {
    open = suggestions.length > 0;
    activeIdx = -1;
  }

  function handleFocus() {
    if (suggestions.length > 0) open = true;
  }

  function handleBlur() {
    // Give pointer events time to fire before closing
    setTimeout(() => {
      open = false;
      activeIdx = -1;
    }, 150);
  }

  function handleKeydown(event) {
    if (!open || suggestions.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIdx = Math.min(activeIdx + 1, suggestions.length - 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIdx = Math.max(activeIdx - 1, -1);
    } else if (event.key === 'Enter' && activeIdx >= 0) {
      event.preventDefault();
      pick(suggestions[activeIdx]);
    } else if (event.key === 'Escape') {
      open = false;
      activeIdx = -1;
    }
  }
</script>

<div class="relative">
  <input
    bind:this={inputEl}
    bind:value
    type="text"
    {id}
    {placeholder}
    role="combobox"
    autocomplete="off"
    autocorrect="off"
    spellcheck="false"
    oninput={handleInput}
    onfocus={handleFocus}
    onblur={handleBlur}
    onkeydown={handleKeydown}
    aria-autocomplete="list"
    aria-expanded={open}
    aria-haspopup="listbox"
    aria-controls={listboxId}
  />

  {#if open && suggestions.length > 0}
    <ul
      id={listboxId}
      class="absolute z-30 w-full rounded-xl border shadow-lg overflow-hidden"
      style="
        background-color: var(--color-surface-2);
        border-color: var(--color-border);
        top: calc(100% + 4px);
      "
      role="listbox"
    >
      {#each suggestions as vendor, i (vendor)}
        <li role="option" aria-selected={i === activeIdx}>
          <button
            type="button"
            class="w-full text-left px-4 text-base transition-opacity"
            style="
              min-height: 44px;
              color: var(--color-text);
              {i === activeIdx ? 'background-color: var(--color-surface-3);' : ''}
            "
            onpointerdown={(e) => { e.preventDefault(); pick(vendor); }}
          >
            {vendor}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
