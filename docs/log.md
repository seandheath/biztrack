# Decisions

- **Audience:** maintainers evaluating architectural changes.
- **Current behavior:** [specification](specification.md).

| Date | Decision | Reason / boundary |
|---|---|---|
| 2026-09-17 | Data model 2; manual mileage; explicit upgrade | Copy and verify spreadsheets; preserve originals; remap current-installation pending writes; no runtime legacy model. Driver history spans all business years. |
| 2026-09-17 | Moves and split replacements: copy → read back → delete | Preserve originals until replacement verification; stable IDs for unchanged retries; one durable queued operation; no cross-sheet atomicity. |
| 2026-09-16–17 | Editable demo; separate in-memory data per tab | No Google access; distinct businesses and years; reset on reload. |
| 2026-09-16 | Beta plus archived fixed releases | Automatic updates or user-selected upgrades; immutable release archives, mutable website hosting. |
| 2026-09-16 | Shared refresh, pagination, transaction links | Remove duplicate logic; retain data formats and auth/queue protections. |
| 2026-09-16 | Browser-local tokens and caches; explicit reconnection | Preserve forms; verify account; retry rejected HTTP 401 once; separate sign-out from revocation. |
| 2026-03-27 | Static SvelteKit/Svelte 5 app; GitHub Pages | Browser execution; no application server. |
| 2026-03-27 | Google Drive/Sheets storage; direct `fetch()` | User-controlled files and Drive sharing; no Google API client SDK. |
| 2026-03-27 | Custom service worker (`injectManifest`) | App caching and Android receipt-share POST handling. |
| 2026-03-27 | Canvas receipt compression | JPEG, quality 0.7, maximum 1920px; PDFs unchanged. |
| 2026-03-27 | Business/year folders | Separate ledgers and receipts by business and year. |

## Superseded designs

| Earlier design | Current replacement |
|---|---|
| Memory-only, then `sessionStorage` tokens | `localStorage` token/expiry; account verification before exposing cached workspace. |
| Google Picker and `drive.file` | Built-in folder browser; full `drive` scope for current discovery/shared-folder workflows. |
| Indefinite OAuth Testing mode | Production audience and applicable verification for public use. |
| SPA fallback HTML routing | Prerendered directory indexes; scoped service workers. |
| Shared payment accounts/favorites in business config | Free-text payment autocomplete; personal favorites/default drivers in `profile-v2.json`. |
| Offline queue deferred | Durable localStorage queue, including compound replacements. |
| Delete before replacement write | Copy, verify, then delete. |
