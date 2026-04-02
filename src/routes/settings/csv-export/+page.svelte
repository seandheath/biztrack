<script>
  /**
   * CSV Export screen — download transaction data as CSV files.
   * Available in device-only mode. Exports match the Google Sheets column layout.
   */

  import { selectedBusiness } from '$lib/store.js';
  import { exportTransactionsCSV, downloadCSV, exportZip } from '$lib/services/local-store.js';
  import { toast, showToast } from '$lib/toast.svelte.js';
  import Toast from '../../../components/Toast.svelte';

  // Available years — derived from the business's yearFolders keys
  let availableYears = $derived.by(() => {
    const biz = $selectedBusiness;
    if (!biz) return [];
    return Object.keys(biz.yearFolders ?? {}).map(Number).sort((a, b) => b - a);
  });

  let selectedYear = $state(new Date().getFullYear());
  let exporting = $state(false);
  let zipping = $state(false);

  // Keep selectedYear valid
  $effect(() => {
    if (availableYears.length && !availableYears.includes(selectedYear)) {
      selectedYear = availableYears[0];
    }
  });

  async function handleExport(sheetName) {
    if (!$selectedBusiness) return;
    exporting = true;
    try {
      const csv = await exportTransactionsCSV($selectedBusiness.id, selectedYear, sheetName);
      const safeName = $selectedBusiness.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `${selectedYear}_${safeName}_${sheetName}.csv`;
      downloadCSV(csv, filename);
      showToast(`${sheetName} exported!`, 'success');
    } catch (err) {
      console.error('[csv-export]', err);
      showToast('Export failed.', 'error');
    } finally {
      exporting = false;
    }
  }

  async function handleZipExport() {
    if (!$selectedBusiness) return;
    zipping = true;
    try {
      await exportZip($selectedBusiness.id, selectedYear, $selectedBusiness.name);
      showToast('ZIP exported!', 'success');
    } catch (err) {
      console.error('[zip-export]', err);
      showToast('ZIP export failed.', 'error');
    } finally {
      zipping = false;
    }
  }
</script>

<div class="px-4 py-6 flex flex-col gap-5 max-w-lg mx-auto">

  <h2 class="text-xl font-semibold" style="color: var(--color-text);">Export CSV</h2>

  {#if !$selectedBusiness}
    <p class="text-sm" style="color: var(--color-text-muted);">
      Select a business on the main screen first.
    </p>
    <a
      href="/"
      class="self-start rounded-xl text-sm font-medium px-5"
      style="min-height: 44px; display:inline-flex; align-items:center; background-color: var(--color-primary); color: var(--color-primary-text);"
    >
      Go to Main Screen
    </a>

  {:else}
    <p class="text-xs font-semibold uppercase tracking-wider px-1" style="color: var(--color-text-muted);">
      {$selectedBusiness.name}
    </p>

    <!-- Year selector -->
    {#if availableYears.length > 0}
      <div class="flex flex-col gap-1">
        <label for="export-year" class="text-sm font-medium" style="color: var(--color-text-muted);">Year</label>
        <select
          id="export-year"
          bind:value={selectedYear}
          class="text-sm"
          style="min-height: 40px;"
        >
          {#each availableYears as year (year)}
            <option value={year}>{year}</option>
          {/each}
        </select>
      </div>

      <!-- Export buttons -->
      <div class="flex flex-col gap-3">
        <!-- ZIP bundle (CSVs + receipts) -->
        <button
          onclick={handleZipExport}
          disabled={zipping}
          class="w-full rounded-xl px-4 font-semibold text-base transition-opacity hover:opacity-80 disabled:opacity-50 flex items-center justify-center gap-2"
          style="min-height: 48px; background-color: var(--color-primary); color: var(--color-primary-text);"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          {zipping ? 'Exporting…' : 'Download ZIP (CSVs + Receipts)'}
        </button>

        <p class="text-xs text-center" style="color: var(--color-text-muted);">
          Or download individual CSVs:
        </p>

        <button
          onclick={() => handleExport('Expenses')}
          disabled={exporting}
          class="w-full rounded-xl px-4 font-semibold text-base transition-opacity hover:opacity-80 disabled:opacity-50 flex items-center justify-center gap-2"
          style="min-height: 48px; background-color: var(--color-surface-2); color: var(--color-text); border: 1px solid var(--color-border);"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Expenses CSV
        </button>
        <button
          onclick={() => handleExport('Mileage')}
          disabled={exporting}
          class="w-full rounded-xl px-4 font-semibold text-base transition-opacity hover:opacity-80 disabled:opacity-50 flex items-center justify-center gap-2"
          style="min-height: 48px; background-color: var(--color-surface-2); color: var(--color-text); border: 1px solid var(--color-border);"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Mileage CSV
        </button>
      </div>
    {:else}
      <p class="text-sm" style="color: var(--color-text-muted);">
        No data to export yet. Add some expenses or mileage first.
      </p>
    {/if}
  {/if}

</div>

<Toast message={toast.message} type={toast.type} visible={toast.visible} />
