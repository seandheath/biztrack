# BizTrack

Zero-backend PWA for tracking business expenses and mileage across multiple LLCs. All data lives in the user's own Google Drive — BizTrack has no server, no database, and no third-party data storage. The app is a SvelteKit static SPA that talks directly to Google Drive, Sheets, and Picker APIs from the browser.

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | SvelteKit 2 + Svelte 5 (runes API) |
| Output | `adapter-static` — pure SPA, `fallback: '404.html'` |
| Styling | Tailwind CSS v4, CSS custom properties for theming |
| Auth | Google Identity Services (GIS) token model — memory-only, no backend |
| Storage | Google Drive (files) + Google Sheets (ledger) via raw `fetch()` |
| PWA | `@vite-pwa/sveltekit`, `injectManifest`, Web Share Target (Android) |
| Deployment | GitHub Pages, custom domain `biztrack.lol`, GitHub Actions CI |

---

## Prerequisites

- Node.js 20+ (or use `nix develop`)
- A Google Cloud project with Drive, Sheets, and Picker APIs enabled
- An OAuth 2.0 client ID (Web application type) and an API key

See [`docs/google_cloud_setup.md`](docs/google_cloud_setup.md) for step-by-step Google Cloud configuration.

---

## Dev Setup

```sh
# Using Nix (recommended — provides Node, npm, and all tools)
nix develop
npm install
npm run dev

# Or directly with Node 20+
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
