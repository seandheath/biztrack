<script>
  import { selectedBusiness, businessConfig, userEmail } from '$lib/store.js';
  import { enqueueCreate } from '$lib/services/sync.js';
  import { queryTransactions } from '$lib/db/queries.js';

  // ---------------------------------------------------------------------------
  // CSV column indices for the bank export format
  // "Transaction ID","Posting Date","Effective Date","Transaction Type","Amount",
  // "Check Number","Reference Number","Description","Transaction Category",
  // "Type","Balance","Memo","Extended Description"
  // ---------------------------------------------------------------------------
  const COL_POSTING_DATE   = 1;
  const COL_TYPE           = 3;  // 'Debit' | 'Credit'
  const COL_AMOUNT         = 4;  // negative number string e.g. "-45.35000"
  const COL_DESCRIPTION    = 7;  // merchant name
  const COL_CATEGORY       = 8;  // bank's category string
  const COL_EXTENDED_DESC  = 12; // long memo string

  // Map common bank category strings → QuickBooks categories.
  // Fallback is 'Uncategorized' for anything not in this table.
  const CATEGORY_MAP = {
    'shopping':                    'Supplies',
    'food & dining':               'Meals',
    'food and dining':             'Meals',
    'restaurants':                 'Meals',
    'travel':                      'Travel',
    'auto & transport':            'Car & Truck Expenses',
    'gas & fuel':                  'Car & Truck Expenses',
    'utilities':                   'Utilities',
    'bills & utilities':           'Utilities',
    'insurance':                   'Insurance',
    'advertising':                 'Advertising',
    'office supplies':             'Office Expenses',
    'office':                      'Office Expenses',
    'taxes':                       'Taxes & Licenses',
    'taxes & licenses':            'Taxes & Licenses',
    'legal & professional':        'Legal & Professional Services',
    'professional services':       'Legal & Professional Services',
    'wages':                       'Wages',
    'payroll':                     'Wages',
    'rent':                        'Rent or Lease (Other Business Property)',
    'supplies':                    'Supplies',
    'repairs':                     'Repairs & Maintenance',
    'repairs & maintenance':       'Repairs & Maintenance',
  };

  /**
   * Maps a bank CSV category string to a QuickBooks category.
   * @param {string} csv
   * @returns {string}
   */
  function mapCategory(csv) {
    return CATEGORY_MAP[csv.toLowerCase().trim()] ?? 'Uncategorized';
  }

  /**
   * Parses a single CSV line respecting RFC 4180 quoting.
   * Handles fields containing commas wrapped in double-quotes.
   * @param {string} line
   * @returns {string[]}
   */
  function parseCSVLine(line) {
    const fields = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        // Escaped quote inside a quoted field ("" → ")
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        fields.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    fields.push(cur);
    return fields;
  }

  /**
   * Parses a bank date string "M/D/YYYY" into ISO "YYYY-MM-DD".
   * @param {string} str
   * @returns {string}
   */
  function parseDate(str) {
    const [m, d, y] = str.split('/');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // ---------------------------------------------------------------------------
  // Component state
  // ---------------------------------------------------------------------------

  let paymentMethod = $state('');
  let parsedRows    = $state([]);   // [{date, vendor, amount, category, description}]
  let fileError     = $state('');
  let importing     = $state(false);
  let result        = $state(null); // {imported, skipped, errors} after import

  /** Payment method options from businessConfig + default Cash */
  let paymentMethods = $derived(['Cash', ...($businessConfig?.payment_accounts ?? [])]);

  /**
   * Reads the selected CSV file, parses it, and filters to debit rows only.
   * @param {Event} e
   */
  async function handleFile(e) {
    fileError = '';
    result = null;
    parsedRows = [];
    const file = e.target.files?.[0];
    if (!file) return;

    let text;
    try {
      text = await file.text();
    } catch {
      fileError = 'Could not read file.';
      return;
    }

    const lines = text.trim().split('\n');
    // Skip header row (index 0)
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const fields = parseCSVLine(line);
      // Only import Debit transactions
      if (fields[COL_TYPE]?.trim() !== 'Debit') continue;

      const rawAmount = parseFloat(fields[COL_AMOUNT] ?? '0');
      if (isNaN(rawAmount)) continue;

      rows.push({
        date:        parseDate(fields[COL_POSTING_DATE]?.trim() ?? ''),
        vendor:      fields[COL_DESCRIPTION]?.trim() ?? '',
        amount:      Math.abs(rawAmount),
        category:    mapCategory(fields[COL_CATEGORY]?.trim() ?? ''),
        description: fields[COL_EXTENDED_DESC]?.trim() ?? '',
      });
    }

    if (rows.length === 0) {
      fileError = 'No debit transactions found in this file.';
      return;
    }

    parsedRows = rows;
  }

  /**
   * Enqueues all parsed rows as expense transactions, skipping duplicates.
   * Dedup key: date|vendor|amount within the selected business.
   */
  async function handleImport() {
    if (!paymentMethod || !parsedRows.length || !$selectedBusiness) return;
    importing = true;
    result = null;

    let imported = 0, skipped = 0, errors = 0;

    try {
      // Build dedup set from existing transactions for each year in the import.
      const years = [...new Set(parsedRows.map((r) => parseInt(r.date.slice(0, 4), 10)))];
      const dedupKeys = new Set();
      for (const year of years) {
        const existing = await queryTransactions($selectedBusiness.id, year, 'expense');
        for (const t of existing) {
          dedupKeys.add(`${t.date}|${t.vendor}|${t.amount}`);
        }
      }

      for (const row of parsedRows) {
        const key = `${row.date}|${row.vendor}|${row.amount}`;
        if (dedupKeys.has(key)) { skipped++; continue; }

        try {
          const year = parseInt(row.date.slice(0, 4), 10);
          await enqueueCreate({
            businessId:    $selectedBusiness.id,
            type:          'expense',
            year,
            date:          row.date,
            vendor:        row.vendor,
            description:   row.description,
            amount:        row.amount,
            category:      row.category,
            paymentMethod,
            notes:         '',
            submittedBy:   $userEmail ?? '',
          });
          // Add to dedup set so a single-file re-run won't double-import
          dedupKeys.add(key);
          imported++;
        } catch {
          errors++;
        }
      }
    } catch (err) {
      console.error('[csv-import] import failed:', err);
      errors = parsedRows.length;
    } finally {
      importing = false;
      result = { imported, skipped, errors };
      // Clear state so user can start a new import
      parsedRows = [];
    }
  }
