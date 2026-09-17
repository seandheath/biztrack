<script>
  import { resolve } from '$app/paths';
</script>

<svelte:head>
  <title>Terms of Service — BizTrack</title>
</svelte:head>

<div class="policy max-w-2xl mx-auto px-6 py-10">
  <h1>Terms of Service</h1>
  <p class="text-sm" style="color: var(--color-text-muted);">Updated: 17 September 2026</p>

  <h2>Use</h2>
  <ul>
    <li><strong>Acceptance:</strong> using BizTrack constitutes agreement to these terms; otherwise, do not use it.</li>
    <li><strong>Purpose:</strong> expense, receipt, and mileage recordkeeping.</li>
    <li><strong>Advice:</strong> no tax, legal, or financial advice; consult a qualified professional.</li>
    <li><strong>Google services:</strong> subject to <a href="https://policies.google.com/terms">Google's Terms of Service</a>.</li>
  </ul>

  <h2>Your responsibilities</h2>
  <ul>
    <li>Maintain Google account access, accurate records, and appropriate Drive sharing permissions.</li>
    <li>Back up spreadsheets and receipts.</li>
    <li>Sync pending writes before clearing browser data or switching versions.</li>
    <li>Demo edits: disposable; reset on reload.</li>
  </ul>

  <h2>Availability and liability</h2>
  <ul>
    <li><strong>Warranty:</strong> provided as-is, without warranties, to the extent permitted by law.</li>
    <li><strong>Availability:</strong> service may change, suspend, or end without notice; no uptime or continued-hosting guarantee.</li>
    <li><strong>Liability:</strong> to the extent permitted by law, BizTrack and its operators are not liable for data loss, financial loss, or other damages from use.</li>
    <li><strong>Examples:</strong> account access loss, browser-data clearing, failed synchronization, service discontinuation.</li>
  </ul>

  <nav aria-label="Policy navigation">
    <a href={resolve('/')}>← Back to BizTrack</a>
    <a href={resolve('/privacy')}>Privacy Policy</a>
  </nav>
</div>
