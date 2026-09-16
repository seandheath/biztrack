<svelte:head>
  <title>Privacy Policy — BizTrack</title>
</svelte:head>

<div class="max-w-2xl mx-auto px-6 py-12" style="color: var(--color-text); font-family: system-ui, sans-serif;">
  <h1 style="font-size: 1.75rem; font-weight: 700; margin-bottom: 0.25rem;">Privacy Policy</h1>
  <p style="color: var(--color-text-muted); margin-bottom: 2rem;">Last updated: September 2026</p>

  <section style="margin-bottom: 2rem;">
    <h2 style="font-size: 1.125rem; font-weight: 600; margin-bottom: 0.75rem;">Overview</h2>
    <p>BizTrack is a browser-based expense and mileage tracking tool. It has no backend server — your data is stored entirely in your own Google Drive account. We do not collect, transmit, or store your personal information on any server we operate.</p>
  </section>

  <section style="margin-bottom: 2rem;">
    <h2 style="font-size: 1.125rem; font-weight: 600; margin-bottom: 0.75rem;">Data Storage</h2>
    <p>All expense records, mileage logs, receipt photos, and configuration data are stored in your Google Drive account, in folders and spreadsheets that you control. You can view, edit, or delete this data at any time directly in Google Drive.</p>
  </section>

  <section style="margin-bottom: 2rem;">
    <h2 style="font-size: 1.125rem; font-weight: 600; margin-bottom: 0.75rem;">Google Account Access</h2>
    <p>BizTrack uses Google Sign-In and requests the <code style="background: var(--color-surface-3); padding: 0.1em 0.3em; border-radius: 3px;">drive</code> permission scope. This scope allows BizTrack to read and write files in your Google Drive so it can manage business folders you select — including folders on Shared Drives created by other users. BizTrack only accesses the specific folders you choose; it does not scan or modify unrelated files. Your short-lived access token and its expiry are saved in this browser so they can be reused until Google expires the token. Tokens are sent only to Google; BizTrack operates no authentication server and stores no refresh tokens. The granted permission technically allows access across your Drive, although BizTrack uses it for its app folder and the business folders you select.</p>
  </section>

  <section style="margin-bottom: 2rem;">
    <h2 style="font-size: 1.125rem; font-weight: 600; margin-bottom: 0.75rem;">Local Storage</h2>
    <p>BizTrack stores your account email, access token, business configuration, cached transaction records, preferences, and any pending offline changes in this browser. Pending changes are sent to Google when synced. Receipts received through the Android share feature can be held temporarily in the browser cache. These local copies are not encrypted by BizTrack and may be accessible to someone with access to your browser profile. Reconnecting before viewing the workspace is an app interface control, not encryption.</p>
  </section>

  <section style="margin-bottom: 2rem;">
    <h2 style="font-size: 1.125rem; font-weight: 600; margin-bottom: 0.75rem;">Sign Out and Disconnect</h2>
    <p>Sign Out clears account data from this device without revoking Google permission. Disconnect Google Drive also asks Google to revoke BizTrack's grant, which can affect your other devices. Neither action deletes your Drive files. Sync pending changes first, or explicitly choose to discard them. Clearing browser site data also removes local copies and any unsynced work. Unfinished forms survive reconnection within the page, but are not backed up across browser termination or manual reload.</p>
  </section>

  <section style="margin-bottom: 2rem;">
    <h2 style="font-size: 1.125rem; font-weight: 600; margin-bottom: 0.75rem;">Analytics & Tracking</h2>
    <p>BizTrack does not use analytics, advertising trackers, cookies, or any third-party tracking services. No usage data is collected.</p>
  </section>

  <section style="margin-bottom: 2rem;">
    <h2 style="font-size: 1.125rem; font-weight: 600; margin-bottom: 0.75rem;">Third-Party Services</h2>
    <p>BizTrack interacts with the following Google services on your behalf:</p>
    <ul style="margin-top: 0.5rem; padding-left: 1.5rem; line-height: 2;">
      <li>Google Identity Services (authentication)</li>
      <li>Google Drive API (file storage)</li>
      <li>Google Sheets API (expense ledger)</li>
    </ul>
    <p style="margin-top: 0.75rem;">Your use of these services is governed by <a href="https://policies.google.com/privacy" style="color: var(--color-primary);">Google's Privacy Policy</a>.</p>
  </section>

  <section style="margin-bottom: 2rem;">
    <h2 style="font-size: 1.125rem; font-weight: 600; margin-bottom: 0.75rem;">Contact</h2>
    <p>Questions about this privacy policy can be sent to <a href="mailto:info@biztrack.lol" style="color: var(--color-primary);">info@biztrack.lol</a>.</p>
  </section>

  <p style="margin-top: 3rem;">
    <a href="/" style="color: var(--color-primary);">← Back to BizTrack</a>
    &nbsp;·&nbsp;
    <a href="/terms" style="color: var(--color-primary);">Terms of Service</a>
  </p>
</div>
