<script>
  // Settings screen (Phase 7.3).
  // Sections: Manage Businesses, Payment Methods, Mileage Favorites, Account.
</script>

<div class="px-4 py-6 flex flex-col gap-6 max-w-lg mx-auto">
  <section>
    <h2 class="text-base font-semibold mb-3" style="color: var(--color-text-muted);">BUSINESSES</h2>
    <div class="rounded-xl border divide-y" style="border-color: var(--color-border); background-color: var(--color-surface-2);">
      <a href="/settings/business" class="flex items-center justify-between px-4 rounded-t-xl hover:opacity-70 transition-opacity" style="color: var(--color-primary);">
        <span class="text-base">Add Business</span>
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </a>
    </div>
  </section>

  <section>
    <h2 class="text-base font-semibold mb-3" style="color: var(--color-text-muted);">PER-BUSINESS</h2>
    <div class="rounded-xl border divide-y" style="border-color: var(--color-border); background-color: var(--color-surface-2);">
      <a href="/settings/payments" class="flex items-center justify-between px-4 hover:opacity-70 transition-opacity" style="color: var(--color-text);">
        <span class="text-base">Payment Methods</span>
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </a>
      <a href="/settings/favorites" class="flex items-center justify-between px-4 rounded-b-xl hover:opacity-70 transition-opacity" style="color: var(--color-text);">
        <span class="text-base">Mileage Favorites</span>
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </a>
    </div>
  </section>

  <section>
    <h2 class="text-base font-semibold mb-3" style="color: var(--color-text-muted);">ACCOUNT</h2>
    <div class="rounded-xl border px-4 py-3" style="border-color: var(--color-border); background-color: var(--color-surface-2); color: var(--color-text-muted);">
      <p class="text-sm">Sign-in coming in Phase 2.</p>
    </div>
  </section>
</div>
