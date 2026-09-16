# BizTrack

Zero-backend PWA for tracking business expenses and mileage across multiple LLCs. All data lives in the user's own Google Drive — BizTrack has no server, no database, and no third-party data storage. The app is a SvelteKit static SPA that talks directly to Google Drive and Sheets APIs from the browser.

---

## Features

- **Multi-business support** — manage any number of LLCs from one account; access controlled by Google Drive folder sharing
- **Expense tracking** — vendor autocomplete, customizable categories and payment-method autocomplete, receipt capture with client-side JPEG compression (or PDF pass-through)
- **Mileage tracking** — round-trip toggle, driver autocomplete/defaults, and personal favorite routes
- **Transaction history** — browse expenses and mileage by year, then open entries to edit
- **Uncategorized review** — step-through workflow for categorizing imported or uncategorized transactions
- **CSV bank import** — parse bank export CSVs with smart vendor/category matching from existing data
- **Custom folder browser** — browse My Drive, Shared Drives, and Shared with Me folders directly via the Drive API (no Google Picker iframe)
- **Web Share Target** — Android image/PDF share registration and receipt handoff (see known limitations in the specification)
- **PWA** — installable with offline shell caching, dark theme, safe-area-aware layout

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | SvelteKit 2 + Svelte 5 (runes API) |
| Output | `adapter-static` — pure SPA, `fallback: '404.html'` |
| Styling | Tailwind CSS v4, CSS custom properties for theming |
| Auth | Google Identity Services (GIS) token model — short-lived token reuse and explicit reconnect, no backend |
| Storage | Google Drive (files) + Google Sheets (ledger) via raw `fetch()` |
| Folder Selection | Custom FolderBrowser component (Drive API v3 direct) |
| PWA | `@vite-pwa/sveltekit`, `injectManifest`, Web Share Target (Android) |
| Deployment | GitHub Pages, custom domain `biztrack.lol`, GitHub Actions CI |
| License | AGPL-3.0-only |

---

## Drive Data Structure

All business data lives in the user's Google Drive. BizTrack creates and manages this structure:

```
<Business Folder>/
  config.json              # business UUID, name, and shared categories
  2026/
    2026_<name>_expenses    # Google Sheet (Expenses + Mileage tabs)
    2026_<name>_Receipts/   # uploaded receipt images/PDFs

BizTrack/                   # app-level folder in user's Drive root
  profile.json              # business index, personal favorites/default drivers
```

Each year gets its own subfolder, spreadsheet, and receipts folder. The spreadsheet has an **Expenses** tab (date, vendor, description, amount, category, payment method, receipt filename, notes, submitter, UUID) and a **Mileage** tab (date, from, to, purpose, miles, submitter, UUID, driver).

---

## Prerequisites

- Node.js 22+ (or use `nix develop`)
- A Google Cloud project with Drive and Sheets APIs enabled
- An OAuth 2.0 client ID (Web application type)

See [`docs/google_cloud_setup.md`](docs/google_cloud_setup.md) for step-by-step Google Cloud configuration.

---

## Dev Setup

```sh
# Using Nix (recommended — provides Node, npm, and all tools)
nix develop
npm install
npm run dev

# Or directly with Node 22+
npm install
npm run dev
```

Copy `.env.example` to `.env` and fill in your credentials:

```sh
cp .env.example .env
```

```env
VITE_GOOGLE_CLIENT_ID=<your OAuth client ID>
```

---

## Google reconnection

The app reuses a saved access token until Google expires it (usually about an hour).
On returning with expired access, reconnect before viewing your business data.
During entry, reconnecting preserves the mounted form and receipt; waiting API calls
resume after the same Google account is verified. Only a request rejected with HTTP
401 is retried, once. Network failures do not automatically replay writes.

**Sign Out** clears this device without revoking Google permission. **Disconnect
Google Drive** also revokes the grant, including its use on other devices. Pending
offline changes must be synced or explicitly discarded before either action.

Local storage contains tokens, the account email, cached business data, and existing
offline writes. This is not an encrypted vault; protect your browser profile and sign
out on shared devices. Reconnection preserves work in the current page, not after a
browser termination or manual reload. App updates offer a safe reload instead of
interrupting an entry form.

Run `npm test` for auth and cleanup regression checks. Google Testing mode still expires
consent after seven days; see the setup guide for production configuration.

---

## Build & Deploy

```sh
npm test        # auth, data loading, Drive operations, and form regressions
npm run check   # TypeScript modules; plain-JS Svelte scripts are not type-checked
npm run build   # compiles Svelte and outputs to build/
```

GitHub Actions (`.github/workflows/deploy.yml`) runs these checks, then builds and deploys to GitHub Pages on every push to `main`. No manual deploy step needed.

---

## Docs

- [`docs/specification.md`](docs/specification.md) — Current behavior, data formats, limitations, and release checks
- [`docs/log.md`](docs/log.md) — Architectural decision log with rationale
- [`docs/google_cloud_setup.md`](docs/google_cloud_setup.md) — Google Cloud setup guide

---

## License

[AGPL-3.0-only](LICENSE)
