<!-- Text input with optional custom suggestion ranking. Defaults retain substring matching/top five. -->
<script>
  import { tick } from 'svelte';
  let {
    items = [],
    displayFn = (x) => x,
    getSuggestions = undefined,
    value = $bindable(''),
    inputEl = $bindable(null),
    placeholder = '',
    id = undefined,
    listboxPrefix = 'autocomplete',
    onpick = undefined,
  } = $props();

  let focused = $state(false);
  let dismissed = $state(false);
  let activeIdx = $state(-1);
  let container;
  let listboxId = $derived(id ? `${id}-listbox` : `${listboxPrefix}-listbox`);
  let suggestions = $derived(getSuggestions ? getSuggestions(items, value) : value.trim()
    ? items.filter(item => displayFn(item).toLowerCase().includes(value.toLowerCase())).slice(0, 5) : []);
  let open = $derived(focused && !dismissed && suggestions.length > 0);
  let activeId = $derived(open && activeIdx >= 0 && activeIdx < suggestions.length ? `${listboxId}-${activeIdx}` : undefined);

  // New query/history results invalidate the keyboard selection.
  $effect(() => { suggestions; activeIdx = -1; });

  function pick(item) {
    value = displayFn(item);
    onpick?.(item);
    inputEl?.focus();
    dismissed = true;
    activeIdx = -1;
  }
  function handleBlur(event) {
    if (container?.contains(event.relatedTarget)) return;
    focused = false;
    activeIdx = -1;
  }
  async function handleKeydown(event) {
    if (event.key === 'Escape') { dismissed = true; activeIdx = -1; return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!suggestions.length) return;
      event.preventDefault();
      dismissed = false;
      activeIdx = event.key === 'ArrowDown' ? Math.min(activeIdx + 1, suggestions.length - 1) : Math.max(activeIdx - 1, 0);
      await tick();
      if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
    } else if (open && event.key === 'Enter' && activeIdx >= 0) {
      event.preventDefault();
      pick(suggestions[activeIdx]);
    }
  }
</script>

<div class="relative" bind:this={container} onfocusout={handleBlur}>
  <input
    bind:this={inputEl} bind:value type="text" {id} {placeholder}
    role="combobox" autocomplete="off" autocorrect="off" spellcheck="false"
    oninput={() => { dismissed = false; activeIdx = -1; }}
    onfocus={() => { focused = true; dismissed = false; }}
    onclick={() => { dismissed = false; }}
    onkeydown={handleKeydown}
    aria-autocomplete="list" aria-expanded={open} aria-haspopup="listbox"
    aria-controls={open ? listboxId : undefined} aria-activedescendant={activeId}
  />
  {#if open}
    <ul id={listboxId} class="absolute z-30 w-full rounded-xl border shadow-lg overflow-y-auto"
      style="background-color:var(--color-surface-2);border-color:var(--color-border);top:calc(100% + 4px);max-height:15rem;overscroll-behavior:contain"
      role="listbox">
      {#each suggestions as item, i (displayFn(item))}
        <li id={`${listboxId}-${i}`} role="option" aria-selected={i === activeIdx}>
          <button type="button" tabindex="-1" class="w-full text-left px-4 text-base"
            style="min-height:44px;justify-content:flex-start;color:var(--color-text);{i === activeIdx ? 'background-color:var(--color-surface-3)' : ''}"
            onpointerdown={(event) => { if (event.pointerType === 'mouse') event.preventDefault(); }}
            onclick={() => pick(item)}>{displayFn(item)}</button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
