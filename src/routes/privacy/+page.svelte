<script>
  import { resolve } from '$app/paths';
</script>

<svelte:head>
  <title>Privacy Policy — BizTrack</title>
</svelte:head>

<div class="policy max-w-2xl mx-auto px-6 py-10">
  <h1>Privacy Policy</h1>
  <p class="text-sm" style="color: var(--color-text-muted);">Updated: 17 September 2026</p>

  <h2>Data locations</h2>
  <dl>
    <dt>Your Google Drive</dt>
    <dd>Expense/mileage spreadsheets, receipts, business configuration, personal preferences. Access controlled by Drive sharing.</dd>
    <dt>Your browser</dt>
    <dd>Account email, access token/expiry, cached records, preferences, pending writes, temporary shared receipts. No BizTrack encryption of local copies.</dd>
    <dt>BizTrack</dt>
    <dd>Static app files; no application server or business-data database. Records sync directly between your browser and Google.</dd>
    <dt>Demo</dt>
    <dd>Sample records and edits: tab memory only; reset on reload. No Google connection. Static app files cached on device.</dd>
  </dl>

  <h2>Google permission</h2>
  <ul>
    <li><strong>Full Drive access:</strong> <code>drive</code> scope; permission to view, create, modify, and delete Drive files.</li>
    <li><strong>App use:</strong> list folders/shared drives for selection; manage the BizTrack profile folder and selected business folders.</li>
    <li><strong>Folder selection:</strong> app behavior; not a restriction on the Google permission grant.</li>
    <li><strong>Tokens:</strong> stored in this browser; sent to Google; no refresh tokens or BizTrack authentication server.</li>
  </ul>

  <h2>Retention and deletion</h2>
  <ul>
    <li><strong>Data upgrades:</strong> original spreadsheets and profiles retained in Drive; pending-write backup retained on this device until sign-out or site-data deletion.</li>
    <li><strong>Drive files:</strong> retained until deleted through Drive or an authorized action; editable/exportable in Drive and Sheets.</li>
    <li><strong>Sign Out:</strong> clears this version's local account data; retains Google permission and Drive files.</li>
    <li><strong>Disconnect Google Drive:</strong> also revokes the grant; may affect other versions/devices; retains Drive files.</li>
    <li><strong>Pending writes:</strong> sync or explicitly discard before sign-out/disconnection. Clearing site data deletes unsynced work.</li>
    <li><strong>Unfinished forms:</strong> retained during reconnection; lost on reload/browser termination.</li>
    <li><strong>Shared devices:</strong> sign out; browser-profile access can expose local copies.</li>
  </ul>

  <h2>Hosting and third parties</h2>
  <ul>
    <li><strong>App analytics:</strong> none; no advertising trackers or app-set cookies.</li>
    <li><strong>GitHub Pages:</strong> serves app files; logs visitor IP addresses for security. <a href="https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#data-collection">Hosting data collection</a>.</li>
    <li><strong>Google:</strong> sign-in, Drive, Sheets; processing under <a href="https://policies.google.com/privacy">Google's Privacy Policy</a>.</li>
    <li><strong>Hosted code:</strong> controlled by site maintainers. Fixed release archives are immutable; website hosting remains mutable.</li>
  </ul>

  <h2>Contact</h2>
  <ul>
    <li><a href="mailto:info@biztrack.lol">info@biztrack.lol</a></li>
    <li>Email contact: your address and message shared with the recipient/email providers; exclude private records and tokens.</li>
  </ul>

  <nav aria-label="Policy navigation">
    <a href={resolve('/')}>← Back to BizTrack</a>
    <a href={resolve('/terms')}>Terms of Service</a>
  </nav>
</div>
