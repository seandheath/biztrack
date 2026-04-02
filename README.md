# BizTrack

Zero-backend PWA for tracking business expenses and mileage across multiple LLCs. All data lives in the user's own Google Drive — BizTrack has no server, no database, and no third-party data storage. The app is a SvelteKit static SPA that talks directly to Google Drive and Sheets APIs from the browser.

---

## Features

- **Multi-business support** — manage any number of LLCs from one account; access controlled by Google Drive folder sharing
- **Expense tracking** — vendor autocomplete, customizable categories and payment methods, receipt capture with client-side JPEG compression (or PDF pass-through)
- **Mileage tracking** — round-trip toggle, saved favorite routes
- **Transaction history** — browse and search past entries by year and type
- **Uncategorized review** — step-through workflow for categorizing imported or uncategorized transactions
- **CSV bank import** — parse bank export CSVs with smart vendor/category matching from existing data
- **Custom folder browser** — browse My Drive, Shared Drives, and Shared with Me folders directly via the Drive API (no Google Picker iframe)
- **Web Share Target** — on Android, share receipt images directly into BizTrack from the camera or file manager
- **PWA** — installable with offline shell caching, dark/light theme, safe-area-aware layout

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | SvelteKit 2 + Svelte 5 (runes API) |
| Output | `adapter-static` — pure SPA, `fallback: '404.html'` |
| Styling | Tailwind CSS v4, CSS custom properties for theming |
| Auth | Google Identity Services (GIS) token model — memory-only, no backend |
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
  config.json              # categories, payment methods, mileage favorites
  2026/
    2026_expenses           # Google Sheet (Expenses + Mileage tabs)
    2026_Receipts/          # uploaded receipt images/PDFs

BizTrack/                   # app-level folder in user's Drive root
  profile.json              # business index (name, folderId, configId)
```

Each year gets its own subfolder, spreadsheet, and receipts folder. The spreadsheet has an **Expenses** tab (date, vendor, description, amount, category, payment method, receipt ID, notes, submitter, UUID) and a **Mileage** tab (date, from, to, purpose, miles, submitter, UUID).

---

## Prerequisites

- Node.js 22+ (or use `nix develop`)
- A Google Cloud project with Drive and Sheets APIs enabled
- An OAuth 2.0 client ID (Web application type) and an API key

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
VITE_GOOGLE_API_KEY=<your API key>
VITE_GOOGLE_APP_ID=<your GCP project number>
```

---

## Build & Deploy

```sh
npm run build   # outputs to build/
```

GitHub Actions (`.github/workflows/deploy.yml`) automatically builds and deploys to GitHub Pages on every push to `main`. No manual deploy step needed.

---

## Docs

- [`docs/specification.md`](docs/specification.md) — Full feature specification
- [`docs/log.md`](docs/log.md) — Architectural decision log with rationale
- [`docs/google_cloud_setup.md`](docs/google_cloud_setup.md) — Google Cloud setup guide

---

## License

[AGPL-3.0-only](LICENSE)
