<script lang="ts">
  import { runUpgrade, type UpgradePlan } from '$lib/upgrade.js';
  let { plan, oncomplete = () => window.location.reload() }: { plan: UpgradePlan; oncomplete?: () => void } = $props();
  let running = $state(false);
  let progress = $state('');
  let error = $state('');
  let acknowledged = $state(false);
  async function upgrade() {
    running = true;
    error = '';
    try {
      await runUpgrade(plan, message => { progress = message; });
      oncomplete();
    } catch (err) { error = err instanceof Error ? err.message : 'Upgrade failed. Your originals are preserved.'; }
    finally { running = false; }
  }
</script>

<section class="px-4 py-6 max-w-lg mx-auto flex flex-col gap-4" aria-labelledby="upgrade-title">
  <h1 id="upgrade-title" class="text-xl font-semibold">Upgrade your data</h1>
  <p>Mileage entries will use a description and total miles. Your original spreadsheets and profile stay in Drive as backups.</p>
  <ul class="list-disc pl-5">
    {#each plan.businesses as business}
      <li>{business.name}: {business.years.map(year => year.year).join(', ') || 'no existing logs'}{business.upgraded ? ' (already upgraded)' : ''}</li>
    {/each}
  </ul>
  <p>After upgrading, use BizTrack 0.2 or later. Older versions use the original files; their later changes will not carry over.</p>
  <label class="flex items-start gap-3">
    <input type="checkbox" bind:checked={acknowledged} disabled={running} class="mt-1" style="width:24px;height:24px;flex-shrink:0" />
    <span>I’ve synced other installations and closed older versions.</span>
  </label>
  {#if plan.localQueue}<p>Pending changes on this installation will be carried over.</p>{/if}
  {#if progress}<p role="status">{progress}</p>{/if}
  {#if error}<p role="alert" style="color: var(--color-error)">{error}</p>{/if}
  <button type="button" onclick={upgrade} disabled={!acknowledged || running} class="rounded-xl px-4 font-semibold disabled:opacity-50" style="min-height:48px;background:var(--color-primary);color:var(--color-primary-text)">
    {running ? 'Upgrading…' : error ? 'Retry upgrade' : 'Back up & upgrade'}
  </button>
  {#if !running}<a href="https://biztrack.lol/" class="text-center underline">Not now</a>{/if}
</section>