</script>

<div class="px-4 py-6 flex flex-col gap-6 max-w-lg mx-auto">

  <!-- Back + heading -->
  <div>
    <a
      href="/settings"
      class="text-sm mb-3 inline-flex items-center gap-1 hover:opacity-70 transition-opacity"
      style="color: var(--color-primary);"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      Settings
    </a>
    <h1 class="text-xl font-bold" style="color: var(--color-text);">Import bank CSV</h1>
    <p class="text-sm mt-1" style="color: var(--color-text-muted);">
      Imports all debit transactions from your bank export. Credits and duplicates are skipped.
    </p>
  </div>

  {#if !$selectedBusiness}
    <p class="text-sm" style="color: var(--color-text-muted);">
      No business selected. <a href="/" style="color: var(--color-primary);">Go home</a> and select one first.
    </p>
  {:else}

    <!-- Payment method -->
    <div class="flex flex-col gap-1">
      <label class="text-sm font-medium" style="color: var(--color-text);" for="payment-method">
        Payment account <span style="color: var(--color-error);">*</span>
      </label>
      <select
        id="payment-method"
        bind:value={paymentMethod}
        class="rounded-xl border px-3 text-base"
        style="
          min-height: 44px;
          background-color: var(--color-surface-2);
          border-color: var(--color-border);
          color: var(--color-text);
        "
      >
        <option value="">Select account…</option>
        {#each paymentMethods as m}
          <option value={m}>{m}</option>
        {/each}
      </select>
      <p class="text-xs" style="color: var(--color-text-muted);">
        All imported transactions will be assigned this payment method.
      </p>
    </div>

    <!-- File picker -->
    <div class="flex flex-col gap-1">
      <label class="text-sm font-medium" style="color: var(--color-text);" for="csv-file">
        CSV file
      </label>
      <input
        id="csv-file"
        type="file"
        accept=".csv,text/csv"
        onchange={handleFile}
        class="text-sm"
        style="color: var(--color-text);"
      />
      {#if fileError}
        <p class="text-sm" style="color: var(--color-error);" role="alert">{fileError}</p>
      {/if}
    </div>

    <!-- Preview -->
    {#if parsedRows.length > 0}
      <div class="flex flex-col gap-3">
        <p class="text-sm font-medium" style="color: var(--color-text);">
          {parsedRows.length} debit transaction{parsedRows.length === 1 ? '' : 's'} found
        </p>

        <!-- First 5 rows preview -->
        <div class="rounded-xl border overflow-hidden" style="border-color: var(--color-border);">
          <table class="w-full text-xs">
            <thead>
              <tr style="background-color: var(--color-surface-2); color: var(--color-text-muted);">
                <th class="text-left px-3 py-2 font-medium">Date</th>
                <th class="text-left px-3 py-2 font-medium">Vendor</th>
                <th class="text-right px-3 py-2 font-medium">Amount</th>
                <th class="text-left px-3 py-2 font-medium">Category</th>
              </tr>
            </thead>
            <tbody class="divide-y" style="border-color: var(--color-border);">
              {#each parsedRows.slice(0, 5) as row}
                <tr style="color: var(--color-text);">
                  <td class="px-3 py-2 whitespace-nowrap">{row.date}</td>
                  <td class="px-3 py-2 truncate max-w-[120px]">{row.vendor}</td>
                  <td class="px-3 py-2 text-right whitespace-nowrap">${row.amount.toFixed(2)}</td>
                  <td class="px-3 py-2 truncate max-w-[100px]">{row.category}</td>
                </tr>
              {/each}
              {#if parsedRows.length > 5}
                <tr>
                  <td colspan="4" class="px-3 py-2 text-center" style="color: var(--color-text-muted);">
                    … and {parsedRows.length - 5} more
                  </td>
                </tr>
              {/if}
            </tbody>
          </table>
        </div>

        <!-- Import button -->
        <button
          onclick={handleImport}
          disabled={!paymentMethod || importing}
          class="w-full rounded-xl font-medium text-base transition-opacity hover:opacity-80 disabled:opacity-50"
          style="min-height: 48px; background-color: var(--color-primary); color: #ffffff;"
          aria-busy={importing}
        >
          {#if importing}
            Importing…
          {:else if !paymentMethod}
            Select a payment account first
          {:else}
            Import {parsedRows.length} transaction{parsedRows.length === 1 ? '' : 's'}
          {/if}
        </button>
      </div>
    {/if}

    <!-- Result -->
    {#if result}
      <div
        class="rounded-xl border px-4 py-3 flex flex-col gap-1"
        style="border-color: var(--color-border); background-color: var(--color-surface-2);"
        role="status"
      >
        <p class="text-sm font-medium" style="color: var(--color-text);">Import complete</p>
        <p class="text-sm" style="color: var(--color-text-muted);">
          {result.imported} imported
          {#if result.skipped > 0}· {result.skipped} duplicate{result.skipped === 1 ? '' : 's'} skipped{/if}
          {#if result.errors > 0}· <span style="color: var(--color-error);">{result.errors} error{result.errors === 1 ? '' : 's'}</span>{/if}
        </p>
        {#if result.imported > 0}
          <a href="/history" class="text-sm mt-1" style="color: var(--color-primary);">
            View in history →
          </a>
        {/if}
      </div>
    {/if}

  {/if}
</div>
