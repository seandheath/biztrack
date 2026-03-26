<script>
  // Web Share Target handler (Android only — Phase 9.4).
  // The PWA manifest registers /share as the share_target action.
  // When an Android user shares a receipt from another app, this page receives the file.
  // This page will read the shared file from the service worker FormData POST and
  // redirect to the main expense form with the receipt pre-attached.
</script>

<div class="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center gap-4">
  <h2 class="text-xl font-semibold" style="color: var(--color-text);">Share Handler</h2>
  <p style="color: var(--color-text-muted);">
    Android Web Share Target coming in Phase 9.
  </p>
</div>
